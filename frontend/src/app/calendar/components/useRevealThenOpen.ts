import { useCallback, useEffect, useState } from "react";

/**
 * 行事曆任務條的「點一下先放大看完整標題、點第二下才開任務」互動（週/月視圖任務格常太窄）。
 *
 * 行為：
 * - 點某任務條時，若它的標題**有被截斷**（放不下）且目前不是放大中 → 只放大（顯示完整標題），不開任務。
 * - 標題本來就看得完整、或已是放大中的那條再點一次 → 開任務。
 * - 點別處（非任務條）或捲動 → 收起放大。
 *
 * 桌機、觸控皆適用（都是「點擊」語意；桌機原本的 hover title 仍在）。
 *
 * @param onTaskClick 真正開任務的回呼（第二下或未截斷時呼叫）。
 * @returns revealedId＝目前放大中的任務 id；handleTaskClick(id, el)＝任務條點擊處理。
 */
export function useRevealThenOpen(onTaskClick?: (taskId: string) => void) {
  const [revealedId, setRevealedId] = useState<string | null>(null);

  const handleTaskClick = useCallback(
    (taskId: string, el: HTMLElement) => {
      // scrollWidth > clientWidth ＝ 水平方向被 ellipsis 截斷；多行時以 scrollHeight 判斷。
      // 有些視圖（時間格）的 nowrap/ellipsis 在「內層子元素」上，外層量不到 → 一併檢查後代。
      const isTrunc = (e: Element) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1;
      const truncated = isTrunc(el) || Array.from(el.querySelectorAll('*')).some(isTrunc);
      if (truncated && revealedId !== taskId) {
        setRevealedId(taskId); // 第一下：放大看完整標題
      } else {
        onTaskClick?.(taskId); // 未截斷 或 已放大中 → 開任務
        setRevealedId(null);
      }
    },
    [revealedId, onTaskClick]
  );

  // 放大中時：點任何「非任務條」的地方 → 收起。用 capture 以先於任務條自身的 onClick 判斷。
  useEffect(() => {
    if (!revealedId) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("[data-cal-task]")) return; // 點在任務條上 → 交給它的 onClick 決定
      setRevealedId(null);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [revealedId]);

  return { revealedId, handleTaskClick };
}
