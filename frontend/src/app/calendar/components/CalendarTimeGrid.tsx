"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { TaskCard } from "@/lib/api";
import { toLocalInputValue, fromLocalInputValue } from "../../tasks/taskUtils";
import { localKey, barColors, taskRangeKeys } from "./calendarBars";

const SNAP_MIN = 15; // 拖曳 / 縮放對齊的分鐘格
const MIN_DUR = 15; // 最短時長（分）
const MINUTES_PER_DAY = 24 * 60;

/** 取某 UTC ISO 在指定時區的「當日分鐘數」(0~1439)。 */
function minutesInTz(iso: string, tz: string): number {
  const local = toLocalInputValue(iso, tz); // YYYY-MM-DDTHH:mm
  const time = local.split("T")[1] ?? "00:00";
  const [hh, mm] = time.split(":").map(Number);
  return hh * 60 + mm;
}

/** 由「某天 + 當日分鐘數」(使用者時區的牆上時間) 組回 UTC ISO。 */
function isoFromDayMinute(day: Date, minute: number, tz: string): string {
  const clamped = Math.max(0, Math.min(MINUTES_PER_DAY - 1, Math.round(minute)));
  const hh = String(Math.floor(clamped / 60)).padStart(2, "0");
  const mm = String(clamped % 60).padStart(2, "0");
  return fromLocalInputValue(`${localKey(day)}T${hh}:${mm}`, tz) ?? day.toISOString();
}

