"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type CalendarViewData,
  type TaskCard,
  type TimeEntry,
  type TimeEntrySummary,
  type TimeEntrySummaryScope,
  getCalendarView,
  getTimeEntrySummary,
  listTimeEntries,
  stopTimeEntry,
  updateTaskCard,
} from "@/lib/api";
import { VizBarChart, VizLineChart } from "./charts";
import { formatDuration } from "@/lib/timeTracking/period";
import { useCurrentUser } from "@/lib/swr";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import { useConfirm } from "@/components/ConfirmProvider";
import { logger } from "@/lib/logger";
import { AgendaSection } from "./AgendaSection";
import { CategorySection } from "./CategorySection";
import { cardStyle, chipStyle, numericStyle, sectionTitleStyle } from "./shared";

/**
 * /time — 時間追蹤儀表板（獨立極簡頁）。
 *
 * 定位：加到 iPhone 主畫面、點開一眼看完「今日／本週把時間花在哪」的專用頁。
 * - 無站內導覽：本頁沒有任何連到其他頁的連結；其他頁也不連到這裡
 *   （標題列與側欄由 globals.css 的 html[data-route="time"] 規則整組隱藏）。
 * - 資料來源：GET /api/time-entries/summary?scope=day|week（與 iOS 小工具同一個端點；
 *   歸日／週依「帳號時區」由後端計算，與網頁面板口徑一致）。
 * - 行程（行事曆）：以彙總回傳的同一組 [from,to) 範圍打 GET /api/calendar，
 *   顯示範圍內的任務（依 Planned/Due 落點，語意與 /calendar 頁一致、重複規則不展開）；
 *   可直接勾完成／取消完成（快速狀態更新不帶樂觀鎖版本＝last-write-wins，比照任務頁拖曳）。
 * - 進行中項目的秒數即時跳動：後端給的是查詢當下快照，前端以「距取得時間的差」補算。
 * - 結束計時要先過確認框（結束後無法復原成進行中，僅能改時間）。
 * - 自動更新：切回分頁／視窗聚焦時重抓＋每 60 秒背景重抓（含行程）。
 */

/** 自動背景重抓的間隔（毫秒）。 */
const AUTO_REFRESH_MS = 60_000;

/** 範圍偏好的 localStorage 鍵（記住上次看「今日」還是「本週」）。 */
const SCOPE_STORAGE_KEY = "zonwiki:time-dashboard:scope";

/** 進行中即時跳動的重繪間隔（毫秒）。 */
const TICK_MS = 1_000;

// 共用樣式（sectionTitleStyle 等）在 ./shared.ts，各區塊元件共用。

/**
 * 時間追蹤儀表板頁。
 */
