"use client";

import { TaskCard, TaskGroup, CurrentUser } from "@/lib/api";
import {
  FALLBACK_TZ,
  STATUS_META,
  PRIORITY_META,
  formatDisplay,
  isOverdue,
  isToday,
} from "../taskUtils";
import { CardSubtasks } from "./CardSubtasks";

/**
 * 清單視圖的單張任務卡片（緊湊）。
 * - 左側核取方塊：快速切換「完成 / 待辦」。
 * - 點卡片其他區域：開啟編輯彈窗（完整欄位 + 子任務）。
 * - 子任務在外層直接顯示（可單獨收合），核取方塊可直接打勾。
 */
export function TaskListItem({
  task,
  group,
  user,
  collapsed,
  onOpen,
  onToggleDone,
  onToggleCollapse,
  onToggleSubtask,
}: {
  task: TaskCard;
  group: TaskGroup | null;
  user: CurrentUser | null;
  collapsed: boolean;
  onOpen: (id: string) => void;
  onToggleDone: (task: TaskCard) => void;
  onToggleCollapse: (taskId: string) => void;
  onToggleSubtask: (taskId: string, subtaskId: string, nextDone: boolean) => void;
}) {
  const tz = user?.timeZone || FALLBACK_TZ;
  const done = task.status === "done";
  const overdue = !done && isOverdue(task.dueDateTime);
  const today = !done && isToday(task.dueDateTime, tz);

  const statusMeta = STATUS_META[task.status] ?? STATUS_META.todo;
  const priorityMeta = PRIORITY_META[task.priority ?? 0];

  return (
    <div
      className={[
        "tk-card",
        overdue ? "tk-card--overdue" : "",
        today ? "tk-card--today" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={() => onOpen(task.id)}
    >
      <div className="tk-card-top">
        <input
          type="checkbox"
          className="tk-card-check"
          checked={done}
          onClick={(e) => e.stopPropagation()}
          onChange={() => onToggleDone(task)}
          aria-label={done ? "標為待辦" : "標為完成"}
          title={done ? "標為待辦" : "標為完成"}
        />
        <h3 className={`tk-card-title ${done ? "tk-card-title--done" : ""}`}>{task.title}</h3>
        {!done && (
          <span
            className="tk-chip"
            style={{ background: statusMeta.bg, color: statusMeta.fg }}
          >
            {statusMeta.label}
          </span>
        )}
      </div>

      <div className="tk-card-meta">
        {(task.priority ?? 0) > 0 && (
          <span style={{ color: priorityMeta.fg, fontSize: "var(--text-xs)" }} title={`優先度：${priorityMeta.label}`}>
            {priorityMeta.dot} {priorityMeta.label}
          </span>
        )}

        {group && (
          <span
            className="tk-chip"
            style={{
              background: group.color ? `${group.color}22` : "var(--bg-surface-secondary)",
              color: group.color || "var(--text-secondary)",
            }}
            title={`分類：${group.name}`}
          >
            {group.name}
          </span>
        )}

        {(task.tags ?? []).map((tg) => (
          <span
            key={tg.id}
            className="tk-chip"
            style={{ background: "var(--bg-surface-secondary)", color: "var(--text-secondary)" }}
            title={`標籤：#${tg.name}`}
          >
            #{tg.name}
          </span>
        ))}

        {task.dueDateTime && (
          <span
            className={[
              "tk-due",
              overdue ? "tk-due--overdue" : "",
              today ? "tk-due--today" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            title={`截止：${task.dueDateTime}`}
          >
            ⏰ {formatDisplay(task.dueDateTime, tz)}
            {overdue ? "（逾期）" : today ? "（今天）" : ""}
          </span>
        )}

        {task.plannedDateTime && !task.dueDateTime && (
          <span className="tk-due" title={`排程：${task.plannedDateTime}`}>
            📅 {formatDisplay(task.plannedDateTime, tz)}
          </span>
        )}
      </div>

      <CardSubtasks
        task={task}
        collapsed={collapsed}
        onToggleCollapse={onToggleCollapse}
        onToggleSubtask={onToggleSubtask}
      />
    </div>
  );
}
