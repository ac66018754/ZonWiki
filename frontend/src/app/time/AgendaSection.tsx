"use client";

import type { CalendarViewData, TaskCard, TimeEntrySummaryScope } from "@/lib/api";
import { WEEKDAY_NAMES, formatClock, parseWallDate, weekdayOf } from "@/lib/timeTracking/period";
import { toLocalInputValue } from "@/app/tasks/taskUtils";
import { cardStyle, chipStyle, numericStyle, sectionTitleStyle } from "./shared";

/**
 * /time 儀表板的「行程」區塊：顯示選定範圍（今日/本週）內的行事曆任務。
 *
 * - 資料語意與 /calendar 頁一致（依 Planned/Due 落點；重複規則不展開）。
 * - 日檢視平鋪、週檢視依「帳號時區」歸日分組（顯示 MM/DD（週X）標頭）。
 * - 可直接勾完成／取消（父層 onToggleTask 負責呼叫 API 與鎖定狀態）。
 * - 逾期（有截止、已過、未完成）：時刻紅字＋「逾期」chip。
 */
export function AgendaSection({
  calendar,
  calendarFailed,
  tzReady,
  tz,
  scope,
  rangeFromMs,
  rangeToMs,
  nowTick,
  togglingTaskId,
  onToggleTask,
}: {
  /** 行事曆資料（null＝載入中或失敗）。 */
  calendar: CalendarViewData | null;
  /** 行程載入失敗（就地顯示訊息，不影響統計）。 */
  calendarFailed: boolean;
  /** 帳號時區是否已載入（未載入前不分組，避免非台北帳號先錯繪再跳正）。 */
  tzReady: boolean;
  /** 帳號 IANA 時區。 */
  tz: string;
  /** 目前範圍（day/week）。 */
  scope: TimeEntrySummaryScope;
  /** 範圍起（UTC 毫秒，含）。 */
  rangeFromMs: number;
  /** 範圍迄（UTC 毫秒，不含）。 */
  rangeToMs: number;
  /** 目前時鐘（毫秒；逾期判斷用）。 */
  nowTick: number;
  /** 正在切換完成狀態的任務 id（非 null＝所有勾選框鎖住）。 */
  togglingTaskId: string | null;
  /** 勾選完成／取消完成。 */
  onToggleTask: (task: TaskCard) => void;
}) {
  if (calendar === null && !calendarFailed) return null;

  /**
   * 任務錨點：優先取「落在目前範圍內」的時間（計畫→截止）；兩者都在範圍外的
   * 跨界任務（後端用「重疊」語意會回傳）夾回範圍邊界——否則週分組會冒出
   * 上週/下週的日期標頭，牴觸頂部的範圍選擇器。皆空回空字串（上層 filter 掉）。
   */
  const taskAnchor = (task: TaskCard): string => {
    const inRange = (iso: string | null | undefined): iso is string => {
      if (!iso) return false;
      const t = new Date(iso).getTime();
      return t >= rangeFromMs && t < rangeToMs;
    };
    if (inRange(task.plannedDateTime)) return task.plannedDateTime;
    if (inRange(task.dueDateTime)) return task.dueDateTime;
    const raw = task.plannedDateTime ?? task.dueDateTime;
    if (!raw || rangeToMs <= rangeFromMs) return "";
    const clamped = Math.min(
      Math.max(new Date(raw).getTime(), rangeFromMs),
      rangeToMs - 1
    );
    return new Date(clamped).toISOString();
  };

  /** 行程項目（任務＋算好的錨點；錨點皆空者防呆濾除，不依賴後端過濾）。 */
  const agendaItems = (calendar?.tasks ?? [])
    .map((task) => ({ task, anchor: taskAnchor(task) }))
    .filter((item) => item.anchor !== "")
    .sort((a, b) => a.anchor.localeCompare(b.anchor));
  const doneCount = agendaItems.filter((i) => i.task.status === "done").length;

  /** 週範圍的分組（[本地日期字串, 該日項目]；日範圍＝單一組、不顯示日期標頭）。 */
  const groups: Array<[string, typeof agendaItems]> = (() => {
    if (scope === "day") return [["", agendaItems]];
    const map = new Map<string, typeof agendaItems>();
    for (const item of agendaItems) {
      const key = toLocalInputValue(item.anchor, tz).slice(0, 10); // YYYY-MM-DD（帳號時區）
      const list = map.get(key);
      if (list) list.push(item);
      else map.set(key, [item]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  })();

  /** "YYYY-MM-DD" → 「MM/DD（週X）」。 */
  const formatDayHeading = (dateStr: string): string => {
    const wall = parseWallDate(dateStr);
    return `${dateStr.slice(5).replace("-", "/")}（週${WEEKDAY_NAMES[weekdayOf(wall)]}）`;
  };

  /** 是否逾期（有截止、已過、未完成）。 */
  const isOverdue = (task: TaskCard): boolean =>
    !!task.dueDateTime &&
    new Date(task.dueDateTime).getTime() < nowTick &&
    task.status !== "done";

  const locked = togglingTaskId !== null;

  return (
    <section style={{ marginBottom: "var(--spacing-8)" }}>
      <h2 style={{ ...sectionTitleStyle, marginBottom: "var(--spacing-3)" }}>
        行程
        {calendar && agendaItems.length > 0
          ? `（${doneCount}/${agendaItems.length} 完成）`
          : ""}
      </h2>
      {calendarFailed ? (
        <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
          行程讀取失敗，下次自動更新時會重試。
        </div>
      ) : agendaItems.length === 0 ? (
        <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
          這段期間沒有排任何行程。
        </div>
      ) : !tzReady ? (
        // 帳號時區未載入前不做歸日分組——先給骨架
        <div
          aria-busy="true"
          style={{
            height: 96,
            borderRadius: "var(--radius-md)",
            background: "var(--skeleton-bg)",
          }}
        />
      ) : (
        <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
          {groups.map(([dateKey, items], groupIndex) => (
            <div key={dateKey || "day"}>
              {/* 週範圍才顯示日期標頭；日範圍單組免標 */}
              {dateKey && (
                <div
                  style={{
                    padding: "var(--spacing-2) var(--spacing-4)",
                    fontSize: "var(--text-xs)",
                    fontWeight: 700,
                    color: "var(--text-secondary)",
                    background: "var(--bg-surface-secondary)",
                    borderTop:
                      groupIndex === 0 ? "none" : "1px solid var(--border-default)",
                  }}
                >
                  {formatDayHeading(dateKey)}
                </div>
              )}
              {items.map(({ task, anchor }, taskIndex) => {
                const done = task.status === "done";
                const overdue = isOverdue(task);
                return (
                  <div
                    key={task.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--spacing-2)",
                      padding:
                        "var(--spacing-1) var(--spacing-3) var(--spacing-1) var(--spacing-2)",
                      borderTop:
                        taskIndex === 0 && (dateKey || groupIndex === 0)
                          ? "none"
                          : "1px solid var(--border-default)",
                    }}
                  >
                    {/* 勾選框（44px 觸控目標；切換期間全部鎖住） */}
                    <button
                      type="button"
                      onClick={() => onToggleTask(task)}
                      disabled={locked}
                      aria-pressed={done}
                      aria-label={done ? `取消完成 ${task.title}` : `完成 ${task.title}`}
                      style={{
                        minWidth: 44,
                        minHeight: 44,
                        border: "none",
                        background: "transparent",
                        // disabled 態要有可辨識的視覺（UIUX 四態規則）
                        cursor: locked ? "default" : "pointer",
                        opacity: locked ? 0.45 : 1,
                        fontSize: 20,
                        lineHeight: 1,
                        color: done
                          ? "var(--status-success-fg)"
                          : "var(--text-secondary)",
                      }}
                    >
                      {done ? "☑" : "☐"}
                    </button>
                    <span
                      style={{
                        ...numericStyle,
                        fontSize: "var(--text-sm)",
                        color: overdue
                          ? "var(--status-danger-fg)"
                          : "var(--text-secondary)",
                        fontWeight: overdue ? 700 : 400,
                        flexShrink: 0,
                      }}
                    >
                      {formatClock(anchor, tz)}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: "var(--text-sm)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        color: done ? "var(--text-secondary)" : "var(--text-primary)",
                        textDecoration: done ? "line-through" : "none",
                      }}
                    >
                      {task.title}
                    </span>
                    {overdue && (
                      <span
                        style={{
                          ...chipStyle,
                          flexShrink: 0,
                          color: "var(--status-danger-fg)",
                          // 透明底＝落在卡片 surface 上：danger-fg on surface 四主題實測
                          // 5.16–6.32 全過 AA；danger-bg 底在 dark/night 只有 3.9–4.3 不合格。
                          background: "transparent",
                          border: "1px solid var(--status-danger-fg)",
                        }}
                      >
                        逾期
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