export default function TimeDashboardPage() {
  const confirm = useConfirm();

  // 帳號時區（行程的歸日與時刻顯示用；與首頁面板同一來源與 fallback）。
  const { data: user } = useCurrentUser();
  const tz = user?.timeZone || DEFAULT_TIMEZONE;

  // ── 範圍（今日/本週；記住偏好） ──
  // null＝偏好尚未從 localStorage 還原。首次抓資料等偏好還原後才發，
  // 避免偏好「本週」的使用者每次開頁都先多打一次「今日」的 API 並閃過錯的畫面。
  const [scope, setScope] = useState<TimeEntrySummaryScope | null>(null);
  useEffect(() => {
    let saved: TimeEntrySummaryScope = "day";
    try {
      if (localStorage.getItem(SCOPE_STORAGE_KEY) === "week") saved = "week";
    } catch {
      /* localStorage 不可用（隱私模式等）時維持預設「今日」 */
    }
    setScope(saved);
  }, []);
  /** UI 顯示用的範圍（偏好還原前先當「今日」渲染，避免水合不一致）。 */
  const effectiveScope: TimeEntrySummaryScope = scope ?? "day";
  const switchScope = (next: TimeEntrySummaryScope) => {
    setScope(next);
    try {
      localStorage.setItem(SCOPE_STORAGE_KEY, next);
    } catch {
      /* 寫入失敗不影響操作 */
    }
  };

  // ── 資料 ──
  const [summary, setSummary] = useState<TimeEntrySummary | null>(null);
  /** 同範圍的行事曆資料（任務行程）；null＝尚未載入或載入失敗。 */
  const [calendar, setCalendar] = useState<CalendarViewData | null>(null);
  /** 行程載入失敗（統計照常顯示，行程區塊就地顯示失敗訊息）。 */
  const [calendarFailed, setCalendarFailed] = useState(false);
  /** 同範圍的計時明細（含起訖時間，圖表分格用）；null＝尚未載入或載入失敗。 */
  const [entries, setEntries] = useState<TimeEntry[] | null>(null);
  /** 圖表資料載入失敗（統計照常顯示，圖表區塊就地顯示失敗訊息，不靜默消失）。 */
  const [entriesFailed, setEntriesFailed] = useState(false);
  /** 正在切換完成狀態的任務 id（單一飛行：期間鎖住所有勾選框）。 */
  const [togglingTaskId, setTogglingTaskId] = useState<string | null>(null);
  /** togglingTaskId 的 ref 鏡像：背景 reload 用它判斷「勾選進行中就別覆寫行程」。 */
  const togglingRef = useRef<string | null>(null);
  togglingRef.current = togglingTaskId;
  /** 彙總取得的時間點（毫秒）；進行中秒數＝快照＋(now − fetchedAt)。 */
  const [fetchedAt, setFetchedAt] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** 正在送「結束」請求的項目 id（顯示「結束中…」用）。 */
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  /**
   * 結束流程進行中（含確認框等待期）。ConfirmProvider 是全站單例，重疊呼叫
   * confirm() 會把前一次靜默吞掉——所以只要有任一結束流程在跑，所有結束鈕一起鎖。
   */
  const [stopBusy, setStopBusy] = useState(false);
  /** 每秒重繪用的時鐘（僅在有進行中項目時跳動）。 */
  const [nowTick, setNowTick] = useState<number>(() => Date.now());

  // 以 ref 記住目前 scope，讓聚焦/計時器的重抓永遠抓「當下選的範圍」而不重綁事件。
  const scopeRef = useRef<TimeEntrySummaryScope | null>(scope);
  scopeRef.current = scope;
  /** 請求世代號：只採納「最新一次」請求的回應，防止快速切換範圍時舊回應蓋新資料。 */
  const requestSeqRef = useRef(0);

  /** 重新抓彙總（silent＝背景更新，不閃 loading 骨架）。 */
  const reload = useCallback(async (silent: boolean) => {
    const seq = ++requestSeqRef.current;
    if (!silent) setLoading(true);
    try {
      const data = await getTimeEntrySummary(scopeRef.current ?? "day");
      // 行程與計時明細都用「彙總回傳的同一組範圍」抓，確保與統計完全同口徑
      //（帳號時區歸日/週）。兩者失敗都不拖垮統計——各自標記、各自就地顯示。
      let calendarData: CalendarViewData | null = null;
      let entriesData: TimeEntry[] | null = null;
      if (data) {
        const [calendarResult, entriesResult] = await Promise.allSettled([
          getCalendarView(new Date(data.from), new Date(data.to)),
          listTimeEntries(data.from, data.to),
        ]);
        if (calendarResult.status === "fulfilled") {
          calendarData = calendarResult.value;
        } else {
          logger.error("Failed to load calendar for time dashboard:", calendarResult.reason);
        }
        if (entriesResult.status === "fulfilled") {
          entriesData = entriesResult.value;
        } else {
          logger.error("Failed to load entries for time dashboard:", entriesResult.reason);
        }
      }
      if (seq !== requestSeqRef.current) return; // 已有更新的請求在跑，丟棄本回應
      if (data) {
        setSummary(data);
        // 勾選完成的就地更新可能正在飛行中——此時跳過行程覆寫，避免舊快照把
        // 剛勾好的狀態閃回去（資料真值在伺服器，下一輪自動更新會校正）。
        if (togglingRef.current === null) {
          setCalendar(calendarData);
          setCalendarFailed(calendarData === null);
        }
        setEntries(entriesData);
        setEntriesFailed(entriesData === null);
        setFetchedAt(Date.now());
        setError(null);
      } else {
        setError("讀取失敗，請稍後重試。");
      }
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      logger.error("Failed to load time summary:", err);
      setError("讀取失敗，請稍後重試。");
    } finally {
      // 只讓「最新請求」控制 loading，避免被淘汰的舊請求提早關掉骨架
      if (seq === requestSeqRef.current) setLoading(false);
    }
  }, []);

  // 偏好還原完成後首抓＋切換範圍時重抓（非 silent：顯示載入骨架蓋住舊範圍的資料）。
  useEffect(() => {
    if (scope !== null) void reload(false);
  }, [scope, reload]);

  // 切回分頁／視窗聚焦→立即背景重抓；另每 60 秒背景重抓一次。
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void reload(true);
    };
    const onFocus = () => void reload(true);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void reload(true);
    }, AUTO_REFRESH_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
  }, [reload]);

  // 有進行中項目時，每秒重繪讓經過時間即時跳動。
  const runningCount = summary?.runningCount ?? 0;
  useEffect(() => {
    if (runningCount === 0) return;
    const timer = window.setInterval(() => setNowTick(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, [runningCount]);

  /** 距離取得快照已過的秒數（進行中項目的補算基準）。 */
  const elapsedSinceFetch =
    fetchedAt > 0 ? Math.max(0, Math.floor((nowTick - fetchedAt) / 1000)) : 0;

  /** 單一項目的顯示秒數（進行中＝快照＋經過）。 */
  const liveSeconds = (seconds: number, running: boolean): number =>
    running ? seconds + elapsedSinceFetch : seconds;

  /** 結束一個進行中項目（確認框→POST→重抓）。整段期間鎖住所有結束鈕。 */
  const handleStop = async (id: string, title: string) => {
    if (stopBusy) return; // 已有另一個結束流程（含確認框）在跑
    setStopBusy(true);
    try {
      const ok = await confirm({
        title: "結束計時",
        message: `確定要結束「${title}」嗎？（結束後無法復原成進行中，只能編輯時間）`,
        confirmLabel: "結束",
      });
      if (!ok) return;
      setStoppingId(id);
      const stopped = await stopTimeEntry(id);
      if (!stopped) {
        // 文案不寫「重試」：下方錯誤列的「重試」鈕只重新讀取、不會重送這次操作
        setError("結束失敗，請再按一次結束。");
        return;
      }
      await reload(true);
    } catch (err) {
      logger.error("Failed to stop time entry:", err);
      setError("結束失敗，請再按一次結束。");
    } finally {
      setStoppingId(null);
      setStopBusy(false);
    }
  };

  /** 勾選／取消任務完成（快速狀態更新，不帶樂觀鎖版本＝last-write-wins，比照任務頁拖曳）。 */
  const handleToggleTask = async (task: TaskCard) => {
    if (togglingTaskId) return; // 單一飛行：等上一個切換完成
    setTogglingTaskId(task.id);
    try {
      const next = task.status === "done" ? "todo" : "done";
      const updated = await updateTaskCard(task.id, { status: next });
      if (!updated) {
        // 文案不寫「重試」：錯誤列的「重試」鈕只重新讀取，不會重送這次勾選
        setError("更新任務狀態失敗，請重新勾選一次。");
        return;
      }
      // 就地更新（不整頁重抓，維持畫面安定；下次自動更新會校正）
      setCalendar((prev) =>
        prev
          ? {
              ...prev,
              tasks: prev.tasks.map((t) =>
                t.id === task.id ? { ...t, status: next } : t
              ),
            }
          : prev
      );
    } catch (err) {
      logger.error("Failed to toggle task status:", err);
      setError("更新任務狀態失敗，請重新勾選一次。");
    } finally {
      setTogglingTaskId(null);
    }
  };

  // ── 衍生顯示值 ──
  const totalSeconds = summary
    ? summary.totalSeconds + runningCount * elapsedSinceFetch
    : 0;

  // ── 行程／圖表共用的範圍毫秒值（行程分組與細節在 AgendaSection.tsx） ──
  const rangeFromMs = summary ? new Date(summary.from).getTime() : 0;
  const rangeToMs = summary ? new Date(summary.to).getTime() : 0;
  /** 帳號時區已就緒（SWR 使用者資料載入完）：分組/時刻顯示前先等它，避免非台北帳號先錯繪再跳正。 */
  const tzReady = user !== undefined;

  // ── 圖表衍生值 ──────────────────────────────────────────────
  // 分格＝[from,to) 的均分（日=24 小時格、週=7 日格）。無 DST 的時區（如 Asia/Taipei）
  // 均分恰等於本地時/日邊界；DST 週會有一格差一小時，屬可接受近似（圖表粒度用途）。
  const binCount = effectiveScope === "day" ? 24 : 7;
  /** 每格投入秒數（進行中項目算到當下，隨 nowTick 即時跳動）。 */
  const chartBins: number[] = (() => {
    if (!summary || !entries || rangeToMs <= rangeFromMs) return [];
    const binMs = (rangeToMs - rangeFromMs) / binCount;
    const bins = new Array<number>(binCount).fill(0);
    for (const entry of entries) {
      const rawStart = new Date(entry.startedDateTime).getTime();
      const rawEnd = entry.endedDateTime
        ? new Date(entry.endedDateTime).getTime()
        : nowTick;
      const start = Math.max(rawStart, rangeFromMs);
      const end = Math.min(rawEnd, rangeToMs);
      if (end <= start) continue;
      const first = Math.floor((start - rangeFromMs) / binMs);
      const last = Math.min(binCount - 1, Math.floor((end - 1 - rangeFromMs) / binMs));
      for (let i = first; i <= last; i++) {
        const binStart = rangeFromMs + i * binMs;
        const binEnd = binStart + binMs;
        bins[i] += (Math.min(end, binEnd) - Math.max(start, binStart)) / 1000;
      }
    }
    return bins.map((v) => Math.round(v));
  })();
  /** 累積走勢（含起點 0）。 */
  const chartCumulative: number[] = (() => {
    const out = [0];
    for (const v of chartBins) out.push(out[out.length - 1] + v);
    return out;
  })();
  /** 週檢視的每日標籤（範圍起點＝帳號時區的週一，由後端保證）。 */
  const WEEK_BIN_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
  const barTickLabels =
    effectiveScope === "day"
      ? [0, 6, 12, 18].map((h) => ({ index: h, text: `${h}時` }))
      : WEEK_BIN_LABELS.map((text, index) => ({ index, text }));
  const barBinTitle = (i: number): string =>
    effectiveScope === "day"
      ? `${i}:00–${i + 1}:00：${formatDuration(chartBins[i] ?? 0)}`
      : `週${WEEK_BIN_LABELS[i]}：${formatDuration(chartBins[i] ?? 0)}`;
  /** 常駐尖峰摘要（手機沒有 hover，逐格 tooltip 讀不到——給一行永遠可讀的文字）。 */
  const chartPeak: string | null = (() => {
    if (chartBins.length === 0) return null;
    const peakValue = Math.max(...chartBins);
    if (peakValue <= 0) return null;
    const peakIndex = chartBins.indexOf(peakValue);
    return effectiveScope === "day"
      ? `${peakIndex}:00–${peakIndex + 1}:00 · ${formatDuration(peakValue)}`
      : `週${WEEK_BIN_LABELS[peakIndex]} · ${formatDuration(peakValue)}`;
  })();

  const runningItems = summary?.items.filter((item) => item.running) ?? [];

  return (
    <div
      className="time-dash-viz"
      style={{
        maxWidth: 560,
        margin: "0 auto",
        padding:
          "var(--spacing-5) var(--spacing-4) var(--spacing-16) var(--spacing-4)",
        fontFamily: "var(--font-body)",
        color: "var(--text-primary)",
      }}
    >
      {/* ── 頁首：標題＋手動重新整理 ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "var(--spacing-4)",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: 700 }}>
          ⏱ 時間
        </h1>
        <button
          type="button"
          className="btn-secondary"
          aria-label="重新整理"
          onClick={() => void reload(false)}
          disabled={loading}
          style={{ minHeight: 44, minWidth: 44, fontSize: "var(--text-base)" }}
        >
          ↻
        </button>
      </div>

      {/* ── 範圍切換（今日/本週）── */}
      <div
        role="group"
        aria-label="統計範圍"
        style={{
          display: "flex",
          gap: "var(--spacing-2)",
          marginBottom: "var(--spacing-6)",
        }}
      >
        {(
          [
            { key: "day", label: "今日" },
            { key: "week", label: "本週" },
          ] as const
        ).map((option) => {
          const active = effectiveScope === option.key;
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => switchScope(option.key)}
              aria-pressed={active}
              style={{
                flex: 1,
                minHeight: 44,
                borderRadius: "var(--radius-full)",
                fontSize: "var(--text-sm)",
                fontWeight: active ? 700 : 500,
                cursor: "pointer",
                border: active
                  ? "1px solid var(--action-secondary-fg)"
                  : "1px solid var(--border-default)",
                background: active
                  ? "var(--action-secondary-bg)"
                  : "transparent",
                color: active
                  ? "var(--action-secondary-fg)"
                  : "var(--text-secondary)",
              }}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {/* ── 錯誤列（讀取或操作失敗；資料照舊顯示）── */}
      {error && (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--spacing-2)",
            padding: "var(--spacing-2) var(--spacing-3)",
            marginBottom: "var(--spacing-4)",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--status-danger-fg)",
            color: "var(--status-danger-fg)",
            background: "var(--status-danger-bg)",
            fontSize: "var(--text-sm)",
          }}
        >
          <span>⚠️ {error}</span>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void reload(false)}
            style={{ minHeight: 44, fontSize: "var(--text-sm)" }}
          >
            重試
          </button>
        </div>
      )}

      {loading ? (
        // ── 載入骨架（首次載入與切換範圍時；蓋住舊範圍資料，避免「tab 已切、數字還是舊的」）──
        <div aria-busy="true" aria-label="載入中">
          <div
            style={{
              height: 64,
              width: "60%",
              borderRadius: "var(--radius-md)",
              background: "var(--skeleton-bg)",
              marginBottom: "var(--spacing-6)",
            }}
          />
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                height: 48,
                borderRadius: "var(--radius-md)",
                background: "var(--skeleton-bg)",
                marginBottom: "var(--spacing-3)",
              }}
            />
          ))}
        </div>
      ) : summary ? (
        <>
          {/* ── 主角：總時長大數字 ── */}
          <div style={{ marginBottom: "var(--spacing-8)" }}>
            <div
              style={{
                ...numericStyle,
                fontSize: "clamp(40px, 12vw, 56px)",
                fontWeight: 800,
                lineHeight: 1.15,
                letterSpacing: "-0.5px",
              }}
            >
              {formatDuration(totalSeconds)}
            </div>
            {runningCount > 0 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--spacing-2)",
                  marginTop: "var(--spacing-2)",
                  color: "var(--status-success-fg)",
                  fontSize: "var(--text-sm)",
                  fontWeight: 600,
                }}
              >
                <span
                  aria-hidden="true"
                  className="time-dash-livedot"
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "var(--radius-full)",
                    background: "var(--status-success-fg)",
                  }}
                />
                進行中 {runningCount} 項
              </div>
            )}
          </div>

          {/* ── 時間分布圖表（長條＝時段投入、折線＝累積走勢）── */}
          {entriesFailed && totalSeconds > 0 ? (
            // 圖表資料載入失敗：就地顯示訊息，不靜默消失（統計不受影響）
            <section style={{ marginBottom: "var(--spacing-8)" }}>
              <h2 style={{ ...sectionTitleStyle, marginBottom: "var(--spacing-3)" }}>
                時間分布
              </h2>
              <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
                圖表讀取失敗，下次自動更新時會重試。
              </div>
            </section>
          ) : entries !== null && totalSeconds > 0 && chartBins.length > 0 ? (
            <section style={{ marginBottom: "var(--spacing-8)" }}>
              <h2 style={{ ...sectionTitleStyle, marginBottom: "var(--spacing-3)" }}>
                {effectiveScope === "day" ? "時間分布（每小時）" : "時間分布（每日）"}
              </h2>
              <div style={{ ...cardStyle, padding: "var(--spacing-3) var(--spacing-4)" }}>
                <VizBarChart
                  bins={chartBins}
                  tickLabels={barTickLabels}
                  binTitle={barBinTitle}
                />
                {/* 常駐尖峰摘要：手機無 hover 讀不到逐格 tooltip，給一行永遠可讀的文字 */}
                {chartPeak && (
                  <div
                    style={{
                      marginTop: "var(--spacing-2)",
                      fontSize: "var(--text-xs)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    尖峰：{chartPeak}
                  </div>
                )}
                <div
                  style={{
                    marginTop: "var(--spacing-4)",
                    marginBottom: "var(--spacing-1)",
                    fontSize: "var(--text-xs)",
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    color: "var(--text-secondary)",
                  }}
                >
                  累積走勢
                </div>
                {/* 終點標籤用圖表自己的累積值（僅計入落在本期間內的時段），與圖自洽；
                    「總時長」大數字沿用全站口徑（完整時長歸開始日），跨午夜項目兩者可能不同 */}
                <VizLineChart
                  cumulative={chartCumulative}
                  endLabel={formatDuration(chartCumulative[chartCumulative.length - 1])}
                />
              </div>
            </section>
          ) : null}

          {/* ── 進行中（可結束）── */}
          {runningItems.length > 0 && (
            <section style={{ marginBottom: "var(--spacing-8)" }}>
              <h2 style={{ ...sectionTitleStyle, marginBottom: "var(--spacing-3)" }}>
                進行中
              </h2>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--spacing-2)",
                }}
              >
                {runningItems.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      ...cardStyle,
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--spacing-3)",
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: "var(--text-base)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {item.title}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "var(--spacing-2)",
                          marginTop: "var(--spacing-1)",
                        }}
                      >
                        {item.category && (
                          <span style={chipStyle}>{item.category}</span>
                        )}
                        <span
                          style={{
                            ...numericStyle,
                            fontSize: "var(--text-sm)",
                            color: "var(--status-success-fg)",
                            fontWeight: 600,
                          }}
                        >
                          {formatDuration(liveSeconds(item.seconds, true))}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => void handleStop(item.id, item.title)}
                      disabled={stopBusy}
                      style={{
                        minHeight: 44,
                        fontSize: "var(--text-sm)",
                        color: "var(--status-danger-fg)",
                      }}
                    >
                      {stoppingId === item.id ? "結束中…" : "⏹ 結束"}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── 行程（行事曆：範圍內的任務，可勾完成；細節在 AgendaSection.tsx）── */}
          <AgendaSection
            calendar={calendar}
            calendarFailed={calendarFailed}
            tzReady={tzReady}
            tz={tz}
            scope={effectiveScope}
            rangeFromMs={rangeFromMs}
            rangeToMs={rangeToMs}
            nowTick={nowTick}
            togglingTaskId={togglingTaskId}
            onToggleTask={(task) => void handleToggleTask(task)}
          />

          {summary.byCategory.length === 0 ? (
            // ── 空狀態 ──
            <div
              style={{
                textAlign: "center",
                padding: "var(--spacing-12) var(--spacing-4)",
                color: "var(--text-secondary)",
              }}
            >
              <div style={{ fontSize: 40, marginBottom: "var(--spacing-3)" }}>
                ⏱
              </div>
              <div style={{ fontSize: "var(--text-base)", fontWeight: 600 }}>
                {effectiveScope === "day" ? "今天還沒有記錄" : "本週還沒有記錄"}
              </div>
              <div
                style={{
                  fontSize: "var(--text-sm)",
                  marginTop: "var(--spacing-2)",
                  lineHeight: "var(--line-height-normal)",
                }}
              >
                在 ZonWiki 首頁或用 iOS 捷徑開始計時後，這裡就會有數字。
              </div>
            </div>
          ) : (
            <>
              {/* ── 依分類（甜甜圈＋清單；細節在 CategorySection.tsx）── */}
              <CategorySection
                byCategory={summary.byCategory}
                elapsedSinceFetch={elapsedSinceFetch}
                totalSeconds={totalSeconds}
              />

              {/* ── 明細 ── */}
              <section>
                <h2
                  style={{ ...sectionTitleStyle, marginBottom: "var(--spacing-3)" }}
                >
                  明細（{summary.items.length}）
                </h2>
                <div
                  style={{
                    ...cardStyle,
                    padding: 0,
                    overflow: "hidden",
                  }}
                >
                  {summary.items.map((item, index) => (
                    <div
                      key={item.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--spacing-2)",
                        padding: "var(--spacing-3) var(--spacing-4)",
                        borderTop:
                          index === 0
                            ? "none"
                            : "1px solid var(--border-default)",
                      }}
                    >
                      <span
                        style={{
                          flex: 1,
                          minWidth: 0,
                          fontSize: "var(--text-sm)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {item.running && (
                          <span
                            aria-label="進行中"
                            style={{ color: "var(--status-success-fg)" }}
                          >
                            ▶{" "}
                          </span>
                        )}
                        {item.title}
                      </span>
                      {item.category && (
                        <span style={{ ...chipStyle, flexShrink: 0 }}>
                          {item.category}
                        </span>
                      )}
                      <span
                        style={{
                          ...numericStyle,
                          fontSize: "var(--text-sm)",
                          color: item.running
                            ? "var(--status-success-fg)"
                            : "var(--text-secondary)",
                          fontWeight: item.running ? 600 : 400,
                          flexShrink: 0,
                        }}
                      >
                        {formatDuration(liveSeconds(item.seconds, item.running))}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}

          {/* ── 頁尾：更新時間（裝置時間；資料本身的歸日/週依帳號時區）── */}
          <div
            style={{
              marginTop: "var(--spacing-8)",
              textAlign: "center",
              fontSize: "var(--text-xs)",
              color: "var(--text-secondary)",
            }}
          >
            更新於{" "}
            {new Date(fetchedAt).toLocaleTimeString("zh-TW", {
              hour: "2-digit",
              minute: "2-digit",
            })}
            ・切回本頁會自動更新
          </div>
        </>
      ) : null}
    </div>
  );
}
