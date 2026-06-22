"use client";

import { useRef } from "react";
import { TaskCard, TaskGroup, CurrentUser } from "@/lib/api";
import {
  FALLBACK_TZ,
  PRIORITY_META,
  formatDisplay,
  isOverdue,
  isToday,
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
  isDragged,
  collapsed,
  onDragStart,
  onDragEnd,
  onOpen,
  onToggleDone,
  onToggleCollapse,
  onToggleSubtask,
}: {
  task: TaskCard;
  group: TaskGroup | null;
  user: CurrentUser | null;
  isDragged: boolean;
  collapsed: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpen: (id: string) => void;
  onToggleDone: (task: TaskCard) => void;
  onToggleCollapse: (taskId: string) => void;
  onToggleSubtask: (taskId: string, subtaskId: string, nextDone: boolean) => void;
}) {
  const tz = user?.timeZone || FALLBACK_TZ;
  const done = task.status === "done";
  const overdue = !done && isOverdue(task.dueDateTime);
  const today = !done && isToday(task.dueDateTime, tz);

  const total = task.subTaskTotal ?? 0;
  const priorityMeta = PRIORITY_META[task.priority ?? 0];

  // 區分「拖曳」與「點擊」：拖曳後短時間內忽略 onClick，避免拖完誤觸開啟彈窗。
  const draggedRef = useRef(false);

  return (
    <div
      draggable
      onDragStart={() => {
        draggedRef.current = true;
        onDragStart();
      }}
      onDragEnd={() => {
        onDragEnd();
        // 在 onClick 之後再清除旗標（onClick 緊接 dragend 觸發時才會被擋下）。
        setTimeout(() => {
          draggedRef.current = false;
        }, 0);
      }}
      onClick={() => {
        if (draggedRef.current) return;
        onOpen(task.id);
      }}
      className={[
        "tk-card",
        overdue ? "tk-card--overdue" : "",
        today ? "tk-card--today" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        background: "var(--bg-elevated)",
        cursor: isDragged ? "grabbing" : "grab",
        opacity: isDragged ? 0.5 : 1,
        boxShadow: isDragged ? "var(--shadow-lg)" : undefined,
      }}
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
        <h4 className={`tk-card-title ${done ? "tk-card-title--done" : ""}`} style={{ fontSize: "var(--text-sm)" }}>
          {task.title}
        </h4>
        {(task.priority ?? 0) > 0 && (
          <span title={`優先度：${priorityMeta.label}`} style={{ fontSize: "var(--text-xs)" }}>
            {priorityMeta.dot}
          </span>
        )}
      </div>

      {(group || (task.tags && task.tags.length > 0) || task.dueDateTime) && (
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
