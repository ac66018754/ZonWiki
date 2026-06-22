"use client";

import { useEffect, useState } from "react";
import { useDraggable, type Position } from "@/hooks/useDraggable";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { ChevronIcon } from "./Icons";

interface FloatingPanelProps {
  /** Stable key for persisting position + collapsed state. */
  id: string;
  title: string;
  /** Desktop spawn position (viewport coordinates). */
  defaultPos: Position;
  width?: number;
  children: React.ReactNode;
}

/**
 * A panel that floats and is draggable on desktop, and docks inline on
 * narrow viewports. Position + collapsed state persist across navigations.
 */
export function FloatingPanel({
  id,
  title,
  defaultPos,
  width = 268,
  children,
}: FloatingPanelProps) {
  const isDesktop = useIsDesktop();
  const { pos, dragging, hydrated, panelRef, onPointerDown } = useDraggable(
    id,
    defaultPos,
  );
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(
        window.localStorage.getItem(`zonwiki:panel:${id}:collapsed`) === "1",
      );
    } catch {
      /* storage unavailable — start expanded */
    }
  }, [id]);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(
          `zonwiki:panel:${id}:collapsed`,
          next ? "1" : "0",
        );
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const className = [
    "panel",
    isDesktop ? "panel--floating" : "panel--docked",
    isDesktop && dragging ? "panel--dragging" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const style: React.CSSProperties | undefined = isDesktop
    ? {
        width,
        maxHeight: "min(76vh, 720px)",
        transform: `translate3d(${pos.x}px, ${pos.y}px, 0)${
          dragging ? " scale(1.012)" : ""
        }`,
        visibility: hydrated ? "visible" : "hidden",
      }
    : undefined;

  return (
    <div ref={panelRef} className={className} data-collapsed={collapsed} style={style}>
      <div className="panel__head">
        <div
          className="panel__grip"
          onPointerDown={isDesktop ? onPointerDown : undefined}
        >
          <span className="panel__dots" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span className="panel__title">{title}</span>
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? `展開 ${title}` : `收合 ${title}`}
        >
          <ChevronIcon size={15} className="panel__chevron" />
        </button>
      </div>
      <div className="panel__body scroll-thin">{children}</div>
    </div>
  );
}
