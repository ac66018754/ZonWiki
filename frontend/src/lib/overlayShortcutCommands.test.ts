/**
 * 浮層快捷鍵動作對應表——完備性測試（對應測試計畫 C 組）。
 *
 * OVERLAY_SHORTCUT_COMMANDS 是「動作 id → 工具列指令」的單一事實來源，
 * 由 NoteOverlay 與 CanvasAnnotationLayer 兩端共用。
 * C1: SHORTCUT_ACTIONS 中每個 overlay scope 動作都有對應指令（防「加了動作忘了接」）。
 * C2: 對應內容逐一正確（toolPen→pen、eraseArea→erase-area…）。
 */
import { describe, expect, it, vi } from 'vitest';
import { SHORTCUT_ACTIONS } from './shortcuts';
import { OVERLAY_SHORTCUT_COMMANDS } from './overlayShortcutCommands';

// shortcuts.ts 頂層 import 了 ./api；單元測試不打網路，整包 stub 掉。
vi.mock('./api', () => ({
  getUserSettings: vi.fn(),
  updateUserSettings: vi.fn(),
}));

/**
 * 刻意「不」進 OVERLAY_SHORTCUT_COMMANDS 的 overlay 動作白名單。
 *
 * 這張表描述的是「選工具 / 新增元件」這類指令，兩端（筆記、畫布）行為一致才有意義。
 * toggleToolbar 切的是「工具列自身的收合狀態」，兩端的實作對象根本不同——
 * 筆記端住在 DrawingToolbar 內部；畫布端住在 CanvasAnnotationLayer（收合時 DrawingToolbar
 * 會整個卸載，交給它處理才展得回來）。硬塞進表裡只會讓表失真。
 *
 * 白名單刻意用「明列」而非「跳過全部沒對應的」：日後再加新動作若忘了接，C1 仍會失敗。
 */
const ACTIONS_NOT_IN_COMMAND_TABLE = new Set(['toggleToolbar']);

describe('C1 完備性', () => {
  it('每個 overlay scope 動作 id 都有對應指令（白名單者除外）', () => {
    const overlayIds = SHORTCUT_ACTIONS.filter((a) => a.scope === 'overlay').map((a) => a.id);
    for (const id of overlayIds) {
      if (ACTIONS_NOT_IN_COMMAND_TABLE.has(id)) continue;
      expect(OVERLAY_SHORTCUT_COMMANDS[id], `overlay 動作 "${id}" 缺對應指令`).toBeDefined();
    }
  });

  it('白名單本身不得含「已經有對應指令」的動作（防白名單過期後被忽略）', () => {
    for (const id of ACTIONS_NOT_IN_COMMAND_TABLE) {
      expect(
        OVERLAY_SHORTCUT_COMMANDS[id],
        `動作 "${id}" 已在對應表內，應從白名單移除`,
      ).toBeUndefined();
    }
  });

  it('對應表沒有多出「不存在的動作 id」（防表與動作清單漂移）', () => {
    const knownIds = new Set(SHORTCUT_ACTIONS.map((a) => a.id));
    for (const id of Object.keys(OVERLAY_SHORTCUT_COMMANDS)) {
      expect(knownIds.has(id), `對應表含未知動作 id "${id}"`).toBe(true);
    }
  });
});

describe('C2 對應正確', () => {
  it('九個工具動作對應到正確的 DrawTool', () => {
    expect(OVERLAY_SHORTCUT_COMMANDS.toolPen).toEqual({ type: 'tool', tool: 'pen' });
    expect(OVERLAY_SHORTCUT_COMMANDS.toolHighlight).toEqual({ type: 'tool', tool: 'highlight' });
    expect(OVERLAY_SHORTCUT_COMMANDS.toolLine).toEqual({ type: 'tool', tool: 'line' });
    expect(OVERLAY_SHORTCUT_COMMANDS.toolRect).toEqual({ type: 'tool', tool: 'rect' });
    expect(OVERLAY_SHORTCUT_COMMANDS.toolEllipse).toEqual({ type: 'tool', tool: 'ellipse' });
    expect(OVERLAY_SHORTCUT_COMMANDS.eraseArea).toEqual({ type: 'tool', tool: 'erase-area' });
    expect(OVERLAY_SHORTCUT_COMMANDS.eraseStroke).toEqual({ type: 'tool', tool: 'erase-stroke' });
    expect(OVERLAY_SHORTCUT_COMMANDS.eraseBox).toEqual({ type: 'tool', tool: 'erase-box' });
  });

  it('新增類動作對應到正確指令', () => {
    expect(OVERLAY_SHORTCUT_COMMANDS.addSticky).toEqual({ type: 'addSticky' });
    expect(OVERLAY_SHORTCUT_COMMANDS.addSlide).toEqual({ type: 'addSlide' });
    expect(OVERLAY_SHORTCUT_COMMANDS.addTextBox).toEqual({ type: 'addText' });
  });
});
