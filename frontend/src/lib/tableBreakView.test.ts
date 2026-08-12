import { describe, expect, test } from 'vitest';
import {
  expandTableRowBreaks,
  collapseTableRowBreaks,
  safeExpandTableRowBreaks,
  listJoinRegions,
  mapExpandedRangeToCollapsed,
  continuationInsertFor,
} from './tableBreakView';

/**
 * 表格 `<br>` 編輯視圖層——純函式測試。
 * 對應 docs/design/測試計畫-Enter硬換行與表格br視圖層.md B2 組（含 v2 修訂新增列）。
 *
 * 核心不變式：collapseTableRowBreaks(expandTableRowBreaks(x)) === x（無損可逆）；
 * 破壞可逆性的病態內容由 safeExpandTableRowBreaks 於初始化偵測並停用視圖層。
 *
 * 「真表格脈絡」（v2 修訂 H-4/M-1）：只有「連續表格列區塊的第 2 列是分隔列」的區塊
 * 才展開/收斂；散文含管線、無分隔列的偽表格、分隔列本身都不動。
 */

/** 標準三列表（表頭／分隔／資料列），資料列首格含一個 <br>。 */
const TABLE_WITH_BR = ['| h1 | h2 |', '| --- | --- |', '| a<br>b | c |'].join('\n');

/** TABLE_WITH_BR 的預期展開形：續行 pad=0 個空白＋「↳ 」（'a' 在視覺欄 2）。 */
const TABLE_EXPANDED = ['| h1 | h2 |', '| --- | --- |', '| a', '↳ b | c |'].join('\n');

