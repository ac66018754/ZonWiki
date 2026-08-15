import type { DrawTool } from '@/lib/drawing/shapes';

/**
 * 浮層工具快捷鍵的「動作 id → 工具列指令」對應（單一事實來源）。
 *
 * ShortcutRuntime 只負責派發動作 id（SHORTCUT_ACTION_EVENT）；
 * 真正執行的兩端（筆記 NoteOverlay、畫布 CanvasAnnotationLayer）都查這張表，
 * 確保兩端行為一致、新增動作時只改一處。
 * 完備性由 overlayShortcutCommands.test.ts 鎖住（每個 overlay scope 動作都要有對應）。
 */

/** 浮層快捷鍵指令：切換繪圖工具，或執行「新增」動作。 */
export type OverlayShortcutCommand =
  | { type: 'tool'; tool: Exclude<DrawTool, null> }
  | { type: 'addSticky' }
  | { type: 'addSlide' }
  | { type: 'addText' };

/** overlay scope 動作 id → 指令。 */
export const OVERLAY_SHORTCUT_COMMANDS: Readonly<Record<string, OverlayShortcutCommand>> = {
  toolPen: { type: 'tool', tool: 'pen' },
  toolHighlight: { type: 'tool', tool: 'highlight' },
  toolLine: { type: 'tool', tool: 'line' },
  toolRect: { type: 'tool', tool: 'rect' },
  toolEllipse: { type: 'tool', tool: 'ellipse' },
  addTextBox: { type: 'addText' },
  eraseArea: { type: 'tool', tool: 'erase-area' },
  eraseStroke: { type: 'tool', tool: 'erase-stroke' },
  eraseBox: { type: 'tool', tool: 'erase-box' },
  addSticky: { type: 'addSticky' },
  addSlide: { type: 'addSlide' },
};
