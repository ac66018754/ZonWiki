"use client";

import { useState } from "react";
import {
  type NoteSummary,
  type NoteCategory,
  type NoteTag,
  deleteNote,
  addNoteToCategory,
  addNoteTag,
  createNoteTag,
} from "@/lib/api";
import { SearchableMultiSelect } from "@/components/SearchableMultiSelect";

/**
 * 筆記清單「編輯模式」的批次操作工具列。
 *
 * 對目前選取（＝批次標籤成員、且在目前清單可見）的筆記做：
 * - 批次刪除（軟刪除，移到垃圾桶可復原）。
 * - 批次加入分類：分類為多對多（加入＝附加，不移除原分類）。若有筆記已屬於「其他分類」，
 *   先跳出提示列出是哪些筆記與原因，請使用者再次確認後才套用。
 * - 批次加入標籤：標籤可多個，無衝突問題；附加到每篇選取筆記既有標籤之上。
 */
export function NotesBatchToolbar({
  selected,
  categories,
  tags,
  onReload,
  onResetBatch,
}: {
  selected: NoteSummary[];
  categories: NoteCategory[];
  tags: NoteTag[];
  onReload: () => void;
  /** 批次刪除後呼叫，讓上層清掉「本次批次標籤」狀態（避免殘留指向空標籤）。 */
  onResetBatch?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  // 目前展開的子操作面板：分類 / 標籤 / 無
  const [panel, setPanel] = useState<null | "category" | "tag">(null);
  const [pickedCat, setPickedCat] = useState<string>("");
  const [pickedTag, setPickedTag] = useState<string>("");
  // 標籤池在就地新增後需即時加入，故用本地 state。
  const [tagPool, setTagPool] = useState<NoteTag[]>(tags);

  const count = selected.length;

  // 分類顯示名稱（含上層路徑）
  const catLabel = (parentId: string | null | undefined): string => {
    if (!parentId) return "";
    const p = categories.find((c) => c.id === parentId);
    return p ? `${catLabel(p.parentId)}${p.name} / ` : "";
  };

  /** 批次刪除（軟刪除）。刪完清掉本次批次標籤狀態（成員已不在，避免殘留空標籤指標）。 */
  const doDelete = async () => {
    if (!window.confirm(`確定刪除選取的 ${count} 篇筆記？會移到垃圾桶，可日後復原。`)) return;
    setBusy(true);
    try {
      await Promise.all(selected.map((n) => deleteNote(n.id)));
      onResetBatch?.();
      onReload();
    } finally {
      setBusy(false);
    }
  };

  /** 批次加入分類（附加；對已屬於其他分類者先提示再次確認）。 */
  const applyCategory = async () => {
    if (!pickedCat) return;
    // 衝突＝該筆記已屬於「至少一個非目標」的分類。
    const conflicts = selected.filter((n) =>
      (n.categories ?? []).some((c) => c.id !== pickedCat)
    );
    if (conflicts.length > 0) {
      const targetName =
        categories.find((c) => c.id === pickedCat)?.name ?? "該分類";
      const lines = conflicts
        .map(
          (n) =>
            `・${n.title}（已屬於：${(n.categories ?? [])
              .map((c) => c.name)
              .join("、")}）`
        )
        .join("\n");
      const ok = window.confirm(
        `以下 ${conflicts.length} 篇筆記已屬於其他分類：\n\n${lines}\n\n` +
          `原因：分類可同時屬於多個，這些筆記目前的分類與「${targetName}」不同。\n` +
          `仍要把它們「加入」「${targetName}」嗎？（只會附加、不會移除原分類）`
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      await Promise.all(selected.map((n) => addNoteToCategory(n.id, pickedCat)));
      setPanel(null);
      setPickedCat("");
      onReload();
    } finally {
      setBusy(false);
    }
  };

  /** 批次加入標籤（用「原子加單一標籤」端點附加，不讀-改-寫整組標籤、不會覆蓋其它變更）。 */
  const applyTag = async () => {
    if (!pickedTag) return;
    setBusy(true);
    try {
      await Promise.all(selected.map((n) => addNoteTag(n.id, pickedTag)));
      setPanel(null);
      setPickedTag("");
      onReload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="nbt">
      <div className="nbt-row">
        <span className="nbt-count">已選 {count} 篇</span>
        <button className="nbt-btn nbt-btn--danger" onClick={doDelete} disabled={busy || count === 0}>
          🗑️ 批次刪除
        </button>
        <button
          className={`nbt-btn ${panel === "category" ? "nbt-btn--on" : ""}`}
          onClick={() => setPanel(panel === "category" ? null : "category")}
          disabled={busy || count === 0}
        >
          📁 加入分類
        </button>
        <button
          className={`nbt-btn ${panel === "tag" ? "nbt-btn--on" : ""}`}
          onClick={() => setPanel(panel === "tag" ? null : "tag")}
          disabled={busy || count === 0}
        >
          🏷️ 加入標籤
        </button>
      </div>

      {panel === "category" && (
        <div className="nbt-panel">
          <div className="nbt-pick">
            <SearchableMultiSelect
              single
              options={categories.map((c) => ({ id: c.id, name: `${catLabel(c.parentId)}${c.name}` }))}
              selectedIds={pickedCat ? [pickedCat] : []}
              onChange={(ids) => setPickedCat(ids[0] ?? "")}
              placeholder="選擇要加入的分類…"
            />
          </div>
          <button className="nbt-btn nbt-btn--primary" onClick={applyCategory} disabled={busy || !pickedCat}>
            套用
          </button>
        </div>
      )}

      {panel === "tag" && (
        <div className="nbt-panel">
          <div className="nbt-pick">
            <SearchableMultiSelect
              single
              options={tagPool.map((t) => ({ id: t.id, name: t.name }))}
              selectedIds={pickedTag ? [pickedTag] : []}
              onChange={(ids) => setPickedTag(ids[0] ?? "")}
              onCreate={async (name) => {
                const tag = await createNoteTag(name);
                if (tag) {
                  setTagPool((p) => [...p, tag]);
                  return { id: tag.id, name: tag.name };
                }
                return null;
              }}
              prefix="#"
              placeholder="選擇或新增要加入的標籤…"
            />
          </div>
          <button className="nbt-btn nbt-btn--primary" onClick={applyTag} disabled={busy || !pickedTag}>
            套用
          </button>
        </div>
      )}

      <style jsx>{`
        .nbt {
          margin-top: var(--spacing-2);
          padding: var(--spacing-2) var(--spacing-3);
          background: var(--action-secondary-bg, var(--bg-surface-secondary, var(--bg-default)));
          border: 1px solid var(--border-default);
          border-radius: var(--radius-md);
        }
        .nbt-row {
          display: flex;
          align-items: center;
          gap: var(--spacing-2);
          flex-wrap: wrap;
        }
        .nbt-count {
          font-size: var(--text-sm);
          font-weight: 600;
          color: var(--text-primary);
          margin-right: var(--spacing-1);
        }
        .nbt-btn {
          padding: var(--spacing-1) var(--spacing-3);
          border: 1px solid var(--border-default);
          border-radius: var(--radius-md);
          background: var(--bg-surface);
          color: var(--text-primary);
          font-size: var(--text-sm);
          cursor: pointer;
        }
        .nbt-btn:hover {
          background: var(--bg-default);
        }
        .nbt-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .nbt-btn--on {
          border-color: var(--action-primary-bg);
          color: var(--action-primary-bg);
        }
        .nbt-btn--primary {
          background: var(--action-primary-bg);
          color: var(--action-primary-fg);
          border-color: var(--action-primary-bg);
          font-weight: 600;
        }
        .nbt-btn--danger {
          color: var(--status-danger-fg);
          border-color: var(--status-danger-fg);
        }
        .nbt-panel {
          display: flex;
          gap: var(--spacing-2);
          align-items: flex-start;
          margin-top: var(--spacing-2);
        }
        .nbt-pick {
          flex: 1;
          min-width: 0;
        }
      `}</style>
    </div>
  );
}
