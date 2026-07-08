"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  NoteCategory,
  NoteTag,
  listNoteCategories,
  listNoteTags,
  createNote,
  createNoteCategory,
  createNoteTag,
} from "@/lib/api";
import { logger } from "@/lib/logger";
import { SearchableMultiSelect } from "./SearchableMultiSelect";
import { MarkdownEditor } from "./MarkdownEditor";

/**
 * 新增筆記彈窗。
 *
 * 功能（由上而下：標題 →（分類、標籤）→ 內容）：標題、選擇分類與標籤（並可就地新增）、
 * Markdown 編輯（編輯／預覽／並排三種檢視 + 快速插入工具列）、字數統計、
 * Esc 關閉 / Ctrl+Enter 建立。建立成功後導向該筆記。
 */
interface NoteCreateModalProps {
  /** 是否開啟。 */
  open: boolean;
  /** 關閉彈窗。 */
  onClose: () => void;
  /** 建立成功後的回呼（例如讓側欄重載分類/標籤計數）。 */
  onCreated?: () => void;
  /** 開啟時預先選取的分類 id（例如從側欄某分類的「＋ → 在此分類下新增筆記」帶入）。 */
  presetCategoryIds?: string[];
}

export function NoteCreateModal({ open, onClose, onCreated, presetCategoryIds }: NoteCreateModalProps) {
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const [categories, setCategories] = useState<NoteCategory[]>([]);
  const [tags, setTags] = useState<NoteTag[]>([]);
  const [selectedCats, setSelectedCats] = useState<Set<string>>(new Set());
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());

  const [busy, setBusy] = useState(false);
  // 圖片上傳進行中的數量：>0 時擋「建立筆記」，避免把「〔圖片上傳中 #xxx〕」佔位文字存進 DB。
  const [uploadingCount, setUploadingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // 開啟時載入分類/標籤並重設表單（若有帶入預設分類則預先選取）
  useEffect(() => {
    if (!open) return;
    setTitle("");
    setContent("");
    setSelectedCats(new Set(presetCategoryIds ?? []));
    setSelectedTags(new Set());
    setError(null);
    Promise.all([listNoteCategories(), listNoteTags()])
      .then(([cats, tgs]) => {
        setCategories(cats);
        setTags(tgs);
      })
      .catch((err) => logger.error("Failed to load categories/tags:", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleCreate = useCallback(async () => {
    if (!title.trim()) {
      setError("請輸入標題");
      return;
    }
    if (uploadingCount > 0) {
      setError("圖片上傳中，請稍候再建立");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const note = await createNote({
        title: title.trim(),
        contentRaw: content,
        categoryIds: Array.from(selectedCats),
        tagIds: Array.from(selectedTags),
      });
      onCreated?.();
      if (note?.slug) {
        const encoded = note.slug.split("/").map(encodeURIComponent).join("/");
        router.push(`/notes/${encoded}`);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "建立筆記失敗");
    } finally {
      setBusy(false);
    }
  }, [title, content, selectedCats, selectedTags, onCreated, onClose, router, uploadingCount]);

  // 鍵盤：Esc 關閉、Ctrl/Cmd+Enter 建立
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        handleCreate();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onClose, handleCreate]);

  const wordCount = useMemo(() => content.trim() ? content.trim().length : 0, [content]);

  const catName = (parentId: string | null | undefined): string => {
    if (!parentId) return "";
    const p = categories.find((c) => c.id === parentId);
    return p ? `${catName(p.parentId)}${p.name} / ` : "";
  };

  if (!open) return null;

  return (
    <div className="ncm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="ncm-modal" role="dialog" aria-modal="true" aria-label="新增筆記">
        {/* 標題列 */}
        <header className="ncm-head">
          <h2 className="ncm-h2">新增筆記</h2>
          <button className="ncm-x" onClick={onClose} disabled={busy} aria-label="關閉">✕</button>
        </header>

        <div className="ncm-body">
          {error && <div className="ncm-error">{error}</div>}

          {/* 由上而下：標題 →（分類、標籤）→ 內容 */}

          {/* 標題 */}
          <input
            className="ncm-title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="筆記標題…"
            autoFocus
          />

          {/* 分類（可搜尋下拉 + 就地新增） */}
          <div className="ncm-field">
            <div className="ncm-label">分類</div>
            <SearchableMultiSelect
              options={categories.map((c) => ({ id: c.id, name: `${catName(c.parentId)}${c.name}` }))}
              selectedIds={Array.from(selectedCats)}
              onChange={(ids) => setSelectedCats(new Set(ids))}
              onCreate={async (name) => {
                try {
                  const cat = await createNoteCategory({ name, parentId: null });
                  if (cat) {
                    setCategories((c) => [...c, cat]);
                    return { id: cat.id, name: cat.name };
                  }
                } catch (err) {
                  setError(err instanceof Error ? err.message : "新增分類失敗");
                }
                return null;
              }}
              placeholder="搜尋或新增分類…"
            />
          </div>

          {/* 標籤（可搜尋下拉 + 就地新增） */}
          <div className="ncm-field">
            <div className="ncm-label">標籤</div>
            <SearchableMultiSelect
              options={tags.map((t) => ({ id: t.id, name: t.name }))}
              selectedIds={Array.from(selectedTags)}
              onChange={(ids) => setSelectedTags(new Set(ids))}
              onCreate={async (name) => {
                try {
                  const tag = await createNoteTag(name);
                  if (tag) {
                    setTags((t) => [...t, tag]);
                    return { id: tag.id, name: tag.name };
                  }
                } catch (err) {
                  setError(err instanceof Error ? err.message : "新增標籤失敗");
                }
                return null;
              }}
              prefix="#"
              placeholder="搜尋或新增標籤…"
            />
          </div>

          {/* 內容：Markdown 編輯器（工具列 + 編輯／並排／預覽） */}
          <MarkdownEditor
            value={content}
            onChange={setContent}
            withPreview
            minHeight={260}
            placeholder="用 Markdown 撰寫內容…（Ctrl+Enter 建立、Esc 取消）"
            onUploadingChange={setUploadingCount}
          />
        </div>

        {/* 底部 */}
        <footer className="ncm-foot">
          <span className="ncm-count">{wordCount} 字</span>
          <div className="ncm-foot-actions">
            <button className="ncm-btn" onClick={onClose} disabled={busy}>取消</button>
            <button
              className="ncm-btn ncm-btn--primary"
              onClick={handleCreate}
              disabled={busy || !title.trim() || uploadingCount > 0}
              title={uploadingCount > 0 ? "圖片上傳中，請稍候…" : undefined}
            >
              {busy ? "建立中…" : uploadingCount > 0 ? "圖片上傳中…" : "建立筆記"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
