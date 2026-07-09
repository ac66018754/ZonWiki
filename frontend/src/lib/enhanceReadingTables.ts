/**
 * 閱讀檢視（後端 Markdig 產生的 HTML）的表格「就地增強」：
 * 讓使用者可以拖曳表頭欄位右緣調整欄寬，並把調好的寬度記進 localStorage，下次開同一篇筆記自動還原。
 *
 * 以純 DOM 操作進行（閱讀內文走 dangerouslySetInnerHTML，本就不由 React reconcile）——
 * 與 enhanceReadingCodeBlocks 同一套機制：每次 previewHtml 變動、React 重新注入後再呼叫一次即可
 * （見 notes 頁 setPreviewNode 的 MutationObserver）。以 data 屬性標記避免同一份 HTML 內重複處理。
 *
 * ⚠️ React 19 陷阱：只要 dangerouslySetInnerHTML 的 {__html} 物件識別變動就會整段重注入、清掉本函式做的
 * 所有 DOM 改動（wrapper／colgroup／把手／欄寬）。解法沿用既有機制——上層以 useMemo 固定物件、並用
 * MutationObserver 在重注入後重跑本函式；本函式再從 localStorage 還原欄寬，故重注入後欄寬會自動恢復。
 */

/** localStorage 命名空間鍵（帶版本，之後資料結構若變可升版避免相容問題）。 */
const STORAGE_KEY = 'zonwiki:tableColWidths:v1';

/** 單欄最小寬度（像素）——避免拖到 0 讓欄位消失。 */
const MIN_COL_WIDTH = 48;

/** 標記表格「已處理」的 data 屬性，避免 MutationObserver 重跑時重複包裝。 */
const ENHANCED_ATTR = 'data-zw-table-enhanced';

/**
 * 單一表格已儲存的欄寬紀錄。
 * 同時存表頭文字與欄數，還原時用來比對「筆記內容是否被改過」——只要對不上就自動失效回預設，不套錯表。
 */
type StoredTableWidths = {
  /** 表頭各欄文字（trim 後），用來比對這張表是否還是當初存的那張。 */
  headers: string[];
  /** 欄數（冗餘存一份，先做快速數量比對再逐欄比文字）。 */
  colCount: number;
  /** 各欄寬度（像素，四捨五入為整數）。 */
  widths: number[];
};

/** localStorage 內的完整對照表：內層鍵＝`${noteId}:${表在容器內的序號}`。 */
type WidthsMap = Record<string, StoredTableWidths>;

/**
 * 讀取整份欄寬對照表（壞資料視同沒有，回空物件）。
 * @returns 目前儲存的欄寬對照表。
 */
function readWidthsMap(): WidthsMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed as WidthsMap;
    }
  } catch {
    /* 壞資料／無 localStorage 皆視同沒有 */
  }
  return {};
}

/**
 * 寫回整份欄寬對照表（失敗時靜默忽略，不影響閱讀）。
 * @param map 要寫入的欄寬對照表。
 */
function writeWidthsMap(map: WidthsMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* localStorage 滿／被停用 → 忽略 */
  }
}

/**
 * 組出某張表在 localStorage 對照表中的內層鍵。
 * @param noteId 筆記 id。
 * @param tableIndex 這張表在容器內、依文件順序的序號（第幾個 table，從 0 起算）。
 * @returns 內層鍵字串。
 */
function buildEntryKey(noteId: string, tableIndex: number): string {
  return `${noteId}:${tableIndex}`;
}

/**
 * 取得一張表的「表頭儲存格」：優先取 thead 的第一列，沒有 thead 就取整表第一列的儲存格。
 * @param table 目標表格。
 * @returns 表頭列的儲存格陣列（可能是 th 或 td）；找不到列時回空陣列。
 */
function getHeaderCells(table: HTMLTableElement): HTMLTableCellElement[] {
  const thead = table.tHead;
  if (thead && thead.rows.length > 0) {
    return Array.from(thead.rows[0].cells);
  }
  const firstRow = table.rows[0];
  return firstRow ? Array.from(firstRow.cells) : [];
}

/**
 * 量測目前各欄的實際像素寬（取表頭各儲存格的 getBoundingClientRect 寬度）。
 * @param headerCells 表頭儲存格陣列。
 * @returns 各欄目前寬度（整數像素）。
 */
function measureColumnWidths(headerCells: HTMLTableCellElement[]): number[] {
  return headerCells.map((cell) => Math.round(cell.getBoundingClientRect().width));
}

/**
 * 依目前 colgroup 各 col 的寬度加總，得到表格總寬（供設定 table.style.width，讓超出容器時可水平捲動）。
 * @param cols colgroup 內的 col 陣列。
 * @returns 各 col 寬度總和（像素）。
 */
function sumColWidths(cols: HTMLTableColElement[]): number {
  return cols.reduce((total, col) => total + (parseFloat(col.style.width) || 0), 0);
}

