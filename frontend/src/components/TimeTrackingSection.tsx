"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type TimeEntry,
  listTimeEntries,
  listRunningTimeEntries,
  listTimeEntryCategories,
  startTimeEntry,
  stopTimeEntry,
  deleteTimeEntry,
} from "@/lib/api";
import { useCurrentUser } from "@/lib/swr";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import { toLocalInputValue } from "@/app/tasks/taskUtils";
import { useConfirm } from "@/components/ConfirmProvider";
import { logger } from "@/lib/logger";
import { TimeEntryEditModal } from "@/components/TimeEntryEditModal";
import {
  type ViewMode,
  type WallDate,
  VIEW_LABELS,
  WEEKDAY_NAMES,
  parseWallDate,
  addDays,
  addMonths,
  weekdayOf,
  todayWallDate,
  computePeriod,
  formatDuration,
  formatClock,
  formatDateClock,
} from "@/lib/timeTracking/period";

/**
 * 首頁「時間追蹤」面板：記錄每天把時間花在什麼上面。
 *
 * - 快速開始：輸入項目名稱＋可選分類 → 開始計時；回來按「結束」→ 顯示時間差。
 * - 進行中清單：即時經過時間（每秒更新）、一鍵結束、可編輯。
 * - 歷史檢視：日/週/月/年 分段切換＋前後期導覽（週/月依日分組、年依月分組），
 *   各附小計、期間總計與分類小計；進行中項目以「目前已經過時間」即時併入各項統計。
 * - 每筆可編輯名稱/分類/開始/結束時間（事後補記）、可刪除（軟刪除、垃圾桶可還原）。
 * - 整塊可收合（狀態記 localStorage）；收合時只剩標頭（含進行中數量）。
 *
 * 期間計算與時間顯示的純函式在 lib/timeTracking/period.ts；編輯彈窗在 TimeEntryEditModal.tsx。
 */

/** 收合狀態的 localStorage 鍵。 */
const COLLAPSE_STORAGE_KEY = "zonwiki:time-tracking:collapsed";

/** 分類 chip 的共用樣式。 */
const categoryChipStyle: React.CSSProperties = {
  display: "inline-block",
  fontSize: "var(--text-xs)",
  padding: "2px 8px",
  borderRadius: 999,
  background: "var(--bg-default)",
  border: "1px solid var(--border-default)",
  color: "var(--text-secondary)",
  whiteSpace: "nowrap",
};

/** 一列（entry row）的共用樣式。 */
const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--spacing-3)",
  padding: "var(--spacing-2) var(--spacing-3)",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border-default)",
  background: "var(--bg-default)",
  flexWrap: "wrap",
};

/** 快速開始表單輸入框的共用樣式。 */
const quickInputStyle: React.CSSProperties = {
  minHeight: 44,
  padding: "var(--spacing-2) var(--spacing-3)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-md)",
  fontSize: "var(--text-sm)",
  background: "var(--bg-default)",
  color: "var(--text-primary)",
};

/**
 * 首頁「時間追蹤」面板元件。
 */
