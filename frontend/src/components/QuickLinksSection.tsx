"use client";

import { useEffect, useMemo, useState } from "react";
import {
  QuickLink,
  NoteTag,
  listNoteTags,
  createNoteTag,
  createQuickLink,
  updateQuickLink,
  deleteQuickLink,
  assignQuickLinkTags,
} from "@/lib/api";
import { SearchableMultiSelect } from "@/components/SearchableMultiSelect";
import { logger } from "@/lib/logger";
import { useConfirm } from "@/components/ConfirmProvider";

/**
 * 首頁「常用連結」區塊。
 * - 連結可設「分類」（常用連結自有的自由文字分組；非與筆記共用）與「標籤」（與筆記/任務共用標籤庫）。
 * - 顯示時依分類分組；每張卡片顯示標籤 chips，並提供編輯 / 刪除。
 */

/** 未設分類的群組標題。 */
const UNCATEGORIZED = "（未分類）";

export function QuickLinksSection({
  links,
  onChanged,
}: {
  /** 目前的常用連結清單（由首頁聚合資料提供，含 category 與 tags）。 */
  links: QuickLink[];
  /** 新增/編輯/刪除後通知首頁重新載入。 */
  onChanged: () => void | Promise<void>;
}) {
  const confirm = useConfirm();
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [category, setCategory] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [tagPool, setTagPool] = useState<NoteTag[]>([]);
  const [busy, setBusy] = useState(false);

  // 載入共用標籤庫（與筆記/任務共用）
  useEffect(() => {
    listNoteTags()
      .then(setTagPool)
      .catch(() => {});
  }, []);

  // 既有分類（去重、排序）供分類下拉建議
  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    links.forEach((l) => {
      if (l.category) set.add(l.category);
    });
    return Array.from(set)
      .sort((a, b) => a.localeCompare(b))
      .map((c) => ({ id: c, name: c }));
  }, [links]);

  // 依分類分組（未分類排最後）
  const grouped = useMemo(() => {
    const map = new Map<string, QuickLink[]>();
    links.forEach((l) => {
      const key = l.category || UNCATEGORIZED;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(l);
    });
    const keys = Array.from(map.keys()).sort((a, b) => {
      if (a === UNCATEGORIZED) return 1;
      if (b === UNCATEGORIZED) return -1;
      return a.localeCompare(b);
    });
    return keys.map((k) => ({ category: k, items: map.get(k)! }));
  }, [links]);

  const resetForm = () => {
    setTitle("");
    setUrl("");
    setCategory("");
    setTagIds([]);
    setEditingId(null);
    setFormOpen(false);
  };

  const openAdd = () => {
    resetForm();
    setFormOpen(true);
  };

  const openEdit = (l: QuickLink) => {
    setEditingId(l.id);
    setTitle(l.title);
    setUrl(l.url);
    setCategory(l.category || "");
    setTagIds((l.tags || []).map((t) => t.id));
    setFormOpen(true);
  };

  const handleSubmit = async () => {
    if (!title.trim() || !url.trim() || busy) return;
    setBusy(true);
    try {
      const cat = category.trim();
      if (editingId) {
        // category 傳空字串＝清為未分類
        await updateQuickLink(editingId, { title: title.trim(), url: url.trim(), category: cat });
        await assignQuickLinkTags(editingId, tagIds);
      } else {
        const created = await createQuickLink({
          title: title.trim(),
          url: url.trim(),
          category: cat || undefined,
        });
        if (created) await assignQuickLinkTags(created.id, tagIds);
      }
      resetForm();
      await onChanged();
    } catch (err) {
      logger.error("Failed to save quick link:", err);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!(await confirm({ message: "刪除這個常用連結？", danger: true }))) return;
    try {
      await deleteQuickLink(id);
      await onChanged();
    } catch (err) {
      logger.error("Failed to delete quick link:", err);
    }
  };

  // 就地建立標籤（同名直接選取；與筆記共用標籤庫）
  const onCreateTag = async (name: string) => {
    const existing = tagPool.find((t) => t.name === name);
    if (existing) return { id: existing.id, name: existing.name };
    try {
      const created = await createNoteTag(name);
      if (created) {
        setTagPool((prev) => [...prev, created]);
        return { id: created.id, name: created.name };
      }
    } catch {
      /* 409 重名等：忽略 */
    }
    return null;
  };

  return (
    <section className="home-section">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "var(--spacing-4)",
        }}
      >
        <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 600, margin: 0 }}>常用連結</h2>
        <button onClick={() => (formOpen && !editingId ? resetForm() : openAdd())} className="btn-primary" style={{ fontSize: "var(--text-sm)" }}>
          {formOpen && !editingId ? "取消" : "+ 新增"}
        </button>
      </div>

      {/* 新增 / 編輯表單 */}
      {formOpen && (
        <div
          style={{
            padding: "var(--spacing-4)",
            background: "var(--bg-surface)",
            borderRadius: "var(--radius-lg)",
            border: "1px solid var(--border-default)",
            marginBottom: "var(--spacing-4)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--spacing-3)",
          }}
        >
          <div style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-secondary)" }}>
            {editingId ? "編輯連結" : "新增連結"}
          </div>
          <input
            type="text"
            placeholder="連結標題"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="qls-input"
          />
          <input
            type="text"
            placeholder="URL (如 https://example.com)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="qls-input"
          />
          <div>
            <label className="qls-label">分類</label>
            <SearchableMultiSelect
              single
              options={categoryOptions}
              selectedIds={category ? [category] : []}
              onChange={(ids) => setCategory(ids[0] ?? "")}
              onCreate={async (name) => {
                const n = name.trim();
                return n ? { id: n, name: n } : null;
              }}
              placeholder="搜尋或新增分類…（可留空＝未分類）"
            />
          </div>
          <div>
            <label className="qls-label">標籤（與筆記共用）</label>
            <SearchableMultiSelect
              options={tagPool.map((t) => ({ id: t.id, name: t.name }))}
              selectedIds={tagIds}
              onChange={setTagIds}
              onCreate={onCreateTag}
              prefix="#"
              placeholder="搜尋或新增標籤…"
            />
          </div>
          <div style={{ display: "flex", gap: "var(--spacing-2)", justifyContent: "flex-end" }}>
            <button onClick={resetForm} className="btn-secondary" style={{ fontSize: "var(--text-sm)" }}>
              取消
            </button>
            <button
              onClick={handleSubmit}
              className="btn-primary"
              style={{ fontSize: "var(--text-sm)" }}
              disabled={!title.trim() || !url.trim() || busy}
            >
              {busy ? "儲存中…" : editingId ? "儲存變更" : "建立連結"}
            </button>
          </div>
        </div>
      )}

      {/* 連結清單（依分類分組） */}
      {links.length === 0 ? (
        <div
          style={{
            padding: "var(--spacing-6)",
            textAlign: "center",
            color: "var(--text-tertiary)",
            background: "var(--bg-surface)",
            borderRadius: "var(--radius-lg)",
            border: "1px dashed var(--border-default)",
          }}
        >
          <span style={{ fontSize: "var(--text-2xl)" }}>🔗</span>
          <p style={{ margin: "var(--spacing-2) 0 0 0" }}>還未新增常用連結</p>
          <p style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)", margin: "var(--spacing-1) 0 0 0" }}>
            按上方「新增」按鈕快速建立，可設定分類與標籤。
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-5)" }}>
          {grouped.map((group) => (
            <div key={group.category}>
              {/* 分類標題（只有一個「未分類」群組且沒有其他分類時也照常顯示，讓版面一致） */}
              <div className="qls-group-head">{group.category}</div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                  gap: "var(--spacing-3)",
                }}
              >
                {group.items.map((link) => (
                  <div key={link.id} className="qls-card">
                    <a href={link.url} target="_blank" rel="noopener noreferrer" className="qls-card-link">
                      <div className="qls-card-title">{link.title}</div>
                      <div className="qls-card-url">{link.url}</div>
                    </a>
                    {link.tags && link.tags.length > 0 && (
                      <div className="qls-card-tags">
                        {link.tags.map((t) => (
                          <span key={t.id} className="qls-tag">
                            #{t.name}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="qls-card-actions">
                      <button onClick={() => openEdit(link)} title="編輯" aria-label={`編輯「${link.title}」`}>
                        ✎
                      </button>
                      <button onClick={() => handleDelete(link.id)} title="刪除" aria-label={`刪除「${link.title}」`}>
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
