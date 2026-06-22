"use client";

import { useState } from "react";
import { TaskCard, TaskGroup, CurrentUser } from "@/lib/api";
import { TaskBoardColumn } from "./TaskBoardColumn";
import { STATUS_ORDER } from "../taskUtils";

/**
 * 看板視圖：依「狀態」分三欄（待辦 / 進行中 / 完成），拖曳卡片即可改變狀態。
 * 分類管理與建立任務由頁面負責；本元件專注於狀態看板。
 */
export function TaskBoardView({
  tasks,
  groups,
  user,
  collapsedTaskIds,
  onOpen,
  onToggleDone,
  onUpdateTask,
  onToggleCollapse,
  onToggleSubtask,
}: {
  tasks: TaskCard[];
  groups: TaskGroup[];
  user: CurrentUser | null;
  collapsedTaskIds: Set<string>;
  onOpen: (id: string) => void;
  onToggleDone: (task: TaskCard) => void;
  onUpdateTask: (id: string, updates: { status: "todo" | "doing" | "done" }) => Promise<void>;
  onToggleCollapse: (taskId: string) => void;
  onToggleSubtask: (taskId: string, subtaskId: string, nextDone: boolean) => void;
}) {
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);

  return (
    <div className="tk-board-grid">
      {STATUS_ORDER.map((status) => (
        <TaskBoardColumn
          key={status}
          status={status}
          tasks={tasks.filter((t) => t.status === status)}
          groups={groups}
          user={user}
          draggedTaskId={draggedTaskId}
          collapsedTaskIds={collapsedTaskIds}
          onDragStart={(taskId) => setDraggedTaskId(taskId)}
          onDragEnd={() => setDraggedTaskId(null)}
          onDrop={() => {
            if (draggedTaskId) {
              const dragged = tasks.find((t) => t.id === draggedTaskId);
              if (dragged && dragged.status !== status) {
                onUpdateTask(draggedTaskId, { status });
              }
            }
            setDraggedTaskId(null);
          }}
          onOpen={onOpen}
          onToggleDone={onToggleDone}
          onToggleCollapse={onToggleCollapse}
          onToggleSubtask={onToggleSubtask}
        />
      ))}
    </div>
  );
}
