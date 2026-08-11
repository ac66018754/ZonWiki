/**
 * editorFolding 單元測試 — 對應 docs/design/測試計畫-編輯模式toggle摺疊.md（v2）。
 *
 * 核心不變式：expand(display, state) 必須精確還原完整文字（round-trip），
 * 任何路徑都不得讓「隱藏內文遺失」或「徽章文字滲入完整文字」。
 */
import { describe, expect, it } from 'vitest';
import {
  emptyFoldState,
  expandDisplay,
  findBadgeAt,
  foldAll,
  foldBlockAt,
  listToggleBlocks,
  makeBadge,
  mapDisplayRangeToFull,
  unfoldAll,
  unfoldBlock,
  validateEdit,
  type FoldState,
} from './editorFolding';

/** 便利函數：固定 id 序列的產生器（測試可預期）。 */
function seqIdGen(...ids: string[]): () => string {
  let i = 0;
  return () => ids[Math.min(i++, ids.length - 1)];
}

/** 便利函數：摺疊第 index 個（可摺疊的）區塊。 */
function foldNth(display: string, state: FoldState, index: number, idGen?: () => string) {
  const blocks = listToggleBlocks(display, state).filter((b) => !b.folded);
  const target = blocks[index];
  expect(target).toBeDefined();
  const result = foldBlockAt(display, state, target.headerStart, idGen);
  expect(result).not.toBeNull();
  return result!;
}

const SIMPLE = [
  '前文',
  ':::toggle 標題A',
  '內文一',
  '內文二',
  ':::',
  '後文',
].join('\n');

describe('A1 findToggleBlocks／listToggleBlocks（位置感知解析）', () => {
  it('A1#1 單一 toggle：標頭位置、標題、範圍正確', () => {
    const blocks = listToggleBlocks(SIMPLE, emptyFoldState);
    expect(blocks).toHaveLength(1);
    const b = blocks[0];
    expect(b.title).toBe('標題A');
    expect(SIMPLE.slice(b.headerStart)).toMatch(/^:::toggle 標題A\n/);
    expect(b.folded).toBe(false);
  });

  it('A1#2 :::toggle-open 也被辨識', () => {
    const md = ':::toggle-open 展開的\n內容\n:::';
    const blocks = listToggleBlocks(md, emptyFoldState);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].title).toBe('展開的');
  });

  it('A1#3 程式碼圍欄內的 :::toggle 不被辨識', () => {
    const md = '```\n:::toggle 假的\n:::\n```\n:::toggle 真的\n內容\n:::';
    const blocks = listToggleBlocks(md, emptyFoldState);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].title).toBe('真的');
  });

  it('A1#4 巢狀 toggle：內外層都列出，外層範圍涵蓋內層', () => {
    const md = ':::toggle 外\n外文\n:::toggle 內\n內文\n:::\n外尾\n:::';
    const blocks = listToggleBlocks(md, emptyFoldState);
    expect(blocks).toHaveLength(2);
    const outer = blocks.find((b) => b.title === '外')!;
    const inner = blocks.find((b) => b.title === '內')!;
    expect(outer.headerStart).toBeLessThan(inner.headerStart);
    expect(outer.blockEnd).toBe(md.length);
    expect(inner.blockEnd!).toBeLessThan(outer.blockEnd!);
  });

  it('A1#5 未閉合 toggle：範圍到文末', () => {
    const md = '前\n:::toggle 沒關\n內容到結尾';
    const blocks = listToggleBlocks(md, emptyFoldState);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].blockEnd).toBe(md.length);
  });

  it('A1#6 :::protect 不可摺疊，但不干擾後續 toggle 判定', () => {
    const md = ':::protect\n保護內容\n:::\n:::toggle 真的\n內容\n:::';
    const blocks = listToggleBlocks(md, emptyFoldState);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].title).toBe('真的');
  });

  it('A1#7+H1 徽章行只有 id 命中 records 才視為 folded；未知假徽章＝一般標頭', () => {
    const { display, state } = foldNth(SIMPLE, emptyFoldState, 0, seqIdGen('gk7q'));
    const folded = listToggleBlocks(display, state);
    expect(folded).toHaveLength(1);
    expect(folded[0].folded).toBe(true);
    expect(folded[0].foldId).toBe('gk7q');

    // 相同的顯示文字、但 state 不認得這個 id → 視為一般（未摺疊）標頭
    const stranger = listToggleBlocks(display, emptyFoldState);
    expect(stranger[0].folded).toBe(false);
  });

  it('H1+ 未知 id 假徽章行後接 body＋::: → 不會提早關掉外層（深度計數正常）', () => {
    const fake = makeBadge('zzzz', 3);
    const md = `:::toggle 外\n:::toggle 假${fake}\n假內\n:::\n外尾\n:::`;
    const blocks = listToggleBlocks(md, emptyFoldState);
    const outer = blocks.find((b) => b.title === '外')!;
    // 外層的結尾必須是最後一個 :::（不被假徽章行影響）
    expect(outer.blockEnd).toBe(md.length);
  });
});

