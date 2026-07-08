"use client";

import { useEffect, useRef, useState } from "react";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { NoteAiActions } from "@/components/NoteAiActions";
import { SearchableMultiSelect } from "@/components/SearchableMultiSelect";
import { noteEditChannelName, type NoteEditInit, type NoteEditMessage } from "@/lib/noteEditChannel";
import {
  listNoteCategories,
  listNoteTags,
  updateNote,
  createNoteCategory,
  createNoteTag,
  type NoteCategory,
  type NoteTag,
} from "@/lib/api";

/** 組出分類的階層路徑前綴（父 / 祖父 / …）。 */
function categoryPath(parentId: string | null | undefined, cats: NoteCategory[]): string {
  if (!parentId) return "";
  const p = cats.find((c) => c.id === parentId);
  return p ? `${categoryPath(p.parentId, cats)}${p.name} / ` : "";
}

/**
 * 獨立編輯視窗（由筆記頁「編輯」以 window.open 開啟）。
 *
 * 提供：Markdown 工具列＋內容區、標題、分類、標籤、AI（美化／調整排版／重排選取）、保存。
 * 刻意不提供 並排／預覽／彈出預覽（預覽由「筆記頁」即時渲染本視窗內容）。
 * 同源 BroadcastChannel 與筆記頁溝通：內容變動即時回推預覽；保存存 DB 且不關窗；關窗筆記頁回存檔版。
 * 以固定滿版遮罩蓋掉 App 外殼，只呈現乾淨編輯畫面。
 */