describe('expandTableRowBreaks（B2-1 ~ B2-10）', () => {
  test('B2-1: 資料列格內 <br> → 換行＋對齊續行（↳ 標記）', () => {
    expect(expandTableRowBreaks(TABLE_WITH_BR)).toBe(TABLE_EXPANDED);
  });

  test('B2-2: 一格內兩個 <br> → 兩條續行、墊片相同', () => {
    const full = ['| h |', '| --- |', '| a<br>b<br>c |'].join('\n');
    expect(expandTableRowBreaks(full)).toBe(
      ['| h |', '| --- |', '| a', '↳ b', '↳ c |'].join('\n'),
    );
  });

  test('B2-3: 兩格各有 <br> → 各自對齊自己儲存格的內容起始欄', () => {
    const full = ['| h1 | h2 |', '| --- | --- |', '| a<br>b | x<br>y |'].join('\n');
    // 第二格內容 'x' 前綴 '| a<br>b | ' 展開後在該列的前綴是 '| a…'？不對——
    // 墊片以「原始單行」計算：'x' 前綴 '| a<br>b | ' 含 <br> 字面（4 視覺欄不重要，
    // 實作以「未展開的原始行」量測會把 <br> 算進去 → 錯位。正確語意：
    // 墊片＝展開後「該儲存格於畫面上的起始欄」，即以『display 上該列的最後一段實體行』
    // 起算不可行——本測試鎖定的正確行為是：以「原始行去掉更早的 <br> 之後」的欄位計算。
    // 'x' 的儲存格開頭在原始行 col：'| a<br>b | ' 中 'x' 之前若把 <br> 換成換行，
    // 'x' 所在實體行是 '↳ b | x…'，其前綴 '↳ b | ' 視覺寬 = 2+1+1+1+1+1 = 7 → 5 空白＋↳。
    expect(expandTableRowBreaks(full)).toBe(
      ['| h1 | h2 |', '| --- | --- |', '| a', '↳ b | x', '     ↳ y |'].join('\n'),
    );
  });

  test('B2-4: CJK 前綴以視覺寬 2 計算墊片', () => {
    const full = ['| 日期 | 項目 |', '| --- | --- |', '| 日期 | x<br>y |'].join('\n');
    // 'x' 前綴 '| 日期 | ' 視覺寬 = 1+1+2+2+1+1+1 = 9 → 7 空白＋'↳ '（↳＋空白佔 2）。
    expect(expandTableRowBreaks(full)).toBe(
      ['| 日期 | 項目 |', '| --- | --- |', '| 日期 | x', '       ↳ y |'].join('\n'),
    );
  });

  test('B2-5: 圍欄程式碼內的表格樣行不展開', () => {
    const full = ['```', '| h |', '| --- |', '| a<br>b |', '```'].join('\n');
    expect(expandTableRowBreaks(full)).toBe(full);
  });

  test('B2-6: <br/>、<br />、<BR> 變體不展開（只認正規形，維持無損可逆）', () => {
    const full = ['| h |', '| --- |', '| a<br/>b |', '| c<br />d |', '| e<BR>f |'].join('\n');
    expect(expandTableRowBreaks(full)).toBe(full);
  });

  test('B2-7: 無未跳脫管線的行不展開', () => {
    const full = 'a<br>b';
    expect(expandTableRowBreaks(full)).toBe(full);
  });

  test('B2-8: 縮排 ≥ 4 的表格樣行不展開（縮排程式碼區塊層級）', () => {
    const full = ['| h |', '| --- |', '    | a<br>b |'].join('\n');
    expect(expandTableRowBreaks(full)).toBe(full);
  });

  test('B2-9: 行尾 \\r（CRLF）的表格列不展開（保守跳過）', () => {
    const full = '| h |\r\n| --- |\r\n| a<br>b |\r\n';
    expect(expandTableRowBreaks(full)).toBe(full);
  });

  test('B2-10: 跳脫管線 \\| 不當欄位分隔，展開位置正確', () => {
    const full = ['| h |', '| --- |', '| a\\|b<br>c |'].join('\n');
    expect(expandTableRowBreaks(full)).toBe(
      ['| h |', '| --- |', '| a\\|b', '↳ c |'].join('\n'),
    );
  });

  test('B2-19: 分隔列本身不展開；B2-20: 無分隔列的偽表格不展開', () => {
    // 分隔列不可能含 <br>（含了就不是分隔列），此處鎖「無分隔列」的偽表格。
    const noDelimiter = ['| a<br>b | c |', '| d | e |'].join('\n');
    expect(expandTableRowBreaks(noDelimiter)).toBe(noDelimiter);
    // 散文含管線也不展開。
    const prose = '甲 | 乙<br>丙';
    expect(expandTableRowBreaks(prose)).toBe(prose);
  });

  test('B2-21: 儲存格 inline code 內的正規形 <br> 也展開（已知顯示差異），round-trip 不受損', () => {
    const full = ['| h |', '| --- |', '| 說明 `a<br>b` |'].join('\n');
    const display = expandTableRowBreaks(full);
    expect(display).toContain('↳');
    expect(collapseTableRowBreaks(display)).toBe(full);
  });

  test('表頭列格內 <br> 也展開（續行落在表頭與分隔列之間），round-trip 成立', () => {
    const full = ['| h1<br>h2 | x |', '| --- | --- |', '| a | b |'].join('\n');
    const display = expandTableRowBreaks(full);
    expect(display).toBe(['| h1', '↳ h2 | x |', '| --- | --- |', '| a | b |'].join('\n'));
    expect(collapseTableRowBreaks(display)).toBe(full);
  });
});

