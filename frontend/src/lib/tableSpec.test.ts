import { describe, expect, test } from 'vitest';
import {
  parseHeaderSpec,
  resolveChipColor,
  splitTableRowLine,
  replaceCellInLine,
  getCellRawFromContent,
  setCellValueInContent,
  isCheckedValue,
  serializeCheckedValue,
  unescapeCellBr,
  toggleCellCheckbox,
  countCellCheckboxes,
} from './tableSpec';
import { BR_PATTERN } from './remarkHtmlLineBreak';

/**
 * 表格語法核心（tableSpec）的單元測試。
 *
 * 對應設計文件《互動表格與讀模式直編設計》§1（表頭宣告控件）、§9.1（純函數測試計畫）
 * 與 v2 修訂第 8（blockquote 前綴）、9（CRLF）、17（字面 `{…}` 存活、off-by-one）條。
 *
 * 重點鎖定：
 * - 表頭尾碼 `{radio:…}` / `{checkbox}` 解析與各種非法情況（一律降級為「無控件、原文照顯」）。
 * - GFM 列切分：前後導管線、`\|` 轉義、blockquote／縮排前綴、行尾空白。
 * - 儲存格替換 round-trip 保證（split→replace→join→再 split 得回一樣的值）。
 * - `setCellValueInContent` 的 1-based 行號與 split 索引的 off-by-one、CRLF／混合行尾保留。
 */

describe('parseHeaderSpec：表頭尾碼解析', () => {
  test('radio 尾碼：半形逗號分隔選項，displayText 去掉尾碼', () => {
    expect(parseHeaderSpec('狀態{radio:未看,考慮中,已投遞,已婉拒}')).toEqual({
      displayText: '狀態',
      control: { kind: 'radio', options: ['未看', '考慮中', '已投遞', '已婉拒'] },
    });
  });

  test('checkbox 尾碼：displayText 去掉尾碼', () => {
    expect(parseHeaderSpec('已讀{checkbox}')).toEqual({
      displayText: '已讀',
      control: { kind: 'checkbox' },
    });
  });

  test('無尾碼：control 為 null、原文即 displayText', () => {
    expect(parseHeaderSpec('職缺')).toEqual({ displayText: '職缺', control: null });
  });

  test('radio 選項前後空白會被 trim', () => {
    expect(parseHeaderSpec('欄{radio: 甲 , 乙 }')).toEqual({
      displayText: '欄',
      control: { kind: 'radio', options: ['甲', '乙'] },
    });
  });

  test('全形字元選項照常成立；全形逗號「，」不是分隔符（只認半形）', () => {
    expect(parseHeaderSpec('欄{radio:甲，乙}')).toEqual({
      displayText: '欄',
      control: { kind: 'radio', options: ['甲，乙'] },
    });
  });

  test('巢狀大括號＝非法 → 視為無控件、原文即 displayText', () => {
    const raw = '欄{radio:a,{b},c}';
    expect(parseHeaderSpec(raw)).toEqual({ displayText: raw, control: null });
  });

  test('radio 零選項＝非法 → 視為無控件', () => {
    const raw = '欄{radio:}';
    expect(parseHeaderSpec(raw)).toEqual({ displayText: raw, control: null });
  });

  test('選項含空選項（連續逗號）＝非法 → 視為無控件', () => {
    const raw = '欄{radio:a,,b}';
    expect(parseHeaderSpec(raw)).toEqual({ displayText: raw, control: null });
  });

  test('選項含禁用字元「|」＝非法 → 視為無控件', () => {
    const raw = '欄{radio:a|b,c}';
    expect(parseHeaderSpec(raw)).toEqual({ displayText: raw, control: null });
  });

  test('未知關鍵字 `{word}`：非控件，字面存活（v2-1 GenericAttributes 移除後的回歸鎖）', () => {
    const raw = '欄{word}';
    expect(parseHeaderSpec(raw)).toEqual({ displayText: raw, control: null });
  });

  test('checkbox 帶多餘內容 `{checkbox:x}`＝非法 → 視為無控件', () => {
    const raw = '欄{checkbox:x}';
    expect(parseHeaderSpec(raw)).toEqual({ displayText: raw, control: null });
  });

  test('關鍵字大小寫敏感：`{CHECKBOX}` 不是控件', () => {
    const raw = '欄{CHECKBOX}';
    expect(parseHeaderSpec(raw)).toEqual({ displayText: raw, control: null });
  });

  test('尾碼不在結尾（後面還有文字）→ 不是尾碼、無控件', () => {
    const raw = '欄{checkbox}尾';
    expect(parseHeaderSpec(raw)).toEqual({ displayText: raw, control: null });
  });

  test('表頭文字與尾碼之間的空白：displayText 會 trim 掉', () => {
    expect(parseHeaderSpec('狀態 {radio:a,b}')).toEqual({
      displayText: '狀態',
      control: { kind: 'radio', options: ['a', 'b'] },
    });
  });

  test('尾碼後面只有空白 → 仍算結尾、可成立', () => {
    expect(parseHeaderSpec('狀態{checkbox}  ')).toEqual({
      displayText: '狀態',
      control: { kind: 'checkbox' },
    });
  });

  test('整格只有尾碼（無表頭文字）→ displayText 為空字串', () => {
    expect(parseHeaderSpec('{checkbox}')).toEqual({ displayText: '', control: { kind: 'checkbox' } });
  });

  test('多重（非巢狀）大括號：只認「最後一組」為尾碼、前組留在顯示文字（鎖住現行為；復審 MEDIUM）', () => {
    expect(parseHeaderSpec('狀態{a}{checkbox}')).toEqual({
      displayText: '狀態{a}',
      control: { kind: 'checkbox' },
    });
    // 兩種控件語法疊在同一欄：尾端那組生效，前組（radio 設定）成為字面顯示文字。
    expect(parseHeaderSpec('狀態{radio:a,b}{checkbox}')).toEqual({
      displayText: '狀態{radio:a,b}',
      control: { kind: 'checkbox' },
    });
  });

  test('雙層包裹 {{checkbox}}＝巢狀非法 → 無控件', () => {
    const raw = '{{checkbox}}';
    expect(parseHeaderSpec(raw)).toEqual({ displayText: raw, control: null });
  });
});

