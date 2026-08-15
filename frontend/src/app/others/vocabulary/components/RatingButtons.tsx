"use client";

import type { ReviewRating, VocabularyWord } from "@/lib/api";
import { RATING_META, formatSchedulePreview } from "../vocabularyUtils";

/**
 * 複習四鍵評分列（Again / Hard / Good / Easy），每鍵顯示「下次間隔預覽」。
 *
 * 間隔預覽為權威值（後端 schedulePreview，DB-as-truth）或降級定性詞（見 formatSchedulePreview）。
 * ≤768px 轉 2×2 grid、每顆 ≥44×44px tap target。色非唯一載體：每鍵有中英文字標籤。
 */
export interface RatingButtonsProps {
  /** 目前複習的卡（供讀取間隔預覽）。 */
  card: VocabularyWord;
  /** 送出中（禁用四鍵，防連按重送）。 */
  disabled: boolean;
  /** 按下某鍵。 */
  onRate: (rating: ReviewRating) => void;
}

/**
 * 四鍵評分列元件。
 * @param props card、disabled、onRate。
 */
export function RatingButtons({ card, disabled, onRate }: RatingButtonsProps) {
  return (
    <div
      role="group"
      aria-label="評分"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
        gap: "var(--spacing-2)",
        width: "100%",
      }}
    >
      {RATING_META.map((meta) => (
        <button
          key={meta.rating}
          type="button"
          className="vocab-rating-btn"
          disabled={disabled}
          onClick={() => onRate(meta.rating)}
          aria-label={`${meta.labelZh}（${meta.labelEn}），下次 ${formatSchedulePreview(card, meta.rating)}`}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "2px",
            minHeight: "56px",
            padding: "var(--spacing-2) var(--spacing-3)",
            borderRadius: "var(--radius-md)",
            border: `1px solid ${meta.fg}`,
            background: meta.bg,
            color: meta.fg,
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.55 : 1,
            transition: "filter 0.15s ease",
          }}
        >
          <span style={{ fontSize: "var(--text-sm)", fontWeight: 700, lineHeight: 1.2 }}>
            {meta.labelZh}
            <span style={{ fontWeight: 400, opacity: 0.85 }}> · {meta.labelEn}</span>
          </span>
          <span style={{ fontSize: "var(--text-xs)", opacity: 0.9 }}>
            {formatSchedulePreview(card, meta.rating)}
          </span>
        </button>
      ))}
      {/* 四態：focus 走全域 :focus-visible、disabled 走 inline opacity；hover/active 用 filter 變暗
          （四主題一致的回饋，與 .btn-danger 同慣例，不與 inline background 衝突）。 */}
      <style jsx>{`
        .vocab-rating-btn:hover:not(:disabled) {
          filter: brightness(0.92);
        }
        .vocab-rating-btn:active:not(:disabled) {
          filter: brightness(0.85);
        }
      `}</style>
    </div>
  );
}
