'use client';

import { useEffect, useState } from 'react';
import {
  SHORTCUT_ACTIONS,
  SHORTCUTS_UPDATED_EVENT,
  type ShortcutOverrides,
  effectiveKey,
  keyCapLabel,
  loadShortcutOverrides,
} from './shortcuts';

/**
 * 取得多個快捷鍵動作目前「生效鍵」的顯示用鍵帽（大寫），並在使用者改鍵後即時更新。
 *
 * 用途：工具列按鈕旁的快捷鍵提示（例如「T(6)」）。
 * - 首次渲染先回預設鍵（同步、不閃空白），載入使用者覆寫後套用實際生效鍵。
 * - 監聽 SHORTCUTS_UPDATED_EVENT（設定頁存檔後廣播）→ 強制重抓並更新。
 *
 * @param ids 要查詢的動作 id 清單（未知 id 會被忽略）。
 * @returns 動作 id → 顯示用鍵帽（大寫）的對應表。
 */
export function useShortcutKeyCaps(ids: readonly string[]): Record<string, string> {
  // ids 通常是呼叫端字面量陣列（每次渲染都是新參考）；以字串鍵穩定化，避免 effect 反覆重跑。
  const idsKey = ids.join('|');

  /** 依覆寫算出「id → 顯示鍵帽」對應表。 */
  const compute = (overrides: ShortcutOverrides): Record<string, string> => {
    const wanted = new Set(idsKey.split('|'));
    const out: Record<string, string> = {};
    for (const action of SHORTCUT_ACTIONS) {
      if (wanted.has(action.id)) out[action.id] = keyCapLabel(effectiveKey(action, overrides));
    }
    return out;
  };

  // 首次同步值：預設鍵（覆寫載入前的合理顯示；多數使用者沒改鍵，直接就是最終值）。
  const [caps, setCaps] = useState<Record<string, string>>(() => compute({}));

  useEffect(() => {
    let alive = true;
    const apply = (overrides: ShortcutOverrides) => {
      if (alive) setCaps(compute(overrides));
    };
    loadShortcutOverrides().then(apply);
    const onUpdated = () => {
      // 設定頁存檔後廣播 → 強制重抓（與 ShortcutRuntime 同步策略一致）。
      loadShortcutOverrides(true).then(apply);
    };
    window.addEventListener(SHORTCUTS_UPDATED_EVENT, onUpdated);
    return () => {
      alive = false;
      window.removeEventListener(SHORTCUTS_UPDATED_EVENT, onUpdated);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  return caps;
}
