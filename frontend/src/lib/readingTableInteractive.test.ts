// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest';
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

// ─── 直編顯示對稱：<br> → 真實換行（測試計畫 B4-3~B4-6）────────────────────

/** 對指定儲存格連點兩下右鍵開啟直編，回傳建立出的 textarea（找不到＝null）。 */
function openEditorOn(cell: HTMLTableCellElement): HTMLTextAreaElement | null {
  cell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  cell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  return cell.querySelector('textarea.zw-cell-editor');
}

/** 觸發 blur → save 流程並讓 saveCell 的 promise 走完。 */
async function blurAndSettle(editor: HTMLTextAreaElement): Promise<void> {
  editor.dispatchEvent(new FocusEvent('blur'));
  await Promise.resolve();
  await Promise.resolve();
}

// ─── 儲存格內多 checkbox（A6，測試計畫 B7-3~B7-6）────────────────────────

/**
 * 建「兩欄、一列」的表：第二格由 (string | 'br')[] 組成（模擬後端渲染的 文字＋<br> 結構）。
 * @param segments 第二格的節點序列。
 * @param withLine 是否標 data-md-line（可寫回）。
 * @param headerCell 第二欄表頭文字（預設無控件）。
 */
function buildChecklistTable(
  segments: (string | 'br')[],
  withLine = true,
  headerCell = '待辦',
): { table: HTMLTableElement; td: HTMLTableCellElement } {
  const table = document.createElement('table');
  table.setAttribute('data-md-table', '');
  const headerRow = table.createTHead().insertRow();
  for (const text of ['項目', headerCell]) {
    const th = document.createElement('th');
    th.textContent = text;
    headerRow.appendChild(th);
  }
  const tr = table.createTBody().insertRow();
  if (withLine) tr.setAttribute('data-md-line', '3');
  tr.insertCell().textContent = '甲';
  const td = tr.insertCell();
  for (const seg of segments) {
    td.appendChild(seg === 'br' ? document.createElement('br') : document.createTextNode(seg));
  }
  document.body.appendChild(table);
  return { table, td };
}

describe('儲存格內多 checkbox（一格多待辦，像 OneNote）', () => {
  function setupChecklist(
    segments: (string | 'br')[],
    raw: string | null,
    withLine = true,
    headerCell = '待辦',
  ) {
    const interactions = {
      getCellRaw: vi.fn((): string | null => raw),
      saveCell: vi.fn(async (): Promise<boolean> => true),
    };
    const { table, td } = buildChecklistTable(segments, withLine, headerCell);
    const controls = prepareHeaderControls(table);
    setupInteractiveTable(table, 0, 'note-checklist', controls, interactions);
    return { interactions, td };
  }

  test('B7-3: 段首 [ ]/[x] 渲染成核取方塊、勾選狀態正確', () => {
    const { td } = setupChecklist(['[ ] 設好 API', 'br', '[x] 設定 Slack'], '[ ] 設好 API<br>[x] 設定 Slack');
    const boxes = td.querySelectorAll<HTMLInputElement>('input.zw-cell-cbx');
    expect(boxes).toHaveLength(2);
    expect(boxes[0].checked).toBe(false);
    expect(boxes[1].checked).toBe(true);
    expect(td.textContent).toContain('設好 API'); // 文字保留、只剝掉 [ ] 字面
    expect(td.textContent).not.toContain('[ ]');
  });

  test('B7-4: 點擊第 k 個 → saveCell 收到切換後的完整 raw', async () => {
    const { interactions, td } = setupChecklist(
      ['[ ] 設好 API', 'br', '[x] 設定 Slack'],
      '[ ] 設好 API<br>[x] 設定 Slack',
    );
    const boxes = td.querySelectorAll<HTMLInputElement>('input.zw-cell-cbx');
    boxes[0].click();
    await Promise.resolve();
    expect(interactions.saveCell).toHaveBeenCalledWith(3, 1, '[x] 設好 API<br>[x] 設定 Slack');
  });

  test('B7-5: {checkbox} 控件欄的「純 [ ] 格」維持整格單一勾選', () => {
    const { td } = setupChecklist(['[ ]'], '[ ]', true, '完成{checkbox}');
    expect(td.querySelectorAll('input.zw-cell-cbx')).toHaveLength(0);
    expect(td.querySelectorAll('input.zw-cell-checkbox')).toHaveLength(1); // 既有控件仍在
  });

  test('B7-5b: {checkbox} 控件欄的「多段/帶標籤格」→ 多 checkbox、標籤可見（使用者 2026-08-13 回報案例）', async () => {
    const { interactions, td } = setupChecklist(
      ['[ ] 甲', 'br', '[x] 乙'],
      '[ ] 甲<br>[x] 乙',
      true,
      '完成{checkbox}',
    );
    const boxes = td.querySelectorAll<HTMLInputElement>('input.zw-cell-cbx');
    expect(boxes).toHaveLength(2);
    expect(td.querySelectorAll('input.zw-cell-checkbox')).toHaveLength(0); // 不再被整格單勾吃掉
    expect(td.textContent).toContain('甲');
    expect(td.textContent).toContain('乙');
    expect(boxes[1].checked).toBe(true);
    // 點擊寫回照常（同一條 saveCell 路徑）。
    boxes[0].click();
    await Promise.resolve();
    expect(interactions.saveCell).toHaveBeenCalledWith(3, 1, '[x] 甲<br>[x] 乙');
  });

  test('B7-5c: {checkbox} 控件欄的「帶標籤單段格」（[ ] 甲）→ 一顆多 checkbox＋標籤可見', () => {
    const { td } = setupChecklist(['[ ] 甲'], '[ ] 甲', true, '完成{checkbox}');
    expect(td.querySelectorAll('input.zw-cell-cbx')).toHaveLength(1);
    expect(td.querySelectorAll('input.zw-cell-checkbox')).toHaveLength(0);
    expect(td.textContent).toContain('甲');
  });

  test('B7-6: 無 data-md-line（不可寫回）→ 不渲染互動 checkbox', () => {
    const { td } = setupChecklist(['[ ] 甲'], '[ ] 甲', false);
    expect(td.querySelectorAll('input.zw-cell-cbx')).toHaveLength(0);
  });

  test('安全比對：DOM 偵測數 ≠ raw 標記數 → 整格放棄（不錯切）', () => {
    // raw 只有 0 個標記（例如 \[ ] 跳脫造成 DOM 與 raw 不同構）→ 不增強。
    const { td } = setupChecklist(['[ ] 甲'], '\\[ ] 甲');
    expect(td.querySelectorAll('input.zw-cell-cbx')).toHaveLength(0);
  });
});