describe('resolveChipColor：顏色字面解析', () => {
  test('英文色名（大小寫不敏感）→ 調色盤鍵', () => {
    expect(resolveChipColor('red')).toBe('red');
    expect(resolveChipColor('GREEN')).toBe('green');
    expect(resolveChipColor(' Amber ')).toBe('amber');
  });

  test('別名歸一：yellow/gold→amber、grey→gray、cyan→teal、violet→purple', () => {
    expect(resolveChipColor('yellow')).toBe('amber');
    expect(resolveChipColor('grey')).toBe('gray');
    expect(resolveChipColor('cyan')).toBe('teal');
    expect(resolveChipColor('violet')).toBe('purple');
  });

  test('中文色名 → 調色盤鍵', () => {
    expect(resolveChipColor('紅')).toBe('red');
    expect(resolveChipColor('綠色')).toBe('green');
    expect(resolveChipColor('灰')).toBe('gray');
  });

  test('十六進位（3/6 碼）→ 小寫原樣；非法回 null', () => {
    expect(resolveChipColor('#16A34A')).toBe('#16a34a');
    expect(resolveChipColor('#abc')).toBe('#abc');
    expect(resolveChipColor('#12g')).toBeNull();
    expect(resolveChipColor('rgb(1,2,3)')).toBeNull();
    expect(resolveChipColor('bright-red')).toBeNull();
    expect(resolveChipColor('')).toBeNull();
  });
});

