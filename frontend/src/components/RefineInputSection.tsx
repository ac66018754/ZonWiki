"use client";

import { useState } from "react";
import { refineUrl } from "@/lib/api";

/**
 * 首頁「✨ 精煉成筆記」區塊。
 *
 * 貼一個連結（YouTube / Podcast / 文章…），後端會抓字幕或把音訊轉成文字，
 * 再用 AI 整理成一篇「分類筆記」。非同步處理——送出後可在「AI 處理中」佇列看進度，
 * 完成後筆記會出現在你的筆記庫。
 */
export function RefineInputSection() {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const u = url.trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) {
      setMsg({ kind: "err", text: "請貼上 http/https 開頭的連結。" });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await refineUrl(u);
      if (r.ok) {
        setMsg({ kind: "ok", text: "已加入處理佇列！正在抓內容並整理成筆記，可到「AI 處理中」看進度。" });
        setUrl("");
      } else {
        setMsg({ kind: "err", text: r.error ?? "送出失敗，請稍後再試。" });
      }
    } catch {
      setMsg({ kind: "err", text: "送出失敗，請稍後再試。" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={cardStyle}>
      <h2 style={titleStyle}>✨ 精煉成筆記</h2>
      <p style={hintStyle}>
        貼一個影片 / Podcast / 文章連結，AI 會抓字幕或把音訊轉成文字，整理成一篇分類筆記。
        （沒字幕的音訊需先在「個人頁 → 精煉成筆記」設定 Groq 金鑰。）
      </p>
      <form onSubmit={handleSubmit} style={{ display: "flex", gap: "var(--spacing-2)", flexWrap: "wrap" }}>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=…"
          style={inputStyle}
          disabled={busy}
          aria-label="要精煉成筆記的連結"
        />
        <button type="submit" style={btnStyle} disabled={busy}>
          {busy ? "送出中…" : "精煉成筆記"}
        </button>
      </form>
      {msg && (
        <p
          style={{
            margin: "var(--spacing-2) 0 0",
            fontSize: "var(--text-sm)",
            color: msg.kind === "ok" ? "var(--status-success-fg, #16a34a)" : "var(--status-danger-fg, #c0392b)",
          }}
        >
          {msg.text}
        </p>
      )}
    </section>
  );
}

const cardStyle: React.CSSProperties = {
  background: "var(--bg-surface)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-lg)",
  padding: "var(--spacing-5)",
  marginBottom: "var(--spacing-5)",
};
const titleStyle: React.CSSProperties = {
  fontSize: "var(--text-lg)",
  fontWeight: 600,
  margin: "0 0 var(--spacing-2)",
  color: "var(--text-primary)",
};
const hintStyle: React.CSSProperties = {
  margin: "0 0 var(--spacing-3)",
  fontSize: "var(--text-xs)",
  color: "var(--text-secondary)",
};
const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: "220px",
  padding: "var(--spacing-2) var(--spacing-3)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-md)",
  background: "var(--bg-default)",
  color: "var(--text-primary)",
  fontSize: "var(--text-sm)",
};
const btnStyle: React.CSSProperties = {
  padding: "var(--spacing-2) var(--spacing-4)",
  background: "var(--action-primary-bg)",
  color: "var(--action-primary-fg)",
  border: "none",
  borderRadius: "var(--radius-md)",
  fontWeight: 600,
  fontSize: "var(--text-sm)",
  cursor: "pointer",
};
