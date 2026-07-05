"use client";

import { useCallback, useEffect, useState } from "react";
import { updateSubTask, deleteSubTask, type SubTask, type CurrentUser } from "@/lib/api";
import { FALLBACK_TZ, formatDisplay } from "../taskUtils";
import { useConfirm } from "@/components/ConfirmProvider";

/** `zonwiki:open-subtask` 事件攜帶的資料。 */
interface OpenSubtaskDetail {
  subtask: SubTask;
  parentTitle: string;
}

/**
 * 子任務瀏覽視窗（像父任務的檢視彈窗）。
 * 以視窗事件 `zonwiki:open-subtask` 開啟——這樣清單/看板/首頁等多處的子任務列
 * 都能直接派發事件開啟，不必逐層傳 callback。
 *
 * 內容：標題（可編輯）、完成狀態（可切換）、所屬任務、建立日期、完成日期、刪除。
 * 任何變更後派發 `zonwiki:tasks-changed`，讓所在頁面重新載入任務以同步。
 */
export function SubtaskViewerModal({ user }: { user: CurrentUser | null }) {
  const confirm = useConfirm();
  const [sub, setSub] = useState<SubTask | null>(null);
  const [parentTitle, setParentTitle] = useState("");
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const tz = user?.timeZone || FALLBACK_TZ;

  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<OpenSubtaskDetail>).detail;
      if (!d?.subtask) return;
      setSub(d.subtask);
      setParentTitle(d.parentTitle || "");
      setEditing(false);
    };
    window.addEventListener("zonwiki:open-subtask", onOpen);
    return () => window.removeEventListener("zonwiki:open-subtask", onOpen);
  }, []);

  const close = useCallback(() => setSub(null), []);
  const notifyChanged = () => window.dispatchEvent(new CustomEvent("zonwiki:tasks-changed"));

  if (!sub) return null;

  const toggleDone = async () => {
    setBusy(true);
    const updated = await updateSubTask(sub.id, { isDone: !sub.isDone });
    setBusy(false);
    if (updated) {
      setSub(updated);
      notifyChanged();
    }
  };

  const saveTitle = async () => {
    const t = titleDraft.trim();
    if (!t || t === sub.title) {
      setEditing(false);
      return;
    }
    setBusy(true);
    const updated = await updateSubTask(sub.id, { title: t });
    setBusy(false);
    if (updated) {
      setSub(updated);
      setEditing(false);
      notifyChanged();
    }
  };

  const remove = async () => {
    if (!(await confirm({ message: "刪除這個子任務？（會進垃圾桶）", danger: true }))) return;
    setBusy(true);
    const ok = await deleteSubTask(sub.id);
    setBusy(false);
    if (ok) {
      notifyChanged();
      close();
    }
  };

  return (
    <div
      onClick={close}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 3500,
        padding: "var(--spacing-4)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: "420px",
          background: "var(--bg-surface)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lg)",
          padding: "var(--spacing-5)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--spacing-3)" }}>
          <span style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>☑️ 子任務</span>
          <button
            onClick={close}
            aria-label="關閉"
            title="關閉"
            style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--text-secondary)", fontSize: "var(--text-base)" }}
          >
            ✕
          </button>
        </div>

        {editing ? (
          <div style={{ display: "flex", gap: "var(--spacing-2)", marginBottom: "var(--spacing-3)" }}>
            <input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveTitle();
                if (e.key === "Escape") setEditing(false);
              }}
              style={{
                flex: 1,
                padding: "var(--spacing-2)",
                border: "1px solid var(--border-default)",
                borderRadius: "var(--radius-md)",
                background: "var(--bg-default)",
                color: "var(--text-primary)",
                fontSize: "var(--text-sm)",
              }}
            />
            <button onClick={saveTitle} disabled={busy} className="btn-primary" style={{ fontSize: "var(--text-sm)" }}>
              儲存
            </button>
          </div>
        ) : (
          <h2
            style={{
              margin: "0 0 var(--spacing-3) 0",
              fontSize: "var(--text-lg)",
              fontWeight: 700,
              color: "var(--text-primary)",
              textDecoration: sub.isDone ? "line-through" : "none",
              opacity: sub.isDone ? 0.7 : 1,
              wordBreak: "break-word",
            }}
          >
            {sub.title || "（未命名子任務）"}
          </h2>
        )}

        {/* 完成狀態切換（此為明確控制項，點整列即切換是預期行為） */}
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--spacing-2)",
            marginBottom: "var(--spacing-4)",
            cursor: "pointer",
            fontSize: "var(--text-sm)",
            color: "var(--text-primary)",
          }}
        >
          <input type="checkbox" checked={sub.isDone} onChange={toggleDone} disabled={busy} />
          <span>{sub.isDone ? "已完成" : "未完成"}</span>
        </label>

        <div style={{ display: "grid", gap: "var(--spacing-2)", fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginBottom: "var(--spacing-4)" }}>
          <div>
            所屬任務：<span style={{ color: "var(--text-primary)" }}>{parentTitle || "—"}</span>
          </div>
          <div>建立日期：{sub.createdDateTime ? formatDisplay(sub.createdDateTime, tz) : "—"}</div>
          <div>完成日期：{sub.completedDateTime ? formatDisplay(sub.completedDateTime, tz) : "—"}</div>
        </div>

        <div style={{ display: "flex", gap: "var(--spacing-2)", justifyContent: "flex-end" }}>
          {!editing && (
            <button
              onClick={() => {
                setTitleDraft(sub.title);
                setEditing(true);
              }}
              style={viewerBtn}
            >
              ✎ 編輯標題
            </button>
          )}
          <button onClick={remove} disabled={busy} style={{ ...viewerBtn, color: "var(--status-danger-fg)" }}>
            🗑 刪除
          </button>
        </div>
      </div>
    </div>
  );
}

const viewerBtn: React.CSSProperties = {
  padding: "var(--spacing-2) var(--spacing-3)",
  background: "var(--bg-default)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-md)",
  fontSize: "var(--text-sm)",
  cursor: "pointer",
};
