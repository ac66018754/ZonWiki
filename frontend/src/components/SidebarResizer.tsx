"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * 左側欄「可隱藏 + 可拖曳調寬」控制器。
 *
 * - 在側欄右緣放一條可拖曳的 bar（cursor: col-resize），拖動即時改變寬度（字多時可拉寬好看）。
 * - 提供隱藏鈕（«）把整個側欄收起、主內容滿版；收起後左緣浮出展開鈕（»）。
 * - 寬度/隱藏狀態存 localStorage；以 CSS 變數 --sidebar-width 與 html[data-sidebar-hidden]
 *   同時驅動 .sidebar 與 .main-content（兩者本來就吃這個變數），故不需改 Sidebar 內容元件。
 * - 只在「有左側欄的頁面」顯示（首頁、開問啦、登入頁無側欄）。
 */
const MIN_WIDTH = 180;
const MAX_WIDTH = 560;
const DEFAULT_WIDTH = 260;
const LS_WIDTH = "zonwiki:sidebarWidth";
const LS_HIDDEN = "zonwiki:sidebarHidden";

export function SidebarResizer() {
  const pathname = usePathname();
  const [hidden, setHidden] = useState(false);
  const [dragging, setDragging] = useState(false);
  const widthRef = useRef(DEFAULT_WIDTH);

  // 沒有左側欄的頁面不顯示控制器（首頁、開問啦、登入、垃圾桶皆為滿版無側欄）
  const hasSidebar =
    pathname !== "/" &&
    pathname !== "/canvas" &&
    pathname !== "/login" &&
    pathname !== "/trash";

  // 套用寬度到 CSS 變數
  const applyWidth = useCallback((w: number) => {
    const clamped = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(w)));
    widthRef.current = clamped;
    document.documentElement.style.setProperty("--sidebar-width", `${clamped}px`);
  }, []);

  // 初始化：從 localStorage 載入寬度/隱藏狀態
  useEffect(() => {
    try {
      const savedW = Number(localStorage.getItem(LS_WIDTH));
      if (savedW && !Number.isNaN(savedW)) applyWidth(savedW);
      else applyWidth(DEFAULT_WIDTH);
      // 掛載時一次性從 localStorage 還原收合狀態（外部狀態同步，非級聯渲染）。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHidden(localStorage.getItem(LS_HIDDEN) === "1");
    } catch {
      applyWidth(DEFAULT_WIDTH);
    }
  }, [applyWidth]);

  // 同步隱藏狀態到 html data 屬性
  useEffect(() => {
    document.documentElement.toggleAttribute("data-sidebar-hidden", hidden);
    try { localStorage.setItem(LS_HIDDEN, hidden ? "1" : "0"); } catch {}
  }, [hidden]);

  // 拖曳調寬
  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    setDragging(true);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    const move = (ev: PointerEvent) => applyWidth(ev.clientX);
    const up = () => {
      setDragging(false);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      try { localStorage.setItem(LS_WIDTH, String(widthRef.current)); } catch {}
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // 鍵盤可調寬（無障礙）
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") { applyWidth(widthRef.current - 16); try { localStorage.setItem(LS_WIDTH, String(widthRef.current)); } catch {} }
    if (e.key === "ArrowRight") { applyWidth(widthRef.current + 16); try { localStorage.setItem(LS_WIDTH, String(widthRef.current)); } catch {} }
  };

  if (!hasSidebar) return null;

  return (
    <>
      {/* 拖曳調寬 bar（側欄右緣） */}
      <div
        className={`sidebar-resizer${dragging ? " sidebar-resizer--dragging" : ""}`}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        role="separator"
        aria-orientation="vertical"
        aria-label="拖曳調整側欄寬度"
        tabIndex={0}
        title="拖曳調整寬度"
      />
      {/* 隱藏鈕（側欄內側） */}
      <button
        className="sidebar-toggle sidebar-toggle--hide"
        onClick={() => setHidden(true)}
        aria-label="隱藏側欄"
        title="隱藏側欄"
      >
        «
      </button>
      {/* 展開鈕（隱藏時浮在最左） */}
      <button
        className="sidebar-toggle sidebar-toggle--show"
        onClick={() => setHidden(false)}
        aria-label="展開側欄"
        title="展開側欄"
      >
        »
      </button>
    </>
  );
}
