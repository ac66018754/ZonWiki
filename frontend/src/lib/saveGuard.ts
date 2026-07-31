/**
 * 存檔攔截判定（computeLostMarks）——feature/paragraph-links 包4 錨點保護核心。
 *
 * 架構裁決（見 docs/DECISIONS.md「段落級關聯＋錨點保護：瀏覽器為唯一座標系」）：
 * mark 錨定的座標系自始是「瀏覽器對渲染 HTML 的 textContent」，後端完全不做 reAnchor。
 * 因此存檔前的「哪些標註會斷」也必須在瀏覽器（或 jsdom，同規格）判定：
 *   ① 舊文字＝把手上的 note.contentHtml 注入 detached DOM 讀 textContent（零請求）；
 *   ② 新文字＝POST /api/notes/render 對「新 contentRaw」dry-run 回傳的 HTML 注入同樣讀 textContent；
 * 兩份純文字各跑一次「既有 textAnchor.reAnchor 原碼」（零演算法移植、零座標系分歧），
 * 「舊找得到、新找不到」者即本次存檔會弄斷的標註。
 *
 * 「原本」基準＝即時重算舊內容——**絕不**讀 DB 存量 Detached：滯後污染會把舊帳誤植為本次破壞
 * （計畫二輪復審裁決）。
 */

import { reAnchor } from "./textAnchor";
import type { NoteMark } from "./api";

/**
 * 把一段 HTML 注入離線 DOM 節點，讀出其 textContent（＝mark 錨定的座標系）。
 * 用 detached 的 div（不接進文件）避免任何副作用；jsdom 對靜態 HTML 的 textContent 與瀏覽器同規格。
 * @param html 要讀取純文字的 HTML 片段。
 * @returns 對應的 textContent（無內容時為空字串）。
 */
function htmlToText(html: string): string {
  const holder = document.createElement("div");
  holder.innerHTML = html;
  return holder.textContent ?? "";
}

/**
 * 計算「這次存檔會弄斷定位」的標註清單。
 *
 * @param oldHtml 存檔前手上的 note.contentHtml（舊內容的權威 HTML）。
 * @param newHtml 對新 contentRaw dry-run 渲染出的 HTML（新內容的權威 HTML）。
 * @param marks 本篇的全部標註（畫重點／備註／關聯／錨點皆納入判定）。
 * @returns 舊內容找得到、新內容找不到的標註（舊帳不歸因：舊內容就已斷者不列入）。
 */
export function computeLostMarks(
  oldHtml: string,
  newHtml: string,
  marks: NoteMark[]
): NoteMark[] {
  const oldText = htmlToText(oldHtml);
  const newText = htmlToText(newHtml);

  return marks.filter((mark) => {
    const inOld = reAnchor(
      oldText,
      mark.anchorText,
      mark.anchorStart,
      mark.anchorPrefix,
      mark.anchorSuffix
    );
    // 舊帳不歸因：本次存檔之前就已找不到的標註，不算是「這次弄斷的」。
    if (!inOld.found) return false;

    const inNew = reAnchor(
      newText,
      mark.anchorText,
      mark.anchorStart,
      mark.anchorPrefix,
      mark.anchorSuffix
    );
    return !inNew.found;
  });
}