describe('parseHeaderSpec：radio 選項顏色（{radio:值=顏色}）', () => {
  test('每項可帶顏色，options 只留純標籤、colors 為「標籤→色鍵」對照', () => {
    expect(
      parseHeaderSpec('狀態{radio:未看=red,考慮中=amber,已投遞=green,已婉拒=gray,暫不考慮=slate}'),
    ).toEqual({
      displayText: '狀態',
      control: {
        kind: 'radio',
        options: ['未看', '考慮中', '已投遞', '已婉拒', '暫不考慮'],
        colors: { 未看: 'red', 考慮中: 'amber', 已投遞: 'green', 已婉拒: 'gray', 暫不考慮: 'slate' },
      },
    });
  });

  test('部分帶色、部分不帶：colors 只收有指定的項', () => {
    expect(parseHeaderSpec('狀態{radio:未看=red,考慮中,已投遞=green}')).toEqual({
      displayText: '狀態',
      control: {
        kind: 'radio',
        options: ['未看', '考慮中', '已投遞'],
        colors: { 未看: 'red', 已投遞: 'green' },
      },
    });
  });

  test('十六進位色：colors 存小寫十六進位字串', () => {
    expect(parseHeaderSpec('欄{radio:甲=#16A34A,乙}')).toEqual({
      displayText: '欄',
      control: { kind: 'radio', options: ['甲', '乙'], colors: { 甲: '#16a34a' } },
    });
  });

  test('保守解析：`=` 後非合法顏色 → 整段當標籤、不硬拆、不帶 colors 鍵', () => {
    // 與舊行為位元一致（無 colors 鍵）——既有含 `=` 的選項（如 價格=100）不被誤拆。
    expect(parseHeaderSpec('欄{radio:價格=100,數量=abc}')).toEqual({
      displayText: '欄',
      control: { kind: 'radio', options: ['價格=100', '數量=abc'] },
    });
  });

  test('標籤可含 `=`（以最後一個 `=` 切色）：a=b=green → 標籤 a=b、色 green', () => {
    expect(parseHeaderSpec('欄{radio:a=b=green}')).toEqual({
      displayText: '欄',
      control: { kind: 'radio', options: ['a=b'], colors: { 'a=b': 'green' } },
    });
  });

  test('無顏色的 radio 維持原樣（不帶 colors 鍵，與既有測試相容）', () => {
    expect(parseHeaderSpec('狀態{radio:未看,考慮中}')).toEqual({
      displayText: '狀態',
      control: { kind: 'radio', options: ['未看', '考慮中'] },
    });
  });
});

describe('splitTableRowLine：GFM 列切分', () => {
  test('標準列（前後導管線）→ cells 為 trim 後的內容', () => {
    expect(splitTableRowLine('| a | b | c |')).toEqual({
      prefix: '',
      cells: ['a', 'b', 'c'],
      suffix: '',
      valid: true,
    });
  });

  test('無前後導管線的列也切得出來', () => {
    const result = splitTableRowLine('a | b');
    expect(result.valid).toBe(true);
    expect(result.cells).toEqual(['a', 'b']);
  });

  test('跳脫管線 `\\|` 不當分隔符，且 cell 值已還原成 `|`', () => {
    const result = splitTableRowLine('| a \\| b | c |');
    expect(result.valid).toBe(true);
    expect(result.cells).toEqual(['a | b', 'c']);
  });

  test('cell 內含 <br> 原樣保留', () => {
    const result = splitTableRowLine('| 第一行<br>第二行 | x |');
    expect(result.cells).toEqual(['第一行<br>第二行', 'x']);
  });

  test('cell 內含連結 [t](u) 原樣保留', () => {
    const result = splitTableRowLine('| [資深工程師](https://example.com) | 備註 |');
    expect(result.cells).toEqual(['[資深工程師](https://example.com)', '備註']);
  });

  test('空儲存格保留為空字串', () => {
    const result = splitTableRowLine('| a |  | c |');
    expect(result.cells).toEqual(['a', '', 'c']);
  });

  test('blockquote 前綴（`> `）剝進 prefix', () => {
    expect(splitTableRowLine('> | a | b |')).toEqual({
      prefix: '> ',
      cells: ['a', 'b'],
      suffix: '',
      valid: true,
    });
  });

  test('多層 blockquote 前綴', () => {
    const result = splitTableRowLine('> > | a |');
    expect(result.valid).toBe(true);
    expect(result.prefix).toBe('> > ');
    expect(result.cells).toEqual(['a']);
  });

  test('1~3 個空白縮排合法、進 prefix', () => {
    const result = splitTableRowLine('  | a | b |');
    expect(result.valid).toBe(true);
    expect(result.prefix).toBe('  ');
  });

  test('縮排 ≥ 4 空白＝縮排程式碼區塊，前綴不合法 → valid=false', () => {
    expect(splitTableRowLine('    | a | b |').valid).toBe(false);
  });

  test('tab 縮排視同 ≥ 4 空白 → valid=false', () => {
    expect(splitTableRowLine('\t| a | b |').valid).toBe(false);
  });

  test('整行沒有未跳脫管線＝不是表格列 → valid=false', () => {
    expect(splitTableRowLine('只是普通文字').valid).toBe(false);
  });

  test('空行 → valid=false', () => {
    expect(splitTableRowLine('').valid).toBe(false);
  });

  test('行尾空白保留在 suffix', () => {
    const result = splitTableRowLine('| a | b |  ');
    expect(result.valid).toBe(true);
    expect(result.cells).toEqual(['a', 'b']);
    expect(result.suffix).toBe('  ');
  });

  test('分隔列（|---|---|）也是合法表格行', () => {
    const result = splitTableRowLine('|---|---|');
    expect(result.valid).toBe(true);
    expect(result.cells).toEqual(['---', '---']);
  });
});

