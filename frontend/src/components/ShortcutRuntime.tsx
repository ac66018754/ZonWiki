"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  SHORTCUT_ACTIONS,
  type ShortcutAction,
  type ShortcutOverrides,
  effectiveKey,
  loadShortcutOverrides,
  SHORTCUTS_UPDATED_EVENT,
  SHORTCUT_ACTION_EVENT,
} from "@/lib/shortcuts";

/**
 * 全域快捷鍵執行器（無 UI，回傳 null）。掛在已登入外殼中。
 *
 * 行為：
 * - 載入使用者的鍵位覆寫（含模組層快取），建立 key→action 對應表；
 *   覆寫更新時（SHORTCUTS_UPDATED_EVENT）即時重建。
 * - 監聽 window keydown：
 *   - 正在輸入（input/textarea/select/contentEditable）或按住 Ctrl/Cmd/Alt → 不觸發。
 *   - global 動作：直接執行（導覽 / 聚焦搜尋）。
 *   - tasks 動作：僅在 /tasks 派發 SHORTCUT_ACTION_EVENT，交給 Todo 頁自行處理。
 *
 * 用 ref 保存最新 pathname 與 keymap，故 keydown 監聽器只註冊一次、不會反覆拆裝
 * （參考 CLAUDE.md #21：參考不穩定→迴圈）。
 */
export function ShortcutRuntime() {
  const pathname = usePathname();
  const router = useRouter();

  // 以 ref 保存最新值，供「只註冊一次」的 keydown 監聽器讀取。
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const routerRef = useRef(router);
  routerRef.current = router;
  const keymapRef = useRef<Map<string, ShortcutAction>>(new Map());

  // 依覆寫重建 key→action 對應表。
  const rebuild = (overrides: ShortcutOverrides) => {
    const map = new Map<string, ShortcutAction>();
    for (const action of SHORTCUT_ACTIONS) {
      map.set(effectiveKey(action, overrides), action);
    }
    keymapRef.current = map;
  };

  // 載入覆寫並建表；監聽覆寫更新事件以即時套用。
  useEffect(() => {
    let alive = true;
    loadShortcutOverrides().then((overrides) => {
      if (alive) rebuild(overrides);
    });
    const onUpdated = () => {
      loadShortcutOverrides(true).then((overrides) => rebuild(overrides));
    };
    window.addEventListener(SHORTCUTS_UPDATED_EVENT, onUpdated);
    return () => {
      alive = false;
      window.removeEventListener(SHORTCUTS_UPDATED_EVENT, onUpdated);
    };
  }, []);

  // 全域 keydown 監聽（只註冊一次）。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // 保留瀏覽器 / 系統快捷鍵；只處理「純單鍵」。
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : "";
      if (!key) return;

      const action = keymapRef.current.get(key);
      if (!action) return;

      if (action.scope === "global") {
        event.preventDefault();
        runGlobalAction(action.id, routerRef.current);
        return;
      }

      // tasks 動作：僅在 Todo 頁觸發，交給該頁處理。
      if (action.scope === "tasks") {
        if (!(pathRef.current ?? "").startsWith("/tasks")) return;
        event.preventDefault();
        window.dispatchEvent(
          new CustomEvent(SHORTCUT_ACTION_EVENT, { detail: { actionId: action.id } })
        );
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return null;
}

/** 是否聚焦於輸入元素（此時不觸發快捷鍵，避免吃掉打字）。 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

/** 顯示主題循環順序（與 Header 一致）。 */
const THEME_ORDER = ["warmpaper", "light", "dark", "night"] as const;

/** 事件：主題已由快捷鍵切換 → 通知 Header 等同步顯示。 */
export const THEME_CHANGED_EVENT = "zonwiki:theme-changed";

/** 切換到下一個顯示主題（暖紙→明亮→暗色→夜間→暖紙），並廣播事件讓 Header 同步。 */
function cycleTheme(): void {
  const current = document.documentElement.getAttribute("data-theme") ?? "warmpaper";
  const idx = THEME_ORDER.indexOf(current as (typeof THEME_ORDER)[number]);
  const next = THEME_ORDER[(idx + 1) % THEME_ORDER.length];
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem("zonwiki:theme", next);
  } catch {
    /* localStorage 不可用時忽略 */
  }
  window.dispatchEvent(new CustomEvent(THEME_CHANGED_EVENT, { detail: { theme: next } }));
}

/** 執行 global 範圍的動作（導覽 / 聚焦搜尋 / 切換主題）。 */
function runGlobalAction(id: string, router: ReturnType<typeof useRouter>): void {
  switch (id) {
    case "openHome":
      router.push("/");
      break;
    case "openTasks":
      router.push("/tasks");
      break;
    case "openCanvas":
      router.push("/canvas");
      break;
    case "openNotes":
      router.push("/notes");
      break;
    case "focusSearch": {
      const input = document.querySelector<HTMLInputElement>('input[aria-label="全域搜尋"]');
      input?.focus();
      break;
    }
    case "cycleTheme":
      cycleTheme();
      break;
  }
}
