"use client";

import { TaskCard, TaskGroup, CurrentUser } from "@/lib/api";
import { TaskCardItem } from "./TaskCardItem";
import { STATUS_META, isTaskOverdue } from "../taskUtils";

/**
 * 看板的單一狀態欄位（待辦 / 進行中 / 完成），為拖放目標。
 */
export function TaskBoardColumn({
  status,
  tasks,
  groups,
  user,
  draggedTaskId,
  collapsedTaskIds,
  onDragStart,
  onDragEnd,
  onDrop,
  onOpen,
  onToggleDone,
  onToggleCollapse,
  onToggleSubtask,
}: {
  status: "todo" | "doing" | "done";
  tasks: TaskCard[];
  groups: TaskGroup[];
  user: CurrentUser | null;
  draggedTaskId: string | null;
  collapsedTaskIds: Set<string>;
  onDragStart: (taskId: string) => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onOpen: (id: string) => void;
  onToggleDone: (task: TaskCard) => void;
  onToggleCollapse: (taskId: string) => void;
  onToggleSubtask: (taskId: string, subtaskId: string, nextDone: boolean) => void;
}) {
  const meta = STATUS_META[status];
  // 逾期數（完成欄不計）
  const overdueCount =
    status === "done" ? 0 : tasks.filter((t) => isTaskOverdue(t)).length;

  return (
    <div
      style={{
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--border-default)",
        background: "var(--bg-surface)",
        padding: "var(--spacing-4)",
        minHeight: "420px",
        display: "flex",
        flexDirection: "column",
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.currentTarget.style.background = "var(--action-secondary-bg)";
      }}
      onDragLeave={(e) => {
        e.currentTarget.style.background = "var(--bg-surface)";
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.currentTarget.style.background = "var(--bg-surface)";
        onDrop();
      }}
    >
      <div
        style={{
          marginBottom: "var(--spacing-3)",
          paddingBottom: "var(--spacing-3)",
          borderBottom: "1px solid var(--border-default)",
          display: "flex",
          alignItems: "center",
          gap: "var(--spacing-2)",
        }}
      >
        <h2 style={{ margin: 0, fontSize: "var(--text-base)", fontWeight: 600, color: "var(--text-primary)" }}>
          {meta.icon} {meta.label}
        </h2>
        <span style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>{tasks.length}</span>
        {overdueCount > 0 && (
          <span
            className="tk-chip"
            style={{ background: "var(--status-danger-bg)", color: "var(--status-danger-fg)" }}
            title={`${overdueCount} 個逾期`}
          >
            逾期 {overdueCount}
          </span>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-3)", flex: 1 }}>
        {tasks.length === 0 ? (
          <div
            style={{
              padding: "var(--spacing-6) var(--spacing-3)",
              textAlign: "center",
              color: "var(--text-tertiary)",
              fontSize: "var(--text-sm)",
            }}
          >
            拖曳任務到此
          </div>
        ) : (
          tasks.map((task) => (
            <TaskCardItem
              key={task.id}
              task={task}
              group={groups.find((g) => g.id === task.groupId) || null}
              user={user}
              isDragged={draggedTaskId === task.id}
              collapsed={collapsedTaskIds.has(task.id)}
              onDragStart={() => onDragStart(task.id)}
              onDragEnd={onDragEnd}
              onOpen={onOpen}
              onToggleDone={onToggleDone}
              onToggleCollapse={onToggleCollapse}
              onToggleSubtask={onToggleSubtask}
            />
          ))
        )}
      </div>
    </div>
  );
}