describe('A2 fold / unfold round-trip 不變式', () => {
  it('A2#8 fold 單一區塊：內文與 ::: 從 display 消失、徽章行數正確；expand 精確還原', () => {
    const { display, state } = foldNth(SIMPLE, emptyFoldState, 0, seqIdGen('gk7q'));
    expect(display).toContain(makeBadge('gk7q', 3)); // 內文兩行＋結尾 ::: ＝ 3 行
    expect(display).not.toContain('內文一');
    expect(display).toContain('前文');
    expect(display).toContain('後文');
    expect(expandDisplay(display, state)).toBe(SIMPLE);
  });

  it('A2#9 unfold：display 還原為原文、records 清空', () => {
    const folded = foldNth(SIMPLE, emptyFoldState, 0, seqIdGen('gk7q'));
    const back = unfoldBlock(folded.display, folded.state, 'gk7q');
    expect(back.display).toBe(SIMPLE);
    expect(back.state.records).toHaveLength(0);
  });

  it('A2#10 未閉合區塊（檔尾無換行）round-trip 精確還原', () => {
    const md = '前\n:::toggle 沒關\n內容到結尾沒有換行';
    const { display, state } = foldNth(md, emptyFoldState, 0);
    expect(expandDisplay(display, state)).toBe(md);
  });

  it('A2#11 foldAll：多個頂層區塊全部摺疊，round-trip 成立', () => {
    const md = ':::toggle 一\nA\n:::\n中間\n:::toggle 二\nB\n:::';
    const { display, state } = foldAll(md, emptyFoldState);
    expect(state.records).toHaveLength(2);
    expect(display).not.toContain('A');
    expect(display).not.toContain('B');
    expect(expandDisplay(display, state)).toBe(md);
  });

  it('A2#12 巢狀：先摺內層再摺外層 → expand 迭代代換還原；unfold 外層後內層徽章重現', () => {
    const md = ':::toggle 外\n外文\n:::toggle 內\n內文\n:::\n外尾\n:::';
    const step1 = (() => {
      const blocks = listToggleBlocks(md, emptyFoldState);
      const inner = blocks.find((b) => b.title === '內')!;
      return foldBlockAt(md, emptyFoldState, inner.headerStart, seqIdGen('gk7q'))!;
    })();
    const step2 = (() => {
      const blocks = listToggleBlocks(step1.display, step1.state);
      const outer = blocks.find((b) => b.title === '外')!;
      return foldBlockAt(step1.display, step1.state, outer.headerStart, seqIdGen('mn3p'))!;
    })();
    // 外層摺疊後：display 不含內層徽章（它藏在外層 hiddenText 裡）
    expect(step2.display).not.toContain(makeBadge('gk7q', 2));
    expect(expandDisplay(step2.display, step2.state)).toBe(md);

    const back = unfoldBlock(step2.display, step2.state, 'mn3p');
    expect(back.display).toContain(makeBadge('gk7q', 2)); // 內層徽章重現（仍摺疊；隱藏 1 行內文＋1 行 :::）
    expect(expandDisplay(back.display, back.state)).toBe(md);
  });

  it('A2#14 兩個內容完全相同的 toggle：id 不同、各自 unfold 不互換', () => {
    const md = ':::toggle 同\n一樣\n:::\n:::toggle 同\n一樣\n:::';
    const s1 = foldNth(md, emptyFoldState, 0, seqIdGen('gk7q'));
    const s2 = foldNth(s1.display, s1.state, 0, seqIdGen('mn3p'));
    expect(s2.state.records.map((r) => r.id).sort()).toEqual(['gk7q', 'mn3p']);
    expect(expandDisplay(s2.display, s2.state)).toBe(md);
    const back = unfoldBlock(s2.display, s2.state, 'mn3p');
    expect(expandDisplay(back.display, back.state)).toBe(md);
  });

  it('C4+ hiddenText 含 $&、$`、$\'、$1 → round-trip 不被替換樣板解義', () => {
    const md = ':::toggle 錢字\nsed "s/a/$&/"\n$` $\' $1 $$\n:::';
    const { display, state } = foldNth(md, emptyFoldState, 0);
    expect(expandDisplay(display, state)).toBe(md);
  });

  it('M6+ CRLF 內容 round-trip 精確還原；徽章插在 \\r 之前', () => {
    const md = '前\r\n:::toggle 標\r\n內\r\n:::\r\n後';
    const { display, state } = foldNth(md, emptyFoldState, 0, seqIdGen('gk7q'));
    // 徽章必須在 \r 之前（同一視覺行）
    expect(display).toContain(`:::toggle 標${makeBadge('gk7q', 2)}\r\n後`);
    expect(expandDisplay(display, state)).toBe(md);
  });

  it('H4+ id 撞名（撞既有紀錄或文中假徽章）→ 自動重生成', () => {
    const fake = makeBadge('gk7q', 1);
    const md = `文中已有假徽章${fake}\n:::toggle 一\nA\n:::\n:::toggle 二\nB\n:::`;
    // 產生器故意先回撞名的 'gk7q'，實作必須跳過再取下一個
    const s1 = foldNth(md, emptyFoldState, 0, seqIdGen('gk7q', 'mn3p'));
    expect(s1.state.records[0].id).toBe('mn3p');
    const s2 = foldNth(s1.display, s1.state, 0, seqIdGen('mn3p', 'tv5w'));
    expect(s2.state.records.map((r) => r.id).sort()).toEqual(['mn3p', 'tv5w']);
    expect(expandDisplay(s2.display, s2.state)).toBe(md);
  });

  it('foldBlockAt 對「已摺疊」的標頭回 null（不可重複摺）', () => {
    const { display, state } = foldNth(SIMPLE, emptyFoldState, 0);
    const folded = listToggleBlocks(display, state)[0];
    expect(foldBlockAt(display, state, folded.headerStart)).toBeNull();
  });

  it('unfoldAll：全部展開（含巢狀）、records 清空、display === 原文', () => {
    const md = ':::toggle 外\n:::toggle 內\nX\n:::\n:::\n尾';
    const all = foldAll(md, emptyFoldState);
    const back = unfoldAll(all.display, all.state);
    expect(back.display).toBe(md);
    expect(back.state.records).toHaveLength(0);
  });
});