describe('replaceCellInLine：儲存格替換（保留風格＋round-trip）', () => {
  test('替換中間儲存格，其他儲存格與空白風格原封不動', () => {
    expect(replaceCellInLine('| a | b | c |', 1, '改')).toBe('| a | 改 | c |');
  });

  test('無空白緊湊風格照樣保留', () => {
    expect(replaceCellInLine('|a|b|', 1, 'x')).toBe('|a|x|');
  });

  test('newValue 含管線 → 寫成 `\\|`，再 split 得回原值（round-trip）', () => {
    const replaced = replaceCellInLine('| a | b |', 0, 'x|y');
    expect(replaced).toBe('| x\\|y | b |');
    expect(splitTableRowLine(replaced!).cells).toEqual(['x|y', 'b']);
  });

  test('newValue 以反斜線結尾 → 不得產生假跳脫，round-trip 得回', () => {
    const replaced = replaceCellInLine('|a|b|', 0, 'a\\');
    expect(replaced).not.toBeNull();
    expect(splitTableRowLine(replaced!).cells).toEqual(['a\\', 'b']);
  });

  test('newValue 含換行 → 存成 <br>（儲存格不可含實體換行）', () => {
    expect(replaceCellInLine('| a | b |', 0, 'x\ny')).toBe('| x<br>y | b |');
  });

  test('blockquote 前綴保留', () => {
    expect(replaceCellInLine('> | a | b |', 0, 'z')).toBe('> | z | b |');
  });

  test('行尾空白（suffix）保留', () => {
    expect(replaceCellInLine('| a | b |  ', 0, 'A')).toBe('| A | b |  ');
  });

  test('原本是空儲存格（兩空白）→ 以標準單空白 padding 寫入', () => {
    expect(replaceCellInLine('| a |  | c |', 1, 'x')).toBe('| a | x | c |');
  });

  test('原本是零寬空儲存格（||）→ 不補 padding', () => {
    expect(replaceCellInLine('| a || c |', 1, 'x')).toBe('| a |x| c |');
  });

  test('cellIndex 越界 → 回 null 不丟例外', () => {
    expect(replaceCellInLine('| a | b |', 5, 'x')).toBeNull();
  });

  test('非表格列 → 回 null', () => {
    expect(replaceCellInLine('# 標題', 0, 'x')).toBeNull();
  });

  test('round-trip 保證：split→replace→join→再 split，各值一致', () => {
    const line = '>  | 未看 | [職缺](https://e.com) |  | 備註 |   ';
    const before = splitTableRowLine(line);
    const replaced = replaceCellInLine(line, 2, '新值');
    expect(replaced).not.toBeNull();
    const after = splitTableRowLine(replaced!);
    expect(after.valid).toBe(true);
    expect(after.prefix).toBe(before.prefix);
    expect(after.suffix).toBe(before.suffix);
    expect(after.cells).toEqual(['未看', '[職缺](https://e.com)', '新值', '備註']);
  });
});