export default function NoteEditPopoutPage() {
  const [init, setInit] = useState<NoteEditInit | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [catIds, setCatIds] = useState<string[]>([]);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [allCategories, setAllCategories] = useState<NoteCategory[]>([]);
  const [allTags, setAllTags] = useState<NoteTag[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  // 圖片上傳進行中的數量：>0 時擋「保存」與 AI 動作，避免把佔位文字永久存進 DB。
  const [uploadingCount, setUploadingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // 頻道：postMessage 型別安全的小包裝。
  const post = (msg: NoteEditMessage) => channelRef.current?.postMessage(msg);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    // 用筆記頁經 URL 傳來的一次性 token 綁定專屬頻道（隔離多分頁/多彈窗，見 noteEditChannel）。
    const token = new URLSearchParams(window.location.search).get("ch");
    const ch = new BroadcastChannel(noteEditChannelName(token));
    channelRef.current = ch;
    ch.onmessage = (e: MessageEvent) => {
      const d = e.data as NoteEditMessage | null;
      // 防呆：驗證 edit-init 結構後才套用，避免異常訊息造成當機。
      if (d?.type === "edit-init" && d.init && typeof d.init === "object") {
        const payload = d.init;
        setInit(payload);
        setTitle(typeof payload.title === "string" ? payload.title : "");
        setContent(typeof payload.content === "string" ? payload.content : "");
        setCatIds(Array.isArray(payload.categoryIds) ? payload.categoryIds : []);
        setTagIds(Array.isArray(payload.tagIds) ? payload.tagIds : []);
      }
    };
    ch.postMessage({ type: "edit-ready" }); // 請筆記頁送初始資料
    // 關窗即通知筆記頁回存檔版。beforeunload 與 pagehide 都掛，提高關閉訊號送達率。
    const onUnload = () => { try { ch.postMessage({ type: "edit-closing" }); } catch { /* ignore */ } };
    window.addEventListener("beforeunload", onUnload);
    window.addEventListener("pagehide", onUnload);
    document.title = "編輯筆記 — ZonWiki";
    // 載入分類/標籤選項（此視窗自行抓，含 auth cookie）。
    listNoteCategories().then(setAllCategories).catch(() => {});
    listNoteTags().then(setAllTags).catch(() => {});
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("pagehide", onUnload);
      ch.close();
      channelRef.current = null;
    };
  }, []);

  // 內容變動 → 即時把 markdown 回推筆記頁做即時預覽（僅在已初始化後）。
  useEffect(() => {
    if (init) post({ type: "edit-content", content });
  }, [content, init]);

  /** 保存到 DB（不關窗）；成功後通知筆記頁重抓。 */
  const handleSave = async () => {
    if (!init || isSaving || aiBusy || uploadingCount > 0) return;
    try {
      setIsSaving(true);
      setError(null);
      const ok = await updateNote(init.noteId, {
        title,
        contentRaw: content,
        categoryIds: catIds,
        tagIds: tagIds,
      });
      if (ok) {
        post({ type: "edit-saved", content });
        setSavedNote(new Date().toLocaleTimeString());
      } else {
        setError("保存失敗，請稍後重試。");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存出錯，請稍後重試。");
    } finally {
      setIsSaving(false);
    }
  };

  const shell: React.CSSProperties = {
    position: "fixed", inset: 0, zIndex: 100000, background: "var(--bg-surface)",
    overflow: "auto", display: "flex", flexDirection: "column",
  };

  if (!init) {
    return (
      <div style={{ ...shell, alignItems: "center", justifyContent: "center", color: "var(--text-tertiary)" }}>
        等待筆記頁傳來內容…（請從筆記頁按「編輯」開啟本視窗）
      </div>
    );
  }

  return (
    <div style={shell}>
      {/* 頂列：標題頁籤 + 保存 */}
      <div style={{ position: "sticky", top: 0, zIndex: 1, display: "flex", alignItems: "center", gap: 12, padding: "8px 16px", borderBottom: "1px solid var(--border-default)", background: "var(--bg-surface-secondary, var(--bg-surface))", flexShrink: 0 }}>
        <span style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>✏️ 編輯筆記</span>
        {savedNote && <span style={{ fontSize: "var(--text-xs)", color: "var(--status-success-fg, green)" }}>● 已於 {savedNote} 保存</span>}
        {error && <span style={{ fontSize: "var(--text-xs)", color: "var(--status-danger-fg, #c00)" }}>{error}</span>}
        <span style={{ flex: 1 }} />
        <button
          onClick={handleSave}
          className="btn-primary"
          disabled={isSaving || aiBusy || uploadingCount > 0}
          title={aiBusy ? "AI 處理中…" : uploadingCount > 0 ? "圖片上傳中，請稍候…" : "保存到資料庫（不關閉本視窗）"}
        >
          {isSaving ? "保存中…" : uploadingCount > 0 ? "圖片上傳中…" : "💾 保存"}
        </button>
      </div>

      <div style={{ padding: 16, maxWidth: 1000, margin: "0 auto", width: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 12, flex: 1, minHeight: 0 }}>
        {/* 標題 */}
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="筆記標題…"
          style={{ padding: "var(--spacing-3)", fontSize: "var(--text-2xl)", fontWeight: 700, border: "1px solid var(--border-default)", borderRadius: "var(--radius-md)" }}
        />

        {/* 分類 / 標籤 */}
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label style={{ display: "block", fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>分類</label>
            <SearchableMultiSelect
              options={allCategories.map((c) => ({ id: c.id, name: `${categoryPath(c.parentId, allCategories)}${c.name}` }))}
              selectedIds={catIds}
              onChange={setCatIds}
              onCreate={async (name) => {
                try {
                  const cat = await createNoteCategory({ name, parentId: null });
                  if (cat) { setAllCategories((c) => [...c, cat]); return { id: cat.id, name: cat.name }; }
                } catch (e) { setError(e instanceof Error ? e.message : "新增分類失敗"); }
                return null;
              }}
              placeholder="搜尋或新增分類…"
            />
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label style={{ display: "block", fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>標籤</label>
            <SearchableMultiSelect
              options={allTags.map((t) => ({ id: t.id, name: t.name }))}
              selectedIds={tagIds}
              onChange={setTagIds}
              onCreate={async (name) => {
                try {
                  const tag = await createNoteTag(name);
                  if (tag) { setAllTags((t) => [...t, tag]); return { id: tag.id, name: tag.name }; }
                } catch (e) { setError(e instanceof Error ? e.message : "新增標籤失敗"); }
                return null;
              }}
              prefix="#"
              placeholder="搜尋或新增標籤…"
            />
          </div>
        </div>

        {/* AI 動作：美化 / 調整排版 / 重排選取 */}
        <NoteAiActions
          noteId={init.noteId}
          currentContent={content}
          onContentUpdate={(contentRaw) => setContent(contentRaw)}
          onError={(m) => setError(m)}
          disabled={isSaving || uploadingCount > 0}
          onBusyChange={setAiBusy}
          taRef={taRef}
        />

        {/* Markdown 工具列 + 內容區（不含 並排／預覽／彈出預覽） */}
        <MarkdownEditor
          value={content}
          onChange={setContent}
          minHeight={400}
          placeholder="用 Markdown 撰寫內容…（🔒 可框住不想被 AI 重排的內容）"
          taRef={taRef}
          onUploadingChange={setUploadingCount}
        />
      </div>
    </div>
  );
}