/**
 * 把「精準控寬」模式套到表格：切成 table-layout: fixed，並用像素寬鎖定各欄與表格總寬。
 * 這是拖曳開始與「還原已存欄寬」共用的一步——先凍結成像素，之後拖曳才能精準只動被拖那欄。
 * @param table 目標表格。
 * @param cols colgroup 內的 col 陣列。
 * @param widths 要套用到各欄的像素寬。
 */
function applyFixedWidths(
  table: HTMLTableElement,
  cols: HTMLTableColElement[],
  widths: number[],
): void {
  cols.forEach((col, index) => {
    const width = widths[index];
    if (typeof width === 'number' && width > 0) {
      col.style.width = `${width}px`;
    }
  });
  table.style.tableLayout = 'fixed';
  // 用像素總寬覆蓋 CSS 預設的 width:100%，讓表格能超出容器 → .md-table-wrap 水平捲動而非壓縮欄位。
  table.style.width = `${sumColWidths(cols)}px`;
  table.style.maxWidth = 'none';
}

/**
 * 清掉表格上的所有欄寬控制，回到 CSS 預設（width:100% + table-layout: auto，依內容自動分配欄寬）。
 * @param table 目標表格。
 * @param cols colgroup 內的 col 陣列。
 */
function clearFixedWidths(table: HTMLTableElement, cols: HTMLTableColElement[]): void {
  cols.forEach((col) => {
    col.style.width = '';
  });
  table.style.tableLayout = '';
  table.style.width = '';
  table.style.maxWidth = '';
}

/**
 * 判斷已存的欄寬紀錄是否仍適用於目前這張表（欄數與表頭文字都要吻合，任一不符即視為內容已變、不套用）。
 * @param stored 已存的欄寬紀錄。
 * @param headers 目前表頭各欄文字。
 * @returns 是否吻合可套用。
 */
function isStoredWidthsApplicable(stored: StoredTableWidths, headers: string[]): boolean {
  if (!Array.isArray(stored.widths) || !Array.isArray(stored.headers)) return false;
  if (stored.colCount !== headers.length) return false;
  if (stored.headers.length !== headers.length) return false;
  if (stored.widths.length !== headers.length) return false;
  // 每欄寬必須是有限正數：防止被竄改／損毀的 localStorage（如含 null／NaN／字串）通過比對後，
  // 在 table-layout:fixed 下把某些欄壓成 ~0px、破壞表格外觀。
  if (!stored.widths.every((width) => Number.isFinite(width) && width > 0)) return false;
  return stored.headers.every((headerText, index) => headerText === headers[index]);
}

/**
 * 為單一表格加上拖曳調寬能力（包 wrapper／建 colgroup／各表頭右緣加把手／綁 pointer 事件／持久化）。
 * @param table 目標表格。
 * @param tableIndex 這張表在容器內的序號（用於持久化鍵）。
 * @param noteId 筆記 id；為 null 時仍可即時拖曳，但不還原也不儲存。
 */
