"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

/**
 * 開問啦工具列「跨元件插槽」。
 *
 * 用途：讓 /canvas 的 KaiWenCanvas 把它的工具列(切換畫布/視圖/設定/垃圾桶…)
 * 「上送」到全站 Header 顯示，免去開問啦自己的第二列標題，使畫布高度與原版一致。
 *
 * 為何用 Context 而非 DOM portal：portal 注入到 <Suspense> 內的 Header 節點，
 * 在 React 19 hydration 時該子樹會被重建、portal 目標節點失效 → 工具列消失 (#418)。
 * 用 Context 由 Header 自己在 React 樹內渲染 node，初始為 null(與 SSR 一致)，
 * 掛載後才由 KaiWenCanvas 設值，無 hydration 不一致。
 */
interface CanvasToolbarContextValue {
  /** 目前要顯示在 Header 的工具列內容（非 /canvas 時為 null）。 */
  node: ReactNode;
  /** 設定/清除工具列內容。 */
  setNode: (node: ReactNode) => void;
}

const CanvasToolbarContext = createContext<CanvasToolbarContextValue>({
  node: null,
  setNode: () => {},
});

/**
 * Provider：包在 layout 內，讓 Header 與頁面(KaiWenCanvas)共享工具列插槽狀態。
 */
export function CanvasToolbarProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<ReactNode>(null);
  return (
    <CanvasToolbarContext.Provider value={{ node, setNode }}>
      {children}
    </CanvasToolbarContext.Provider>
  );
}

/**
 * 取用工具列插槽：Header 讀 node 來渲染；KaiWenCanvas 用 setNode 上送/清除。
 */
export function useCanvasToolbar(): CanvasToolbarContextValue {
  return useContext(CanvasToolbarContext);
}