describe('讀模式直編：開啟編輯器時 <br> 還原成真實換行', () => {
  /** 建含一列兩欄（無控件表頭）的表，第二欄為直編目標。 */
  function buildEditableTable(interactions: Parameters<typeof setupInteractiveTable>[4]): HTMLTableCellElement {
    const table = buildStatusTable('狀態{radio:未看}', ['未看']);
    const controls = prepareHeaderControls(table);
    setupInteractiveTable(table, 0, 'note-unescape', controls, interactions);
    return table.tBodies[0].rows[0].cells[1];
  }

  test('B4-3: 格值 a<br>b → textarea 初值 a\\nb、rows=2（不再看到字面 <br>）', () => {
    const interactions = {
      getCellRaw: vi.fn((): string | null => 'a<br>b'),
      saveCell: vi.fn(async (): Promise<boolean> => true),
    };
    const editor = openEditorOn(buildEditableTable(interactions));
    expect(editor).not.toBeNull();
    expect(editor!.value).toBe('a\nb');
    expect(editor!.rows).toBe(2);
  });

  test('B4-4: 開啟後未改直接 blur → 不呼叫 saveCell（無變更比較用還原後值）', async () => {
    const interactions = {
      getCellRaw: vi.fn((): string | null => 'a<br>b'),
      saveCell: vi.fn(async (): Promise<boolean> => true),
    };
    const editor = openEditorOn(buildEditableTable(interactions))!;
    await blurAndSettle(editor);
    expect(interactions.saveCell).not.toHaveBeenCalled();
  });

  test('B4-5: 格值含變體 a<br/>b 開啟未改 blur → 不存檔（變體不因開關而被正規化）', async () => {
    const interactions = {
      getCellRaw: vi.fn((): string | null => 'a<br/>b'),
      saveCell: vi.fn(async (): Promise<boolean> => true),
    };
    const editor = openEditorOn(buildEditableTable(interactions))!;
    expect(editor.value).toBe('a\nb');
    await blurAndSettle(editor);
    expect(interactions.saveCell).not.toHaveBeenCalled();
  });

  test('B4-6: 改字後 blur → saveCell 收到含真實換行的新值（\\n→<br> 由既有 escape 處理）', async () => {
    const interactions = {
      getCellRaw: vi.fn((): string | null => 'a<br>b'),
      saveCell: vi.fn(async (): Promise<boolean> => true),
    };
    const editor = openEditorOn(buildEditableTable(interactions))!;
    editor.value = 'a\nb\nc';
    await blurAndSettle(editor);
    expect(interactions.saveCell).toHaveBeenCalledWith(3, 1, 'a\nb\nc');
  });
});
