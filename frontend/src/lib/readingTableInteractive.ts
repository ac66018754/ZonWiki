/**
 * 讀模式互動表格機制（由 enhanceReadingTables 於每張 data-md-table 表首次增強時呼叫一次）：
 * - 表頭尾碼宣告的控件欄（radio chip／checkbox）就地渲染與寫回
 * - 表頭點擊排序（無→升→降→無；搬移既有 tr 節點，畫記 [data-anno] 包裹跟著列走）
 * - 欄篩選（漏斗按鈕＋相異值面板；只用 CSS display:none 隱藏、絕不移出 DOM——
 *   textContent/Range 座標不變 → 畫記不斷錨、浮層錨點自然隱藏）
 * - 雙右鍵儲存格直編（textarea 就地編輯原始 Markdown 片段）＋表格內右鍵選單抑制
 * - 檢視狀態 localStorage 持久化與首次增強時還原
 *
 * 錨定安全設計（與 NoteMarksLayer／NoteOverlay 的約定）：
 * - 排序/篩選作用中在 table 標 `data-zw-view-altered`——NoteMarksLayer 據此延後「標失效」
 *   回寫並暫停新建標註（DOM 非原始狀態時的座標不可入庫）。
 * - 任何版面變動後派發 `zonwiki:layout-changed`，讓浮層立即 rebase 而不必等捲動。
 */
import {
  parseHeaderSpec,
  isCheckedValue,
  unescapeCellBr,
  toggleCellCheckbox,
  countCellCheckboxes,
  type HeaderControl,
} from './tableSpec';
import {
  compareCellValues,
  rowPassesFilters,
  readTableView,
  writeTableView,
  type TableViewState,
} from './tableView';
import { createDoubleRightClickTracker } from './doubleRightClick';

/** 排序/篩選作用中（DOM 非原始狀態）標在 table 上的屬性；NoteMarksLayer 據此延後「標失效」回寫。 */
const VIEW_ALTERED_ATTR = 'data-zw-view-altered';

/**
 * 讀模式互動表格的寫回介面（由筆記頁提供；未提供＝表格仍可排序/篩選，但控件唯讀、不可直編）。
 */
export type ReadingTableInteractions = {
  /**
   * 取得某儲存格的「原始 Markdown 片段」（直編 textarea 的初始內容）。
   * @param mdLine 該列在原文的行號（1 起算，來自後端 data-md-line）。
   * @param cellIndex 欄索引（0 起算）。
   * @returns 原始片段；行號/欄索引對不上原文時回 null（該格降級為不可直編）。
   */
  getCellRaw: (mdLine: number, cellIndex: number) => string | null;
  /**
   * 寫回某儲存格的新值（改原文該行該欄 → PUT 筆記；成功後上層會以最新筆記重注入整段 HTML）。
   * @param mdLine 該列在原文的行號（1 起算）。
   * @param cellIndex 欄索引（0 起算）。
   * @param newValue 新的儲存格原始內容。
   * @returns 是否成功（失敗時上層負責 toast，本層負責還原樂觀 UI／保留編輯內容）。
   */
  saveCell: (mdLine: number, cellIndex: number, newValue: string) => Promise<boolean>;
  /**
   * 在表格最後一列後插入一列空儲存格（2026-08-13「＋ 新增一行」鈕）。
   * 以該表任一列的 data-md-line 當定位錨；原文層的區塊定位與欄數推導由
   * lib/tableRowInsert.ts 處理。未提供時不顯示加行鈕（相容舊呼叫端）。
   * @param anchorMdLine 該表任一列在原文的行號（1 起算）。
   * @returns 是否成功（成功後上層重注入 HTML，新空列就地出現）。
   */
  insertRow?: (anchorMdLine: number) => Promise<boolean>;
};

/**
 * 在互動表格下方掛「＋ 新增一行」鈕（2026-08-13）：點擊即於原文表尾插入空列，
 * 走 insertRow（applyReadingEdit 管線）寫回；成功後整段 HTML 重注入、新列就地出現。
 *
 * - 錨點取表格「最後一個帶 data-md-line 的列」；整表皆無行號（不可寫回）＝不掛鈕。
 * - 排序/篩選作用中照常可按——語意固定為「追加到原文表尾」（畫面落點可能因排序不同，屬預期）。
 * - hover 才醒目、觸控裝置常駐顯示（樣式見 globals.css 的 .zw-table-addrow）。
 *
 * @param table 目標表格（已由 enhanceReadingTables 增強）。
 * @param interactions 讀模式寫回介面（需含 insertRow）。
 */
