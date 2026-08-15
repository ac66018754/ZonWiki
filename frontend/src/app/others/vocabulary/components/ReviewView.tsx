"use client";

import { useCallback, useEffect, useState } from "react";
import { useSWRConfig } from "swr";
import type { ReviewRating, VocabularyWord } from "@/lib/api";
import { reviewVocabulary } from "@/lib/api";
import { useDueVocabulary, revalidateAllVocabulary } from "@/lib/swr";
import { Button } from "@/components/Button";
import { showToast } from "@/lib/toast";
import { ReviewCard } from "./ReviewCard";
import { RatingButtons } from "./RatingButtons";
import { RATING_META } from "../vocabularyUtils";

/**
 * 複習模式（設計書 §3.4 第二點）：由 GET /due 驅動的全螢幕卡片流。
 *
 * 佇列策略（KISS）：以首次抓到的到期陣列做快照，本地游標逐張前進，**不每張 refetch**，
 * 避免 Again 卡立即到期造成的重抓/無限迴圈；如需 Anki 式同場重排屬後端佇列語意/未來增強。
 */
export interface ReviewViewProps {
  /** 離開複習（回清單模式）。 */
  onExit: () => void;
}

/**
 * 複習模式元件。
 * @param props onExit 回呼。
 */
export function ReviewView({ onExit }: ReviewViewProps) {
  const { mutate: globalMutate } = useSWRConfig();
  const { data, error, mutate } = useDueVocabulary();

  // 快照佇列（首次 data 到位時設一次，之後不被 SWR 背景重抓覆蓋）。
  const [queue, setQueue] = useState<VocabularyWord[] | null>(null);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (data && queue === null) {
      setQueue(data);
    }
  }, [data, queue]);

  const current = queue && index < queue.length ? queue[index] : null;

  /** 送出一次評分並前進到下一張。 */
  const handleRate = useCallback(
    async (rating: ReviewRating) => {
      if (!queue || !current || submitting) return;
      setSubmitting(true);
      try {
        const updated = await reviewVocabulary(current.id, rating);
        if (!updated) {
          showToast("送出失敗，請重試", { type: "error" });
          return;
        }
        setFlipped(false);
        const nextIndex = index + 1;
        setIndex(nextIndex);
        // 複習完（游標到底）時讓清單/佇列反映新 due。
        if (nextIndex >= queue.length) {
          revalidateAllVocabulary(globalMutate);
        }
      } catch {
        showToast("送出失敗，請重試", { type: "error" });
      } finally {
        setSubmitting(false);
      }
    },
    [queue, current, index, submitting, globalMutate],
  );

  // 數字鍵 1-4 對應四鍵評分（翻面後才生效；複習模式無輸入框、不衝突）。
  useEffect(() => {
    if (!flipped || !current || submitting) return;
    const handler = (event: KeyboardEvent) => {
      const digit = Number(event.key);
      if (digit >= 1 && digit <= RATING_META.length) {
        event.preventDefault();
        void handleRate(RATING_META[digit - 1].rating);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [flipped, current, submitting, handleRate]);

  /** 頂列：進度 + 離開。 */
  const header = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--spacing-3)",
        marginBottom: "var(--spacing-4)",
      }}
    >
      <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
        {queue && queue.length > 0 && index < queue.length
          ? `第 ${index + 1} / ${queue.length} 張`
          : "複習"}
      </span>
      <Button variant="secondary" size="sm" onClick={onExit}>
        離開複習
      </Button>
    </div>
  );

  // 載入 / 錯誤（快照尚未建立）。
  if (queue === null) {
    if (error) {
      return (
        <div>
          {header}
          <div
            role="alert"
            style={{
              padding: "var(--spacing-4)",
              background: "var(--status-danger-bg)",
              color: "var(--status-danger-fg)",
              borderRadius: "var(--radius-lg)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--spacing-3)",
              alignItems: "center",
            }}
          >
            無法載入到期單字，請稍後重試。
            <Button variant="secondary" size="sm" onClick={() => void mutate()}>
              重試
            </Button>
          </div>
        </div>
      );
    }
    return (
      <div>
        {header}
        <div
          style={{
            minHeight: "40vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-secondary)",
          }}
        >
          載入中…
        </div>
      </div>
    );
  }

  // 佇列空（一開始就沒有到期卡）。
  if (queue.length === 0) {
    return (
      <div>
        {header}
        <ReviewEmptyState title="🎉 今日沒有到期單字" onExit={onExit} />
      </div>
    );
  }

  // 複習完成（游標走完）。
  if (index >= queue.length) {
    return (
      <div>
        {header}
        <ReviewEmptyState title="🎉 今日複習完成" onExit={onExit} />
      </div>
    );
  }

  return (
    <div>
      {header}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-4)", minHeight: "60vh" }}>
        <ReviewCard word={current!} flipped={flipped} onFlip={() => setFlipped((value) => !value)} />
        {flipped && (
          <div style={{ maxWidth: "560px", margin: "0 auto", width: "100%" }}>
            <RatingButtons card={current!} disabled={submitting} onRate={handleRate} />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 複習結束/無到期卡的置中空狀態。
 */
function ReviewEmptyState({ title, onExit }: { title: string; onExit: () => void }) {
  return (
    <div
      style={{
        minHeight: "40vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--spacing-4)",
        textAlign: "center",
      }}
    >
      <p style={{ margin: 0, fontSize: "var(--text-xl)", fontWeight: 600, color: "var(--text-primary)" }}>
        {title}
      </p>
      <Button variant="primary" onClick={onExit}>
        回清單
      </Button>
    </div>
  );
}
