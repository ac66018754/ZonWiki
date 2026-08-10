"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { confirmNavigation } from "@/lib/navigationGuard";
import {
  type MouseNavAnchor,
  type MouseNavState,
  canGoBack,
  canGoForward,
  goBack,
  goForward,
  isBackButton,
  isForwardButton,
  loadState,
  recordAnchor,
  saveState,
} from "@/lib/mouseNav";

/**
 * VS 風格「滑鼠側鍵錨點導航」執行器（無 UI，回傳 null）。掛在已登入外殼中、
 * ShortcutRuntime 旁（因用到 useSearchParams，外層需包 Suspense）。
 *
 * 行為：
 * - 左鍵 pointerdown ＝ 下錨（目前路由＋捲動位置）；路由（含 search）變更也下錨。
 * - 滑鼠側鍵（button 3 上一頁／4 下一頁）在錨點堆疊中穿梭，取代瀏覽器歷史——
 *   Chromium 151 實測：preventDefault `pointerup`（或 `mouseup`）即可攔下側鍵的
 *   歷史導航；`mousedown`/`pointerdown`/`auxclick` 單獨攔無效，且攔 pointerdown
 *   會使相容性 mouse 事件整組消失，故本元件以 pointerup 為行動點、
 *   mouseup/auxclick 只作保險絲。
 * - 堆疊不可移動時「不攔」：放行瀏覽器原生歷史，使用者仍可用側鍵離開網站。
 * - 跨路由移動前先過 confirmNavigation()（筆記編輯未存守門），拒絕則零副作用。
 * - 捲動還原多次重試（0/150/400/900ms）且每次重新查容器（內文重掛也有效）；
 *   使用者輸入（滾輪/點擊/鍵盤）即取消——不跟使用者搶捲動。
 *   時序上晚於筆記頁自身 250ms 的「續讀」還原，錨點位置優先。
 *
 * 防護邊界（明知而為的取捨）：只攔「滑鼠側鍵」這一種輸入。鍵盤 Alt+←/→、
 * 觸控板兩指滑動手勢仍走瀏覽器原生歷史（不經此堆疊、也不經導頁守門）。
 * 開問啦畫布頁的位置＝viewport 平移非捲動，錨點只還原路由、不還原視角。
 */