export function attachAddRowButton(
  table: HTMLTableElement,
  interactions: ReadingTableInteractions,
): void {
  const insertRow = interactions.insertRow;
  if (!insertRow) return;

  const rowsWithLine = table.querySelectorAll<HTMLTableRowElement>('tr[data-md-line]');
  const lastRow = rowsWithLine.length > 0 ? rowsWithLine[rowsWithLine.length - 1] : null;
  const anchorMdLine = lastRow ? Number.parseInt(lastRow.dataset.mdLine ?? '', 10) : NaN;
  if (!Number.isFinite(anchorMdLine)) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'zw-table-addrow';
  button.textContent = '＋ 新增一行';
  button.title = '在此表格底部新增一列（儲存格皆為空，可雙右鍵直編）';
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    button.disabled = true;
    try {
      // 失敗的 toast 由 applyReadingEdit（上層）統一處理；成功後整段重注入、本鈕隨舊 DOM 汰換。
      await insertRow(anchorMdLine);
    } finally {
      button.disabled = false;
    }
  });

  // 插在橫向捲動容器（.md-table-wrap）「外面」：寬表格橫捲時按鈕不可跟著捲出可視範圍
  //（二輪復審 M：手機表格橫捲是本專案特別優化過的情境，按鈕必須固定可見）。
  const host = table.closest('.md-table-wrap') ?? table;
  host.insertAdjacentElement('afterend', button);
}

/** 通知浮層（便利貼/文字框/塗鴉）「版面因排序/篩選變動了」，立即 rebase 而不必等捲動。 */
function dispatchLayoutChanged(): void {
  window.dispatchEvent(new CustomEvent('zonwiki:layout-changed'));
}

/**
 * 目前開啟中的浮動選單關閉器（模組級、同時只有一個）。
 * 掛模組級而非表格閉包的原因（復審 HIGH）：面板 append 在 document.body、不在內文子樹內——
 * 整段 HTML 重注入時舊表格被丟棄，但孤兒面板會殘留且其選項仍可觸發「以過期行號寫回」；
 * 故 enhanceReadingTables 每次重跑（＝重注入後）都先關掉殘留面板。
 */
let activePopoverCloser: (() => void) | null = null;

/** 關閉目前開啟中的表格浮動選單（無則不動作）。 */
export function closeActiveTablePopover(): void {
  activePopoverCloser?.();
  activePopoverCloser = null;
}

/**
 * 取表格的表頭儲存格（thead 第一列；無 thead 時取整表第一列）。
 * @param table 目標表格。
 * @returns 表頭儲存格陣列。
 */
function getHeaderCellsOf(table: HTMLTableElement): HTMLTableCellElement[] {
  const thead = table.tHead;
  if (thead && thead.rows.length > 0) return Array.from(thead.rows[0].cells);
  const firstRow = table.rows[0];
  return firstRow ? Array.from(firstRow.cells) : [];
}

/**
 * 解析並定版表頭：剝除 `{radio:…}`/`{checkbox}` 尾碼（只動最後一個文字節點；尾碼被行內格式
 * 拆散＝非法＝不啟用控件），把「剝除後的定版文字」快照進 th.dataset.zwHeaderText——
 * 欄寬紀錄與檢視狀態的簽章一律讀此快照，之後 th 內新增的把手/漏斗（無文字、icon 走 CSS
 * pseudo-element）不會污染比對。
 * @param table 目標表格。
 * @returns 各欄的控件宣告（無控件＝null）。
 */
export function prepareHeaderControls(table: HTMLTableElement): (HeaderControl | null)[] {
  const headerCells = getHeaderCellsOf(table);
  return headerCells.map((cell) => {
    const raw = (cell.textContent ?? '').trim();
    const spec = parseHeaderSpec(raw);
    if (spec.control) {
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      let lastText: Text | null = null;
      while (walker.nextNode()) lastText = walker.currentNode as Text;
      const suffix = raw.slice(spec.displayText.length);
      if (lastText && suffix && lastText.data.includes(suffix)) {
        lastText.data = lastText.data.replace(suffix, '');
      } else if (suffix) {
        // 尾碼不完整位於最後一個文字節點（被粗體等行內格式拆散）→ 視為非法宣告、原樣顯示。
        cell.dataset.zwHeaderText = raw;
        return null;
      }
    }
    cell.dataset.zwHeaderText = spec.displayText;
    return spec.control;
  });
}

