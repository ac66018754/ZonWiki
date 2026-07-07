/**
 * 逐字 diff（word-level）——供糾錯卡把「原句 → 修正句」的差異標成刪除/新增/不變。
 * 以 LCS（最長共同子序列）對齊，回傳可直接渲染的區段序列。純運算，可測。
 */

/** diff 區段種類。 */
export type DiffSegmentType = "equal" | "removed" | "added";

/** 一個 diff 區段。 */
export interface DiffSegment {
  /** 種類：不變 / 刪除（原句有、修正句無）/ 新增（修正句有、原句無）。 */
  type: DiffSegmentType;
  /** 該區段文字（已用空白合併相鄰同類）。 */
  text: string;
}

/**
 * 以空白切詞（過濾空字串）。
 * @param text 句子。
 * @returns 詞陣列。
 */
function tokenize(text: string): string[] {
  return text.split(/\s+/).filter((t) => t.length > 0);
}

/**
 * 對兩句做逐字 LCS diff。
 * @param original 原句（可能含錯誤）。
 * @param corrected 修正句。
 * @returns diff 區段序列（相鄰同類已合併）。
 */
export function diffWords(original: string, corrected: string): DiffSegment[] {
  const a = tokenize(original);
  const b = tokenize(corrected);
  const m = a.length;
  const n = b.length;

  // dp[i][j] = a[i..]、b[j..] 的 LCS 長度。
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const raw: DiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      raw.push({ type: "equal", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      raw.push({ type: "removed", text: a[i] });
      i++;
    } else {
      raw.push({ type: "added", text: b[j] });
      j++;
    }
  }
  while (i < m) raw.push({ type: "removed", text: a[i++] });
  while (j < n) raw.push({ type: "added", text: b[j++] });

  // 合併相鄰同類，減少 DOM 節點與視覺碎裂（不可變寫法：以新物件取代，不 mutate 既有元素）。
  const merged: DiffSegment[] = [];
  for (const seg of raw) {
    const last = merged[merged.length - 1];
    if (last && last.type === seg.type) {
      merged[merged.length - 1] = { ...last, text: last.text + " " + seg.text };
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}
