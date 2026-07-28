"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { listPinnedTodoTasks, type TaskCard } from "@/lib/api";
import { STATUS_META } from "@/app/tasks/taskUtils";

/**
 * Todo 頁左側欄的「置頂的任務」清單。
 *
 * - 內容＝所有 isPinnedToTodo=true 的任務（後端 `GET /api/tasks?view=list&pinnedToTodo=true`，依建立時間排序）。
 * - 點擊任一項派發 `zonwiki:open-task` 事件 → Todo 頁監聽後開啟該任務的完整編輯器
 *   （與首頁/筆記頁開任務同一機制，不需逐層傳 callback）。
 * - 監聽 `zonwiki:tasks-changed`（任務儲存/建立/刪除後由編輯器派發）即時重新載入，
 *   讓「勾了置頂→儲存」立刻反映在側欄。
 * - 已完成（done）的任務仍會顯示（劃刪除線、降低透明度），由使用者自行決定何時取消置頂。
 */
export function TasksPinnedList() {
  const [tasks, setTasks] = useState<TaskCard[]>([]);
  const [loading, setLoading] = useState(true);
  // 請求序號：防止「後發先至」——連續兩次 reload 時，較早發出但較晚回來的舊回應
  // 不得覆蓋較新的資料（對抗式復審 MEDIUM 修正）。
  const requestSeqRef = useRef(0);

  /** 重新載入置頂清單（掛載時與任務變更事件時呼叫）。 */
  const reload = useCallback(() => {
    const seq = ++requestSeqRef.current;
    listPinnedTodoTasks()
      .then((list) => {
        // 只有「仍是最新一次請求」的回應才寫入狀態。
        if (seq === requestSeqRef.current) setTasks(list);
      })
      .catch(() => {})
      .finally(() => {
        if (seq === requestSeqRef.current) setLoading(false);
      });
  }, []);

  useEffect(() => {
    reload();
    window.addEventListener("zonwiki:tasks-changed", reload);
    return () => window.removeEventListener("zonwiki:tasks-changed", reload);
  }, [reload]);

  /** 點擊項目 → 派發開啟任務事件（Todo 頁的編輯器會接手）。 */
  const openTask = (taskId: string) => {
    window.dispatchEvent(
      new CustomEvent("zonwiki:open-task", { detail: { taskId } })
    );
  };

  return (
    <div className="tpl-wrap">
      <p className="tpl-head">置頂的任務</p>

      {loading && <p className="tpl-hint">載入中…</p>}

      {!loading && tasks.length === 0 && (
        <p className="tpl-hint">
          尚無置頂任務。
          <br />
          開啟任務後勾選「📍 置頂（Todo 側欄）」即會顯示在這裡。
        </p>
      )}

      {!loading && tasks.length > 0 && (
        <ul className="tpl-list">
          {tasks.map((task) => {
            const meta = STATUS_META[task.status] ?? STATUS_META.todo;
            const isDone = task.status === "done";
            return (
              <li key={task.id}>
                <button
                  type="button"
                  className={`tpl-item ${isDone ? "tpl-item--done" : ""}`}
                  onClick={() => openTask(task.id)}
                  title={`開啟「${task.title}」`}
                >
                  <span className="tpl-icon" aria-hidden>
                    {meta.icon}
                  </span>
                  <span className="tpl-title">{task.title}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <style jsx>{`
        .tpl-wrap {
          display: flex;
          flex-direction: column;
          gap: var(--spacing-2);
        }
        .tpl-head {
          margin: 0;
          font-size: var(--text-xs);
          color: var(--text-tertiary);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .tpl-hint {
          margin: 0;
          font-size: var(--text-sm);
          color: var(--text-secondary);
          line-height: 1.7;
        }
        .tpl-list {
          margin: 0;
          padding: 0;
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: var(--spacing-1);
        }
        .tpl-item {
          width: 100%;
          display: flex;
          align-items: center;
          gap: var(--spacing-2);
          padding: var(--spacing-2) var(--spacing-2);
          border: 1px solid transparent;
          border-radius: var(--radius-md);
          background: transparent;
          color: var(--text-primary);
          font-size: var(--text-sm);
          text-align: left;
          cursor: pointer;
          transition: background 0.15s ease, border-color 0.15s ease;
        }
        .tpl-item:hover {
          background: var(--bg-surface-secondary, var(--bg-default));
          border-color: var(--border-default);
        }
        .tpl-item:focus-visible {
          outline: 2px solid var(--action-secondary-fg);
          outline-offset: 1px;
        }
        .tpl-item--done {
          opacity: 0.6;
        }
        .tpl-item--done .tpl-title {
          text-decoration: line-through;
        }
        .tpl-icon {
          flex-shrink: 0;
          font-size: var(--text-sm);
        }
        .tpl-title {
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          line-height: 1.6;
        }
      `}</style>
    </div>
  );
}
