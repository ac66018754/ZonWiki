"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listTaskCardsInRange, type CurrentUser, type TaskCard } from "@/lib/api";
import { FALLBACK_TZ, STATUS_META, dateKeyInTz, fromLocalInputValue } from "@/app/tasks/taskUtils";
import { TagGroupedTaskList } from "./tasks/TagGroupedTaskList";

/**
 * 算出「使用者時區的今天」對應的 UTC 起訖時間（含頭含尾）。
 *
 * 為什麼不能直接用 `new Date()` 取當地零點：瀏覽器的當地時區未必等於使用者在系統設定的時區
 * （例如人在國外出差、或帳號設定成 Asia/Taipei 但電腦是 UTC）。時間鐵則是「DB 存 UTC、
 * 依使用者時區顯示」，所以這裡先取「使用者時區的今天是幾號」，再把那一天的 00:00 與 23:59
 * 當成該時區的牆上時間換回 UTC。
 *
 * @param tz IANA 時區（例如 "Asia/Taipei"）。
 * @returns { fromIso, toIso } 今天的 UTC 起訖 ISO 字串。
 */
export function computeTodayRangeUtc(tz: string): { fromIso: string; toIso: string } {
  const todayKey = dateKeyInTz(new Date().toISOString(), tz);
  // fromLocalInputValue 只會在字串為空時回 null；這裡一定有值，仍以 ?? 收斂型別。
  const fromIso = fromLocalInputValue(`${todayKey}T00:00`, tz) ?? new Date().toISOString();
  const toIso = fromLocalInputValue(`${todayKey}T23:59`, tz) ?? new Date().toISOString();
  return { fromIso, toIso };
}

/**
 * Todo 頁左側欄的「今日任務」清單。
 *
 * - 內容＝開始（排程）時間或截止時間落在「使用者時區的今天」的任務
 *   （後端 `GET /api/tasks?view=calendar&from&to`，與行事曆同一條查詢路徑）。
 * - 排序：未完成在前、已完成在後；同組內依「今天的時間點」由早到晚。
 * - 點擊任一項派發 `zonwiki:open-task` 事件 → Todo 頁監聽後開啟該任務的完整編輯器
 *   （與「置頂的任務」分頁同一機制）。
 * - 監聽 `zonwiki:tasks-changed`（任務儲存/建立/刪除後由編輯器派發）即時重新載入。
 * - **依標籤分組、每組可獨立收合**（交給 TagGroupedTaskList）：分組不影響上面那條排序規則，
 *   排序結果原封不動帶進各群組內；收合狀態與「置頂的任務」分開記，互不干擾。
 *
 * @param user 目前登入者（只用其時區；未登入或未設定時退回 Asia/Taipei）。
 */
