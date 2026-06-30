"use client";

import { TaskCard, TaskGroup, CurrentUser } from "@/lib/api";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
  type DragEndEvent,
} from "@dnd-kit/core";
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
  // 拖曳感測器：移動 8px 才啟動，桌機滑鼠與手機觸控（拖卡片左上「⠿」把手）皆適用。
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  /** 拖曳結束：卡片放到哪一欄（over.id＝狀態）就改成該狀態（沿用原行為，不在欄內排序）。 */
  const handleDragEnd = (e: DragEndEvent) => {
    const taskId = String(e.active.id);
    const newStatus = e.over?.id as "todo" | "doing" | "done" | undefined;
    if (!newStatus) return;
    const dragged = tasks.find((t) => t.id === taskId);
    if (dragged && dragged.status !== newStatus) {
      onUpdateTask(taskId, { status: newStatus });
    }
  };

  return (
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={handleDragEnd}>
      <div className="tk-board-grid">
        {STATUS_ORDER.map((status) => (
          <TaskBoardColumn
            key={status}
            status={status}
            tasks={tasks.filter((t) => t.status === status)}
            groups={groups}
            user={user}
            collapsedTaskIds={collapsedTaskIds}
            onOpen={onOpen}
            onToggleDone={onToggleDone}
            onToggleCollapse={onToggleCollapse}
            onToggleSubtask={onToggleSubtask}
          />
        ))}
      </div>
    </DndContext>
  );
}
