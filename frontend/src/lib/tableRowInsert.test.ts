import { describe, expect, test } from 'vitest';
import { appendEmptyTableRow } from './tableRowInsert';

/**
 * 讀模式表格「＋ 新增一行」的純函式測試（測試計畫 包5 T1–T10）。
 * appendEmptyTableRow(content, anchorMdLine)：
 * - anchorMdLine（1 起算，同後端 data-md-line）指向該表任一資料/表頭列；
 * - 在該表「連續表格區塊」的最後一列之後插入空列（欄數以分隔列為準）；
 * - 定位失敗（非表格列、圍欄內、無分隔列的偽表格…）回 null。
 */

const TABLE = ['| 姓名 | 年齡 | 備註 |', '| --- | --- | --- |', '| 甲 | 1 | x |', '| 乙 | 2 | y |'].join(
  '\n',
);

describe('appendEmptyTableRow', () => {
  test('T1：標準 3 欄表、anchor=中間資料列 → 在最後一列後插入 3 欄空列', () => {
    const result = appendEmptyTableRow(TABLE, 3);
    expect(result).toBe(`${TABLE}\n|  |  |  |`);
  });

  test('T1b：anchor=表頭列也可（同一區塊）', () => {
    const result = appendEmptyTableRow(TABLE, 1);
    expect(result).toBe(`${TABLE}\n|  |  |  |`);
  });

  test('T2：表格後緊接段落 → 插入位置在表尾與段落之間', () => {
    const content = `${TABLE}\n\n後面的段落`;
    const result = appendEmptyTableRow(content, 3);
    expect(result).toBe(`${TABLE}\n|  |  |  |\n\n後面的段落`);
  });

  test('T3：圍欄內的偽表格行 → null', () => {
    const content = ['```', '| a | b |', '| --- | --- |', '| 1 | 2 |', '```'].join('\n');
    expect(appendEmptyTableRow(content, 2)).toBeNull();
  });

  test('T4：anchor 行不是表格列 → null', () => {
    const content = `普通段落\n${TABLE}`;
    expect(appendEmptyTableRow(content, 1)).toBeNull();
  });

  test('T5：含跳脫管線的資料列 → 欄數以分隔列為準、插入正確', () => {
    const content = ['| A | B |', '| --- | --- |', '| a\\|b | c |'].join('\n');
    const result = appendEmptyTableRow(content, 3);
    expect(result).toBe(`${content}\n|  |  |`);
  });

  test('T6：檔尾無換行 → 插入後不黏行、不多出空行', () => {
    const result = appendEmptyTableRow(TABLE, 4);
    expect(result).toBe(`${TABLE}\n|  |  |  |`);
  });

  test('T7：CRLF 行尾 → 照 tableSpec 慣例正確處理（新列同樣帶 \\r）', () => {
    const crlf = TABLE.replace(/\n/g, '\r\n');
    const result = appendEmptyTableRow(crlf, 3);
    expect(result).toBe(`${crlf}\r\n|  |  |  |`);
  });

  test('T8：anchorMdLine 超出範圍 → null', () => {
    expect(appendEmptyTableRow(TABLE, 99)).toBeNull();
    expect(appendEmptyTableRow(TABLE, 0)).toBeNull();
  });

  test('T9：無分隔列的偽表格（連續管線行但第二行不是 ---） → null', () => {
    const content = ['| a | b |', '| c | d |', '| e | f |'].join('\n');
    expect(appendEmptyTableRow(content, 2)).toBeNull();
  });

  test('T10：blockquote 前綴表格 → 新列重建前綴', () => {
    const content = ['> | A | B |', '> | --- | --- |', '> | 1 | 2 |'].join('\n');
    const result = appendEmptyTableRow(content, 3);
    expect(result).toBe(`${content}\n> |  |  |`);
  });

  test('文件中有兩張表 → 只動 anchor 所在那張', () => {
    const other = ['| X |', '| --- |', '| z |'].join('\n');
    const content = `${TABLE}\n\n${other}`;
    const result = appendEmptyTableRow(content, 8); // 第二張表的資料列（1起算：6,7,8）
    expect(result).toBe(`${TABLE}\n\n${other}\n|  |`);
  });
});