describe('collapseTableRowBreaks（B2-11 ~ B2-16、B2-22）', () => {
  test('B2-11: collapse(expand(x)) === x（代表性輸入集）', () => {
    const inputs = [
      TABLE_WITH_BR,
      ['前文', '', TABLE_WITH_BR, '', '後文段落'].join('\n'),
      ['| h |', '| --- |', '| a<br>b<br>c |', '', '| h2 |', '| --- |', '| x<br>y |'].join('\n'),
      ['```', '| a<br>b |', '```', TABLE_WITH_BR].join('\n'),
      ['| h1 | h2 |', '| --- | --- |', '| <br>a | b<br> |'].join('\n'), // <br> 在格首/格尾
      ['| h |', '| --- |', '| a<br> b |'].join('\n'), // <br> 後帶空白（內容自有空白要保留）
      '沒有表格的純文字\n第二行',
      '',
    ];
    for (const full of inputs) {
      expect(collapseTableRowBreaks(expandTableRowBreaks(full))).toBe(full);
    }
  });

  test('B2-12: 孤兒 ↳ 行（前一行是普通段落）維持字面不 join', () => {
    const display = ['普通段落', '↳ 這是使用者自己的箭頭行'].join('\n');
    expect(collapseTableRowBreaks(display)).toBe(display);
  });

  test('B2-13: ↳ 後無空白（刪到一半）仍 join、不漏 ↳ 進完整文字', () => {
    const display = ['| h |', '| --- |', '| a', '↳b |'].join('\n');
    expect(collapseTableRowBreaks(display)).toBe(['| h |', '| --- |', '| a<br>b |'].join('\n'));
  });

  test('B2-14: 連鎖續行 join 成 a<br>b<br>c', () => {
    const display = ['| h |', '| --- |', '| a', '↳ b', '↳ c |'].join('\n');
    expect(collapseTableRowBreaks(display)).toBe(['| h |', '| --- |', '| a<br>b<br>c |'].join('\n'));
  });

  test('B2-15: 圍欄內的 ↳ 行不 join', () => {
    const display = ['```', '| a |', '↳ b', '```'].join('\n');
    expect(collapseTableRowBreaks(display)).toBe(display);
  });

  test('B2-22: \\r 結尾的續行不 join（CRLF 對稱拒收）', () => {
    const display = '| h |\n| --- |\n| a\n↳ b |\r\n後文';
    expect(collapseTableRowBreaks(display)).toBe(display);
  });

  test('無分隔列脈絡的 ↳ 行不 join（與展開側對稱）', () => {
    const display = ['| a |', '↳ b'].join('\n');
    expect(collapseTableRowBreaks(display)).toBe(display);
  });
});

describe('safeExpandTableRowBreaks（B2-16）', () => {
  test('正常內容：enabled=true、display=展開形', () => {
    const result = safeExpandTableRowBreaks(TABLE_WITH_BR);
    expect(result.enabled).toBe(true);
    expect(result.display).toBe(TABLE_EXPANDED);
  });

  test('B2-16: 原文本來就有「表格列＋次行行首 ↳」→ 停用（display=原文）', () => {
    const pathological = ['| h |', '| --- |', '| a |', '↳ 使用者自己的字面箭頭行'].join('\n');
    const result = safeExpandTableRowBreaks(pathological);
    expect(result.enabled).toBe(false);
    expect(result.display).toBe(pathological);
  });

  test('無表格的一般筆記：enabled=true、display===原文', () => {
    const plain = '第一行\n第二行';
    const result = safeExpandTableRowBreaks(plain);
    expect(result.enabled).toBe(true);
    expect(result.display).toBe(plain);
  });
});