/** 把分鐘數格式化為 HH:MM。 */
function fmtMin(min: number): string {
  const m = ((Math.round(min) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

const snap = (min: number) => Math.round(min / SNAP_MIN) * SNAP_MIN;

/** 單一任務在某天的時間區段（分鐘）。 */
interface Placed {
  task: TaskCard;
  startMin: number;
  endMin: number;
  lane: number;
  cols: number;
}

/** 算某一天內各任務的「重疊分欄」（並排顯示，避免互相蓋住）。 */
function layoutDay(items: { task: TaskCard; startMin: number; endMin: number }[]): Placed[] {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const out: Placed[] = [];
  let cluster: (Placed & { _e: number })[] = [];
  let clusterEnd = -1;
  let colsEnd: number[] = []; // 各欄目前的結束分鐘

  const flush = () => {
    const n = colsEnd.length || 1;
    for (const it of cluster) out.push({ ...it, cols: n });
    cluster = [];
    colsEnd = [];
    clusterEnd = -1;
  };

  for (const it of sorted) {
    if (cluster.length && it.startMin >= clusterEnd) flush();
    let lane = colsEnd.findIndex((end) => end <= it.startMin);
    if (lane === -1) {
      lane = colsEnd.length;
      colsEnd.push(it.endMin);
    } else {
      colsEnd[lane] = it.endMin;
    }
    cluster.push({ task: it.task, startMin: it.startMin, endMin: it.endMin, lane, cols: 1, _e: it.endMin });
    clusterEnd = Math.max(clusterEnd, it.endMin);
  }
  if (cluster.length) flush();
  return out;
}

interface DragState {
  taskId: string;
  mode: "move" | "resize-top" | "resize-bottom";
  dayIndex: number;
  startMin: number;
  endMin: number;
  moved: boolean;
}

/**
 * 行事曆時間格（週 / 日視圖共用）。
 * - 以「絕對定位」依實際時間放置任務：top＝開始分鐘、height＝時長（分鐘精度，修正先前只佔半格的問題）。
 * - 任務可**拖曳整塊移動**（保持時長；週視圖可橫移到其他天）、**拖上/下緣縮放**起訖時間（對齊 15 分）。
 * - 重疊的任務自動並排分欄；點空白格＝新增該時段；點任務（未拖動）＝開啟編輯器。
 */
export function CalendarTimeGrid({
  days,
  tasks,
  userTz,
  todayKey,
  hourHeight,
  gutter,
  onTaskClick,
  onSlotClick,
  onTaskTimeChange,
}: {
  /** 欄位日期（日視圖 1 天、週視圖 7 天）。 */
  days: Date[];
  /** 全部任務（本元件自行篩出「單日且有時間」者）。 */
  tasks: TaskCard[];
  userTz: string;
  /** 今天的日期鍵（高亮用）。 */
  todayKey: string;
  /** 每小時格高（px）。 */
  hourHeight: number;
  /** 左側時間欄寬（px）。 */
  gutter: number;
  onTaskClick?: (taskId: string) => void;
  onSlotClick?: (dateStr: string, hour: number | null) => void;
  /** 拖曳 / 縮放後寫回（plannedDateTime＝開始、dueDateTime＝結束，皆 UTC ISO）。 */
  onTaskTimeChange?: (taskId: string, plannedIso: string, dueIso: string) => void;
}) {
  const HOUR_H = hourHeight;
  const colsRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  // 開啟時捲到約 07:00，省得每次都從 00:00 看起。
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 7 * HOUR_H;
  }, [HOUR_H]);

  // 每天的「單日且有時間」任務 → 分欄佈局。
  const placedByDay = useMemo(() => {
    const map = new Map<string, Placed[]>();
    const buckets = new Map<string, { task: TaskCard; startMin: number; endMin: number }[]>();
    for (const t of tasks) {
      const start = t.plannedDateTime ?? t.dueDateTime;
      if (!start) continue;
      const range = taskRangeKeys(t, userTz);
      if (range && range.startKey !== range.endKey) continue; // 跨日 → 全天區，不在此
      const dayKey = range?.startKey ?? "";
      const startMin = minutesInTz(start, userTz);
      const endRaw = t.dueDateTime ?? t.plannedDateTime!;
      let endMin = minutesInTz(endRaw, userTz);
      if (endMin <= startMin) endMin = Math.min(startMin + 30, MINUTES_PER_DAY); // 無結束/結束<=開始 → 預設 30 分
      if (!buckets.has(dayKey)) buckets.set(dayKey, []);
      buckets.get(dayKey)!.push({ task: t, startMin, endMin });
    }
    for (const [k, v] of buckets) map.set(k, layoutDay(v));
    return map;
  }, [tasks, userTz]);

  const startDrag = (e: React.PointerEvent, placed: Placed, dayIndex: number, mode: DragState["mode"]) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const colW = colsRef.current ? colsRef.current.clientWidth / days.length : 1;
    const o = { start: placed.startMin, end: placed.endMin, dayIndex };
    let moved = false;
    // 以閉包變數保存「最新」拖曳結果，供 onUp 直接讀取——
    // 不可在 setDrag 的 updater 裡呼叫父層回呼（onTaskClick/onTaskTimeChange），
    // 否則會「在渲染某元件時更新另一元件」（CalendarTimeGrid 渲染中更新 CalendarWeekView）而報錯。
    const latest = { startMin: o.start, endMin: o.end, dayIndex: o.dayIndex };
    setDrag({ taskId: placed.task.id, mode, dayIndex, startMin: o.start, endMin: o.end, moved: false });

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      const dMin = snap((dy / HOUR_H) * 60);
      let s = o.start;
      let en = o.end;
      let di = o.dayIndex;
      if (mode === "move") {
        let delta = dMin;
        if (o.start + delta < 0) delta = -o.start;
        if (o.end + delta > MINUTES_PER_DAY) delta = MINUTES_PER_DAY - o.end;
        s = o.start + delta;
        en = o.end + delta;
        di = Math.max(0, Math.min(days.length - 1, o.dayIndex + Math.round(dx / colW)));
      } else if (mode === "resize-top") {
        s = Math.max(0, Math.min(o.end - MIN_DUR, o.start + dMin));
        en = o.end;
      } else {
        en = Math.min(MINUTES_PER_DAY, Math.max(o.start + MIN_DUR, o.end + dMin));
        s = o.start;
      }
      latest.startMin = s;
      latest.endMin = en;
      latest.dayIndex = di;
      setDrag({ taskId: placed.task.id, mode, dayIndex: di, startMin: s, endMin: en, moved });
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      // 先清掉拖曳狀態（單純值），父層回呼在 updater 外、於事件時呼叫，避免渲染期更新他元件。
      setDrag(null);
      if (!moved) {
        onTaskClick?.(placed.task.id);
      } else {
        const day = days[latest.dayIndex] ?? days[dayIndex];
        onTaskTimeChange?.(
          placed.task.id,
          isoFromDayMinute(day, latest.startMin, userTz),
          isoFromDayMinute(day, latest.endMin, userTz)
        );
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const onColumnClick = (day: Date, e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const hour = Math.max(0, Math.min(23, Math.floor((e.clientY - rect.top) / HOUR_H)));
    onSlotClick?.(localKey(day), hour);
  };

  // 每小時一條清晰的分隔線（用 --border-strong 才看得出格子；半小時處再加一條更淡的輔助線）。
  const hourLineBg =
    `repeating-linear-gradient(to bottom, transparent, transparent ${HOUR_H - 1}px, var(--border-strong, var(--border-default)) ${HOUR_H - 1}px, var(--border-strong, var(--border-default)) ${HOUR_H}px),` +
    `repeating-linear-gradient(to bottom, transparent, transparent ${HOUR_H / 2 - 1}px, var(--border-default) ${HOUR_H / 2 - 1}px, var(--border-default) ${HOUR_H / 2}px)`;

  return (
    <div
      ref={scrollRef}
      style={{ maxHeight: "64vh", overflowY: "auto", border: "1px solid var(--border-default)", borderRadius: "var(--radius-md)" }}
    >
      <div style={{ display: "flex" }}>
        {/* 左側時間欄 */}
        <div style={{ width: gutter, flexShrink: 0, position: "relative", height: 24 * HOUR_H }}>
          {Array.from({ length: 24 }, (_, h) => (
            <div
              key={h}
              style={{
                position: "absolute",
                top: h * HOUR_H,
                right: 6,
                fontSize: "var(--text-xs)",
                color: "var(--text-tertiary)",
                transform: "translateY(-1px)",
              }}
            >
              {String(h).padStart(2, "0")}:00
            </div>
          ))}
        </div>

        {/* 天欄 */}
        <div ref={colsRef} style={{ flex: 1, display: "grid", gridTemplateColumns: `repeat(${days.length}, 1fr)` }}>
          {days.map((day, dayIndex) => {
            const dayKey = localKey(day);
            const placed = placedByDay.get(dayKey) ?? [];
            return (
              <div
                key={dayIndex}
                onClick={(e) => onColumnClick(day, e)}
                title="點此新增此時段任務"
                style={{
                  position: "relative",
                  height: 24 * HOUR_H,
                  borderLeft: "1px solid var(--border-strong, var(--border-default))",
                  backgroundImage: hourLineBg,
                  // 今日：用「淡底色 + 左側強調線」標示，而非整欄塗滿綠色（過去太刺眼）。
                  // 注意：用 backgroundColor（非 background 簡寫）才不會把 backgroundImage 的時刻線洗掉。
                  backgroundColor:
                    dayKey === todayKey
                      ? "color-mix(in srgb, var(--status-success-bg) 35%, transparent)"
                      : undefined,
                  boxShadow:
                    dayKey === todayKey ? "inset 2px 0 0 0 var(--status-success-fg)" : undefined,
                  cursor: "pointer",
                }}
              >
                {placed.map((p) => {
                  const isDragging = drag?.taskId === p.task.id;
                  const sMin = isDragging ? drag!.startMin : p.startMin;
                  const eMin = isDragging ? drag!.endMin : p.endMin;
                  // 拖曳移動時可能換欄（週視圖）；只在「目標欄」畫拖曳中的塊，避免重複。
                  if (isDragging && drag!.mode === "move" && drag!.dayIndex !== dayIndex) return null;
                  const c = barColors(p.task);
                  // 任務塊四周留小縫隙，讓周圍空白時段仍可點擊新增（gap=左右、vGap=上下）。
                  const gap = 3;
                  const vGap = 2;
                  const widthPct = 100 / p.cols;
                  const top = (sMin / 60) * HOUR_H + vGap;
                  const height = Math.max(((eMin - sMin) / 60) * HOUR_H - vGap * 2, 12);
                  return (
                    <div
                      key={p.task.id}
                      onPointerDown={(e) => startDrag(e, p, dayIndex, "move")}
                      onClick={(e) => e.stopPropagation()} // 點任務塊不該冒泡到欄位（否則同時觸發新增時段）
                      title={p.task.title}
                      style={{
                        position: "absolute",
                        top,
                        height,
                        left: `calc(${p.lane * widthPct}% + ${gap}px)`,
                        width: `calc(${widthPct}% - ${gap * 2}px)`,
                        background: c.bg,
                        color: c.fg,
                        border: `1px solid ${c.border}`,
                        borderRadius: "var(--radius-sm)",
                        padding: "1px 5px",
                        fontSize: "var(--text-xs)",
                        fontWeight: 600,
                        overflow: "hidden",
                        boxSizing: "border-box",
                        cursor: "grab",
                        textDecoration: p.task.status === "done" ? "line-through" : "none",
                        zIndex: isDragging ? 5 : 1,
                        boxShadow: isDragging ? "var(--shadow-md)" : undefined,
                        userSelect: "none",
                      }}
                    >
                      {/* 上緣縮放把手 */}
                      <div
                        onPointerDown={(e) => startDrag(e, p, dayIndex, "resize-top")}
                        style={{ position: "absolute", top: 0, left: 0, right: 0, height: 6, cursor: "ns-resize" }}
                      />
                      <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1.25 }}>
                        {p.task.title}
                      </div>
                      {height >= 28 && (
                        <div style={{ fontSize: "10px", opacity: 0.85, fontWeight: 400 }}>
                          {fmtMin(sMin)}–{fmtMin(eMin)}
                        </div>
                      )}
                      {/* 下緣縮放把手 */}
                      <div
                        onPointerDown={(e) => startDrag(e, p, dayIndex, "resize-bottom")}
                        style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 6, cursor: "ns-resize" }}
                      />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
