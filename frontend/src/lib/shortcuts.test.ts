/**
 * 浮層工具快捷鍵——鍵位模型單元測試（對應測試計畫 A 組）。
 *
 * 測試對象：shortcuts.ts 的動作清單、衝突偵測（scope 共存判定）、覆寫解析/序列化。
 * A1: overlay/notes 新動作齊全且預設鍵符合使用者裁示（工具 1-9、便利貼 s、圖片板 i、目錄 c）。
 * A2: 出廠預設零衝突。
 * A3: overlay 撞 global＝衝突（同頁共存）。
 * A4: overlay 撞 tasks＝不衝突（不同頁、不共存）。
 * A5: overlay 撞 notes＝衝突（筆記頁共存）。
 * A6: parseOverrides 接受數字單鍵、丟棄多字元。
 * A7: serializeOverrides 只存與預設不同的最小差異。
 * A8: overlay 內部自撞＝衝突（同 scope 天然共存）。
 * A9: 數字動作改字母鍵／字母動作改數字鍵都能保留且衝突偵測正確。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  SHORTCUT_ACTIONS,
  findConflicts,
  parseOverrides,
  serializeOverrides,
} from './shortcuts';

// shortcuts.ts 頂層 import 了 ./api（載入/儲存覆寫用）；單元測試不打網路，整包 stub 掉。
vi.mock('./api', () => ({
  getUserSettings: vi.fn(),
  updateUserSettings: vi.fn(),
}));

/** 依動作 id 取定義（找不到直接讓測試爆掉，訊息清楚）。 */
function actionById(id: string) {
  const found = SHORTCUT_ACTIONS.find((a) => a.id === id);
  if (!found) throw new Error(`SHORTCUT_ACTIONS 缺少動作 id="${id}"`);
  return found;
}

describe('A1 新動作齊全且預設鍵正確', () => {
  it('overlay scope 的 11 個動作與預設鍵完全符合裁示（數字照 2026-08-10 版面視覺順序、便利貼 s、圖片板 i）', () => {
    /** 使用者裁示的鍵位規格（id → 預設鍵）：Row1 文字框=1、Row2 工具=2-6、Row3 橡皮擦=7-9。 */
    const expected: Record<string, string> = {
      addTextBox: '1',
      toolPen: '2',
      toolHighlight: '3',
      toolLine: '4',
      toolRect: '5',
      toolEllipse: '6',
      eraseArea: '7',
      eraseStroke: '8',
      eraseBox: '9',
      addSticky: 's',
      addSlide: 'i',
    };
    const overlayActions = SHORTCUT_ACTIONS.filter((a) => a.scope === 'overlay');
    const actual = Object.fromEntries(overlayActions.map((a) => [a.id, a.defaultKey]));
    expect(actual).toEqual(expected);
  });

  it('notes scope 含 toggleToc（目錄，預設 c），且既有 newNote（a）未被動到', () => {
    expect(actionById('toggleToc').scope).toBe('notes');
    expect(actionById('toggleToc').defaultKey).toBe('c');
    expect(actionById('newNote').scope).toBe('notes');
    expect(actionById('newNote').defaultKey).toBe('a');
  });

  it('不提供快捷鍵的功能真的沒有動作定義（結束繪圖／清除全部／儲存快照）', () => {
    const ids = SHORTCUT_ACTIONS.map((a) => a.id);
    expect(ids).not.toContain('doneDrawing');
    expect(ids).not.toContain('clearAll');
    expect(ids).not.toContain('saveSnapshot');
  });
});

describe('A2 出廠預設零衝突', () => {
  it('findConflicts({}) 為空物件', () => {
    expect(findConflicts({})).toEqual({});
  });
});

describe('A3 overlay 撞 global＝衝突', () => {
  it('toolPen 改成 h（openHome）→ 兩者互列衝突', () => {
    const conflicts = findConflicts({ toolPen: 'h' });
    expect(conflicts.toolPen).toContain('openHome');
    expect(conflicts.openHome).toContain('toolPen');
  });
});

describe('A4 overlay 撞 tasks＝不衝突（不同頁不共存）', () => {
  it('toolPen 改成 y（calYear）→ 無衝突', () => {
    expect(findConflicts({ toolPen: 'y' })).toEqual({});
  });
});

describe('A5 overlay 撞 notes＝衝突（筆記頁共存）', () => {
  it('addSticky 改成 a（newNote）→ 兩者互列衝突', () => {
    const conflicts = findConflicts({ addSticky: 'a' });
    expect(conflicts.addSticky).toContain('newNote');
    expect(conflicts.newNote).toContain('addSticky');
  });
});

describe('A6 parseOverrides 接受數字單鍵', () => {
  it('數字鍵覆寫被保留；多字元值被丟棄', () => {
    const parsed = parseOverrides(JSON.stringify({ toolPen: '3', addSticky: 'ab' }));
    expect(parsed.toolPen).toBe('3');
    expect(parsed.addSticky).toBeUndefined();
  });
});

describe('A7 serializeOverrides 最小化', () => {
  it('全部等於預設 → 空字串', () => {
    const allDefaults = Object.fromEntries(SHORTCUT_ACTIONS.map((a) => [a.id, a.defaultKey]));
    expect(serializeOverrides(allDefaults)).toBe('');
  });

  it('只有一項不同 → JSON 只含那一項', () => {
    const overrides = Object.fromEntries(SHORTCUT_ACTIONS.map((a) => [a.id, a.defaultKey]));
    overrides.toolPen = 'x';
    expect(JSON.parse(serializeOverrides(overrides))).toEqual({ toolPen: 'x' });
  });
});

describe('A8 overlay 內部自撞＝衝突', () => {
  it('toolLine 改成 toolRect 的預設鍵（5）→ 兩者互列衝突', () => {
    const conflicts = findConflicts({ toolLine: '5' });
    expect(conflicts.toolLine).toContain('toolRect');
    expect(conflicts.toolRect).toContain('toolLine');
  });
});

describe('A9 數字↔字母互換改鍵', () => {
  it('toolPen 改字母 x、addSticky 改數字 0（無人使用）→ 都被保留、無衝突', () => {
    const parsed = parseOverrides(JSON.stringify({ toolPen: 'x', addSticky: '0' }));
    expect(parsed.toolPen).toBe('x');
    expect(parsed.addSticky).toBe('0');
    expect(findConflicts(parsed)).toEqual({});
  });

  it('addSticky 改成 3（撞 toolHighlight）→ 衝突偵測照樣抓到', () => {
    const conflicts = findConflicts({ addSticky: '3' });
    expect(conflicts.addSticky).toContain('toolHighlight');
  });
});