describe('listJoinRegions／mapExpandedRangeToCollapsed（B2-17、B2-18）', () => {
  test('join 區清單：位置與內容起點正確', () => {
    // TABLE_EXPANDED 的 join：'| a' 行尾（換行處）到 '↳ ' 之後。
    // '| h1 | h2 |\n| --- | --- |\n| a' 長度 = 11+1+13+1+3 = 29 → join 起點=29（\n），
    // 內容起點 = 29 + 1（\n）+ 0（墊片）+ 2（'↳ '）= 32。
    const regions = listJoinRegions(TABLE_EXPANDED);
    expect(regions).toEqual([{ start: 29, contentStart: 32 }]);
  });

  test('B2-17: join 之前的 offset 不變、之後的 offset 位移正確', () => {
    // 展開形 '↳ b | c |' 的 'b'（offset 32）→ 收斂形 '| a<br>b | c |' 的 'b'。
    // 收斂形前綴 '| h1 | h2 |\n| --- | --- |\n| a<br>' 長度 = 11+1+13+1+3+4 = 33。
    expect(mapExpandedRangeToCollapsed(TABLE_EXPANDED, 32, 33)).toEqual({ start: 33, end: 34 });
    // join 之前：'| a' 的 'a'（offset 28）原位。
    expect(mapExpandedRangeToCollapsed(TABLE_EXPANDED, 28, 29)).toEqual({ start: 28, end: 29 });
  });

  test('B2-18: 端點落在 join 區內 → 貼齊 join 起點（不回 null）', () => {
    // offset 30（墊片/標記區內）貼齊 29 → 收斂座標 29。
    expect(mapExpandedRangeToCollapsed(TABLE_EXPANDED, 30, 33)).toEqual({ start: 29, end: 34 });
  });
});

describe('continuationInsertFor（Shift+Enter 的插入內容）', () => {
  test('游標在資料列儲存格內 → 回傳 \\n＋墊片＋↳ ', () => {
    // TABLE_WITH_BR 的第三列 '| a<br>b | c |'，游標放在 'c' 之後。
    const full = TABLE_WITH_BR;
    const pos = full.indexOf('| c |') + 3; // 'c' 之後
    // 'c' 儲存格內容起始欄：前綴 '| a<br>b | ' 視覺寬 = 11 → 9 空白＋'↳ '。
    expect(continuationInsertFor(full, pos)).toBe('\n' + ' '.repeat(9) + '↳ ');
  });

  test('游標在續行上 → 沿用該行墊片', () => {
    const pos = TABLE_EXPANDED.length - 1; // 續行 '↳ b | c |' 內
    expect(continuationInsertFor(TABLE_EXPANDED, pos)).toBe('\n↳ ');
  });

  test('續行上、游標已進入「新儲存格」（有管線）→ 仍回傳可用的插入內容（LOW-1 補測）', () => {
    // 續行 '↳ b | c |'，游標放在 'c' 之後（跨過管線＝第二儲存格）。
    const pos = TABLE_EXPANDED.indexOf(' c |') + 2;
    const insert = continuationInsertFor(TABLE_EXPANDED, pos);
    expect(insert).not.toBeNull();
    expect(insert).toMatch(/^\n *↳ $/);
  });

  test('B3-20 對應: 分隔列上 → null（放行預設換行）', () => {
    const pos = TABLE_WITH_BR.indexOf('---') + 1;
    expect(continuationInsertFor(TABLE_WITH_BR, pos)).toBeNull();
  });

  test('B3-21 對應: 散文含管線（無分隔列脈絡）→ null', () => {
    const prose = '甲 | 乙';
    expect(continuationInsertFor(prose, 5)).toBeNull();
  });

  test('圍欄內表格樣行 → null', () => {
    const full = ['```', '| a | b |', '```'].join('\n');
    expect(continuationInsertFor(full, full.indexOf('a'))).toBeNull();
  });

  test('游標在列首（第一格內容之前）→ null（避免把 <br> 插在列首毀掉表格列）', () => {
    const row = '| a | b |';
    const full = ['| h | h2 |', '| --- | --- |', row].join('\n');
    const rowStart = full.indexOf(row, 20);
    expect(continuationInsertFor(full, rowStart)).toBeNull(); // 行首
    expect(continuationInsertFor(full, rowStart + 1)).toBeNull(); // '|' 後、內容前仍不可
  });

  test('游標在尾導管線之後 → null（<br> 落在儲存格外會改變欄數）', () => {
    const full = ['| h |', '| --- |', '| a |'].join('\n');
    expect(continuationInsertFor(full, full.length)).toBeNull();
  });
});
