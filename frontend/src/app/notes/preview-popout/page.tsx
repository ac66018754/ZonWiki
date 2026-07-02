"use client";

import { useEffect, useState } from "react";
import { ToggleAwareMarkdown } from "@/components/MarkdownPreview";
import { PREVIEW_CHANNEL } from "@/components/MarkdownEditor";

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

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(PREVIEW_CHANNEL);
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
    };
  }, []);

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
      <div className="markdown-prose md-preview" style={{ padding: "20px 24px", maxWidth: 900, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
        {markdown.trim() ? (
          <ToggleAwareMarkdown value={markdown} />
        ) : (
          <span style={{ color: "var(--text-tertiary)" }}>（尚無內容；請在編輯器輸入 Markdown）</span>
        )}
      </div>
    </div>
  );
}
