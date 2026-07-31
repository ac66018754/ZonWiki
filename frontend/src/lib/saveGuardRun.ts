/**
 * 存檔攔截的「串接層」（feature/paragraph-links 包4）。
 *
 * 把純判定 {@link computeLostMarks}（見 saveGuard.ts）接上實際的 API：
 * 抓本篇標註、對新內容打 render dry-run、算出「這次存檔會弄斷定位」的清單，
 * 並提供給確認框顯示的訊息格式化。
 *
 * 刻意與 saveGuard.ts 分檔：saveGuard.ts 是被單元測試覆蓋的「純函式」（只依賴 textAnchor 與 DOM），
 * 不引入任何 API 相依；本檔才做網路串接，避免污染受測純模組。
 */

import { listNoteMarks, renderNoteDryRun, type NoteMark } from "./api";
import { computeLostMarks } from "./saveGuard";

/** kind → 確認框分組圖示。 */
const KIND_ICON: Record<string, string> = {
  highlight: "🖍",
  link: "🔗",
  annotation: "📝",
  anchor: "📍",
};

/** 錨文字顯示上限（確認框列出時截斷）。 */
const ANCHOR_PREVIEW_MAX = 40;

/**
 * 算出「把新內容存下去會弄斷定位」的標註清單。
 *
 * @param noteId 筆記識別碼。
 * @param oldHtml 存檔前手上的權威 HTML（note.contentHtml；即時重算舊內容基準，不讀 DB 存量 Detached）。
 * @param newContentRaw 即將存檔的新 Markdown 原文。
 * @returns 會弄斷的標註；render 失敗或無標註時回空陣列（附加檢查不阻擋主存檔流程）。
 */
export async function findLostMarksForSave(
  noteId: string,
  oldHtml: string,
  newContentRaw: string
): Promise<NoteMark[]> {
  const marks = await listNoteMarks(noteId);
  if (marks.length === 0) return [];

  const newHtml = await renderNoteDryRun(newContentRaw);
  if (newHtml == null) return []; // render 端點失敗 → 保守放行，不因附加檢查卡住存檔

  return computeLostMarks(oldHtml, newHtml, marks);
}

/**
 * 把會斷的標註列成確認框訊息（分組圖示＋錨文字截斷＋anchor 的 referencedBy「被《X》引用」）。
 * @param lost 會弄斷定位的標註。
 * @returns 供 useConfirm 顯示的多行訊息（ConfirmDialog 會保留 \n）。
 */
export function formatLostMarksMessage(lost: NoteMark[]): string {
  const lines = lost.map((m) => {
    const icon = KIND_ICON[m.kind] ?? "•";
    const text =
      m.anchorText.length > ANCHOR_PREVIEW_MAX
        ? `${m.anchorText.slice(0, ANCHOR_PREVIEW_MAX)}…`
        : m.anchorText;
    const refs = m.referencedBy ?? [];
    const refPart =
      m.kind === "anchor" && refs.length > 0
        ? `（被${refs.map((r) => `《${r}》`).join("、")}引用）`
        : "";
    return `${icon}「${text}」${refPart}`;
  });

  return (
    `這次儲存會讓下列 ${lost.length} 個標註失去定位` +
    `（畫記／備註／關聯會顯示「失去定位」）：\n\n${lines.join("\n")}\n\n仍要儲存嗎？`
  );
}