describe('setCellValueInContent：整份內容的儲存格寫回', () => {
  const contentLines = [
    '# 標題',
    '',
    '| 狀態 | 職缺 |',
    '|---|---|',
    '| 未看 | A職缺 |',
    '| 已投遞 | B職缺 |',
  ];
  const content = contentLines.join('\n');

  test('1-based 行號正確落在 split 索引（off-by-one 鎖）：mdLine=5 改的是 index 4', () => {
    const result = setCellValueInContent(content, 5, 0, '已投遞');
    expect(result).not.toBeNull();
    const lines = result!.split('\n');
    expect(lines[4]).toBe('| 已投遞 | A職缺 |');
    // 其他行位元組不變。
    expect(lines[0]).toBe('# 標題');
    expect(lines[2]).toBe('| 狀態 | 職缺 |');
    expect(lines[5]).toBe('| 已投遞 | B職缺 |');
  });

  test('CRLF 內容：處理後行尾風格還原為 CRLF', () => {
    const crlfContent = contentLines.join('\r\n');
    const result = setCellValueInContent(crlfContent, 5, 0, '已投遞');
    const expected = [
      '# 標題',
      '',
      '| 狀態 | 職缺 |',
      '|---|---|',
      '| 已投遞 | A職缺 |',
      '| 已投遞 | B職缺 |',
    ].join('\r\n');
    expect(result).toBe(expected);
  });

  test('混合行尾：各行保留自己原本的行尾（逐行剝 \\r 處理）', () => {
    const mixed = 'a\r\n| x | y |\nb';
    expect(setCellValueInContent(mixed, 2, 0, 'x2')).toBe('a\r\n| x2 | y |\nb');
  });

  test('行號越界（0 與超過總行數）→ 回 null', () => {
    expect(setCellValueInContent(content, 0, 0, 'x')).toBeNull();
    expect(setCellValueInContent(content, 99, 0, 'x')).toBeNull();
  });

  test('該行非表格列 → 回 null 不改內容', () => {
    expect(setCellValueInContent(content, 1, 0, 'x')).toBeNull();
  });

  test('cellIndex 越界 → 回 null', () => {
    expect(setCellValueInContent(content, 5, 9, 'x')).toBeNull();
  });
});

describe('getCellRawFromContent：取儲存格原始值（直編 textarea 初始內容）', () => {
  const content = [
    '# 標題',
    '',
    '| 狀態 | 職缺 |',
    '|---|---|',
    '| 未看 | [A職缺](https://e.com) |',
  ].join('\n');

  test('1-based 行號＋欄索引取值（與 setCellValueInContent 同一套定位）', () => {
    expect(getCellRawFromContent(content, 5, 0)).toBe('未看');
    expect(getCellRawFromContent(content, 5, 1)).toBe('[A職缺](https://e.com)');
  });

  test('跳脫已還原：`\\|` 讀回 `|`；與 setCellValueInContent 成對 round-trip（原值寫回＝位元組不變）', () => {
    const escapedContent = '| a \\| b | c |';
    expect(getCellRawFromContent(escapedContent, 1, 0)).toBe('a | b');
    // 讀出來的值原封不動寫回去 → 整份內容位元組不變（直編開了又存、沒改字＝無變更）。
    expect(setCellValueInContent(escapedContent, 1, 0, 'a | b')).toBe(escapedContent);
  });

  test('空儲存格 → 空字串（非 null）', () => {
    expect(getCellRawFromContent('| a |  | c |', 1, 1)).toBe('');
  });

  test('CRLF 內容也取得到', () => {
    const crlf = ['| a | b |', '|---|---|', '| v1 | v2 |'].join('\r\n');
    expect(getCellRawFromContent(crlf, 3, 1)).toBe('v2');
  });

  test('行號越界／非表格列／欄索引越界 → 回 null', () => {
    expect(getCellRawFromContent(content, 0, 0)).toBeNull();
    expect(getCellRawFromContent(content, 99, 0)).toBeNull();
    expect(getCellRawFromContent(content, 1, 0)).toBeNull(); // 標題行
    expect(getCellRawFromContent(content, 5, 9)).toBeNull();
  });
});

describe('checkbox 值域 helper', () => {
  test('isCheckedValue：[x] 為勾選（含大寫 X 與前後空白容錯）', () => {
    expect(isCheckedValue('[x]')).toBe(true);
    expect(isCheckedValue('[X]')).toBe(true);
    expect(isCheckedValue(' [x] ')).toBe(true);
  });

  test('isCheckedValue：[ ]、空字串、純空白皆為未勾（空儲存格視同 [ ]）', () => {
    expect(isCheckedValue('[ ]')).toBe(false);
    expect(isCheckedValue('')).toBe(false);
    expect(isCheckedValue('  ')).toBe(false);
  });

  test('isCheckedValue：其他文字一律未勾', () => {
    expect(isCheckedValue('任意文字')).toBe(false);
    expect(isCheckedValue('[]')).toBe(false);
  });

  test('serializeCheckedValue：true → [x]、false → [ ]', () => {
    expect(serializeCheckedValue(true)).toBe('[x]');
    expect(serializeCheckedValue(false)).toBe('[ ]');
  });
});