/**
 * 取某列某欄的「排序/篩選用值」：控件欄以 dataset.zwValue 為準（chip 渲染後 textContent
 * 可能含「未設定」佔位字），一般欄取 textContent（畫記會把文字節點切碎，不可假設單一節點）。
 * @param row 目標列。
 * @param columnIndex 欄索引。
 * @returns 排序/篩選用字串值。
 */
function rowCellValue(row: HTMLTableRowElement, columnIndex: number): string {
  const cell = row.cells[columnIndex];
  if (!cell) return '';
  if (cell.dataset.zwValue !== undefined) return cell.dataset.zwValue;
  return (cell.textContent ?? '').trim();
}

/**
 * 篩選面板上的值顯示名稱（checkbox 欄的 [x]/[ ] 直接顯示不友善）。
 * @param value 儲存值。
 * @returns 顯示文字。
 */
function filterValueLabel(value: string): string {
  if (value === '[x]') return '已勾選';
  if (value === '[ ]') return '未勾選';
  if (value === '') return '（空白）';
  return value;
}

/**
 * 依 radio 控件的 colors 對照，把某元素（chip 或選單項）套上顏色。
 * 調色盤鍵 → `data-zw-color` 屬性（走 globals.css 的 color-mix 規則、隨明暗主題自適應）；
 * 十六進位 → 以 `--zw-chip-hex` 內聯變數 ＋ `data-zw-color="hex"` 呈現。
 * 無對應顏色時清掉先前的著色（值改變後可能從有色變無色）。
 * @param element 目標元素（chip 或 popover item）。
 * @param colors 選項值 → 色鍵對照（可為 undefined＝此欄無配色）。
 * @param value 目前選項值。
 */
function applyChipColor(
  element: HTMLElement,
  colors: Record<string, string> | undefined,
  value: string,
): void {
  const color = colors?.[value];
  element.removeAttribute('data-zw-color');
  element.style.removeProperty('--zw-chip-hex');
  if (!color) return;
  if (color.startsWith('#')) {
    element.style.setProperty('--zw-chip-hex', color);
    element.dataset.zwColor = 'hex';
  } else {
    element.dataset.zwColor = color;
  }
}

/**
 * 儲存格「段首」多 checkbox 的文字樣式（DOM 端；raw 端的同構規則見 tableSpec.countCellCheckboxes）：
 * 可選空白＋字面 `[ ]`/`[x]`/`[X]`，其後必須是空白或文字節點結尾（黏字不算）。
 */
const SEGMENT_CHECKBOX_TEXT_PATTERN = /^([ \t]*)\[( |x|X)\](?=$|[ \t])/;

/**
 * 是否為「整格單一勾選」的純值（`[ ]`/`[x]`/`[X]`/空）——`{checkbox}` 控件欄只有這種格
 * 走既有的整格單勾渲染；帶標籤或多段的格（如 `[ ] 甲<br>[x] 乙`）改走多 checkbox 增強，
 * 否則整格被換成一顆孤零零的勾選框、標籤文字全被吃掉（使用者 2026-08-13 實際回報）。
 * @param value 儲存格文字值（textContent／zwValue）。
 * @returns 純值＝true。
 */
function isWholeCellCheckboxValue(value: string): boolean {
  const trimmed = value.trim();
  return trimmed === '' || /^\[( |x|X)\]$/.test(trimmed);
}

/**
 * 掃描儲存格的多 checkbox 候選文字節點（不動 DOM）：段首（起頭或 `<br>` 之後）的
 * 文字節點且以標記樣式開頭。供控件欄分流判斷與 enhanceCellChecklist 共用。
 * @param cell 目標儲存格。
 * @returns 候選文字節點（依文件順序）。
 */
function collectChecklistCandidates(cell: HTMLTableCellElement): Text[] {
  const candidates: Text[] = [];
  let atSegmentStart = true;
  for (const node of Array.from(cell.childNodes)) {
    if (node instanceof HTMLBRElement) {
      atSegmentStart = true;
      continue;
    }
    const isStart = atSegmentStart;
    atSegmentStart = false;
    if (!isStart || !(node instanceof Text)) continue;
    if (SEGMENT_CHECKBOX_TEXT_PATTERN.test(node.textContent ?? '')) candidates.push(node);
  }
  return candidates;
}

