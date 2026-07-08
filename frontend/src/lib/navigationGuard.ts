/**
 * 全站導頁守門（Navigation Guard）
 *
 * 用途：
 * 讓「任何會呼叫 router.push 做站內導頁的入口」（全域搜尋結果、指令面板、
 * Header 的『筆記』導覽等），在真正導頁前先徵詢目前頁面是否放行——
 * 典型情境是「筆記編輯中有未儲存變更」時，先跳確認對話框，取消就留在原地。
 *
 * 為何不是靠攔截 <a> click：
 * 全域搜尋 / 指令面板的結果列是 <div onClick={router.push(...)}>（非 <a>），
 * 鍵盤 Enter 甚至完全沒有 click 事件；用 capture 階段攔 <a> 這種「猜測式」作法
 * 涵蓋不到它們，且對別的元件（如 Header 的 <a>+自訂 onClick）會有副作用。
 * 故改為一個「模組層單例的守門登記處」：需要保護的頁面把自己的確認函式登記進來，
 * 導頁入口在 router.push 前呼叫 confirmNavigation() 取得放行許可即可，涵蓋全站。
 *
 * 生命週期：以模組層單例保存（跨元件共用、不依賴 React context 樹），
 * 頁面掛載時 registerNavigationGuard 登記、卸載時呼叫回傳的解除函式移除。
 */

/**
 * 單一守門函式：回傳 Promise<true> 代表「可放行導頁」，
 * Promise<false> 代表「使用者選擇留在原地、應中止導頁」。
 */
export type NavigationGuardFn = () => Promise<boolean>;

/**
 * 目前登記中的守門函式集合（模組層單例）。
 * 用 Set 以支援理論上多個並存的守門（實務多為 0 或 1 個）。
 */
const registeredGuards = new Set<NavigationGuardFn>();

/**
 * 登記一個導頁守門函式。
 *
 * @param guard 導頁前要徵詢的確認函式（回傳是否放行）。
 * @returns 解除登記用的清理函式（通常放進 useEffect 的回傳值）。
 */
export function registerNavigationGuard(guard: NavigationGuardFn): () => void {
  registeredGuards.add(guard);
  return () => {
    registeredGuards.delete(guard);
  };
}

/**
 * 在導頁前徵詢所有已登記的守門是否放行。
 *
 * 任一守門回傳 false（使用者選擇不離開）即中止，回傳 false；
 * 全部放行（或無任何守門登記）才回傳 true。
 *
 * @returns 是否可放行導頁。
 */
export async function confirmNavigation(): Promise<boolean> {
  // 逐一徵詢；一旦有守門否決就立刻中止（不再問其餘守門，避免連續多個對話框）。
  // 取快照迭代，避免守門在 await 期間增減集合造成的迭代問題。
  for (const guard of Array.from(registeredGuards)) {
    // eslint-disable-next-line no-await-in-loop -- 需序列詢問：前一個否決就不該再問下一個
    const canLeave = await guard();
    if (!canLeave) return false;
  }
  return true;
}
