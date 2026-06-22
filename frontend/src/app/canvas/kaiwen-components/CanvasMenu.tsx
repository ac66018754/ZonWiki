"use client";

import { useEffect, useRef, useState } from "react";
import type { CanvasDto } from "../kaiwen-types";

/**
 * 畫布切換選單：顯示目前畫布名稱，點開可切換到其他畫布，並把「改名 / 刪除此畫布」
 * 收攏在選單底部，讓工具列不再散落多顆畫布管理按鈕（對齊開問啦原版 CanvasMenu）。
 */
export function CanvasMenu({
  canvases,
  canvasId,
  onSelect,
  onRename,
  onDelete,
}: {
  canvases: CanvasDto[];
  canvasId: string | null;
  onSelect: (id: string) => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [open]);

  const current = canvases.find((c) => c.Canvas_Id === canvasId);

  return (
    <div className="kw-canvasmenu" ref={ref}>
      <button
        className="kw-btn kw-canvasmenu-trigger"
        onClick={() => setOpen((v) => !v)}
        data-testid="canvas-menu"
        title="切換 / 管理畫布"
      >
        <span className="kw-canvasmenu-title">{current?.Canvas_Title ?? "選擇畫布…"}</span>
        <span className="kw-canvasmenu-caret">▾</span>
      </button>

      {open && (
        <div className="kw-popover kw-canvasmenu-panel" data-testid="canvas-menu-panel">
          <div className="kw-canvasmenu-list">
            {canvases.length === 0 && <div className="kw-canvasmenu-empty">尚無畫布</div>}
            {canvases.map((c) => (
              <button
                key={c.Canvas_Id}
                className={`kw-canvasmenu-item ${c.Canvas_Id === canvasId ? "kw-canvasmenu-item--active" : ""}`}
                onClick={() => {
                  onSelect(c.Canvas_Id);
                  setOpen(false);
                }}
              >
                {c.Canvas_Id === canvasId ? "✓ " : "　"}
                {c.Canvas_Title}
              </button>
            ))}
          </div>
          {canvasId && (
            <div className="kw-canvasmenu-actions">
              <button
                className="kw-canvasmenu-item"
                onClick={() => {
                  setOpen(false);
                  onRename();
                }}
                data-testid="rename-canvas"
              >
                ✎ 改名
              </button>
              <button
                className="kw-canvasmenu-item kw-canvasmenu-item--danger"
                onClick={() => {
                  setOpen(false);
                  onDelete();
                }}
                data-testid="delete-canvas"
              >
                🗑 刪除此畫布
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
