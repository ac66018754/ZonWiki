import { useEffect, useMemo, useState } from "react";
import { TaskCard, NoteSummary, getCalendarView, CalendarViewData } from "@/lib/api";
import { FloatingPanel } from "@/components/FloatingPanel";
import { logger } from "@/lib/logger";
import { useRevealThenOpen } from "./useRevealThenOpen";
import { dateKeyInTz, FALLBACK_TZ } from "../../tasks/taskUtils";
import {
  localKey,
  buildRowBars,
  barColors,
  taskCoversDay,
  taskRangeKeys,
} from "./calendarBars";

/** 月視圖每格的版面常數（像素）。 */
const HEADER_H = 24; // 日期數字列高
const BAR_STEP = 20; // 每條橫條（含間距）佔的高度
const MAX_LANES = 4; // 每週最多顯示幾層橫條，超出以「+N」表示
const FOOTER_H = 16; // 「+N / 日記」footer 高

/**
 * 月視圖：整月日期網格，跨日任務以「橫跨多格的橫條」呈現（Google Calendar 風格）。
 * - 點橫條 → 開任務檢視/編輯（若有傳 onTaskClick）
 * - 點格子空白 → 展開當日浮動面板（任務 + 日記）
 * - 時間存 UTC、依使用者時區歸日
 */
