import { useCallback, useEffect, useMemo, useState } from "react";
import { getCalendarView, updateTaskCard, CalendarViewData } from "@/lib/api";
import { useCurrentUser } from "@/lib/swr";
import { logger } from "@/lib/logger";
import { dateKeyInTz, FALLBACK_TZ } from "../../tasks/taskUtils";
import { localKey, isMultiDay, taskCoversDay, barColors } from "./calendarBars";
import { CalendarTimeGrid } from "./CalendarTimeGrid";

const HOUR_H = 44;

/**
 * 日視圖（Google Calendar 風）：
 * - 頂部：當天大橫幅；其下「全天」區放涵蓋當天的跨日任務橫條。
 * - 主體：x = 今日（單欄），y = 0~23 點；點任一小時格 → 新增該小時的任務（onSlotClick）。
 *   有時間的單日任務以方塊顯示在其起始小時格，點擊可開編輯器。
 */
export function CalendarDayView({
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
  // 目前登入者（僅用於時區顯示）改由共用的 SWR 快取取得，避免每個檢視各自重打 /api/me。
  const { data: user } = useCurrentUser();

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const dayStart = new Date(selectedDate);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(selectedDate);
        dayEnd.setHours(23, 59, 59, 999);
        const response = await getCalendarView(dayStart, dayEnd);
        if (response) setEvents(response);
      } catch (err) {
        logger.error("Failed to load calendar events:", err);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [selectedDate, refreshKey]);

  const userTz = user?.timeZone || FALLBACK_TZ;
  const dayKey = localKey(selectedDate);
  const todayKey = dateKeyInTz(new Date().toISOString(), userTz);
  const isToday = dayKey === todayKey;
  const tasks = events?.tasks ?? [];

  const multiDayTasks = useMemo(
    () => tasks.filter((t) => isMultiDay(t, userTz) && taskCoversDay(t, dayKey, userTz)),
    [tasks, dayKey, userTz]
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
        const dayStart = new Date(selectedDate);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(selectedDate);
        dayEnd.setHours(23, 59, 59, 999);
        const fresh = await getCalendarView(dayStart, dayEnd);
        if (fresh) setEvents(fresh);
      }
    },
    [selectedDate]
  );

  if (loading) {
    return <div style={{ textAlign: "center", padding: "var(--spacing-8)" }}>載入中...</div>;
  }

  const banner = selectedDate.toLocaleDateString("zh-Hant", {
    month: "long",
    day: "numeric",
    weekday: "long",
  });
  const GUTTER = 64;

  return (
    <div style={{ width: "100%" }}>
      {/* 今日大橫幅 */}
      <div
        style={{
          textAlign: "center",
          padding: "var(--spacing-3)",
          borderRadius: "var(--radius-lg)",
          // 今日：淡綠底 + 綠框 + 綠字（含「（今天）」標記），不再整條塗滿濃綠。
          background: isToday
            ? "color-mix(in srgb, var(--status-success-bg) 40%, var(--bg-surface-secondary))"
            : "var(--bg-surface-secondary)",
          border: isToday ? "1px solid var(--status-success-fg)" : "1px solid transparent",
          color: isToday ? "var(--status-success-fg)" : "var(--text-primary)",
          fontSize: "var(--text-2xl)",
          fontWeight: 700,
          marginBottom: "var(--spacing-2)",
        }}
      >
        {banner}
        {isToday && <span style={{ fontSize: "var(--text-sm)", marginLeft: "var(--spacing-2)" }}>（今天）</span>}
      </div>

      {/* 全天（涵蓋本日的跨日任務） */}
      {multiDayTasks.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "2px", marginBottom: "var(--spacing-2)" }}>
          {multiDayTasks.map((t) => {
            const c = barColors(t);
            return (
              <div
                key={t.id}
                title={t.title}
                onClick={onTaskClick ? () => onTaskClick(t.id) : undefined}
                style={{
                  background: c.bg,
                  color: c.fg,
                  border: `1px solid ${c.border}`,
                  borderRadius: "var(--radius-sm)",
                  padding: "2px 8px",
                  fontSize: "var(--text-xs)",
                  fontWeight: 600,
                  cursor: onTaskClick ? "pointer" : "default",
                  textDecoration: t.status === "done" ? "line-through" : "none",
                }}
              >
                🗓 {t.title}（跨日）
              </div>
            );
          })}
        </div>
      )}

      {/* 時間格（0~23 點）：絕對定位依實際時間放置，可拖曳移動 / 縮放、點空白格新增 */}
      <CalendarTimeGrid
        days={[selectedDate]}
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