describe('toggleCellCheckbox：儲存格內多 checkbox（A6，測試計畫 B7-1/B7-2）', () => {
  test('B7-1: 切換第 k 個標記、其餘位元組不動', () => {
    expect(toggleCellCheckbox('[ ] 甲<br>[x] 乙', 0)).toBe('[x] 甲<br>[x] 乙');
    expect(toggleCellCheckbox('[ ] 甲<br>[x] 乙', 1)).toBe('[ ] 甲<br>[ ] 乙');
    expect(toggleCellCheckbox('[X] 大寫', 0)).toBe('[ ] 大寫');
    expect(toggleCellCheckbox('[ ]', 0)).toBe('[x]'); // 無後綴文字也算
  });

  test('B7-2: 段首以外的 [ ] 不算標記（不誤切）', () => {
    expect(countCellCheckboxes('昨天 [ ] 甲')).toBe(0);
    expect(countCellCheckboxes('[ ] 甲<br>昨天 [x] 乙')).toBe(1);
    expect(countCellCheckboxes('`[ ]` 程式碼')).toBe(0); // 段首不是字面 [ ]
    expect(countCellCheckboxes('[y] 非法標記')).toBe(0);
    expect(countCellCheckboxes('[ ]x 後面黏字不算')).toBe(0);
  });

  test('段首允許前導空白；<br> 變體也是段界', () => {
    expect(countCellCheckboxes(' [ ] 甲<br/> [x] 乙')).toBe(2);
    expect(toggleCellCheckbox(' [ ] 甲<br/> [x] 乙', 1)).toBe(' [ ] 甲<br/> [ ] 乙');
  });

  test('索引越界回 null', () => {
    expect(toggleCellCheckbox('[ ] 甲', 1)).toBeNull();
    expect(toggleCellCheckbox('沒有標記', 0)).toBeNull();
  });
});

describe('unescapeCellBr：直編顯示對稱（<br> 家族 → 真實換行）', () => {
  // 對應測試計畫 B4-1/B4-2/B4-7：與後端 HtmlLineBreakInlineExtension 同款白名單
  //（<br>/<br/>/<br />，大小寫不敏感、標籤內允許空白／Tab）。

  test('B4-1: <br> 家族各變體皆轉成 \\n', () => {
    expect(unescapeCellBr('a<br>b')).toBe('a\nb');
    expect(unescapeCellBr('a<br/>b')).toBe('a\nb');
    expect(unescapeCellBr('a<br />b')).toBe('a\nb');
    expect(unescapeCellBr('a<BR>b')).toBe('a\nb');
    expect(unescapeCellBr('a<br >b')).toBe('a\nb');
    expect(unescapeCellBr('a<br  />b')).toBe('a\nb');
    expect(unescapeCellBr('a<br>b<br>c')).toBe('a\nb\nc');
  });

  test('B4-2: 非白名單標籤維持字面（不擴大轉換面）', () => {
    expect(unescapeCellBr('a<brs>b')).toBe('a<brs>b');
    expect(unescapeCellBr('a<br x>b')).toBe('a<br x>b');
    expect(unescapeCellBr('a<div>b')).toBe('a<div>b');
    expect(unescapeCellBr('沒有標籤')).toBe('沒有標籤');
  });

  test('B4-7: 白名單與 remarkHtmlLineBreak 的 BR_PATTERN 同步（防拷貝漂移）', () => {
    const accepted = ['<br>', '<br/>', '<br />', '<BR>', '<br >', '<br  />'];
    const rejected = ['<brs>', '<br x>', '<br"', '<b r>'];
    for (const token of accepted) {
      expect(unescapeCellBr(`a${token}b`)).toBe('a\nb');
      expect(BR_PATTERN.test(token)).toBe(true);
      BR_PATTERN.lastIndex = 0; // 全域旗標正則：歸零避免測試間污染
    }
    for (const token of rejected) {
      expect(unescapeCellBr(`a${token}b`)).toBe(`a${token}b`);
      expect(BR_PATTERN.test(token)).toBe(false);
      BR_PATTERN.lastIndex = 0;
    }
  });

  test('round-trip：unescape 後照直編存檔路徑 escape 回去，得回正規形 <br>', () => {
    // 直編開啟（unescape）→ 使用者未改 → 不存檔（無變更判斷在 readingTableInteractive）；
    // 若有改，escapeCellText（經 replaceCellInLine）會把 \n 轉回 <br>。
    const line = '| a<br>b | c |';
    const cell = splitTableRowLine(line).cells[0];
    const edited = unescapeCellBr(cell); // 'a\nb'
    expect(replaceCellInLine(line, 0, edited)).toBe('| a<br>b | c |');
  });
});
