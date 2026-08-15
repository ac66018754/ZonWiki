"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { noteHref } from "@/lib/noteHref";
import { buildCategoryOptions } from "@/lib/categoryOptions";
import {
  clearDraft,
  createDraftWriter,
  draftKeyForNote,
  loadDraft,
  type DraftRecord,
  type DraftWriter,
} from "@/lib/draftBackup";
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

  // ── 本地草稿備份（防停電，2026-08-13；鍵＝zw:draft:note:new）──────────
  // 第一次寫新筆記也可能遇上停電——與筆記編輯頁同款：使用者輸入 debounce 落地
  // localStorage、建立成功才清；重開彈窗偵測到草稿時顯示還原橫幅。
  const draftWriterRef = useRef<DraftWriter | null>(null);
  const titleDraftRef = useRef("");
  const contentDraftRef = useRef("");
  const [pendingDraft, setPendingDraft] = useState<DraftRecord | null>(null);

  // 開啟時載入分類/標籤並重設表單（若有帶入預設分類則預先選取）
  useEffect(() => {
    if (!open) return;
    setTitle("");
    setContent("");
    titleDraftRef.current = "";
    contentDraftRef.current = "";
    setSelectedCats(new Set(presetCategoryIds ?? []));
    setSelectedTags(new Set());
    setError(null);
    // 進入當下先讀走既有草稿（程式化重設不會覆寫它——寫入只走使用者輸入 handler）。
    const existing = loadDraft(draftKeyForNote(null));
    setPendingDraft(existing && (existing.title !== "" || existing.content !== "") ? existing : null);
    const writer = createDraftWriter(draftKeyForNote(null));
    draftWriterRef.current = writer;
    const flushOnUnload = () => writer.flush();
    window.addEventListener("beforeunload", flushOnUnload);
    Promise.all([listNoteCategories(), listNoteTags()])
      .then(([cats, tgs]) => {
        setCategories(cats);
        setTags(tgs);
      })
      .catch((err) => logger.error("Failed to load categories/tags:", err));
    return () => {
      window.removeEventListener("beforeunload", flushOnUnload);
      // 關閉彈窗＝停計時但保留已落地草稿（未建立就關窗的內容仍可救回）。
      writer.cancel();
      if (draftWriterRef.current === writer) draftWriterRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /** 標題輸入（使用者輸入路徑——寫草稿）。 */
  const handleTitleChange = useCallback((value: string) => {
    setTitle(value);
    titleDraftRef.current = value;
    draftWriterRef.current?.write({ title: value, content: contentDraftRef.current });
  }, []);

  /** 內容輸入（使用者輸入路徑——寫草稿）。 */
  const handleContentChange = useCallback((value: string) => {
    setContent(value);
    contentDraftRef.current = value;
    draftWriterRef.current?.write({ title: titleDraftRef.current, content: value });
  }, []);

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
      // 建立成功＝草稿任務完成（失敗/取消時保留草稿當保險）。
      draftWriterRef.current?.cancel();
      clearDraft(draftKeyForNote(null));
      setPendingDraft(null);
      onCreated?.();
      if (note?.slug) {
        // 逐段編碼收斂到 noteHref（行為與原本手寫的 split/encode/join 一致）。
        router.push(noteHref(note.slug));
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

  // 分類顯示名稱改用共用 util（完整路徑＋排序＋防環——見 lib/categoryOptions.ts）。

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

          {/* ⚡ 本地草稿還原橫幅（防停電）：上次未建立就中斷（停電/誤關）的內容 */}
          {pendingDraft && (
            <div className="ncm-error" style={{ background: 'var(--status-warning-bg, var(--bg-surface))', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <span style={{ flex: 1, minWidth: 180 }}>
                ⚡ 偵測到上次未建立的草稿（{pendingDraft.title || '無標題'}）
              </span>
              <button
                type="button"
                className="ncm-btn ncm-btn--primary"
                onClick={() => {
                  handleTitleChange(pendingDraft.title);
                  handleContentChange(pendingDraft.content);
                  setPendingDraft(null);
                }}
              >
                還原
              </button>
              <button
                type="button"
                className="ncm-btn"
                onClick={() => {
                  clearDraft(draftKeyForNote(null));
                  setPendingDraft(null);
                }}
              >
                捨棄
              </button>
            </div>
          )}

          {/* 標題 */}
          <input
            className="ncm-title-input"
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="筆記標題…"
            autoFocus
          />

          {/* 分類（可搜尋下拉 + 就地新增） */}
          <div className="ncm-field">
            <div className="ncm-label">分類</div>
            <SearchableMultiSelect
              options={buildCategoryOptions(categories)}
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
            onChange={handleContentChange}
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