/**
 * 儲存格內多 checkbox 增強（A6）：以 `<br>` 分「段」，把段首字面 `[ ]`/`[x]` 換成
 * 可點擊核取方塊；點擊＝以 tableSpec.toggleCellCheckbox 切換 raw 第 k 個標記後走
 * 既有 saveCell 寫回。
 *
 * 安全比對：DOM 偵測到的段首標記數必須等於 raw 的標記數（`\[ ]` 跳脫等會造成
 * DOM 與 raw 不同構）——不相等＝整格放棄增強，寧可不互動、不可切錯標記。
 *
 * @param cell 目標儲存格（td）。
 * @param mdLine 該列在原文的行號（1 起算）。
 * @param columnIndex 欄索引（0 起算）。
 * @param table 所屬表格（寫回前檢查 isConnected，防孤兒節點寫錯行）。
 * @param interactions 寫回介面。
 */
function enhanceCellChecklist(
  cell: HTMLTableCellElement,
  mdLine: number,
  columnIndex: number,
  table: HTMLTableElement,
  interactions: ReadingTableInteractions,
): void {
  // 先蒐集候選（不動 DOM）：段首（起頭或 <br> 之後）的文字節點且以標記樣式開頭。
  const candidates = collectChecklistCandidates(cell);
  if (candidates.length === 0) return;

  const raw = interactions.getCellRaw(mdLine, columnIndex);
  if (raw === null || countCellCheckboxes(raw) !== candidates.length) return;

  // 把候選文字節點的標記字面換成核取方塊（其餘文字原樣保留）。
  const boxes: HTMLInputElement[] = [];
  for (const textNode of candidates) {
    const text = textNode.textContent ?? '';
    const match = text.match(SEGMENT_CHECKBOX_TEXT_PATTERN);
    if (!match) continue;
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'zw-cell-cbx';
    box.checked = match[2].toLowerCase() === 'x';
    box.setAttribute('aria-label', '待辦勾選');
    textNode.textContent = text.slice(match[0].length);
    cell.insertBefore(box, textNode);
    boxes.push(box);
  }

  boxes.forEach((box, checkboxIndex) => {
    box.addEventListener('change', () => {
      // 表格已被整段重注入汰換（孤兒節點）→ 不寫回（行號可能已過期）。
      if (!table.isConnected) {
        box.checked = !box.checked;
        return;
      }
      // 以「此刻」的 raw 為準（同格可能剛被別的操作改過）；切換失敗＝還原勾選。
      const currentRaw = interactions.getCellRaw(mdLine, columnIndex);
      const nextValue = currentRaw === null ? null : toggleCellCheckbox(currentRaw, checkboxIndex);
      if (nextValue === null) {
        box.checked = !box.checked;
        return;
      }
      boxes.forEach((b) => {
        b.disabled = true;
      });
      interactions.saveCell(mdLine, columnIndex, nextValue).then((ok) => {
        // 成功也要自行恢復可互動：渲染後 HTML 可能一字未變、不會有重注入（同控件欄先例）。
        boxes.forEach((b) => {
          b.disabled = false;
        });
        if (!ok) box.checked = !box.checked; // 失敗還原樂觀 UI
      });
    });
  });
}

/**
 * 為單一互動表格（data-md-table）裝上全部互動能力。只在首次增強時執行一次
 * （呼叫端以 ENHANCED_ATTR 防重；檢視狀態還原也因此只在此執行一次、且不觸發持久化——
 * MutationObserver 回呼絕不主動套狀態）。
 * @param table 目標表格。
 * @param tableIndex 表在容器內的文件順序序號（持久化鍵用）。
 * @param noteId 筆記 id；null 時不還原也不儲存檢視狀態。
 * @param controls 各欄控件宣告（prepareHeaderControls 的結果）。
 * @param interactions 寫回介面；未提供＝控件唯讀、不可直編。
 */