function enhanceSingleTable(
  table: HTMLTableElement,
  tableIndex: number,
  noteId: string | null,
): void {
  const headerCells = getHeaderCells(table);
  const colCount = headerCells.length;
  if (colCount === 0) return; // 沒有可辨識的表頭列 → 無從建立欄，略過

  // ── 1) 用一層 .md-table-wrap 包住表格，讓拖寬後可水平捲動、不爆版 ──────────────────
  const wrap = document.createElement('div');
  wrap.className = 'md-table-wrap';
  table.parentNode?.insertBefore(wrap, table);
  wrap.appendChild(table);

  // ── 2) 建立 colgroup（每欄一個 col），讓各欄寬度可被精準控制 ──────────────────────
  const colgroup = document.createElement('colgroup');
  const cols: HTMLTableColElement[] = [];
  for (let i = 0; i < colCount; i += 1) {
    const col = document.createElement('col');
    colgroup.appendChild(col);
    cols.push(col);
  }
  // colgroup 需在 thead/tbody 之前；插為表格第一個子節點即可（markdown 表格無 caption）。
  table.insertBefore(colgroup, table.firstChild);

  const headerTexts = headerCells.map((cell) => (cell.textContent ?? '').trim());

  /**
   * 把目前各欄寬度存回 localStorage（noteId 為 null 時不存）。
   */
  const persistWidths = (): void => {
    if (!noteId) return;
    const widths = cols.map((col) => Math.round(parseFloat(col.style.width) || 0));
    const map = readWidthsMap();
    map[buildEntryKey(noteId, tableIndex)] = {
      headers: headerTexts,
      colCount,
      widths,
    };
    writeWidthsMap(map);
  };

  /**
   * 清掉這張表的記憶並還原預設欄寬（雙擊把手時呼叫）。
   */
  const resetWidths = (): void => {
    clearFixedWidths(table, cols);
    if (!noteId) return;
    const map = readWidthsMap();
    delete map[buildEntryKey(noteId, tableIndex)];
    writeWidthsMap(map);
  };

  // ── 3) 若有已存欄寬且比對吻合（欄數＋表頭文字都對）→ 立即還原，達成「記住寬度」 ──────
  if (noteId) {
    const stored = readWidthsMap()[buildEntryKey(noteId, tableIndex)];
    if (stored && isStoredWidthsApplicable(stored, headerTexts)) {
      applyFixedWidths(table, cols, stored.widths);
    }
  }

  // ── 4) 每個表頭儲存格右緣加一個拖曳把手 ─────────────────────────────────────────
  headerCells.forEach((cell, columnIndex) => {
    cell.classList.add('zw-th-resizable'); // CSS 給 position:relative，讓把手可絕對定位

    const handle = document.createElement('span');
    handle.className = 'zw-col-resizer';
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-label', '拖曳調整欄寬，雙擊還原');
    handle.title = '拖曳調整欄寬（雙擊還原預設）';

    // 拖曳過程用的暫存狀態（在 pointerdown 當下快照，避免拖曳中重覆量測造成漂移）。
    let startPointerX = 0;
    let startColWidth = 0;

    const onPointerMove = (moveEvent: PointerEvent): void => {
      const delta = moveEvent.clientX - startPointerX;
      const nextWidth = Math.max(MIN_COL_WIDTH, Math.round(startColWidth + delta));
      cols[columnIndex].style.width = `${nextWidth}px`;
      // 同步更新表格總寬，讓表格能隨拖曳變寬／變窄 → 由 .md-table-wrap 水平捲動。
      table.style.width = `${sumColWidths(cols)}px`;
    };

    const onPointerUp = (upEvent: PointerEvent): void => {
      handle.classList.remove('zw-resizing');
      try {
        handle.releasePointerCapture(upEvent.pointerId);
      } catch {
        /* 指標已釋放 → 忽略 */
      }
      handle.removeEventListener('pointermove', onPointerMove);
      handle.removeEventListener('pointerup', onPointerUp);
      handle.removeEventListener('pointercancel', onPointerUp);
      persistWidths();
    };

    handle.addEventListener('pointerdown', (downEvent: PointerEvent) => {
      // 只吃主鍵（滑鼠左鍵／觸控／筆）；避免右鍵選單等干擾。
      if (downEvent.button !== 0) return;
      // 阻擋事件冒泡與預設行為，避免觸發文字選取／NoteMarksLayer 的框選標註。
      downEvent.preventDefault();
      downEvent.stopPropagation();

      // 拖曳開始：把當下各欄實際像素寬凍結進 colgroup、表格切成 fixed（之後才能精準控寬）。
      const currentWidths = measureColumnWidths(headerCells);
      applyFixedWidths(table, cols, currentWidths);

      startPointerX = downEvent.clientX;
      startColWidth = currentWidths[columnIndex];

      handle.classList.add('zw-resizing');
      try {
        handle.setPointerCapture(downEvent.pointerId);
      } catch {
        /* 少數環境不支援 → 仍以 document 事件退而求其次（此處從簡，交由把手自身事件） */
      }
      handle.addEventListener('pointermove', onPointerMove);
      handle.addEventListener('pointerup', onPointerUp);
      handle.addEventListener('pointercancel', onPointerUp);
    });

    // 雙擊把手＝清除記憶、還原預設欄寬。
    handle.addEventListener('dblclick', (dblEvent: MouseEvent) => {
      dblEvent.preventDefault();
      dblEvent.stopPropagation();
      resetWidths();
    });

    cell.appendChild(handle);
  });
}

/**
 * 增強容器內所有尚未處理的表格：加上可拖曳調寬的把手，並依 localStorage 還原記住的欄寬。
 * @param container 閱讀內文的容器（.markdown-prose）；null 時不動作。
 * @param noteId 目前筆記 id；為 null 時表格仍可即時拖曳，但不會還原也不會儲存欄寬。
 */
export function enhanceReadingTables(container: HTMLElement | null, noteId: string | null): void {
  if (!container) return;

  // 以「容器內所有 table、依文件順序」的索引當持久化序號——重注入後表格順序不變，索引才能穩定對應。
  // 已包裝過的表格（有 ENHANCED_ATTR）仍計入索引以維持序號一致，但略過重複處理。
  const tables = Array.from(container.querySelectorAll('table'));
  tables.forEach((table, tableIndex) => {
    if (!(table instanceof HTMLTableElement)) return;
    if (table.getAttribute(ENHANCED_ATTR) === '1') return;
    // 先標記再處理：本函式為同步執行，MutationObserver 回呼在其後才觸發，故標記可攔下重入時的重複包裝。
    table.setAttribute(ENHANCED_ATTR, '1');
    enhanceSingleTable(table, tableIndex, noteId);
  });
}