export function CalendarMonthView({
  selectedDate,
  user,
  onTaskClick,
  onSlotClick,
  refreshKey,
}: {
  selectedDate: Date;
  user?: unknown;
  onTaskClick?: (taskId: string) => void;
  /** 點空白日格→新增當日任務（hour=null＝整天） */
  onSlotClick?: (dateStr: string, hour: number | null) => void;
  refreshKey?: number;
}) {
  const [events, setEvents] = useState<CalendarViewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  // 兩段式點擊：窄任務條先點一下放大看完整標題，再點才開任務。
  const { revealedId, handleTaskClick } = useRevealThenOpen(onTaskClick);

  const userTz = (user as { timeZone?: string } | undefined)?.timeZone || FALLBACK_TZ;

  // 整個可見網格（6 週 × 7 天）的真實日期（含上/下月補格），讓橫條能跨月邊界。
  const grid = useMemo(() => buildMonthGrid(selectedDate), [selectedDate]);
  const weeks = useMemo(() => {
    const out: Date[][] = [];
    for (let i = 0; i < grid.length; i += 7) out.push(grid.slice(i, i + 7));
    return out;
  }, [grid]);

  // 換月份（grid 變）時先清空內容，讓「換範圍」顯示載入中並套用新表頭；單純背景重抓
  //（refreshKey 變、grid 不變，如關閉任務彈窗後）則保留現有內容、抓完再換，不卸載、不閃動。
  useEffect(() => {
    setEvents(null);
  }, [grid]);

  // 抓「整個可見網格範圍」的資料（不是只有當月），跨月與補格的任務才完整。
  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const from = new Date(grid[0]);
        from.setHours(0, 0, 0, 0);
        const to = new Date(grid[grid.length - 1]);
        to.setHours(23, 59, 59, 999);
        const response = await getCalendarView(from, to);
        if (response) setEvents(response);
      } catch (err) {
        logger.error("Failed to load calendar events:", err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [grid, refreshKey]);

  const tasks = events?.tasks ?? [];
  const journals = events?.journalNotes ?? [];
  const todayKey = dateKeyInTz(new Date().toISOString(), userTz);

  /** 某天的日記（依使用者時區歸日）。 */
  function journalsForDay(dayKey: string): NoteSummary[] {
    return journals.filter((n) => dateKeyInTz(n.updatedDateTime, userTz) === dayKey);
  }
  /** 某天涵蓋的任務（含跨日；用於浮動面板）。 */
  function tasksForDay(dayKey: string): TaskCard[] {
    return tasks.filter((t) => taskCoversDay(t, dayKey, userTz));
  }

  const weekDayNames = ["日", "一", "二", "三", "四", "五", "六"];

  // 只有「首次載入（尚無資料）」才顯示載入中並卸載內容；背景重抓（如關閉任務彈窗後 refreshKey 變動）
  // 保留現有內容顯示、抓完再換上新資料——避免整塊卸載重掛造成「閃一下＋捲動跳回」。
  if (loading && !events) {
    return <div style={{ textAlign: "center", padding: "var(--spacing-8)" }}>載入中...</div>;
  }

  return (
    <div style={{ position: "relative", width: "100%" }}>
      {/* 星期標題 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: "var(--spacing-2)" }}>
        {weekDayNames.map((d) => (
          <div
            key={d}
            style={{
              textAlign: "center",
              fontSize: "var(--text-sm)",
              fontWeight: 600,
              color: "var(--text-secondary)",
              padding: "var(--spacing-1)",
            }}
          >
            {d}
          </div>
        ))}
      </div>

      {/* 週列（每列含背景格 + 橫條覆蓋層） */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        {weeks.map((week, wi) => {
          const { segments, laneCount } = buildRowBars(week, tasks, userTz);
          const shownLanes = Math.min(laneCount, MAX_LANES);
          const rowHeight = HEADER_H + shownLanes * BAR_STEP + FOOTER_H;

          // 每欄被隱藏（lane >= MAX_LANES）的橫條數，用於「+N」。
          const hiddenPerCol = new Array(7).fill(0);
          for (const s of segments) {
            if (s.lane >= MAX_LANES) {
              for (let c = s.startCol; c < s.startCol + s.span; c++) hiddenPerCol[c]++;
            }
          }

          return (
            <div
              key={wi}
              style={{
                position: "relative",
                display: "grid",
                gridTemplateColumns: "repeat(7, 1fr)",
                gap: "4px",
                minHeight: `${rowHeight}px`,
              }}
            >
              {/* 背景日期格 */}
              {week.map((date, col) => {
                const key = localKey(date);
                const inMonth = date.getMonth() === selectedDate.getMonth();
                const isToday = key === todayKey;
                const isSel = selectedDay && key === localKey(selectedDay);
                return (
                  <div
                    key={col}
                    className="cal-day-cell"
                    onClick={() => onSlotClick?.(key, null)}
                    title="點此新增當日任務"
                    style={{
                      borderRadius: "var(--radius-md)",
                      // 今日：淡綠底 + 綠框（搭配下方綠色日期數字）標示，不再整格塗滿濃綠（太刺眼）。
                      // 選取框（藍）優先於今日框（綠）。
                      border: isSel
                        ? "2px solid var(--action-primary-bg)"
                        : isToday
                        ? "2px solid var(--status-success-fg)"
                        : "1px solid var(--border-default)",
                      background: isToday
                        ? "color-mix(in srgb, var(--status-success-bg) 30%, var(--bg-surface))"
                        : inMonth
                        ? "var(--bg-surface)"
                        : "var(--bg-surface-secondary)",
                      opacity: inMonth ? 1 : 0.55,
                      cursor: "pointer",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: `${HEADER_H}px`,
                        padding: "2px 6px",
                        fontSize: "var(--text-sm)",
                        fontWeight: 600,
                        color: isToday ? "var(--status-success-fg)" : "var(--text-primary)",
                      }}
                    >
                      {date.getDate()}
                    </div>
                    {/* footer：+N 隱藏任務 / 日記點（橫條覆蓋層在上方，故此處只放 footer） */}
                    <div style={{ position: "absolute", bottom: 2, left: 6, right: 6, height: FOOTER_H }}>
                      {hiddenPerCol[col] > 0 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedDay(date);
                          }}
                          title="查看當日全部任務"
                          style={{
                            border: "none",
                            background: "transparent",
                            padding: 0,
                            cursor: "pointer",
                            fontSize: "var(--text-xs)",
                            color: "var(--text-tertiary)",
                          }}
                        >
                          +{hiddenPerCol[col]}
                        </button>
                      )}
                      {journalsForDay(key).length > 0 && (
                        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", marginLeft: 4 }}>
                          📝{journalsForDay(key).length}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* 橫條覆蓋層（跨格） */}
              <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                {segments
                  .filter((s) => s.lane < MAX_LANES)
                  .map((s, i) => {
                    const c = barColors(s.task);
                    const leftPct = (s.startCol / 7) * 100;
                    const widthPct = (s.span / 7) * 100;
                    const revealed = revealedId === s.task.id;
                    return (
                      <div
                        key={`${s.task.id}-${i}`}
                        data-cal-task
                        title={s.task.title}
                        onClick={
                          onTaskClick
                            ? (e) => {
                                e.stopPropagation();
                                handleTaskClick(s.task.id, e.currentTarget);
                              }
                            : undefined
                        }
                        style={{
                          position: "absolute",
                          left: `calc(${leftPct}% + 3px)`,
                          width: `calc(${widthPct}% - 6px)`,
                          top: `${HEADER_H + s.lane * BAR_STEP + 2}px`,
                          // 放大中：解除單行截斷、可換行顯示完整標題、疊到最上層加陰影標示。
                          ...(revealed
                            ? {
                                minHeight: `${BAR_STEP - 5}px`,
                                height: "auto",
                                lineHeight: 1.3,
                                whiteSpace: "normal",
                                overflow: "visible",
                                zIndex: 20,
                                boxShadow: "var(--shadow-lg)",
                                outline: "2px solid var(--action-primary-bg)",
                              }
                            : {
                                height: `${BAR_STEP - 5}px`,
                                lineHeight: `${BAR_STEP - 5}px`,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }),
                          background: c.bg,
                          color: c.fg,
                          border: `1px solid ${c.border}`,
                          borderTopLeftRadius: s.continuesLeft ? 0 : "var(--radius-sm)",
                          borderBottomLeftRadius: s.continuesLeft ? 0 : "var(--radius-sm)",
                          borderTopRightRadius: s.continuesRight ? 0 : "var(--radius-sm)",
                          borderBottomRightRadius: s.continuesRight ? 0 : "var(--radius-sm)",
                          padding: "0 6px",
                          fontSize: "var(--text-xs)",
                          fontWeight: 600,
                          textDecoration: s.task.status === "done" ? "line-through" : "none",
                          cursor: onTaskClick ? "pointer" : "default",
                          pointerEvents: "auto",
                          boxSizing: "border-box",
                        }}
                      >
                        {s.continuesLeft ? "◀ " : ""}
                        {s.task.title}
                      </div>
                    );
                  })}
              </div>
            </div>
          );
        })}
      </div>

      {/* 浮動面板：當日詳情 */}
      {selectedDay && (
        <FloatingPanel
          id={`calendar-day-${localKey(selectedDay)}`}
          title={selectedDay.toLocaleDateString("zh-Hant", {
            year: "numeric",
            month: "long",
            day: "numeric",
            weekday: "long",
          })}
          defaultPos={{ x: 400, y: 100 }}
          width={320}
        >
          <DayDetail
            tasks={tasksForDay(localKey(selectedDay))}
            notes={journalsForDay(localKey(selectedDay))}
            tz={userTz}
            onTaskClick={onTaskClick}
            onClose={() => setSelectedDay(null)}
          />
        </FloatingPanel>
      )}
    </div>
  );
}

/** 浮動面板內容：當日任務（含跨日標示）與日記。 */
function DayDetail({
  tasks,
  notes,
  tz,
  onTaskClick,
  onClose,
}: {
  tasks: TaskCard[];
  notes: NoteSummary[];
  tz: string;
  onTaskClick?: (taskId: string) => void;
  onClose: () => void;
}) {
  return (
    <div style={{ padding: "var(--spacing-4)", display: "flex", flexDirection: "column", gap: "var(--spacing-4)" }}>
      <div>
        <h3 style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-secondary)", margin: "0 0 var(--spacing-2) 0", textTransform: "uppercase" }}>
          任務清單
        </h3>
        {tasks.length === 0 ? (
          <p style={{ color: "var(--text-tertiary)", fontSize: "var(--text-sm)", margin: 0 }}>暫無任務</p>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "var(--spacing-2)" }}>
            {tasks.map((t) => {
              const r = taskRangeKeys(t, tz);
              const multi = r && r.startKey !== r.endKey;
              return (
                <li
                  key={t.id}
                  onClick={onTaskClick ? () => onTaskClick(t.id) : undefined}
                  style={{
                    padding: "var(--spacing-2)",
                    borderRadius: "var(--radius-sm)",
                    background: "var(--bg-surface-secondary)",
                    fontSize: "var(--text-xs)",
                    cursor: onTaskClick ? "pointer" : "default",
                  }}
                >
                  <div style={{ fontWeight: 600, color: "var(--text-primary)", wordBreak: "break-word" }}>
                    {t.title}
                  </div>
                  {multi && r && (
                    <div style={{ color: "var(--text-tertiary)" }}>
                      跨日：{r.startKey} ~ {r.endKey}
                    </div>
                  )}
                  <div style={{ color: "var(--text-tertiary)" }}>狀態：{t.status}</div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div style={{ borderTop: "1px solid var(--border-default)", paddingTop: "var(--spacing-3)" }}>
        <h3 style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-secondary)", margin: "0 0 var(--spacing-2) 0", textTransform: "uppercase" }}>
          日記
        </h3>
        {notes.length === 0 ? (
          <p style={{ color: "var(--text-tertiary)", fontSize: "var(--text-sm)", margin: 0 }}>暫無日記</p>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "var(--spacing-2)" }}>
            {notes.map((n) => (
              <li key={n.id} style={{ padding: "var(--spacing-2)", borderRadius: "var(--radius-sm)", background: "var(--action-secondary-bg)", fontSize: "var(--text-xs)", color: "var(--action-secondary-fg)", wordBreak: "break-word" }}>
                📔 {n.title}
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        onClick={onClose}
        style={{
          padding: "var(--spacing-2) var(--spacing-3)",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border-default)",
          background: "var(--bg-surface-secondary)",
          color: "var(--text-secondary)",
          fontSize: "var(--text-xs)",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        關閉
      </button>
    </div>
  );
}

/** 產生 6 週 × 7 天的整月網格（週日起算，含上/下月補格的真實日期）。 */
function buildMonthGrid(date: Date): Date[] {
  const year = date.getFullYear();
  const month = date.getMonth();
  const first = new Date(year, month, 1);
  const startDow = first.getDay(); // 0=日
  const gridStart = new Date(year, month, 1 - startDow);
  const out: Date[] = [];
  for (let i = 0; i < 42; i++) {
    out.push(new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
  }
  return out;
}
