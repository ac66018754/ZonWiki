'use client';

import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';

/**
 * 全站 SWR 設定（客戶端資料快取）。
 *
 * 目的：讓「切走再切回某頁」直接吃快取、瞬間顯示，背景再靜默重抓，
 * 而不是每次導航都對（弱核）後端重打一次相同的 API。
 *
 * 設定取捨（目標：單人使用下「導航不重抓、資料變更才更新」，最大化降低後端負載）：
 * - revalidateIfStale=false：已有快取時，重新掛載（切走再切回某頁）不自動重抓，直接用快取。
 *   資料的新鮮度改由「使用者操作後主動 mutate」維持（各頁的新增/編輯/勾選都已呼叫對應 mutate）。
 *   → 切「任務→首頁→任務」時，task-cards 等共用快取只會抓一次，不再每次打後端。
 * - revalidateOnFocus=false：切回分頁不重抓（避免類似輪詢的額外負載）。
 * - dedupingInterval=10s：10 秒內對同一個 key 的重複請求只實際打一次（第一次載入的去重）。
 * - keepPreviousData=true：key 改變（例如切換筆記分類）時先沿用舊資料、避免畫面閃爍。
 * - errorRetryCount=2：失敗最多重試兩次，避免無限重試打爆後端。
 *
 * 取捨備註：因關閉了 stale 自動重抓，若資料被「本頁操作以外」的來源改動（例如外部 AI 經 MCP 寫入），
 * 需重新整理（F5）或觸發該頁的 reload 才會看到。單人、以 UI 為主的使用情境下，這是為了降低 VM 負載的刻意取捨；
 * 若日後想要更即時，可改回 revalidateIfStale=true（stale-while-revalidate：仍即時顯示快取、背景再抓新）。
 */
export function SwrProvider({ children }: { children: ReactNode }) {
  return (
    <SWRConfig
      value={{
        revalidateIfStale: false,
        revalidateOnFocus: false,
        dedupingInterval: 10_000,
        keepPreviousData: true,
        errorRetryCount: 2,
      }}
    >
      {children}
    </SWRConfig>
  );
}