export function MouseNavRuntime() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  // search 以字串參與 effect 依賴（URLSearchParams 物件每次 render 都是新識別，不可直接當依賴）。
  const searchKey = searchParams?.toString() ?? "";

  // 以 ref 保存可變狀態，事件監聽器只註冊一次（參考 ShortcutRuntime 的模式）。
  const routerRef = useRef(router);
  routerRef.current = router;
  /** 錨點堆疊（懶載入：首次使用時才讀 sessionStorage）。 */
  const stateRef = useRef<MouseNavState | null>(null);
  /** 跨路由移動後待還原的目標（帶時間戳，逾時即棄用，避免旗標永久卡住）。 */
  const pendingRestoreRef = useRef<{ target: MouseNavAnchor; setAt: number } | null>(null);
  /** 跨路由導航進行中（confirm → push → 路由變更 effect 之間）：吞掉側鍵連按。 */
  const navigatingRef = useRef(false);
  /** 保險絲：pointerup 對本次側鍵按壓的處置結果，供 mouseup/auxclick 決定是否跟著攔。 */
  const fuseRef = useRef<{ button: number; handled: boolean } | null>(null);
  /** 取消目前排程中的捲動還原（新動作／使用者輸入時呼叫）。 */
  const cancelRestoreRef = useRef<(() => void) | null>(null);

  /** 取得堆疊（首次呼叫時從 sessionStorage 載入）。 */
  const getState = (): MouseNavState => {
    if (stateRef.current === null) stateRef.current = loadState();
    return stateRef.current;
  };

  /** 提交新堆疊：更新 ref＋寫回 sessionStorage。 */
  const commit = (state: MouseNavState): void => {
    stateRef.current = state;
    saveState(state);
  };

  /**
   * 排程捲動還原：多次嘗試（內容非同步載入會撐版、筆記頁自身 250ms 續讀會蓋位置，
   * 故最後幾次須晚於它們）；每次都重新查容器（不快取節點，內文重掛也有效）；
   * 使用者輸入即取消剩餘嘗試。
   */
  const scheduleRestore = (scrollTop: number): void => {
    cancelRestoreRef.current?.();
    const timers: number[] = [];
    const cleanup = () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.removeEventListener("wheel", onUserInput, true);
      window.removeEventListener("pointerdown", onUserInput, true);
      window.removeEventListener("keydown", onUserInput, true);
      cancelRestoreRef.current = null;
    };
    const onUserInput = () => cleanup();
    cancelRestoreRef.current = cleanup;
    window.addEventListener("wheel", onUserInput, { capture: true, passive: true });
    window.addEventListener("pointerdown", onUserInput, true);
    window.addEventListener("keydown", onUserInput, true);
    for (const delay of RESTORE_DELAYS_MS) {
      timers.push(
        window.setTimeout(() => {
          const el = resolveScrollContainer();
          if (el) el.scrollTop = scrollTop;
          if (delay === RESTORE_DELAYS_MS[RESTORE_DELAYS_MS.length - 1]) cleanup();
        }, delay),
      );
    }
  };

  /** 執行一次側鍵移動（上一頁/下一頁）。 */
  const runSideAction = (direction: "back" | "forward"): void => {
    const live: MouseNavAnchor = { route: currentRoute(), scrollTop: readScrollTop() };
    const result = direction === "back" ? goBack(getState(), live) : goForward(getState(), live);
    if (!result) return;
    const { target } = result;

    if (target.route === live.route) {
      // 同路由：直接還原捲動位置（同步完成，無需守門）。
      commit(result.state);
      scheduleRestore(target.scrollTop);
      return;
    }

    // 跨路由：先過導頁守門；期間吞掉連按。拒絕／失敗時零副作用（state 不 commit、不 push）。
    navigatingRef.current = true;
    // 安全網「當下」就排程（不可排在 push 之後）：守門 reject、push 拋錯、或路由變更
    // effect 遲遲未發生時，逾時自行解除 in-flight——否則側鍵會整個 session 靜默失效
    //（對抗復審 HIGH 抓到的卡死路徑）。
    window.setTimeout(() => {
      navigatingRef.current = false;
    }, PENDING_RESTORE_TIMEOUT_MS);
    void confirmNavigation()
      .then((canLeave) => {
        if (!canLeave) {
          navigatingRef.current = false;
          return;
        }
        try {
          pendingRestoreRef.current = { target, setAt: Date.now() };
          routerRef.current.push(target.route);
          // push 成功送出才 commit：若 push 同步拋錯，堆疊留在原地、下一次按壓可重試。
          commit(result.state);
        } catch {
          pendingRestoreRef.current = null;
          navigatingRef.current = false;
        }
      })
      .catch(() => {
        // 守門本身 reject（守門函式拋錯等）：視同拒絕，解除 in-flight。
        navigatingRef.current = false;
      });
  };

  // 路由（pathname 或 search）變更：若是我方導航抵達 → 還原捲動、不重複下錨；
  // 否則把新位置記為錨點。首次掛載也會執行（初始頁成為第一個錨點）。
  useEffect(() => {
    const route = currentRoute();
    const pending = pendingRestoreRef.current;
    pendingRestoreRef.current = null;
    navigatingRef.current = false;
    if (
      pending &&
      pending.target.route === route &&
      Date.now() - pending.setAt <= PENDING_RESTORE_TIMEOUT_MS
    ) {
      scheduleRestore(pending.target.scrollTop);
      return;
    }
    commit(recordAnchor(getState(), { route, scrollTop: readScrollTop() }));
  }, [pathname, searchKey]);

  // 滑鼠事件監聽（只註冊一次；capture 階段，避免被個別元件 stopPropagation 擋住）。
  useEffect(() => {
    /** 左鍵下錨。 */
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      commit(recordAnchor(getState(), { route: currentRoute(), scrollTop: readScrollTop() }));
    };

    /** 側鍵行動點：決定攔或放行，並記錄保險絲。 */
    const onPointerUp = (event: PointerEvent) => {
      const back = isBackButton(event);
      const forward = isForwardButton(event);
      if (!back && !forward) return;
      let handled: boolean;
      if (navigatingRef.current) {
        // 導航進行中：吞掉連按（仍攔住瀏覽器，避免亂跳），不重複執行。
        handled = true;
      } else {
        handled = back ? canGoBack(getState()) : canGoForward(getState());
        if (handled) runSideAction(back ? "back" : "forward");
        // 不可移動 → 不攔：放行瀏覽器原生歷史（堆疊見底時側鍵仍可離開網站）。
      }
      fuseRef.current = { button: event.button, handled };
      if (handled) event.preventDefault();
    };

    /**
     * 保險絲：同一次按壓的 mouseup/auxclick 跟隨 pointerup 的處置
     * （Chromium 對 pointerup「或」mouseup 任一 preventDefault 都會取消導航；
     * 兩者都攔是雙保險）。事件順序保證 pointerup 先於 mouseup/auxclick，
     * 故每次按壓的旗標都會先被 pointerup 覆寫，不會殘留誤判。
     */
    const onFuse = (event: MouseEvent) => {
      if (!isBackButton(event) && !isForwardButton(event)) return;
      const fuse = fuseRef.current;
      if (fuse && fuse.button === event.button && fuse.handled) event.preventDefault();
    };

    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("mouseup", onFuse, true);
    window.addEventListener("auxclick", onFuse, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("mouseup", onFuse, true);
      window.removeEventListener("auxclick", onFuse, true);
      cancelRestoreRef.current?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 監聽器只註冊一次，內部一律經 ref 讀最新值
  }, []);

  return null;
}

/** 捲動還原的重試時點（ms）：最後兩次晚於筆記頁自身 250ms 的續讀還原，錨點優先。 */
const RESTORE_DELAYS_MS = [0, 150, 400, 900];

/** pendingRestore／in-flight 旗標的逾時（ms）：路由變更遲遲未發生時自行失效。 */
const PENDING_RESTORE_TIMEOUT_MS = 2000;

/** 目前路由（pathname + search；即時讀 window.location，避免 hook 值與事件時點脫節）。 */
function currentRoute(): string {
  return window.location.pathname + window.location.search;
}

/**
 * 解析目前頁的捲動容器：筆記閱覽頁自己是捲動容器（.note-detail-page），
 * 其餘頁面捲動發生在 .main-content（globals.css）。每次都重新查詢、不快取，
 * 因為筆記內文區會因編輯彈窗／切分頁而卸載重掛。
 * @returns 捲動容器元素；都找不到時回 null（還原成為無害的 no-op）。
 */
function resolveScrollContainer(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>(".note-detail-page") ??
    document.querySelector<HTMLElement>(".main-content")
  );
}

/** 讀取目前捲動位置（找不到容器時視為 0）。 */
function readScrollTop(): number {
  return resolveScrollContainer()?.scrollTop ?? 0;
}
