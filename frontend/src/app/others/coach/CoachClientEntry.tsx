"use client";

import { useEffect, type ReactElement } from "react";
import dynamic from "next/dynamic";
import { ensureCoachTestHarness } from "./lib/testHarness";

/**
 * 動態載入即時工作區並**關閉 SSR**（計畫 §5/§6 審修-F1）。
 *
 * 為什麼在這裡做 dynamic(ssr:false)：App Router 的 Server Component（page.tsx）內禁止
 * `dynamic(..., { ssr:false })`（build 期報錯）。故 page.tsx 保持 Server Component、只渲染本
 * client wrapper；由本 wrapper 才對 CoachLiveWorkspace 關閉 SSR。工作區內含 AudioContext/window
 * 相依（音訊層），必須僅在瀏覽器求值，避免 prerender 時 `window is not defined`。
 */
const CoachLiveWorkspace = dynamic(
  () => import("./components/CoachLiveWorkspace").then((m) => m.CoachLiveWorkspace),
  {
    ssr: false,
    loading: () => (
      <div className="coach-page">
        <div className="coach-start">
          <div className="coach-start__card" aria-busy="true">
            <div aria-hidden style={{ fontSize: "48px", lineHeight: 1 }}>
              🎙️
            </div>
            <p style={{ marginTop: "var(--spacing-4)", color: "var(--text-secondary)" }}>
              載入中…
            </p>
          </div>
        </div>
      </div>
    ),
  },
);

/**
 * 教練頁 client 入口（page.tsx 這個 Server Component 渲染它）。
 * e2e 模式下於掛載即安裝測試 harness，讓監工能在點「開始對話」前預先設定/檢查。
 * @returns 即時工作區。
 */
export function CoachClientEntry(): ReactElement {
  useEffect(() => {
    // 僅 e2e 模式會安裝；正式模式回 null、完全不介入。
    ensureCoachTestHarness();
  }, []);

  return <CoachLiveWorkspace />;
}
