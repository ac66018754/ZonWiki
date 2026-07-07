"use client";

import type { VocabularyWord } from "@/lib/api";
import { SpeakButton } from "./SpeakButton";

/**
 * 複習卡（正/反面）。
 *
 * 正面：單字大字＋音標＋🔊 發音鈕。反面：詞性、雙語釋義、例句（＋保留 🔊）。
 * 翻面用 flipped 布林切換（v1 以「顯示/隱藏」呈現，不強制 3D 動畫）；卡片可聚焦、Space/Enter 翻面。
 */
export interface ReviewCardProps {
  /** 目前複習的卡。 */
  word: VocabularyWord;
  /** 是否已翻面（顯示答案）。 */
  flipped: boolean;
  /** 切換翻面。 */
  onFlip: () => void;
}

/**
 * 複習卡元件。
 * @param props word、flipped、onFlip。
 */
export function ReviewCard({ word, flipped, onFlip }: ReviewCardProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      className="vocab-review-card"
      aria-label={flipped ? "點擊收合答案" : "點擊顯示答案"}
      onClick={onFlip}
      onKeyDown={(event) => {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault(); // 避免 Space 捲頁
          onFlip();
        }
      }}
      style={{
        width: "100%",
        maxWidth: "560px",
        minHeight: "40vh",
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--spacing-4)",
        padding: "var(--spacing-8) var(--spacing-6)",
        background: "var(--bg-surface)",
        border: "1px solid var(--border-default)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-sm)",
        cursor: "pointer",
        textAlign: "center",
        transition: "filter 0.15s ease, transform 0.15s ease",
      }}
    >
      {/* 正面：單字 */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--spacing-2)" }}>
        <div style={{ fontSize: "var(--text-3xl)", fontWeight: 700, color: "var(--text-primary)" }}>
          {word.word}
        </div>
        {word.phonetic && (
          <div style={{ fontSize: "var(--text-base)", color: "var(--text-secondary)" }}>
            {word.phonetic}
          </div>
        )}
        <SpeakButton word={word.word} size="md" />
      </div>

      {/* 反面：釋義 */}
      {flipped ? (
        <div
          style={{
            width: "100%",
            borderTop: "1px solid var(--border-default)",
            paddingTop: "var(--spacing-4)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--spacing-2)",
            fontSize: "var(--text-base)",
            color: "var(--text-primary)",
            lineHeight: 1.7,
          }}
        >
          {word.partOfSpeech && (
            <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
              {word.partOfSpeech}
            </div>
          )}
          {word.definitionZh && <div style={{ fontWeight: 600 }}>{word.definitionZh}</div>}
          {word.definitionEn && (
            <div style={{ color: "var(--text-secondary)" }}>{word.definitionEn}</div>
          )}
          {word.exampleSentence && (
            <div
              style={{
                marginTop: "var(--spacing-2)",
                fontStyle: "italic",
                color: "var(--text-secondary)",
                borderLeft: "3px solid var(--border-strong)",
                paddingLeft: "var(--spacing-3)",
                textAlign: "left",
              }}
            >
              {word.exampleSentence}
            </div>
          )}
          {!word.definitionZh && !word.definitionEn && !word.exampleSentence && (
            <div style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
              （這張卡尚無釋義，可到清單模式補上）
            </div>
          )}
        </div>
      ) : (
        <div style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
          點卡片或按空白鍵顯示答案
        </div>
      )}

      {/* 四態：focus 走全域 :focus-visible；卡片無 disabled 態；hover 微亮並上浮、active 回落，
          給整卡可點的視覺回饋（boxShadow 為 inline 短屬性，改用 filter+transform）。 */}
      <style jsx>{`
        .vocab-review-card:hover {
          filter: brightness(1.02);
          transform: translateY(-2px);
        }
        .vocab-review-card:active {
          transform: translateY(0);
          filter: brightness(0.98);
        }
      `}</style>
    </div>
  );
}
