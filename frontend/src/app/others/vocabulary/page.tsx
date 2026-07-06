import type { ReactElement } from "react";
import { ComingSoon } from "../components/ComingSoon";

/**
 * 單字庫佔位頁（Phase 2 開發中）。
 *
 * Phase 1 僅顯示功能預告；實際的單字 CRUD＋SRS 複習於 Phase 2 實作（設計書 §3）。
 */
export default function VocabularyPage(): ReactElement {
  return (
    <ComingSoon
      icon="📚"
      title="單字庫"
      phase={2}
      previewPoints={[
        "單字 CRUD＋SRS 間隔複習",
        "四鍵評分複習卡（Again / Hard / Good / Easy）",
        "Web Speech 發音",
        "與英文教練雙向整合（到期單字注入課程）",
      ]}
    />
  );
}