export function setupInteractiveTable(
  table: HTMLTableElement,
  tableIndex: number,
  noteId: string | null,
  controls: (HeaderControl | null)[],
  interactions?: ReadingTableInteractions,
): void {
  const headerCells = getHeaderCellsOf(table);
  const tbody = table.tBodies[0];
  if (!tbody || headerCells.length === 0) return;

  // 初始列順序快照：排序「無」時據此還原；排序一律「搬移既有 tr 節點」（保留畫記包裹）。
  const originalRows = Array.from(tbody.rows);
  const headerSignature =
    headerCells.map((cell) => cell.dataset.zwHeaderText ?? '').join('|') + `#${headerCells.length}`;

  // 目前檢視狀態（記憶體版；使用者變更時同步持久化）。
  let view: TableViewState = { sort: null, filters: {} };

  /** 目前是否處於「非原始 DOM 狀態」（有排序或任一欄篩選）。 */
  const isAltered = (): boolean =>
    view.sort !== null ||
    Object.values(view.filters).some((allowed) => allowed && allowed.length > 0);

  /** 把 view 套到 DOM：搬列排序＋display:none 篩選＋altered 標記＋表頭指示；最後通知浮層 rebase。 */
  const applyView = (): void => {
    const sort = view.sort;
    const ordered = sort
      ? originalRows
          .map((row, index) => ({ row, index }))
          .sort((a, b) => {
            const diff = compareCellValues(
              rowCellValue(a.row, sort.col),
              rowCellValue(b.row, sort.col),
            );
            const directed = sort.dir === 'desc' ? -diff : diff;
            return directed !== 0 ? directed : a.index - b.index; // 穩定排序
          })
          .map((entry) => entry.row)
      : originalRows;
    ordered.forEach((row) => tbody.appendChild(row));

    for (const row of originalRows) {
      const values = headerCells.map((_, columnIndex) => rowCellValue(row, columnIndex));
      row.classList.toggle('zw-row-filtered', !rowPassesFilters(values, view.filters));
    }

    if (isAltered()) table.setAttribute(VIEW_ALTERED_ATTR, '1');
    else table.removeAttribute(VIEW_ALTERED_ATTR);

    headerCells.forEach((cell, columnIndex) => {
      cell.classList.toggle('zw-sort-asc', sort?.col === columnIndex && sort.dir === 'asc');
      cell.classList.toggle('zw-sort-desc', sort?.col === columnIndex && sort.dir === 'desc');
      cell
        .querySelector('.zw-filter-btn')
        ?.classList.toggle('zw-filter-active', (view.filters[columnIndex]?.length ?? 0) > 0);
    });

    dispatchLayoutChanged();
  };

  /** 使用者變更檢視後：套用＋持久化（還原路徑不走本函式，避免重複寫入）。 */
  const commitView = (): void => {
    applyView();
    if (noteId) writeTableView(noteId, tableIndex, headerSignature, view);
  };

  /**
   * 取某列的原文行號（後端 data-md-line，1 起算）；不合法回 null（該列不可寫回）。
   * @param row 目標列。
   */
  const editableRowLine = (row: HTMLTableRowElement): number | null => {
    const lineAttr = row.getAttribute('data-md-line');
    const line = lineAttr === null ? NaN : Number(lineAttr);
    return Number.isInteger(line) && line > 0 ? line : null;
  };

  // ── 浮動面板（radio 選項選單／篩選面板共用；同時只開一個，點外部或捲動即關；
  //    關閉器掛模組級——重注入後由 enhanceReadingTables 統一清掉孤兒面板）────────────────
  const closePopover = (): void => closeActiveTablePopover();
  const openFixedPopover = (anchor: HTMLElement, panel: HTMLElement): void => {
    closeActiveTablePopover();
    const rect = anchor.getBoundingClientRect();
    panel.style.position = 'fixed';
    panel.style.left = `${Math.round(rect.left)}px`;
    panel.style.top = `${Math.round(rect.bottom + 4)}px`;
    document.body.appendChild(panel);
    // 右邊界夾取：靠右欄（尤其手機 393px）開面板會被切出畫面外——掛上後量實寬再往左收。
    const panelWidth = panel.getBoundingClientRect().width;
    const maxLeft = window.innerWidth - panelWidth - 8;
    if (rect.left > maxLeft) {
      panel.style.left = `${Math.max(8, Math.round(maxLeft))}px`;
    }
    const onDocumentPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && panel.contains(event.target)) return;
      closeActiveTablePopover();
    };
    const onScroll = (): void => closeActiveTablePopover();
    document.addEventListener('pointerdown', onDocumentPointerDown, true);
    window.addEventListener('scroll', onScroll, true);
    activePopoverCloser = () => {
      document.removeEventListener('pointerdown', onDocumentPointerDown, true);
      window.removeEventListener('scroll', onScroll, true);
      panel.remove();
    };
  };

  // ── 控件欄渲染（radio → 目前值 chip＋點開選項選單；checkbox → 核取方塊）────────────────
  controls.forEach((control, columnIndex) => {
    if (!control) return;
    for (const row of originalRows) {
      const cell = row.cells[columnIndex];
      if (!cell) continue;
      const currentValue = (cell.textContent ?? '').trim();
      cell.dataset.zwValue = currentValue;
      const mdLine = editableRowLine(row);
      const canWrite = !!interactions && mdLine !== null;

      if (control.kind === 'checkbox') {
        // 多段/帶標籤的格（[ ] 甲<br>[x] 乙）→ 留給下方「多 checkbox 增強」處理——
        // 整格單勾會把內容換成一顆勾選框、標籤全被吃掉（使用者 2026-08-13 回報）。
        // 純 [ ]/[x]/空 格才走整格單勾（維持既有欄語意與測試）。
        if (!isWholeCellCheckboxValue(currentValue) && collectChecklistCandidates(cell).length > 0) {
          continue;
        }
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.className = 'zw-cell-checkbox';
        box.checked = isCheckedValue(currentValue);
        box.disabled = !canWrite;
        box.setAttribute(
          'aria-label',
          `${headerCells[columnIndex]?.dataset.zwHeaderText ?? ''} 勾選`,
        );
        if (canWrite && interactions && mdLine !== null) {
          box.addEventListener('change', () => {
            // 表格已被整段重注入汰換（本控件是孤兒節點）→ 不寫回（行號可能已過期）。
            if (!table.isConnected) return;
            const previous = cell.dataset.zwValue ?? '';
            const nextValue = box.checked ? '[x]' : '[ ]';
            cell.dataset.zwValue = nextValue; // 樂觀更新；失敗還原
            box.disabled = true;
            interactions.saveCell(mdLine, columnIndex, nextValue).then((ok) => {
              if (!ok) {
                cell.dataset.zwValue = previous;
                box.checked = isCheckedValue(previous);
              }
              // 成功也要自行恢復可互動：渲染後 HTML 可能一字未變（如儲存格 trim 後相同），
              // 此時不會有重注入來汰換本 DOM——不能把「恢復」押注在重注入上（復審 HIGH）。
              box.disabled = false;
            });
          });
        }
        cell.replaceChildren(box);
      } else {
        // 此欄若在表頭宣告了各選項顏色（{radio:值=顏色,…}），chip 與選單項都據此著色。
        const radioColors = control.colors;
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'zw-cell-radio-chip' + (currentValue ? '' : ' zw-radio-unset');
        chip.textContent = currentValue || '未設定';
        chip.disabled = !canWrite;
        chip.setAttribute('aria-haspopup', 'menu');
        applyChipColor(chip, radioColors, currentValue);
        if (canWrite && interactions && mdLine !== null) {
          chip.addEventListener('click', () => {
            const menu = document.createElement('div');
            menu.className = 'zw-table-popover';
            menu.setAttribute('role', 'menu');
            for (const option of control.options) {
              const item = document.createElement('button');
              item.type = 'button';
              item.className =
                'zw-popover-item' +
                (option === cell.dataset.zwValue ? ' zw-popover-item-current' : '');
              item.textContent = option;
              applyChipColor(item, radioColors, option);
              item.addEventListener('click', () => {
                closePopover();
                // 表格已被整段重注入汰換（孤兒面板殘留）→ 不寫回（行號可能已過期，會寫錯行）。
                if (!table.isConnected) return;
                const previous = cell.dataset.zwValue ?? '';
                if (option === previous) return;
                cell.dataset.zwValue = option; // 樂觀更新；失敗還原
                chip.textContent = option;
                chip.classList.remove('zw-radio-unset');
                applyChipColor(chip, radioColors, option);
                chip.disabled = true;
                interactions.saveCell(mdLine, columnIndex, option).then((ok) => {
                  if (!ok) {
                    cell.dataset.zwValue = previous;
                    chip.textContent = previous || '未設定';
                    chip.classList.toggle('zw-radio-unset', !previous);
                    applyChipColor(chip, radioColors, previous);
                  }
                  // 成功也要恢復可互動（HTML 可能一字未變、不會有重注入——復審 HIGH）。
                  chip.disabled = false;
                });
              });
              menu.appendChild(item);
            }
            openFixedPopover(chip, menu);
          });
        }
        cell.replaceChildren(chip);
      }
    }
  });

  // ── 儲存格內多 checkbox（一格多待辦，像 OneNote；2026-08-13 使用者追加）──────────
  // 以 <br> 分「段」，段首的字面 [ ]/[x] 換成可點擊核取方塊；
  // 點擊＝切換 raw 中對應第 k 個標記後走既有 saveCell 寫回（樂觀 UI、失敗還原）。
  // 適用範圍：一般欄＋「{checkbox} 控件欄的多段/帶標籤格」（純 [ ]/[x] 格已由上方整格單勾
  // 渲染並 replaceChildren，這裡掃不到候選、天然跳過）；radio 等其他控件欄一律不套。
  if (interactions) {
    for (const row of originalRows) {
      const mdLine = editableRowLine(row);
      if (mdLine === null) continue; // 不可寫回的列不增強（唯讀 checkbox 只會誤導）
      Array.from(row.cells).forEach((cell, columnIndex) => {
        const control = controls[columnIndex];
        if (control && control.kind !== 'checkbox') return; // chip 欄有自己的整格語意
        enhanceCellChecklist(cell, mdLine, columnIndex, table, interactions);
      });
    }
  }

  // ── 表頭：點擊排序（無→升→降→無）＋漏斗篩選 ──────────────────────────────────────
  headerCells.forEach((cell, columnIndex) => {
    cell.classList.add('zw-th-sortable');

    const filterButton = document.createElement('button');
    filterButton.type = 'button';
    filterButton.className = 'zw-filter-btn'; // 漏斗 icon 走 CSS pseudo-element，不進 textContent
    filterButton.setAttribute('aria-label', '篩選此欄');
    filterButton.title = '篩選此欄';
    filterButton.addEventListener('click', (event) => {
      event.stopPropagation(); // 不觸發表頭排序
      const distinct = Array.from(
        new Set(originalRows.map((row) => rowCellValue(row, columnIndex))),
      ).sort(compareCellValues);
      const panel = document.createElement('div');
      panel.className = 'zw-table-popover zw-filter-panel';

      const clearButton = document.createElement('button');
      clearButton.type = 'button';
      clearButton.className = 'zw-popover-item zw-filter-clear';
      clearButton.textContent = '清除篩選（全部顯示）';
      clearButton.addEventListener('click', () => {
        delete view.filters[columnIndex];
        commitView();
        closePopover();
      });
      panel.appendChild(clearButton);

      const activeFilter = view.filters[columnIndex];
      for (const value of distinct) {
        const label = document.createElement('label');
        label.className = 'zw-filter-option';
        const box = document.createElement('input');
        box.type = 'checkbox';
        // 無作用中篩選＝全部顯示（全勾）；有篩選時只勾集合內的值。
        box.checked = !activeFilter || activeFilter.length === 0 || activeFilter.includes(value);
        box.addEventListener('change', () => {
          // 第一次取消勾選時把「目前全選」具體化成集合，之後依勾選增減；回到全選即移除篩選。
          const current = view.filters[columnIndex];
          const active = new Set(current && current.length > 0 ? current : distinct);
          if (box.checked) active.add(value);
          else active.delete(value);
          if (active.size >= distinct.length) delete view.filters[columnIndex];
          else view.filters[columnIndex] = Array.from(active);
          commitView();
        });
        const text = document.createElement('span');
        text.textContent = filterValueLabel(value);
        label.appendChild(box);
        label.appendChild(text);
        panel.appendChild(label);
      }
      openFixedPopover(filterButton, panel);
    });
    cell.appendChild(filterButton);

    cell.addEventListener('click', (event) => {
      // 點到把手/漏斗/控件不排序；只有點表頭本體才循環排序方向。
      if (
        event.target instanceof Element &&
        event.target.closest('.zw-col-resizer, .zw-filter-btn, button, input')
      ) {
        return;
      }
      if (view.sort?.col !== columnIndex) view.sort = { col: columnIndex, dir: 'asc' };
      else if (view.sort.dir === 'asc') view.sort = { col: columnIndex, dir: 'desc' };
      else view.sort = null;
      commitView();
    });
  });

  // ── 雙右鍵儲存格直編＋右鍵選單抑制（範圍＝本表格；豁免直編中的 textarea）───────────────
  const wrap = table.closest('.md-table-wrap') ?? table;
  let editingCell: HTMLTableCellElement | null = null;

  /**
   * 開啟儲存格直編：textarea 取代內容（初值＝該格原始 Markdown 片段）。
   * Esc＝取消還原、Enter＝儲存、Shift+Enter＝換行、失焦＝儲存；
   * 失敗保留輸入（不摧毀編輯中內容），成功交由整段重注入汰換。
   * @param cell 目標儲存格（td）。
   */
  const openCellEditor = (cell: HTMLTableCellElement): void => {
    if (!interactions || editingCell) return;
    const row = cell.parentElement;
    if (!(row instanceof HTMLTableRowElement)) return;
    const mdLine = editableRowLine(row);
    if (mdLine === null) return;
    const cellIndex = cell.cellIndex;
    const raw = interactions.getCellRaw(mdLine, cellIndex);
    if (raw === null) return; // 行號/欄位對不上原文（防呆）→ 此格降級為不可直編
    // 顯示對稱：字面 <br> 家族還原成真實換行（Shift+Enter 存進去的是 <br>，重開時
    // 不該讓使用者看到標籤；存檔時 escapeCellText 會把 \n 轉回正規形 <br>）。
    // 「無變更」比較也用還原後的 initial——變體（<br/> 等）開了沒改不會被悄悄正規化存檔。
    const initial = unescapeCellBr(raw);

    const original = document.createDocumentFragment();
    while (cell.firstChild) original.appendChild(cell.firstChild);

    const editor = document.createElement('textarea');
    editor.className = 'zw-cell-editor';
    editor.value = initial;
    editor.rows = Math.max(1, initial.split('\n').length);
    editingCell = cell;

    const closeEditor = (restore: boolean): void => {
      editor.removeEventListener('blur', onBlur);
      if (restore) cell.replaceChildren(original);
      editingCell = null;
    };
    const save = (): void => {
      if (editor.value === initial) {
        closeEditor(true); // 沒改 → 視同取消，不打擾後端（比較基準＝還原換行後的初值）
        return;
      }
      editor.disabled = true;
      editor.classList.add('zw-cell-saving');
      interactions.saveCell(mdLine, cellIndex, editor.value).then((ok) => {
        if (ok) {
          // 成功也「還原原內容」而非等待重注入：渲染後 HTML 可能一字未變（如只改尾隨空白，
          // GFM 儲存格 trim 後相同）→ 不會有重注入；此時原內容即正確畫面。若 HTML 真的變了，
          // 重注入隨後會汰換整張表，這裡的還原只是暫態。押注重注入會讓 UI 永久卡死（復審 HIGH）。
          closeEditor(true);
        } else {
          editor.disabled = false;
          editor.classList.remove('zw-cell-saving');
          editor.focus();
        }
      });
    };
    const onBlur = (): void => save();
    editor.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeEditor(true);
      } else if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        editor.blur(); // 統一走 blur → save，避免雙重觸發
      }
    });
    editor.addEventListener('blur', onBlur);
    cell.replaceChildren(editor);
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);
  };

  // 純觸控裝置（手機/平板）不綁「雙右鍵直編」：觸控根本打不出右鍵，綁了只會因
  // preventDefault 把 iOS 長按（選字/複製）整個吃掉，讓表格文字在手機上選不起來。
  const isCoarseTouch =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  if (!isCoarseTouch) {
    const tracker = createDoubleRightClickTracker((event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const cell = target.closest('td');
      if (cell instanceof HTMLTableCellElement && table.contains(cell)) openCellEditor(cell);
    });
    wrap.addEventListener('contextmenu', (event) => {
      // 直編中的 textarea 保留原生右鍵（貼上/拼字修正）。
      if (event.target instanceof Element && event.target.closest('textarea')) return;
      // 順序關鍵：先餵 tracker 再 preventDefault——tracker 依規格會忽略「已被別人 preventDefault」
      // 的事件（NoteOverlay 繪圖取消那一下），若自己先 preventDefault 等於把每一擊都標成該忽略、
      // 雙右鍵永遠不會觸發。
      tracker.handleContextMenu(event);
      event.preventDefault(); // 表格內一律抑制原生選單（單次右鍵也抑制，與全站既有慣例一致）
    });
  }

  // ── 檢視狀態還原：只在首次增強時執行一次（ENHANCED_ATTR 防線內），不觸發持久化 ─────────
  if (noteId) {
    const stored = readTableView(noteId, tableIndex, headerSignature);
    if (stored) {
      view = stored;
      if (isAltered()) applyView();
    }
  }
}
