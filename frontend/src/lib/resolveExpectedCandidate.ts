import type { SlugCandidate } from './api';

/**
 * 在一組消歧異候選中，找出 `?expect=<id>` 指定的那一篇。
 *
 * 用途（feature/slug-alias 包3，對抗式復審 CRITICAL #2 的配套）：某個 slug 歧義時，若網址帶著
 * `?expect=<筆記id>`（複製筆記、或改名存檔後 router.replace 帶上的意圖標記），就以該 id 直達本篇、
 * 不逼使用者看消歧異頁。此判斷抽成純函式以便單元測試（載入 effect 的歧義分支呼叫它）。
 *
 * @param candidates 消歧異候選清單。
 * @param expectId 期望直達的筆記 id（GUID）；null／空字串＝沒有期望。
 * @returns 命中（id 相符）的候選；未命中／無期望／空候選皆回 null。
 */
export function resolveExpectedCandidate(
  candidates: SlugCandidate[],
  expectId: string | null,
): SlugCandidate | null {
  if (!expectId || !candidates || candidates.length === 0) {
    return null;
  }
  return candidates.find((candidate) => candidate.id === expectId) ?? null;
}