describe('A3 validateEdit（使用者編輯驗證）', () => {
  const folded = () => foldNth(SIMPLE, emptyFoldState, 0, seqIdGen('gk7q'));

  it('A3#15 徽章外的一般編輯：接受，expand 反映編輯', () => {
    const { display, state } = folded();
    const edited = display.replace('後文', '後文改');
    const v = validateEdit(edited, state);
    expect(v.ok).toBe(true);
    if (v.ok) expect(expandDisplay(edited, v.state)).toBe(SIMPLE.replace('後文', '後文改'));
  });

  it('A3#16 摺疊標頭行「徽章之前」改標題：接受，隱藏內文不變', () => {
    const { display, state } = folded();
    const edited = display.replace(':::toggle 標題A', ':::toggle 新標題');
    const v = validateEdit(edited, state);
    expect(v.ok).toBe(true);
    if (v.ok) {
      const full = expandDisplay(edited, v.state);
      expect(full).toBe(SIMPLE.replace(':::toggle 標題A', ':::toggle 新標題'));
    }
  });

  it('A3#17+C3 刪除整行（含完整徽章）：接受＝整塊刪除，紀錄移入 graveyard', () => {
    const { display, state } = folded();
    const badge = makeBadge('gk7q', 3);
    const line = `:::toggle 標題A${badge}\n`;
    const edited = display.replace(line, '');
    const v = validateEdit(edited, state);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.deletedIds).toEqual(['gk7q']);
      expect(v.state.records).toHaveLength(0);
      expect(v.state.graveyard.map((r) => r.id)).toContain('gk7q');
      expect(expandDisplay(edited, v.state)).toBe('前文\n後文');
    }
  });

  it('C3+ undo 復活：graveyard 徽章重現 → 紀錄復活、expand 含原內容', () => {
    const { display, state } = folded();
    const badge = makeBadge('gk7q', 3);
    const deleted = display.replace(`:::toggle 標題A${badge}\n`, '');
    const v1 = validateEdit(deleted, state);
    expect(v1.ok).toBe(true);
    if (!v1.ok) return;
    // 模擬 Ctrl+Z：徽章行貼回來
    const revived = display;
    const v2 = validateEdit(revived, v1.state);
    expect(v2.ok).toBe(true);
    if (v2.ok) {
      expect(v2.revivedIds).toEqual(['gk7q']);
      expect(v2.state.records.map((r) => r.id)).toContain('gk7q');
      expect(v2.state.graveyard).toHaveLength(0);
      expect(expandDisplay(revived, v2.state)).toBe(SIMPLE);
    }
  });

  it('A3#18 徽章被改壞（id 還在但徽章不完整）：拒絕 damaged', () => {
    const { display, state } = folded();
    const edited = display.replace('已摺疊 3 行', '已摺疊 3行'); // 動了徽章內部、#gk7q 仍在
    const v = validateEdit(edited, state);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('damaged');
  });

  it('A3#18b 內文恰有同 id 開頭的 hashtag（#gk7qxyz）時，乾淨刪除整塊仍被接受（復審 HIGH 迴歸）', () => {
    // 內文含巧合字串 `#gk7qxyz`——裸 `#id` 全文比對會把合法刪除誤判成 damaged
    const md = '參考 #gk7qxyz 這是不相關的 hashtag\n:::toggle 標題A\n內文一\n:::\n後文';
    const blocks = listToggleBlocks(md, emptyFoldState).filter((b) => !b.folded);
    const folded1 = foldBlockAt(md, emptyFoldState, blocks[0].headerStart, seqIdGen('gk7q'))!;
    const badge = makeBadge('gk7q', 2);
    const deleted = folded1.display.replace(`:::toggle 標題A${badge}\n`, '');
    const v = validateEdit(deleted, folded1.state);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.deletedIds).toEqual(['gk7q']);
      expect(expandDisplay(deleted, v.state)).toBe('參考 #gk7qxyz 這是不相關的 hashtag\n後文');
    }
  });

  it('A3#18c 徽章尾括號被刪（前框＋id 還在）：仍判 damaged 拒絕', () => {
    const { display, state } = folded();
    const edited = display.replace('#gk7q〕', '#gk7q'); // 刪掉〕
    const v = validateEdit(edited, state);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('damaged');
  });

  it('A3#19 徽章被複製成兩份：拒絕 duplicated', () => {
    const { display, state } = folded();
    const badge = makeBadge('gk7q', 3);
    const edited = display + `\n貼上的${badge}`;
    const v = validateEdit(edited, state);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('duplicated');
  });

  it('A3#20 未知 id 的假徽章：接受（一般文字），expand 原樣保留', () => {
    const { display, state } = folded();
    const fake = makeBadge('zzzz', 5);
    const edited = display + `\n假的${fake}`;
    const v = validateEdit(edited, state);
    expect(v.ok).toBe(true);
    if (v.ok) expect(expandDisplay(edited, v.state)).toBe(`${SIMPLE}\n假的${fake}`);
  });

  it('巢狀摺疊時：內層徽章不在 display（藏於外層 hiddenText）→ 驗證通過', () => {
    const md = ':::toggle 外\n:::toggle 內\nX\n:::\n:::';
    const all = foldAll(md, emptyFoldState);
    const edited = all.display + '\n加一行';
    const v = validateEdit(edited, all.state);
    expect(v.ok).toBe(true);
    if (v.ok) expect(expandDisplay(edited, v.state)).toBe(`${md}\n加一行`);
  });

  it('M4+ 徽章行被改到不再是 :::toggle 標頭：接受、expand 不掉內容', () => {
    const { display, state } = folded();
    const edited = display.replace(':::toggle 標題A', '普通文字');
    const v = validateEdit(edited, state);
    expect(v.ok).toBe(true);
    if (v.ok) {
      const full = expandDisplay(edited, v.state);
      expect(full).toContain('內文一'); // 隱藏內文仍在
      expect(full).toContain('內文二');
      expect(full).not.toContain('已摺疊'); // 徽章不滲入完整文字
    }
  });

  it('M5+ 徽章被搬進行中間：接受、round-trip 所有字元保留', () => {
    const { display, state } = folded();
    const badge = makeBadge('gk7q', 3);
    // 把徽章從標頭行剪下、貼到「後文」兩字中間
    const removed = display.replace(badge, '');
    const idx = removed.indexOf('後文') + 1;
    const edited = removed.slice(0, idx) + badge + removed.slice(idx);
    const v = validateEdit(edited, state);
    expect(v.ok).toBe(true);
    if (v.ok) {
      const full = expandDisplay(edited, v.state);
      // 內容完整性：隱藏內文一字不失、徽章不殘留
      expect(full).toContain('內文一');
      expect(full).toContain('內文二');
      expect(full).not.toContain('已摺疊');
    }
  });
});

