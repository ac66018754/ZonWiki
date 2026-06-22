"use client";

import { useEffect, useState } from "react";
import { createTaskCard, type TaskGroup, type CurrentUser } from "@/lib/api";
import { DateTimePicker } from "@/components/DateTimePicker";
import { SearchableMultiSelect } from "@/components/SearchableMultiSelect";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { FALLBACK_TZ, PRIORITY_META } from "../taskUtils";

/** 行事曆點格子帶入的初始時間（UTC ISO；可為 null）。null=不開啟。 */
export interface QuickCreateInitial {
  plannedDateTime: string | null;
  dueDateTime: string | null;
}

/**
 * 快速新增任務的浮動表單（行事曆點格子彈出）。
 * 預設帶入「開始（排程）/ 截止」時間（皆可再調整），另可填標題、優先度、分類。
 * 建立後通知上層重抓；要設更多欄位可建立後再點任務開完整編輯器。
 */
export function QuickCreateTaskModal({
  initial,
  groups,
  user,
  onClose,
  onCreated,
}: {
  initial: QuickCreateInitial | null;
  groups: TaskGroup[];
  user: CurrentUser | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const tz = user?.timeZone || FALLBACK_TZ;
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [planned, setPlanned] = useState<string | null>(null);
  const [due, setDue] = useState<string | null>(null);
  const [priority, setPriority] = useState(0);
  const [groupId, setGroupId] = useState("");
  const [saving, setSaving] = useState(false);

  // 每次開啟（initial 變更）重置欄位並帶入時間
  useEffect(() => {
    if (!initial) return;
    setTitle("");
    setContent("");
    setPlanned(initial.plannedDateTime);
    setDue(initial.dueDateTime);
    setPriority(0);
    setGroupId("");
  }, [initial]);

  // Esc 關閉
  useEffect(() => {
    if (!initial) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [initial, onClose]);

  if (!initial) return null;

  const save = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      const created = await createTaskCard({
        title: title.trim(),
        content: content.trim() || undefined,
        status: "todo",
        priority,
        groupId: groupId || undefined,
        plannedDateTime: planned,
        dueDateTime: due,
      });
      if (created) {
        onCreated();
        onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      onClick={onClose}
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
          maxWidth: "480px",
          maxHeight: "90vh",
          overflowY: "auto",
          background: "var(--bg-surface)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lg)",
          padding: "var(--spacing-5)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--spacing-3)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--text-primary)" }}>新增任務</h2>
          <button
            onClick={onClose}
            aria-label="關閉"
            title="關閉"
            style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--text-secondary)", fontSize: "var(--text-base)" }}
          >
            ✕
          </button>
        </div>

        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
          }}
          placeholder="任務標題…"
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "var(--spacing-2) var(--spacing-3)",
            border: "1px solid var(--border-default)",
            borderRadius: "var(--radius-md)",
            background: "var(--bg-default)",
            color: "var(--text-primary)",
            fontSize: "var(--text-base)",
          }}
        />

        <div style={{ display: "flex", gap: "var(--spacing-3)", flexWrap: "wrap" }}>
          <label style={{ flex: 1, minWidth: "180px", fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
            開始（排程）
            <DateTimePicker value={planned} onChange={setPlanned} tz={tz} ariaLabel="開始時間" />
          </label>
          <label style={{ flex: 1, minWidth: "180px", fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
            截止
            <DateTimePicker value={due} onChange={setDue} tz={tz} ariaLabel="截止時間" />
          </label>
        </div>

        <div style={{ display: "flex", gap: "var(--spacing-3)", flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ display: "flex", gap: "4px" }}>
            {[0, 1, 2, 3].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPriority(p)}
                title={`優先度：${PRIORITY_META[p]?.label ?? p}`}
                style={{
                  padding: "var(--spacing-1) var(--spacing-2)",
                  borderRadius: "var(--radius-full)",
                  border: `1px solid ${priority === p ? "var(--action-primary-bg)" : "var(--border-default)"}`,
                  background: priority === p ? "var(--action-primary-bg)" : "transparent",
                  color: priority === p ? "var(--action-primary-fg)" : "var(--text-secondary)",
                  fontSize: "var(--text-xs)",
                  cursor: "pointer",
                }}
              >
                {p === 0 ? "無" : PRIORITY_META[p]?.label ?? p}
              </button>
            ))}
          </div>
          <div style={{ flex: 1, minWidth: "160px" }}>
            <SearchableMultiSelect
              single
              options={groups.map((g) => ({ id: g.id, name: g.name }))}
              selectedIds={groupId ? [groupId] : []}
              onChange={(ids) => setGroupId(ids[0] ?? "")}
              placeholder="分類（可留空）…"
            />
          </div>
        </div>

        {/* 內容（Markdown；與完整編輯器同一套工具列） */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-1)" }}>
          <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>內容</span>
          <MarkdownEditor
            value={content}
            onChange={setContent}
            minHeight={110}
            placeholder="內容（可留空，建立後也能再編輯）…"
          />
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--spacing-2)", marginTop: "var(--spacing-2)" }}>
          <button onClick={onClose} className="tk-btn" style={{ cursor: "pointer" }}>
            取消
          </button>
          <button onClick={save} disabled={!title.trim() || saving} className="tk-btn tk-btn--primary" style={{ cursor: "pointer" }}>
            {saving ? "建立中…" : "建立"}
          </button>
        </div>
      </div>
    </div>
  );
}
