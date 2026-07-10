/**
 * 捲動到某個浮層元件（便利貼 / T 文字框）並短暫高亮。
 *
 * 供兩處共用（DRY）：
 * 1. 筆記頁的 `?overlay=` 捲動定位 effect（搜尋結果 / 問題清單頁跳轉進來）。
 * 2. 筆記頁「問題清單面板」點列項目時的就地定位。
 *
 * 浮層資料是「非同步載入」（NoteOverlay 掛載後才 fetch），故採「延遲首試 + 找不到就重試」直到 item 的
 * DOM 出現為止。pinned（position:fixed）者不捲動、只閃爍；非 pinned（absolute，隨內文捲動）者捲到視野中央再閃爍。
 *
 * @param overlayId 目標浮層元件的 id（對應 DOM 的 data-overlay-id）。
 * @returns 清理函式：取消尚未完成的重試與高亮清除計時器（供 useEffect 的 cleanup 使用；直接呼叫時可忽略）。
 */
export function scrollToOverlayItem(overlayId: string): () => void {
  let cancelled = false;
  let attempts = 0;
  const maxAttempts = 20; // 最多重試 20 次（約 5 秒）
  const retryDelayMs = 250; // 每次重試間隔
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let cleanupTimer: ReturnType<typeof setTimeout> | null = null;

  const tryLocate = () => {
    if (cancelled) return;

    // 浮層 item 外層 wrapper 帶 data-overlay-id；pinned（fixed）者以 portal 掛到 body，
    // 故在整份文件（而非只在內文區）內尋找。
    const el = document.querySelector(
      `[data-overlay-id="${CSS.escape(overlayId)}"]`
    ) as HTMLElement | null;

    if (!el) {
      attempts += 1;
      if (attempts < maxAttempts) {
        retryTimer = setTimeout(tryLocate, retryDelayMs);
      }
      return;
    }

    // pinned 浮層為 position:fixed（釘在畫面上、不隨內文捲動）→ 只閃爍高亮；
    // 非 pinned（absolute，隨內文捲動）→ 捲動到視野中央再高亮。
    const isFixed = window.getComputedStyle(el).position === 'fixed';
    if (!isFixed) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // 短暫高亮脈衝（琥珀色外框；四主題皆清楚。outline 不受 overflow:hidden 裁切）。
    el.style.outline = '3px solid transparent';
    el.style.outlineOffset = '3px';
    el.style.animation = 'zonwiki-overlay-locate-flash 0.8s ease-out 0s 3';
    cleanupTimer = setTimeout(() => {
      el.style.animation = '';
      el.style.outline = '';
      el.style.outlineOffset = '';
    }, 2600);
  };

  // 首次延遲 300ms（等預覽 HTML 與浮層層掛載），之後交給 tryLocate 自行重試。
  retryTimer = setTimeout(tryLocate, 300);

  return () => {
    cancelled = true;
    if (retryTimer) clearTimeout(retryTimer);
    if (cleanupTimer) clearTimeout(cleanupTimer);
  };
}