export function TasksTodayList({ user }: { user: CurrentUser | null }) {
  const [tasks, setTasks] = useState<TaskCard[]>([]);
  const [loading, setLoading] = useState(true);
  // 請求序號：防止「後發先至」——較早發出但較晚回來的舊回應不得覆蓋較新的資料
  // （與 TasksPinnedList 同一道防線）。
  const requestSeqRef = useRef(0);

  const tz = user?.timeZone || FALLBACK_TZ;

  /** 重新載入今日清單（掛載時、時區變更時、任務變更事件時呼叫）。 */
  const reload = useCallback(() => {
    const seq = ++requestSeqRef.current;
    const { fromIso, toIso } = computeTodayRangeUtc(tz);
    listTaskCardsInRange(fromIso, toIso)
      .then((list) => {
        if (seq === requestSeqRef.current) setTasks(list);
      })
      .catch(() => {})
      .finally(() => {
        if (seq === requestSeqRef.current) setLoading(false);
      });
  }, [tz]);

  useEffect(() => {
    reload();
    window.addEventListener("zonwiki:tasks-changed", reload);
    return () => window.removeEventListener("zonwiki:tasks-changed", reload);
  }, [reload]);

  /** 排序後的清單：未完成在前，其次依當天的時間點由早到晚。 */
  const sorted = useMemo(() => {
    /** 取這張卡片「今天的時間點」（優先看排程時間，其次截止時間）。 */
    const timeOf = (task: TaskCard): number => {
      const iso = task.plannedDateTime ?? task.dueDateTime;
      const ms = iso ? new Date(iso).getTime() : Number.NaN;
      return Number.isNaN(ms) ? Number.MAX_SAFE_INTEGER : ms;
    };
    return [...tasks].sort((a, b) => {
      const aDone = a.status === "done" ? 1 : 0;
      const bDone = b.status === "done" ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
      return timeOf(a) - timeOf(b);
    });
  }, [tasks]);

  /** 點擊項目 → 派發開啟任務事件（Todo 頁的編輯器會接手）。 */
  const openTask = (taskId: string) => {
    window.dispatchEvent(new CustomEvent("zonwiki:open-task", { detail: { taskId } }));
  };

  /** 把 UTC ISO 轉成使用者時區的 HH:mm（無時間資訊回空字串）。 */
  const timeLabel = (task: TaskCard): string => {
    const iso = task.plannedDateTime ?? task.dueDateTime;
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("zh-Hant", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: tz,
    }).format(date);
  };

  return (
    <div className="ttl-wrap">
      <p className="ttl-head">今日任務</p>

      {loading && <p className="ttl-hint">載入中…</p>}

      {!loading && sorted.length === 0 && (
        <p className="ttl-hint">
          今天沒有安排任務。
          <br />
          任務的「開始」或「截止」時間設在今天，就會出現在這裡。
        </p>
      )}

      {!loading && sorted.length > 0 && (
        <TagGroupedTaskList
          storageKey="today"
          tasks={sorted}
          renderTask={(task) => {
            const meta = STATUS_META[task.status] ?? STATUS_META.todo;
            const isDone = task.status === "done";
            const time = timeLabel(task);
            return (
              <button
                type="button"
                className={`ttl-item ${isDone ? "ttl-item--done" : ""}`}
                onClick={() => openTask(task.id)}
                title={`開啟「${task.title}」`}
              >
                <span className="ttl-icon" aria-hidden>
                  {meta.icon}
                </span>
                <span className="ttl-title">{task.title}</span>
                {time && <span className="ttl-time">{time}</span>}
              </button>
            );
          }}
        />
      )}

      <style jsx>{`
        .ttl-wrap {
          display: flex;
          flex-direction: column;
          gap: var(--spacing-2);
        }
        .ttl-head {
          margin: 0;
          font-size: var(--text-xs);
          color: var(--text-tertiary);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .ttl-hint {
          margin: 0;
          font-size: var(--text-sm);
          color: var(--text-secondary);
          line-height: 1.7;
        }
        .ttl-item {
          width: 100%;
          display: flex;
          align-items: center;
          gap: var(--spacing-2);
          padding: var(--spacing-2) var(--spacing-2);
          border: 1px solid transparent;
          border-radius: var(--radius-md);
          background: transparent;
          color: var(--text-primary);
          font-family: var(--font-body);
          font-size: var(--text-sm);
          text-align: left;
          cursor: pointer;
          transition: background 0.15s ease, border-color 0.15s ease;
        }
        .ttl-item:hover {
          background: var(--bg-surface-secondary, var(--bg-default));
          border-color: var(--border-default);
        }
        .ttl-item:focus-visible {
          outline: 2px solid var(--action-secondary-fg);
          outline-offset: 1px;
        }
        .ttl-item--done {
          opacity: 0.6;
        }
        .ttl-item--done .ttl-title {
          text-decoration: line-through;
        }
        .ttl-icon {
          flex-shrink: 0;
          font-size: var(--text-sm);
        }
        .ttl-title {
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          line-height: 1.6;
        }
        .ttl-time {
          flex-shrink: 0;
          font-size: var(--text-xs);
          color: var(--text-secondary);
          font-variant-numeric: tabular-nums;
        }
      `}</style>
    </div>
  );
}