describe('A4 mapDisplayRangeToFull', () => {
  it('A4#21 無摺疊：恆等', () => {
    expect(mapDisplayRangeToFull(SIMPLE, emptyFoldState, 3, 8)).toEqual({ start: 3, end: 8 });
  });

  it('A4#22 範圍完全在徽章之前：恆等', () => {
    const { display, state } = foldNth(SIMPLE, emptyFoldState, 0);
    expect(mapDisplayRangeToFull(display, state, 0, 2)).toEqual({ start: 0, end: 2 });
  });

  it('A4#23 範圍在徽章之後：位移＝隱藏展開長 − 徽章長', () => {
    const { display, state } = foldNth(SIMPLE, emptyFoldState, 0, seqIdGen('gk7q'));
    const badge = makeBadge('gk7q', 3);
    const hiddenLen = '\n內文一\n內文二\n:::'.length;
    const delta = hiddenLen - badge.length;
    const s = display.indexOf('後文');
    const mapped = mapDisplayRangeToFull(display, state, s, s + 2)!;
    expect(mapped).toEqual({ start: s + delta, end: s + 2 + delta });
    expect(SIMPLE.slice(mapped.start, mapped.end)).toBe('後文');
  });

  it('A4#23b 巢狀摺疊：位移用「完全展開長度」', () => {
    const md = ':::toggle 外\n:::toggle 內\nX\n:::\n:::\n尾巴';
    const all = foldAll(md, emptyFoldState);
    const s = all.display.indexOf('尾巴');
    const mapped = mapDisplayRangeToFull(all.display, all.state, s, s + 2)!;
    expect(md.slice(mapped.start, mapped.end)).toBe('尾巴');
  });

  it('A4#24+M2 嚴格跨入徽章＝null；貼齊前後緣＝允許', () => {
    const { display, state } = foldNth(SIMPLE, emptyFoldState, 0, seqIdGen('gk7q'));
    const badge = makeBadge('gk7q', 3);
    const bStart = display.indexOf(badge);
    const bEnd = bStart + badge.length;
    // 嚴格跨入
    expect(mapDisplayRangeToFull(display, state, bStart - 2, bStart + 1)).toBeNull();
    expect(mapDisplayRangeToFull(display, state, bEnd - 1, bEnd + 1)).toBeNull();
    expect(mapDisplayRangeToFull(display, state, bStart, bEnd)).toBeNull();
    // 貼齊邊緣（不相交）
    expect(mapDisplayRangeToFull(display, state, 0, bStart)).toEqual({ start: 0, end: bStart });
    const after = mapDisplayRangeToFull(display, state, bEnd, bEnd + 1);
    expect(after).not.toBeNull();
    expect(SIMPLE.slice(after!.start, after!.end)).toBe(display.slice(bEnd, bEnd + 1));
  });
});

