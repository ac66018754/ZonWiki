// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { prepareHeaderControls, setupInteractiveTable } from './readingTableInteractive';

/**
 * 讀模式互動表格的 DOM 整合測試（jsdom）——聚焦「表頭 {radio:值=顏色} 宣告 → chip 著色」的渲染路徑。
 *
 * 走真實程式路徑：prepareHeaderControls（剝尾碼＋解析控件）→ setupInteractiveTable（渲染 chip、套色）。
 * 驗證重點：
 * - 有指定顏色的選項 → chip 的 data-zw-color＝對應色鍵；未指定 → 無 data-zw-color。
 * - 十六進位色 → data-zw-color="hex" ＋ 內聯 --zw-chip-hex。
 * - 表頭尾碼（含 =顏色）被剝除，只留純標題文字。
 */

/** 最小可互動介面（本測試不觸發寫回，getCellRaw/saveCell 給空實作即可）。 */
const noopInteractions = {
  getCellRaw: (): string | null => null,
  saveCell: async (): Promise<boolean> => true,
};

/**
 * 建一張「後端已標 data-md-table」的表：表頭一格（狀態）＋一格（項目），
 * 每列首格＝狀態值、第二格＝項目名，並帶 data-md-line（可寫回的正整數行號）。
 * @param headerCell 狀態欄表頭文字（含 {radio:…} 尾碼）。
 * @param statusValues 各列的狀態值。
 * @returns 組好的 table 元素（已掛進 document.body）。
 */
function buildStatusTable(headerCell: string, statusValues: string[]): HTMLTableElement {
  const table = document.createElement('table');
  table.setAttribute('data-md-table', '');

  const headerRow = table.createTHead().insertRow();
  const statusTh = document.createElement('th');
  statusTh.textContent = headerCell;
  headerRow.appendChild(statusTh);
  const itemTh = document.createElement('th');
  itemTh.textContent = '項目';
  headerRow.appendChild(itemTh);

  const tbody = table.createTBody();
  statusValues.forEach((value, index) => {
    const tr = tbody.insertRow();
    tr.setAttribute('data-md-line', String(index + 3)); // 任意正整數行號
    const statusTd = tr.insertCell();
    statusTd.textContent = value;
    const itemTd = tr.insertCell();
    itemTd.textContent = `項目${index + 1}`;
  });

  document.body.appendChild(table);
  return table;
}

/** 取 tbody 內狀態欄的所有 chip。 */
function statusChips(table: HTMLTableElement): HTMLElement[] {
  return Array.from(table.querySelectorAll<HTMLElement>('tbody .zw-cell-radio-chip'));
}

describe('readingTableInteractive：radio chip 依表頭宣告著色', () => {
  test('命名顏色：有指定的著色、未指定的無 data-zw-color', () => {
    const table = buildStatusTable(
      '狀態{radio:未看=red,考慮中,已投遞=green,已婉拒=gray}',
      ['未看', '考慮中', '已投遞', '已婉拒'],
    );
    const controls = prepareHeaderControls(table);
    setupInteractiveTable(table, 0, 'note-color', controls, noopInteractions);

    const chips = statusChips(table);
    expect(chips.map((chip) => chip.textContent)).toEqual(['未看', '考慮中', '已投遞', '已婉拒']);
    expect(chips[0].dataset.zwColor).toBe('red');
    expect(chips[1].dataset.zwColor).toBeUndefined(); // 考慮中 未指定 → 無色
    expect(chips[2].dataset.zwColor).toBe('green');
    expect(chips[3].dataset.zwColor).toBe('gray');
  });

  test('十六進位色：data-zw-color="hex" 並帶內聯 --zw-chip-hex', () => {
    const table = buildStatusTable('狀態{radio:甲=#16A34A,乙}', ['甲', '乙']);
    const controls = prepareHeaderControls(table);
    setupInteractiveTable(table, 0, 'note-hex', controls, noopInteractions);

    const chips = statusChips(table);
    expect(chips[0].dataset.zwColor).toBe('hex');
    expect(chips[0].style.getPropertyValue('--zw-chip-hex')).toBe('#16a34a');
    expect(chips[1].dataset.zwColor).toBeUndefined();
  });

  test('表頭尾碼（含 =顏色）被剝除，只留純標題文字', () => {
    const table = buildStatusTable('狀態{radio:未看=red,已投遞=green}', ['未看']);
    prepareHeaderControls(table);
    const statusTh = table.tHead!.rows[0].cells[0];
    expect((statusTh.textContent ?? '').trim()).toBe('狀態');
    expect(statusTh.dataset.zwHeaderText).toBe('狀態');
  });

  test('無配色表頭：chip 正常渲染、皆無 data-zw-color（相容既有）', () => {
    const table = buildStatusTable('狀態{radio:未看,已投遞}', ['未看', '已投遞']);
    const controls = prepareHeaderControls(table);
    setupInteractiveTable(table, 0, 'note-plain', controls, noopInteractions);

    const chips = statusChips(table);
    expect(chips).toHaveLength(2);
    expect(chips.every((chip) => chip.dataset.zwColor === undefined)).toBe(true);
  });
});
