import type { ReactElement } from "react";
import { ComingSoon } from "../components/ComingSoon";

/**
 * 英文教練佔位頁（Phase 3 開發中）。
 *
 * 【刻意延後的設計偏離｜設計書 §2.2「教練頁滿版規則」】
 * 設計書 §2.2 明文要求 /others/coach 走「滿版」（`sidebar--hidden` 變體＋`data-route` 白名單），
 * 理由是真教練頁需要把 `.main-content` 的 margin 歸零、給雙向字幕/糾錯卡足夠寬度。
 * 但那是 Phase 3 的「真教練頁」需求；Phase 1 的 coach 只是佔位頁，故**刻意維持標準 OthersSidebar
 * 側欄版**、不做滿版，屬合理縮圈（與「任務把 coach 定為佔位頁」一致）。
 * Phase 3 上線真教練時再改滿版：在 Sidebar 為 `/others/coach` 加 `sidebar--hidden` 特例，
 * 並把 `data-route="others"` 或該路由加入 globals.css 的滿版白名單（§2.2）。
 */
export default function CoachPage(): ReactElement {
  return (
    <ComingSoon
      icon="🎙️"
      title="英文教練"
      phase={3}
      previewPoints={[
        "Vertex Live 即時語音對話",
        "雙向即時字幕＋糾錯卡",
        "Midoo 式教學法",
        "「加入單字本」語音指令（Function Calling）",
      ]}
    />
  );
}
