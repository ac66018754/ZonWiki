"use client";

import { useEffect, useSyncExternalStore } from "react";

/** 空訂閱（語音支援與否在 session 內不變，故無需訂閱變更）。 */
const emptySubscribe = () => () => {};

/**
 * SSR 安全地偵測瀏覽器是否支援 Web Speech `speechSynthesis`。
 * 伺服器端快照回 false、客戶端回實際支援狀態，避免 hydration 不一致與 effect 內 setState。
 * @returns 是否支援語音發音。
 */
function useSpeechSynthesisSupported(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => typeof window !== "undefined" && "speechSynthesis" in window,
    () => false,
  );
}

/**
 * 發音鈕（Web Speech `speechSynthesis`）。
 *
 * 前景短句朗讀單字（預設英文 en-US、語速稍慢求清楚）。不預先挑特定 voice
 * （voiceschanged 為非同步，且 iOS/Safari 首次需使用者手勢觸發）——只設 lang，交瀏覽器選預設英文 voice。
 * `SpeechSynthesisUtterance` 為 TS DOM 內建型別，免自訂宣告。
 */
export interface SpeakButtonProps {
  /** 要朗讀的文字（單字）。 */
  word: string;
  /** BCP-47 語言（預設 en-US）。 */
  lang?: string;
  /** 尺寸（sm＝列內小鈕；md＝複習卡大鈕）。 */
  size?: "sm" | "md";
}

/**
 * 發音鈕元件。
 * @param props word、lang、size。
 */
export function SpeakButton({ word, lang = "en-US", size = "sm" }: SpeakButtonProps) {
  const supported = useSpeechSynthesisSupported();

  // 中止未播完的語音：卸載時、以及 word 變更時都要中止。
  // 複習切卡（ReviewCard 未帶 key）會重用同一 SpeakButton 實例、只變 word 而不卸載，
  // 相依帶入 word 才能在切到下一字時打斷上一字的朗讀。
  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [word]);

  /** 朗讀單字（打斷前一次，重新念）。 */
  const speak = () => {
    if (!supported || !word) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = lang;
    utterance.rate = 0.9; // 稍慢、清楚
    window.speechSynthesis.speak(utterance);
  };

  const dimension = size === "md" ? 40 : 28;
  const fontSize = size === "md" ? "var(--text-lg)" : "var(--text-sm)";

  return (
    <button
      type="button"
      className="vocab-speak-btn"
      onClick={(event) => {
        // 列可整列點擊展開；發音鈕不要連帶觸發父層 onClick。
        event.stopPropagation();
        speak();
      }}
      disabled={!supported}
      aria-label={supported ? `發音：${word}` : "此瀏覽器不支援語音發音"}
      title={supported ? "發音" : "此瀏覽器不支援語音發音"}
      style={{
        flexShrink: 0,
        width: dimension,
        height: dimension,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize,
        lineHeight: 1,
        borderRadius: "var(--radius-full)",
        border: "1px solid var(--border-default)",
        background: "var(--bg-surface)",
        color: "var(--text-primary)",
        cursor: supported ? "pointer" : "not-allowed",
        opacity: supported ? 1 : 0.5,
        transition: "border-color 0.15s ease, filter 0.15s ease",
      }}
    >
      <span aria-hidden>🔊</span>
      {/* 四態：focus 走全域 :focus-visible、disabled 走 inline opacity；hover/active 用 filter 變暗＋
          box-shadow 環（inline 已佔用 border 短屬性，故不改 border-color 改用 shadow 提示）。 */}
      <style jsx>{`
        .vocab-speak-btn:hover:not(:disabled) {
          filter: brightness(0.9);
          box-shadow: 0 0 0 2px var(--border-strong);
        }
        .vocab-speak-btn:active:not(:disabled) {
          filter: brightness(0.82);
        }
      `}</style>
    </button>
  );
}
