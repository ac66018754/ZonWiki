import { useEffect, useMemo, useState } from "react";
import { TaskCard, getCalendarView, CalendarViewData } from "@/lib/api";
import { logger } from "@/lib/logger";
import { dateKeyInTz, FALLBACK_TZ } from "../../tasks/taskUtils";
import { localKey, parseKey, diffDays, taskRangeKeys, barColors } from "./calendarBars";

/**
 * 年視圖：一年 12 個小月曆。跨日任務會把其涵蓋的日期格子上色，連續日期形成「色帶」（band），
 * 在年層級也看得出任務橫跨了哪幾天（如 6/19~6/25 在六月小月曆連成一條）。
 * 點某天 / 月份 → 鑽研到該月（切到月視圖）。
 */
export function CalendarYearView({
  selectedDate,
  user,
  refreshKey,
  onDrillToDate,
}: {
  selectedDate: Date;
  user?: unknown;
  refreshKey?: number;
  /** 點日期/月份時鑽研到該日所在月（由 /tasks 行事曆切到月視圖）。 */
  onDrillToDate?: (date: Date) => void;
}) {
  const [events, setEvents] = useState<CalendarViewData | null>(null);
  const [loading, setLoading] = useState(true);
  const year = selectedDate.getFullYear();
  const userTz = (user as { timeZone?: string } | undefined)?.timeZone || FALLBACK_TZ;

  // 換年（year 變）時先清空內容顯示載入中；單純背景重抓（refreshKey 變、year 不變，
  // 如關閉任務彈窗後）則保留現有內容、抓完再換——不卸載、不閃動。
  useEffect(() => {
    setEvents(null);
  }, [year]);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const from = new Date(year, 0, 1, 0, 0, 0);
        const to = new Date(year, 11, 31, 23, 59, 59);
        const response = await getCalendarView(from, to);
        if (response) setEvents(response);
      } catch (err) {
        logger.error("Failed to load calendar events:", err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [year, refreshKey]);

  const tasks = events?.tasks ?? [];

  // 每個日期鍵 → 涵蓋它的任務清單（用於上色 + tooltip）。
  const dayMap = useMemo(() => {
    const map = new Map<string, TaskCard[]>();
    for (const t of tasks) {
      const r = taskRangeKeys(t, userTz);
      if (!r) continue;
      const total = diffDays(r.startKey, r.endKey);
      const start = parseKey(r.startKey);
      for (let i = 0; i <= total; i++) {
        const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        if (d.getFullYear() !== year) continue;
        const key = localKey(d);
        const arr = map.get(key);
        if (arr) arr.push(t);
        else map.set(key, [t]);
      }
    }
    return map;
  }, [tasks, userTz, year]);

  const todayKey = dateKeyInTz(new Date().toISOString(), userTz);

  // 只有「首次載入（尚無資料）」才顯示載入中並卸載內容；背景重抓（如關閉任務彈窗後 refreshKey 變動）
  // 保留現有內容顯示、抓完再換上新資料——避免整塊卸載重掛造成「閃一下」。
  if (loading && !events) {
    return <div style={{ textAlign: "center", padding: "var(--spacing-8)" }}>載入中...</div>;
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: "var(--spacing-4)",
      }}
    >
      {Array.from({ length: 12 }, (_, m) => (
        <MiniMonth
          key={m}
          year={year}
          month={m}
          dayMap={dayMap}
          todayKey={todayKey}
          onDrillToDate={onDrillToDate}
        />
      ))}
    </div>
  );
}

/** 單一小月曆。 */
function MiniMonth({
  year,
  month,
  dayMap,
  todayKey,
  onDrillToDate,
}: {
  year: number;
  month: number;
  dayMap: Map<string, TaskCard[]>;
  todayKey: string;
  onDrillToDate?: (date: Date) => void;
}) {
  const first = new Date(year, month, 1);
  const startDow = first.getDay();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  const lastDate = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= lastDate; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const monthNames = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
  const dow = ["日", "一", "二", "三", "四", "五", "六"];

  return (
    <div style={{ border: "1px solid var(--border-default)", borderRadius: "var(--radius-md)", padding: "var(--spacing-2)" }}>
      <button
        onClick={() => onDrillToDate?.(new Date(year, month, 1))}
        style={{
          width: "100%",
          textAlign: "left",
          background: "transparent",
          border: "none",
          cursor: onDrillToDate ? "pointer" : "default",
          fontSize: "var(--text-sm)",
          fontWeight: 700,
          color: "var(--text-primary)",
          marginBottom: "var(--spacing-1)",
          padding: 0,
        }}
        title="檢視此月"
      >
        {monthNames[month]}
      </button>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "1px" }}>
        {dow.map((d) => (
          <div key={d} style={{ textAlign: "center", fontSize: "9px", color: "var(--text-tertiary)" }}>
            {d}
          </div>
        ))}
        {cells.map((date, i) => {
          if (!date) return <div key={i} />;
          const key = localKey(date);
          const covering = dayMap.get(key);
          const isToday = key === todayKey;
          const c = covering && covering.length > 0 ? barColors(covering[0]) : null;
          return (
            <div
              key={i}
              onClick={() => onDrillToDate?.(date)}
              title={covering ? covering.map((t) => t.title).join("、") : undefined}
              style={{
                textAlign: "center",
                fontSize: "10px",
                lineHeight: "18px",
                height: "18px",
                borderRadius: "3px",
                cursor: onDrillToDate ? "pointer" : "default",
                background: isToday ? "var(--status-success-bg)" : c ? c.bg : "transparent",
                color: isToday ? "var(--status-success-fg)" : c ? c.fg : "var(--text-secondary)",
                fontWeight: isToday || c ? 700 : 400,
                outline: isToday ? "1px solid var(--status-success-fg)" : "none",
              }}
            >
              {date.getDate()}
            </div>
          );
        })}
      </div>
    </div>
  );
}
