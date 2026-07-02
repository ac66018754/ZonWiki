"use client";

import { useEffect, useRef, useState } from "react";
import { ToggleAwareMarkdown } from "@/components/MarkdownPreview";
import { PREVIEW_CHANNEL } from "@/components/MarkdownEditor";

/** 右鍵定位時，往上找到的「區塊級」元素標籤（取其文字前綴回送編輯器定位來源行）。 */
const BLOCK_TAGS = new Set(["P", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "SUMMARY", "TD", "TH", "PRE", "BLOCKQUOTE"]);

/**
 * 獨立預覽視窗（由編輯器「⬈ 彈出預覽」以 window.open 開啟）。
 *
 * 透過同源 BroadcastChannel 即時接收編輯框最新 markdown，並用與並排預覽「完全相同」的
 * ToggleAwareMarkdown 渲染（含 :::toggle、:::protect）。以固定滿版遮罩蓋住 App 外殼（標題列/側欄），
 * 讓此視窗只呈現乾淨的即時預覽。
 */
export default function PreviewPopoutPage() {
  const [markdown, setMarkdown] = useState<string>("");
  const [connected, setConnected] = useState(false);
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(PREVIEW_CHANNEL);
    channelRef.current = ch;
    ch.onmessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; markdown?: string } | null;
      if (data?.type === "content" && typeof data.markdown === "string") {
        setMarkdown(data.markdown);
        setConnected(true);
      }
    };
    // 告訴編輯器「我準備好了」，請它補送目前內容。
    ch.postMessage({ type: "preview-ready" });
    // 關窗時通知編輯器恢復內嵌預覽。
    const onUnload = () => {
      try { ch.postMessage({ type: "preview-closing" }); } catch { /* ignore */ }
    };
    window.addEventListener("beforeunload", onUnload);
    document.title = "即時預覽 — ZonWiki";
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      ch.close();
      channelRef.current = null;
    };
  }, []);

  /**
   * 右鍵預覽某一行 → 把該區塊的文字前綴回送編輯器，讓編輯框捲到對應來源行（該行落在編輯框頂端）。
   * 抑制瀏覽器預設右鍵選單。
   */
  const onContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    let el = e.target as HTMLElement | null;
    while (el && el !== e.currentTarget && !BLOCK_TAGS.has(el.tagName)) {
      el = el.parentElement;
    }
    const text = (el?.textContent || "").trim().slice(0, 40);
    if (!text) return;
    e.preventDefault();
    channelRef.current?.postMessage({ type: "reveal-source", text });
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100000,
        background: "var(--bg-surface)",
        overflow: "auto",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          position: "sticky",
          top: 0,
          padding: "8px 16px",
          borderBottom: "1px solid var(--border-default)",
          background: "var(--bg-surface-secondary, var(--bg-surface))",
          fontSize: "var(--text-sm)",
          color: "var(--text-secondary)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexShrink: 0,
        }}
      >
        <span>👁 即時預覽</span>
        <span style={{ fontSize: "var(--text-xs)", color: connected ? "var(--status-success-fg, green)" : "var(--text-tertiary)" }}>
          {connected ? "● 已同步" : "○ 等待編輯器內容…"}
        </span>
      </div>
      <div
        className="markdown-prose md-preview"
        style={{ padding: "20px 24px", maxWidth: 900, margin: "0 auto", width: "100%", boxSizing: "border-box" }}
        onContextMenu={onContextMenu}
        title="右鍵點某一行 → 編輯視窗會捲到該行"
      >
        {markdown.trim() ? (
          <ToggleAwareMarkdown value={markdown} />
        ) : (
          <span style={{ color: "var(--text-tertiary)" }}>（尚無內容；請在編輯器輸入 Markdown）</span>
        )}
      </div>
    </div>
  );
}
