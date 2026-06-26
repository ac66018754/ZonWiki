"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface Position {
  x: number;
  y: number;
}

const EDGE = 8;
const STORAGE_PREFIX = "zonwiki:panel:";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function readStored(key: string): Position | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Position>;
    if (typeof parsed.x === "number" && typeof parsed.y === "number") {
      return { x: parsed.x, y: parsed.y };
    }
  } catch {
    /* corrupt or unavailable storage — fall back to default */
  }
  return null;
}

interface DragOrigin {
  pointerX: number;
  pointerY: number;
  posX: number;
  posY: number;
}

/**
 * Pointer-based dragging for a floating panel. Position is constrained to the
 * viewport and persisted to localStorage under a stable key. Hydration is
 * deferred to the client to avoid SSR markup mismatches.
 */
export function useDraggable(
  key: string,
  defaultPos: Position,
  options?: { persist?: boolean },
) {
  // persist=false：不讀也不寫 localStorage —— 每次掛載都用 defaultPos（例如章節目錄表，
  // 不要記憶上次被拖到的位置，避免「每次打開都壓在某處」）。
  const persist = options?.persist !== false;
  const [pos, setPos] = useState<Position>(defaultPos);
  const [dragging, setDragging] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const origin = useRef<DragOrigin | null>(null);
  const defaultRef = useRef(defaultPos);

  const constrain = useCallback((next: Position): Position => {
    const el = panelRef.current;
    const w = el?.offsetWidth ?? 280;
    const h = el?.offsetHeight ?? 200;
    return {
      x: clamp(next.x, EDGE, window.innerWidth - w - EDGE),
      y: clamp(next.y, EDGE, window.innerHeight - h - EDGE),
    };
  }, []);

  // Hydrate from storage (or default) after mount, snapped onto the viewport.
  // localStorage is client-only, so this deliberately runs as a post-mount
  // pass to keep the SSR and first client render identical.
  useEffect(() => {
    const stored = persist ? readStored(key) : null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional one-time client hydration
    setPos(constrain(stored ?? defaultRef.current));
    setHydrated(true);
  }, [key, constrain, persist]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      origin.current = {
        pointerX: e.clientX,
        pointerY: e.clientY,
        posX: pos.x,
        posY: pos.y,
      };
      setDragging(true);
    },
    [pos.x, pos.y],
  );

  useEffect(() => {
    if (!dragging) return;

    function onMove(e: PointerEvent) {
      const start = origin.current;
      if (!start) return;
      setPos(
        constrain({
          x: start.posX + (e.clientX - start.pointerX),
          y: start.posY + (e.clientY - start.pointerY),
        }),
      );
    }
    function onUp() {
      setDragging(false);
      origin.current = null;
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging, constrain]);

  // Persist resting position; keep panels on-screen across viewport resizes.
  useEffect(() => {
    if (!persist || !hydrated || dragging) return;
    try {
      window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(pos));
    } catch {
      /* storage full or blocked — position simply won't persist */
    }
  }, [pos, hydrated, dragging, key, persist]);

  useEffect(() => {
    if (!hydrated) return;
    function onResize() {
      setPos((current) => constrain(current));
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [hydrated, constrain]);

  return { pos, dragging, hydrated, panelRef, onPointerDown };
}
