import { useCallback, useEffect, useMemo, useState } from "react";
import { getCalendarView, updateTaskCard, CalendarViewData, CurrentUser } from "@/lib/api";
import { getCurrentUser } from "@/lib/api";
import { logger } from "@/lib/logger";
import { dateKeyInTz, FALLBACK_TZ } from "../../tasks/taskUtils";
import { localKey, buildRowBars, barColors, isMultiDay } from "./calendarBars";
import { CalendarTimeGrid } from "./CalendarTimeGrid";

const BAR_STEP = 22;
const HOUR_H = 40; // 每小時格高（px）

/**
 * 週視圖（Google Calendar 風）：
 * - 上方「全天」區：跨日任務以橫條呈現（多日任務）。
 * - 下方時間格：x = 週日~週六、y = 0~23 點；點任一格 → 新增該天該小時的任務（onSlotClick）。
 *   有時間的單日任務以小方塊顯示在其起始小時格，點擊可開編輯器。
 */
export function CalendarWeekView({
  selectedDate,
  onTaskClick,
  onSlotClick,
  refreshKey,
}: {
  selectedDate: Date;
  onTaskClick?: (taskId: string) => void;
  onSlotClick?: (dateStr: string, hour: number | null) => void;
  refreshKey?: number;
}) {
  const [events, setEvents] = useState<CalendarViewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<CurrentUser | null>(null);

  const weekDays = useMemo(() => getWeekDays(selectedDate), [selectedDate]);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setUser(await getCurrentUser());
        const from = new Date(weekDays[0]);
        from.setHours(0, 0, 0, 0);
        const to = new Date(weekDays[6]);
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
  }, [weekDays, refreshKey]);

  const userTz = user?.timeZone || FALLBACK_TZ;
  const tasks = events?.tasks ?? [];
  const todayKey = dateKeyInTz(new Date().toISOString(), userTz);
  const dayNames = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];

  // 全天區只放「跨日」任務；單日且有時間者改由下方時間格依實際時段呈現（不重複）。
  const { segments, laneCount } = useMemo(
    () => buildRowBars(weekDays, tasks.filter((t) => isMultiDay(t, userTz)), userTz),
    [weekDays, tasks, userTz]
  );

  // 拖曳 / 縮放後寫回：先樂觀更新本地、再持久化；失敗則重抓還原。
  const handleTaskTimeChange = useCallback(
    async (taskId: string, plannedIso: string, dueIso: string) => {
      setEvents((prev) =>
        prev
          ? { ...prev, tasks: prev.tasks.map((t) => (t.id === taskId ? { ...t, plannedDateTime: plannedIso, dueDateTime: dueIso } : t)) }
          : prev
      );
      try {
        await updateTaskCard(taskId, { plannedDateTime: plannedIso, dueDateTime: dueIso });
      } catch (err) {
        logger.error("Failed to update task time:", err);
        const from = new Date(weekDays[0]);
        from.setHours(0, 0, 0, 0);
        const to = new Date(weekDays[6]);
        to.setHours(23, 59, 59, 999);
        const fresh = await getCalendarView(from, to);
        if (fresh) setEvents(fresh);
      }
    },
    [weekDays]
  );

  if (loading) {
    return <div style={{ textAlign: "center", padding: "var(--spacing-8)" }}>載入中...</div>;
  }

  const barsHeight = Math.max(laneCount, 1) * BAR_STEP + 8;
  const GUTTER = 56;

  return (
    <div style={{ width: "100%" }}>
      {/* 日期表頭（含左側時間欄留白） */}
      <div style={{ display: "grid", gridTemplateColumns: `${GUTTER}px repeat(7, 1fr)`, gap: "4px", marginBottom: "4px" }}>
        <div />
        {weekDays.map((d, i) => {
          const isToday = localKey(d) === todayKey;
          return (
            <div
              key={i}
              style={{
                textAlign: "center",
                padding: "var(--spacing-2)",
                borderRadius: "var(--radius-md)",
                background: isToday
                  ? "color-mix(in srgb, var(--status-success-bg) 45%, var(--bg-surface-secondary))"
                  : "var(--bg-surface-secondary)",
              }}
            >
              <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>{dayNames[d.getDay()]}</div>
              <div
                style={{
                  fontSize: "var(--text-lg)",
                  fontWeight: 700,
                  color: isToday ? "var(--status-success-fg)" : "var(--text-primary)",
                }}
              >
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* 全天（跨日任務橫條） */}
      {segments.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: `${GUTTER}px repeat(7, 1fr)`, gap: "4px", marginBottom: "var(--spacing-2)" }}>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", textAlign: "right", paddingRight: 4 }}>全天</div>
          <div style={{ gridColumn: "2 / 9", position: "relative", minHeight: `${barsHeight}px` }}>
            {segments.map((s, i) => {
              const c = barColors(s.task);
              return (
                <div
                  key={`${s.task.id}-${i}`}
                  title={s.task.title}
                  onClick={onTaskClick ? (e) => { e.stopPropagation(); onTaskClick(s.task.id); } : undefined}
                  style={{
                    position: "absolute",
                    left: `calc(${(s.startCol / 7) * 100}% + 3px)`,
                    width: `calc(${(s.span / 7) * 100}% - 6px)`,
                    top: `${s.lane * BAR_STEP + 2}px`,
                    height: `${BAR_STEP - 4}px`,
                    lineHeight: `${BAR_STEP - 4}px`,
                    background: c.bg,
                    color: c.fg,
                    border: `1px solid ${c.border}`,
                    borderRadius: "var(--radius-sm)",
                    padding: "0 6px",
                    fontSize: "var(--text-xs)",
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    textDecoration: s.task.status === "done" ? "line-through" : "none",
                    cursor: onTaskClick ? "pointer" : "default",
                    boxSizing: "border-box",
                  }}
                >
                  {s.continuesLeft ? "◀ " : ""}{s.task.title}{s.continuesRight ? " ▶" : ""}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 時間格（0~23 點 × 7 天）：絕對定位依實際時間放置，可拖曳移動 / 縮放、點空白格新增 */}
      <CalendarTimeGrid
        days={weekDays}
        tasks={tasks}
        userTz={userTz}
        todayKey={todayKey}
        hourHeight={HOUR_H}
        gutter={GUTTER}
        onTaskClick={onTaskClick}
        onSlotClick={onSlotClick}
        onTaskTimeChange={handleTaskTimeChange}
      />
    </div>
  );
}

/** 該週 7 天（週日起算）。 */
function getWeekDays(date: Date): Date[] {
  const d = new Date(date);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay());
  const out: Date[] = [];
  for (let i = 0; i < 7; i++) {
    out.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }
  return out;
}
