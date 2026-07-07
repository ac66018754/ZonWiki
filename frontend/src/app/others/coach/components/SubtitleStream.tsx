"use client";

import { memo, useEffect, useRef, useState, type ReactElement } from "react";
import type { SubtitleTurn } from "../lib/useCoachConnection";

/** 打字機每次揭露的字元數。 */
const TYPEWRITER_CHARS_PER_TICK = 2;
/** 打字機每格毫秒。 */
const TYPEWRITER_TICK_MS = 24;

/**
 * 逐字打字機：把不斷成長的 fullText 漸進揭露。fullText 縮短（新回合從空重來/barge-in）時縮回。
 *
 * 縮回採「渲染期依 prop 變化調整 state」的官方模式（非 effect 內 setState），避免串聯渲染警告。
 * @param fullText 目前完整文字。
 * @returns 已揭露的子字串。
 */
function useTypewriter(fullText: string): string {
  const [revealed, setRevealed] = useState(0);
  const [prevLen, setPrevLen] = useState(0);

  // 渲染期修正：fullText 變短時把 revealed 夾回（新回合從 0 起算），有守衛不會無限迴圈。
  if (fullText.length !== prevLen) {
    if (fullText.length < revealed) setRevealed(fullText.length);
    setPrevLen(fullText.length);
  }

  useEffect(() => {
    if (revealed >= fullText.length) return;
    const timer = window.setTimeout(() => {
      setRevealed((r) => Math.min(fullText.length, r + TYPEWRITER_CHARS_PER_TICK));
    }, TYPEWRITER_TICK_MS);
    return () => clearTimeout(timer);
  }, [revealed, fullText]);

  return fullText.slice(0, Math.min(revealed, fullText.length));
}

/**
 * 雙向即時字幕（計畫 §6）。
 *  - AI 側：逐字打字機（左對齊）。
 *  - 使用者側：整句氣泡（右對齊）。
 *  - barge-in：被打斷的 AI 回合標「（被打斷）」（依 audio-streamer 實際進度近似截斷）。
 *
 * 以 React.memo 包裝（審修 M2）：麥克風音量每 25ms 更新會讓工作區重繪，但只要 turns/
 * liveAssistantText 未變（例如聆聽中），本元件即略過重繪。
 *
 * @param turns 已定案回合。
 * @param liveAssistantText 正在串流的 AI 文字。
 */
function SubtitleStreamInner({
  turns,
  liveAssistantText,
}: {
  turns: SubtitleTurn[];
  liveAssistantText: string;
}): ReactElement {
  const typed = useTypewriter(liveAssistantText);
  const endRef = useRef<HTMLDivElement | null>(null);

  // 新內容進來時自動捲到底。串流每 ~24ms 更新，用 "auto"（瞬捲）避免平滑動畫互搶造成卡頓（審修 M3）。
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "auto" });
  }, [turns, typed]);

  const isEmpty = turns.length === 0 && liveAssistantText.length === 0;

  return (
    <div
      className="coach-subtitles"
      aria-label="即時字幕"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--spacing-3)",
        overflowY: "auto",
        padding: "var(--spacing-2)",
      }}
    >
      {isEmpty && (
        <p
          style={{
            margin: "auto",
            textAlign: "center",
            color: "var(--text-secondary)",
            fontSize: "var(--text-sm)",
            lineHeight: 1.8,
          }}
        >
          開始說話，教練會即時回應並在下方顯示字幕。
        </p>
      )}

      {turns.map((turn) => (
        <Bubble key={turn.id} role={turn.role} interrupted={turn.interrupted}>
          {turn.text}
        </Bubble>
      ))}

      {/* 串流中的 AI 文字（aria-live 讓輔助科技朗讀）。 */}
      {liveAssistantText.length > 0 && (
        <Bubble role="assistant" live>
          {typed}
          <span aria-hidden className="coach-caret">
            ▋
          </span>
        </Bubble>
      )}

      <div ref={endRef} />
    </div>
  );
}

/** 雙向即時字幕（memo 包裝，見上）。 */
export const SubtitleStream = memo(SubtitleStreamInner);

/**
 * 單則字幕氣泡。
 * @param role 角色（assistant 左／user 右）。
 * @param children 內容。
 * @param interrupted 是否被打斷。
 * @param live 是否為串流中（設 aria-live）。
 */
function Bubble({
  role,
  children,
  interrupted,
  live,
}: {
  role: "assistant" | "user";
  children: React.ReactNode;
  interrupted?: boolean;
  live?: boolean;
}): ReactElement {
  const isUser = role === "user";
  return (
    <div
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
      }}
    >
      <div
        aria-live={live ? "polite" : undefined}
        style={{
          maxWidth: "min(88%, 640px)",
          padding: "var(--spacing-2) var(--spacing-3)",
          borderRadius: "var(--radius-lg)",
          fontSize: "var(--text-sm)",
          lineHeight: 1.7,
          background: isUser ? "var(--action-secondary-bg)" : "var(--bg-surface)",
          color: isUser ? "var(--action-secondary-fg)" : "var(--text-primary)",
          border: isUser ? "none" : "1px solid var(--border-default)",
          wordBreak: "break-word",
        }}
      >
        <span
          className="coach-sr-only"
        >{isUser ? "你說：" : "教練說："}</span>
        {children}
        {interrupted && (
          <span
            style={{
              marginLeft: "var(--spacing-2)",
              fontSize: "var(--text-xs)",
              color: "var(--text-tertiary)",
              fontStyle: "italic",
            }}
          >
            （被打斷）
          </span>
        )}
      </div>
    </div>
  );
}