describe('A5 徽章格式與 findBadgeAt', () => {
  it('A5#25 一般文字含 ⋯ 或 〔〕 不會誤匹配', () => {
    const md = '省略號⋯與〔括號〕單獨出現\n:::toggle 真\nX\n:::';
    const { display, state } = foldNth(md, emptyFoldState, 0);
    const v = validateEdit(display, state);
    expect(v.ok).toBe(true);
    expect(expandDisplay(display, state)).toBe(md);
  });

  it('findBadgeAt：嚴格在內＝inside；貼齊前緣＝atStart；貼齊後緣＝atEnd；其他＝null', () => {
    const { display, state } = foldNth(SIMPLE, emptyFoldState, 0, seqIdGen('gk7q'));
    const badge = makeBadge('gk7q', 3);
    const bStart = display.indexOf(badge);
    const bEnd = bStart + badge.length;
    expect(findBadgeAt(display, state, bStart + 3)?.touching).toBe('inside');
    expect(findBadgeAt(display, state, bStart)?.touching).toBe('atStart');
    expect(findBadgeAt(display, state, bEnd)?.touching).toBe('atEnd');
    expect(findBadgeAt(display, state, 0)).toBeNull();
    expect(findBadgeAt(display, state, bStart)?.foldId).toBe('gk7q');
  });
});

describe('M8+ 效能冒煙', () => {
  it('約 200KB＋50 個摺疊：validate＋expand 在寬鬆時限內', () => {
    const parts: string[] = [];
    for (let i = 0; i < 50; i += 1) {
      parts.push(`:::toggle 區塊${i}`);
      parts.push('內容'.repeat(400)); // 每塊約 2.4KB
      parts.push(':::');
      parts.push('間隔文字'.repeat(100));
    }
    const md = parts.join('\n');
    const all = foldAll(md, emptyFoldState);
    const t0 = performance.now();
    for (let i = 0; i < 10; i += 1) {
      const v = validateEdit(all.display + `x${i}`, all.state);
      expect(v.ok).toBe(true);
      expandDisplay(all.display, all.state);
    }
    const elapsed = performance.now() - t0;
    // 寬鬆上限：10 輪 validate+expand < 2 秒（CI 慢機防抖）
    expect(elapsed).toBeLessThan(2000);
  });
});
