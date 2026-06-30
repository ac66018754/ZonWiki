"use client";

import { TaskCard, TaskGroup, CurrentUser } from "@/lib/api";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  FALLBACK_TZ,
  PRIORITY_META,
  formatDisplay,
  isTaskOverdue,
  isToday,
  formatTargetPeriod,
} from "../taskUtils";
import { CardSubtasks } from "./CardSubtasks";

/**
 * 看板視圖中的任務卡片。
 * - 可拖曳到其他欄位以改變狀態。
 * - 左側核取方塊：快速完成。
 * - 點卡片其他區域：開啟編輯彈窗。
 * - 顯示：標題、分類、截止（逾期紅 / 今天黃）、優先度。
 * - 子任務在外層直接顯示（可單獨收合），核取方塊可直接打勾。
 */
export function TaskCardItem({
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
  const overdue = !done && isTaskOverdue(task);
  const today = !done && isToday(task.dueDateTime, tz);
  const targetText = formatTargetPeriod(task.targetDateTime, task.targetGranularity);

  const total = task.subTaskTotal ?? 0;
  const priorityMeta = PRIORITY_META[task.priority ?? 0];

  // 拖曳能力由 @dnd-kit 提供：listeners 只掛在「⠿」把手上，卡片本體照常可點（開啟）/捲動，
  // 觸控時不會「碰到卡片就被當成拖曳」。拖到其他欄位即由看板的 onDragEnd 改變狀態。
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } =
    useDraggable({ id: task.id });

  return (
    <div
      ref={setNodeRef}
      onClick={() => onOpen(task.id)}
      className={[
        "tk-card",
        overdue ? "tk-card--overdue" : "",
        today ? "tk-card--today" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        background: "var(--bg-elevated)",
        cursor: "pointer",
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.5 : 1,
        boxShadow: isDragging ? "var(--shadow-lg)" : undefined,
        zIndex: isDragging ? 50 : undefined,
        position: isDragging ? "relative" : undefined,
      }}
    >
      <div className="tk-card-top">
        <span
          ref={setActivatorNodeRef}
          className="tk-card-drag-handle"
          title="拖曳到其他欄位改變狀態（手機長按把手拖曳）"
          style={{
            touchAction: "none",
            cursor: "grab",
            color: "var(--text-tertiary)",
            fontSize: "var(--text-sm)",
            lineHeight: 1,
            userSelect: "none",
          }}
          onClick={(e) => e.stopPropagation()}
          {...attributes}
          {...listeners}
        >
          ⠿
        </span>
        <input
          type="checkbox"
          className="tk-card-check"
          checked={done}
          onClick={(e) => e.stopPropagation()}
          onChange={() => onToggleDone(task)}
          aria-label={done ? "標為待辦" : "標為完成"}
          title={done ? "標為待辦" : "標為完成"}
        />
        <h4 className={`tk-card-title ${done ? "tk-card-title--done" : ""}`} style={{ fontSize: "var(--text-sm)" }}>
          {task.title}
        </h4>
        {(task.priority ?? 0) > 0 && (
          <span title={`優先度：${priorityMeta.label}`} style={{ fontSize: "var(--text-xs)" }}>
            {priorityMeta.dot}
          </span>
        )}
      </div>

      {(group || (task.tags && task.tags.length > 0) || task.dueDateTime || task.isLongTerm) && (
        <div className="tk-card-meta">
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
          {task.isLongTerm && (
            <span
              className="tk-chip"
              style={{ background: "var(--action-secondary-bg)", color: "var(--action-secondary-fg)" }}
              title={targetText ? `長期任務・目標 ${targetText}` : "長期任務"}
            >
              ♾️ 長期{targetText ? `・${targetText}` : ""}
            </span>
          )}
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
            </span>
          )}
        </div>
      )}

      {total > 0 && (
        <CardSubtasks
          task={task}
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          onToggleSubtask={onToggleSubtask}
        />
      )}
    </div>
  );
}
