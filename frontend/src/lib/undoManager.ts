'use client';

import { useEffect } from 'react';

/**
 * 筆記頁共用的「復原 / 重做」管理器（單一來源）。
 *
 * 為何需要：筆記預覽同時有「手繪塗鴉」(NoteOverlay) 與「畫重點」(NoteMarksLayer) 兩種可復原操作，
 * 若各自掛 Ctrl+Z 監聽會互搶。改由此模組維護「單一動作堆疊」，
 * 兩者都把動作 push 進來，並由筆記頁掛「唯一一個」鍵盤監聽 → 依最近動作復原 / 重做。
 *
 * 每個動作以 undo()/redo() 兩個閉包表示（可為 async）。閉包應透過「最新狀態的 ref」操作，
 * 不要在閉包內鎖死過時的物件（例如尚未建立的繪圖項目）。
 */
export interface UndoAction {
  /** 復原此動作。 */
  undo: () => void | Promise<void>;
  /** 重做此動作。 */
  redo: () => void | Promise<void>;
}

let undoStack: UndoAction[] = [];
let redoStack: UndoAction[] = [];

// 串行化執行佇列：避免使用者連按 Ctrl+Z 時多個 async 動作併發互相干擾（重抓 / 寫入競態）。
// pop() 在鏈內執行（而非呼叫當下），故順序穩定、不會同時跑兩個動作。
let opChain: Promise<void> = Promise.resolve();

/** 推入一個新動作（清空 redo 堆疊；上限 100 步）。 */
export function pushUndo(action: UndoAction): void {
  undoStack.push(action);
  if (undoStack.length > 100) undoStack.shift();
  redoStack = [];
}

/** 是否可復原 / 重做。 */
export function canUndo(): boolean {
  return undoStack.length > 0;
}
export function canRedo(): boolean {
  return redoStack.length > 0;
}

/** 執行復原（串行化；把該動作移到 redo 堆疊）。 */
export function performUndo(): Promise<void> {
  opChain = opChain.then(async () => {
    const a = undoStack.pop();
    if (!a) return;
    await a.undo();
    redoStack.push(a);
  });
  return opChain;
}

/** 執行重做（串行化；把該動作移回 undo 堆疊）。 */
export function performRedo(): Promise<void> {
  opChain = opChain.then(async () => {
    const a = redoStack.pop();
    if (!a) return;
    await a.redo();
    undoStack.push(a);
  });
  return opChain;
}

/** 清空堆疊（切換筆記時呼叫，避免跨筆記復原）。 */
export function resetUndo(): void {
  undoStack = [];
  redoStack = [];
}

/**
 * 在某個範圍生效時，掛上「唯一一個」Ctrl+Z / Ctrl+Y（或 Ctrl+Shift+Z）鍵盤監聽。
 * 在輸入框 / 文字區 / contentEditable 內時不攔截（交給原生文字復原）。
 * @param active 是否啟用（例如僅在筆記預覽分頁）。
 */
export function useUndoHotkeys(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      const isRedo = k === 'y' || (k === 'z' && e.shiftKey);
      const isUndo = k === 'z' && !e.shiftKey;
      if (isUndo && canUndo()) {
        e.preventDefault();
        performUndo();
      } else if (isRedo && canRedo()) {
        e.preventDefault();
        performRedo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);
}
