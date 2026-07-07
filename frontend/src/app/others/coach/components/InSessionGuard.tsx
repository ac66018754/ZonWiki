"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ConfirmProvider";

/**
 * 對話進行中的離開守衛（計畫 §6）。
 *  - 關頁/重整：beforeunload 原生確認。
 *  - 站內連結導航：capture 階段攔截 <a> 點擊，以樣式化 confirm 詢問後才放行（router.push）。
 *  - visibilitychange：切到背景/回前景時呼叫回呼（工作區據此暫停/恢復麥克風與播放）。
 *
 * 註：瀏覽器「上一頁」(popstate) 因需 re-push history 易造成導航迴圈，本版不攔（交接清單已列），
 * 以 beforeunload＋連結攔截覆蓋最常見的離開路徑。
 *
 * @param active 對話是否進行中（false 時完全不介入）。
 * @param onHidden 切到背景的回呼。
 * @param onVisible 回到前景的回呼。
 */
export function InSessionGuard({
  active,
  onHidden,
  onVisible,
}: {
  active: boolean;
  onHidden?: () => void;
  onVisible?: () => void;
}): null {
  const confirm = useConfirm();
  const router = useRouter();

  // 關頁/重整確認。
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // 現代瀏覽器忽略自訂字串，設 returnValue 即觸發原生確認。
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [active]);

  // visibilitychange：暫停/恢復。
  useEffect(() => {
    if (!active) return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") onHidden?.();
      else onVisible?.();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [active, onHidden, onVisible]);

  // 站內連結導航攔截（capture 階段）。
  useEffect(() => {
    if (!active) return;
    const onClick = (e: MouseEvent) => {
      // 只攔主鍵、無修飾鍵的一般點擊（讓 Ctrl/Cmd＋點擊照常開新分頁）。
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest?.("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      if (anchor.target === "_blank") return;

      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return; // 外部連結放行
      if (url.pathname.startsWith("/others/coach")) return; // 留在本頁

      e.preventDefault();
      e.stopPropagation();
      void confirm({
        message: "對話進行中，離開將結束這次教練對話。確定離開？",
        danger: true,
      }).then((ok) => {
        if (ok) router.push(url.pathname + url.search);
      });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [active, confirm, router]);

  return null;
}