export function TimeTrackingSection() {
  const { data: user } = useCurrentUser();
  const tz = user?.timeZone || DEFAULT_TIMEZONE;
  const confirm = useConfirm();

  // ── 收合（預設展開；掛載後讀 localStorage 還原偏好，避免 SSR 水合不一致）──
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_STORAGE_KEY) === "1");
    } catch {
      /* localStorage 不可用（隱私模式等）時維持預設展開 */
    }
  }, []);
  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      try {
        localStorage.setItem(COLLAPSE_STORAGE_KEY, prev ? "0" : "1");
      } catch {
        /* 寫入失敗不影響操作 */
      }
      return !prev;
    });
  };

  // ── 資料 ──
  const [running, setRunning] = useState<TimeEntry[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── 歷史檢視狀態 ──
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const [anchor, setAnchor] = useState<WallDate>(() => todayWallDate(tz));
  const period = useMemo(() => computePeriod(viewMode, anchor, tz), [viewMode, anchor, tz]);

  // 使用者尚未手動導覽前，錨點跟著 tz 校正到「該時區的今天」——
  // tz 非同步載入（useCurrentUser），若初始 fallback 時區與使用者時區跨日，錨點會錯一天。
  const userNavigatedRef = useRef(false);
  useEffect(() => {
    if (!userNavigatedRef.current) setAnchor(todayWallDate(tz));
  }, [tz]);

  // ── 快速開始表單 ──
  const [titleInput, setTitleInput] = useState("");
  const [categoryInput, setCategoryInput] = useState("");
  const [busy, setBusy] = useState(false);

  // ── 編輯彈窗 ──
  const [editing, setEditing] = useState<TimeEntry | null>(null);

  // ── 即時經過時間（有進行中項目時每秒 tick）──
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (running.length === 0) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running.length]);

  /** 重新載入「進行中」與分類（開始/結束/編輯/刪除後呼叫）。 */
  const reloadRunning = useCallback(async () => {
    try {
      const [runningList, categoryList] = await Promise.all([
        listRunningTimeEntries(),
        listTimeEntryCategories(),
      ]);
      setRunning(runningList);
      setCategories(categoryList);
    } catch (err) {
      logger.error("Failed to load running time entries:", err);
      setError("無法載入進行中的計時，請稍後重試。");
    }
  }, []);

  // 歷史清單重抓的請求世代號：只接受「最新一次」請求的回應，
  // 防止快速切換期間時舊回應晚到、覆蓋新期間的資料（靜默資料錯誤）。
  const entriesRequestIdRef = useRef(0);

  /** 重新載入目前期間的歷史清單（帶世代號守衛）。 */
  const reloadEntries = useCallback(async () => {
    const requestId = ++entriesRequestIdRef.current;
    try {
      const data = await listTimeEntries(period.fromIso, period.toIso);
      if (requestId !== entriesRequestIdRef.current) return; // 已被更新的請求取代，捨棄
      setEntries(data);
      setError(null);
    } catch (err) {
      if (requestId !== entriesRequestIdRef.current) return;
      logger.error("Failed to load time entries:", err);
      setError("無法載入時間記錄，請稍後重試。");
    } finally {
      if (requestId === entriesRequestIdRef.current) setLoading(false);
    }
  }, [period.fromIso, period.toIso]);

  useEffect(() => {
    void reloadRunning();
  }, [reloadRunning]);
  useEffect(() => {
    void reloadEntries();
  }, [reloadEntries]);

  /** 開始計時（快速開始表單送出）。 */
  const handleStart = async () => {
    const title = titleInput.trim();
    if (!title || busy) return;
    setBusy(true);
    try {
      const created = await startTimeEntry({
        title,
        category: categoryInput.trim() || undefined,
      });
      if (created) {
        setTitleInput("");
        setCategoryInput("");
        await Promise.all([reloadRunning(), reloadEntries()]);
      } else {
        setError("開始計時失敗，請稍後重試。");
      }
    } catch (err) {
      logger.error("Failed to start time entry:", err);
      setError("開始計時失敗，請稍後重試。");
    } finally {
      setBusy(false);
    }
  };

  /** 結束指定項目的計時。 */
  const handleStop = async (id: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const stopped = await stopTimeEntry(id);
      if (!stopped) setError("結束計時失敗，請稍後重試。");
      await Promise.all([reloadRunning(), reloadEntries()]);
    } catch (err) {
      logger.error("Failed to stop time entry:", err);
      setError("結束計時失敗，請稍後重試。");
    } finally {
      setBusy(false);
    }
  };

  /** 期間導覽（‹ ›／今天）。 */
  const shiftPeriod = (direction: 1 | -1) => {
    userNavigatedRef.current = true;
    setAnchor((prev) => {
      if (viewMode === "day") return addDays(prev, direction);
      if (viewMode === "week") return addDays(prev, direction * 7);
      if (viewMode === "month") return addMonths(prev, direction);
      return { ...prev, y: prev.y + direction };
    });
  };

  /**
   * 項目的「有效時長」（秒）：已結束用後端算好的 durationSeconds，
   * 進行中用「目前已經過時間」即時併入——讓總計/小計與清單顯示一致，不靜默排除。
   */
  const effectiveSeconds = useCallback(
    (entry: TimeEntry): number =>
      entry.durationSeconds ??
      Math.max(0, (nowMs - new Date(entry.startedDateTime).getTime()) / 1000),
    [nowMs]
  );

  // ── 分組（週/月依日、年依月；日檢視單一組）──
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; items: TimeEntry[] }>();
    for (const entry of entries) {
      const localDate = toLocalInputValue(entry.startedDateTime, tz).slice(0, 10);
      let key: string;
      let label: string;
      if (viewMode === "year") {
        key = localDate.slice(0, 7);
        label = `${Number(localDate.slice(5, 7))} 月`;
      } else {
        key = localDate;
        const w = parseWallDate(localDate);
        label = `${String(w.m).padStart(2, "0")}/${String(w.d).padStart(2, "0")}（週${WEEKDAY_NAMES[weekdayOf(w)]}）`;
      }
      if (!map.has(key)) map.set(key, { label, items: [] });
      map.get(key)!.items.push(entry);
    }
    // 依 key（日期/月份）逆序：最近的在最上面。
    return Array.from(map.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, group]) => ({ key, ...group }));
  }, [entries, viewMode, tz]);

  /** 期間總時長（秒；進行中項目以目前經過時間即時併入）。 */
  const periodTotalSeconds = useMemo(
    () => entries.reduce((sum, e) => sum + effectiveSeconds(e), 0),
    [entries, effectiveSeconds]
  );

  /** 分類小計（依時長逆序；含進行中）。 */
  const categoryTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const e of entries) {
      const key = e.category ?? "未分類";
      totals.set(key, (totals.get(key) ?? 0) + effectiveSeconds(e));
    }
    return Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
  }, [entries, effectiveSeconds]);

  /** 一組內的小計（秒；含進行中）。 */
  const groupTotal = (items: TimeEntry[]) =>
    items.reduce((sum, e) => sum + effectiveSeconds(e), 0);

  return (
    <section
      className="home-section"
      style={{
        background: "var(--bg-surface)",
        borderRadius: "var(--radius-lg)",
        border: "1px solid var(--border-default)",
        padding: "var(--spacing-5)",
      }}
    >
      {/* 分類 autocomplete 資料（放 section 根層級：不隨收合卸載，編輯彈窗也引用它） */}
      <datalist id="time-tracking-categories">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      {/* ── 標頭列（永遠顯示；收合時只剩這排）── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--spacing-3)",
        }}
      >
        <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 600, margin: 0 }}>
          ⏱ 時間追蹤
          {running.length > 0 && (
            <span
              style={{
                marginLeft: "var(--spacing-2)",
                fontSize: "var(--text-xs)",
                fontWeight: 600,
                padding: "2px 8px",
                borderRadius: 999,
                background: "var(--action-primary-bg)",
                color: "var(--action-primary-fg)",
                verticalAlign: "middle",
              }}
            >
              進行中 {running.length}
            </span>
          )}
        </h2>
        <button
          type="button"
          className="btn-secondary"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          style={{ fontSize: "var(--text-sm)", minHeight: 44 }}
        >
          {collapsed ? "▸ 展開" : "▾ 收合"}
        </button>
      </div>

      {!collapsed && (
        <div style={{ marginTop: "var(--spacing-4)" }}>
          {/* ── 錯誤回饋 ── */}
          {error && (
            <div
              role="alert"
              style={{
                marginBottom: "var(--spacing-3)",
                padding: "var(--spacing-2) var(--spacing-3)",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--status-danger-fg, #c0392b)",
                color: "var(--status-danger-fg, #c0392b)",
                fontSize: "var(--text-sm)",
              }}
            >
              ⚠️ {error}
            </div>
          )}

          {/* ── 快速開始 ── */}
          <div
            style={{
              display: "flex",
              gap: "var(--spacing-2)",
              flexWrap: "wrap",
              marginBottom: "var(--spacing-4)",
            }}
          >
            <input
              type="text"
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleStart();
              }}
              placeholder="做什麼？（項目名稱）"
              aria-label="項目名稱"
              maxLength={200}
              style={{ ...quickInputStyle, flex: "2 1 200px" }}
            />
            <input
              type="text"
              value={categoryInput}
              onChange={(e) => setCategoryInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleStart();
              }}
              placeholder="分類（可選）"
              aria-label="分類"
              maxLength={128}
              list="time-tracking-categories"
              style={{ ...quickInputStyle, flex: "1 1 120px" }}
            />
            <button
              type="button"
              className="btn-primary"
              onClick={() => void handleStart()}
              disabled={!titleInput.trim() || busy}
              style={{ fontSize: "var(--text-sm)", minHeight: 44 }}
            >
              ▶ 開始
            </button>
          </div>

          {/* ── 進行中清單 ── */}
          {running.length > 0 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--spacing-2)",
                marginBottom: "var(--spacing-4)",
              }}
            >
              {running.map((entry) => (
                <div key={entry.id} style={{ ...rowStyle, borderColor: "var(--border-strong)" }}>
                  <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                    {entry.title}
                  </span>
                  {entry.category && <span style={categoryChipStyle}>{entry.category}</span>}
                  <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
                    {formatDateClock(entry.startedDateTime, tz)} 開始
                  </span>
                  <span
                    style={{
                      marginLeft: "auto",
                      fontVariantNumeric: "tabular-nums",
                      fontWeight: 600,
                      color: "var(--text-primary)",
                    }}
                  >
                    ⏳ {formatDuration(effectiveSeconds(entry))}
                  </span>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => void handleStop(entry.id)}
                    disabled={busy}
                    style={{ fontSize: "var(--text-sm)", minHeight: 44 }}
                  >
                    ⏹ 結束
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setEditing(entry)}
                    aria-label={`編輯 ${entry.title}`}
                    style={{ fontSize: "var(--text-sm)", minHeight: 44 }}
                  >
                    ✎
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* ── 歷史檢視控制列 ── */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--spacing-2)",
              flexWrap: "wrap",
              marginBottom: "var(--spacing-3)",
            }}
          >
            <div
              role="group"
              aria-label="檢視範圍"
              style={{
                display: "inline-flex",
                border: "1px solid var(--border-default)",
                borderRadius: "var(--radius-md)",
                overflow: "hidden",
              }}
            >
              {VIEW_LABELS.map(({ mode, label }) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  aria-pressed={viewMode === mode}
                  style={{
                    padding: "var(--spacing-2) var(--spacing-3)",
                    minHeight: 44,
                    minWidth: 44,
                    fontSize: "var(--text-sm)",
                    border: "none",
                    cursor: "pointer",
                    background: viewMode === mode ? "var(--action-primary-bg)" : "transparent",
                    color:
                      viewMode === mode ? "var(--action-primary-fg)" : "var(--text-secondary)",
                    fontWeight: viewMode === mode ? 600 : 400,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => shiftPeriod(-1)}
              aria-label="上一期"
              style={{ fontSize: "var(--text-sm)", minHeight: 44, minWidth: 44 }}
            >
              ‹
            </button>
            <span
              style={{
                fontSize: "var(--text-sm)",
                fontWeight: 600,
                color: "var(--text-primary)",
              }}
            >
              {period.label}
            </span>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => shiftPeriod(1)}
              aria-label="下一期"
              style={{ fontSize: "var(--text-sm)", minHeight: 44, minWidth: 44 }}
            >
              ›
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                userNavigatedRef.current = true;
                setAnchor(todayWallDate(tz));
              }}
              style={{ fontSize: "var(--text-sm)", minHeight: 44 }}
            >
              今天
            </button>
            <span
              style={{
                marginLeft: "auto",
                fontSize: "var(--text-sm)",
                color: "var(--text-secondary)",
              }}
            >
              共{" "}
              <strong style={{ color: "var(--text-primary)" }}>
                {formatDuration(periodTotalSeconds)}
              </strong>
              {entries.some((e) => e.durationSeconds == null) && "（含進行中）"}
            </span>
          </div>

          {/* ── 分類小計 ── */}
          {categoryTotals.length > 0 && (
            <div
              style={{
                display: "flex",
                gap: "var(--spacing-2)",
                flexWrap: "wrap",
                marginBottom: "var(--spacing-3)",
              }}
            >
              {categoryTotals.map(([name, seconds]) => (
                <span key={name} style={categoryChipStyle}>
                  {name} {formatDuration(seconds)}
                </span>
              ))}
            </div>
          )}

          {/* ── 歷史清單（分組）── */}
          {loading ? (
            <p style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>載入中…</p>
          ) : groups.length === 0 ? (
            <p style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
              這段期間沒有記錄。輸入項目名稱按「▶ 開始」即可開始計時。
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-3)" }}>
              {groups.map((group) => (
                <div key={group.key}>
                  {/* 日檢視只有單一組，不需要組標題 */}
                  {viewMode !== "day" && (
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "baseline",
                        marginBottom: "var(--spacing-2)",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "var(--text-sm)",
                          fontWeight: 600,
                          color: "var(--text-primary)",
                        }}
                      >
                        {group.label}
                      </span>
                      <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
                        {formatDuration(groupTotal(group.items))}
                      </span>
                    </div>
                  )}
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-2)" }}
                  >
                    {group.items.map((entry) => (
                      <div key={entry.id} style={rowStyle}>
                        <span style={{ color: "var(--text-primary)" }}>{entry.title}</span>
                        {entry.category && <span style={categoryChipStyle}>{entry.category}</span>}
                        <span
                          style={{
                            fontSize: "var(--text-sm)",
                            color: "var(--text-secondary)",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {formatClock(entry.startedDateTime, tz)}
                          {" – "}
                          {entry.endedDateTime ? formatClock(entry.endedDateTime, tz) : "進行中"}
                        </span>
                        <span
                          style={{
                            marginLeft: "auto",
                            fontWeight: 600,
                            fontVariantNumeric: "tabular-nums",
                            color: "var(--text-primary)",
                          }}
                        >
                          {entry.durationSeconds == null && "⏳ "}
                          {formatDuration(effectiveSeconds(entry))}
                        </span>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => setEditing(entry)}
                          aria-label={`編輯 ${entry.title}`}
                          style={{ fontSize: "var(--text-sm)", minHeight: 44 }}
                        >
                          ✎
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── 編輯彈窗（key 依 entry id：切換編輯對象時強制重掛、避免殘留舊值）── */}
      {editing && (
        <TimeEntryEditModal
          key={editing.id}
          entry={editing}
          tz={tz}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await Promise.all([reloadRunning(), reloadEntries()]);
          }}
          onDelete={async () => {
            const ok = await confirm({
              title: "刪除時間記錄",
              message: `確定要刪除「${editing.title}」嗎？（會移到垃圾桶，可還原）`,
              confirmLabel: "刪除",
              danger: true,
            });
            if (!ok) return true; // 使用者取消＝不是錯誤
            const success = await deleteTimeEntry(editing.id);
            if (!success) return false; // 由彈窗就地顯示錯誤（父層錯誤列會被遮罩蓋住）
            setEditing(null);
            await Promise.all([reloadRunning(), reloadEntries()]);
            return true;
          }}
        />
      )}
    </section>
  );
}
