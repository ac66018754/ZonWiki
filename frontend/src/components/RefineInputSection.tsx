"use client";

import { useRef, useState } from "react";
import { refineUrl, refineUpload } from "@/lib/api";

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
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** 上傳檔案大小上限（與後端一致：100MB）。 */
  const MAX_UPLOAD_MB = 100;

  const handleUpload = async (file: File) => {
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setMsg({ kind: "err", text: `檔案過大（上限 ${MAX_UPLOAD_MB}MB）。` });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await refineUpload(file);
      if (r.ok) {
        setMsg({ kind: "ok", text: "已上傳並加入處理佇列！正在轉錄並整理成筆記，可到「AI 處理中」看進度。" });
      } else {
        setMsg({ kind: "err", text: r.error ?? "上傳失敗，請稍後再試。" });
      }
    } catch {
      setMsg({ kind: "err", text: "上傳失敗，請稍後再試。" });
    } finally {
      setBusy(false);
      // 重置 input，讓「選同一個檔」也能再次觸發 onChange。
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

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

      {/* 或：上傳檔案（給手機/電腦自己抓下來的 IG／影片／錄音檔；一律走 Groq 轉錄） */}
      <div style={dividerRowStyle}>
        <span style={dividerLineStyle} />
        <span style={dividerTextStyle}>或上傳影音 / 錄音檔</span>
        <span style={dividerLineStyle} />
      </div>
      <div style={{ display: "flex", gap: "var(--spacing-2)", alignItems: "center", flexWrap: "wrap" }}>
        {/* 隱藏原生 file input（各主題下看起來像純文字、不夠顯眼）→ 改用明確按鈕觸發 */}
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,video/*"
          disabled={busy}
          aria-label="要精煉成筆記的音訊或影片檔"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleUpload(f);
          }}
          style={{ display: "none" }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          style={uploadBtnStyle}
        >
          📎 {busy ? "處理中…" : "選擇音訊 / 影片檔上傳"}
        </button>
      </div>
      <p style={{ ...hintStyle, margin: "var(--spacing-2) 0 0" }}>
        上傳檔一律需轉錄，請先在「個人頁 → 精煉成筆記」設定 Groq 金鑰（免費）。上限 {MAX_UPLOAD_MB}MB。
      </p>

      {/* 教學：一般人不知道怎麼把影片/音訊變成檔案，提供各平台步驟（可收合） */}
      <details style={helpBoxStyle}>
        <summary style={helpSummaryStyle}>📖 不知道怎麼取得影片 / 音訊檔？點我看教學</summary>
        <div style={helpBodyStyle}>
          <p style={helpLineStyle}>📱 <b>iPhone</b>：在 IG / YouTube 點「分享」→ 用「捷徑」或下載類 App 把影片存到「檔案 / 相簿」→ 回這裡選檔上傳。</p>
          <p style={helpLineStyle}>🤖 <b>Android</b>：用下載類 App 或瀏覽器把影片存到手機 → 上傳。</p>
          <p style={helpLineStyle}>💻 <b>電腦</b>：用瀏覽器擴充或下載工具把影片 / 音訊存成檔案 → 上傳（用自己電腦＋已登入＋自家網路，成功率最高）。</p>
          <p style={helpLineStyle}>🎙️ <b>錄音</b>：手機 / 電腦的會議錄音、語音備忘錄（m4a / mp3 / wav）可直接上傳。</p>
          <p style={helpLineStyle}>💡 只是要 <b>YouTube 字幕或網路文章</b>？不用下載——直接把<b>網址</b>貼到上面那個框就好。</p>
        </div>
      </details>

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
const dividerRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--spacing-2)",
  margin: "var(--spacing-3) 0",
};
const dividerLineStyle: React.CSSProperties = {
  flex: 1,
  height: 1,
  background: "var(--border-default)",
};
const dividerTextStyle: React.CSSProperties = {
  fontSize: "var(--text-xs)",
  color: "var(--text-tertiary)",
  whiteSpace: "nowrap",
};
// 上傳按鈕：明確的「實心次要按鈕」外觀（用主題變數，在所有顯示模式都顯眼，不再像純文字）。
const uploadBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "var(--spacing-2) var(--spacing-4)",
  background: "var(--action-secondary-bg)",
  color: "var(--action-secondary-fg)",
  border: "1px solid var(--action-secondary-fg)",
  borderRadius: "var(--radius-md)",
  fontWeight: 600,
  fontSize: "var(--text-sm)",
  cursor: "pointer",
};
const helpBoxStyle: React.CSSProperties = {
  marginTop: "var(--spacing-3)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-md)",
  background: "var(--bg-default)",
  padding: "var(--spacing-2) var(--spacing-3)",
};
const helpSummaryStyle: React.CSSProperties = {
  cursor: "pointer",
  fontSize: "var(--text-sm)",
  fontWeight: 600,
  color: "var(--text-secondary)",
};
const helpBodyStyle: React.CSSProperties = {
  marginTop: "var(--spacing-2)",
  display: "flex",
  flexDirection: "column",
  gap: "var(--spacing-1)",
};
const helpLineStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "var(--text-xs)",
  color: "var(--text-secondary)",
  lineHeight: 1.6,
};
