"use client";

import { TaskCard } from "@/lib/api";

/**
 * 卡片外層的子任務區（清單 / 看板共用）：
 * - 進度列（可點：收合 / 展開該卡片的子任務）＋ 進度條 ＋ 完成數。
 * - 展開時列出子任務，核取方塊可直接打勾（不會誤觸開啟編輯彈窗）。
 */
export function CardSubtasks({
  task,
  collapsed,
  onToggleCollapse,
  onToggleSubtask,
}: {
  task: TaskCard;
  collapsed: boolean;
  onToggleCollapse: (taskId: string) => void;
  onToggleSubtask: (taskId: string, subtaskId: string, nextDone: boolean) => void;
}) {
  const subs = task.subTasks ?? [];
  const total = task.subTaskTotal ?? subs.length;
  const done = task.subTaskDone ?? subs.filter((s) => s.isDone).length;
  if (total === 0) return null;
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <div className="tk-subs-inline" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="tk-subs-toggle"
        onClick={() => onToggleCollapse(task.id)}
        title={collapsed ? "展開子任務" : "收合子任務"}
      >
        <span className="tk-subs-caret">{collapsed ? "▸" : "▾"}</span>
        <span className="tk-mini-bar">
          <i style={{ width: `${pct}%` }} />
        </span>
        <span className="tk-subs-frac">
          {done}/{total}
        </span>
      </button>

      {!collapsed && subs.length > 0 && (
        <div className="tk-subs-items">
          {subs.map((s) => (
            // 改為 div（非 label）：只有點核取方塊才會切換完成，點標題則開啟子任務瀏覽視窗，
            // 避免「點整列誤觸打勾」。
            <div key={s.id} className="tk-subitem">
              <input
                type="checkbox"
                checked={s.isDone}
                onChange={() => onToggleSubtask(task.id, s.id, !s.isDone)}
                aria-label={s.isDone ? "標為未完成" : "標為完成"}
              />
              <span
                className={s.isDone ? "tk-subitem--done" : ""}
                onClick={() =>
                  // 子任務＝任務：點標題開啟完整任務編輯器（與點父任務相同）。
                  window.dispatchEvent(
                    new CustomEvent("zonwiki:open-task", { detail: { taskId: s.id } })
                  )
                }
                style={{ cursor: "pointer", flex: 1, minWidth: 0 }}
                title="點擊開啟此子任務（完整任務）"
              >
                {s.title}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
