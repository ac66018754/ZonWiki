/**
 * 表格檢視（排序／篩選／狀態持久化）的純函數層。
 *
 * 對應設計文件《互動表格與讀模式直編設計》§3.2（排序比較器）、§3.3（篩選 AND 語意）、
 * §3.5（localStorage 檢視狀態）與 v2 修訂第 14 條：
 * 檢視狀態鍵照欄寬先例（enhanceReadingTables.ts 的 StoredTableWidths 模式）——
 * 內層鍵 `${noteId}:${tableIndex}`＋表頭簽章雙保險，簽章不符（內容被改過）即棄用回預設。
 *
 * 注意：控件欄（radio/checkbox）的排序鍵與篩選相異值一律讀 `td.dataset.zwValue`
 * 而非 textContent（v2 修訂第 5 條）——那是 DOM 層（enhanceReadingTables）的職責，
 * 本模組只接收已取好的字串值。
 */

// ────────────────────────── 型別 ──────────────────────────

/** 排序方向：升冪／降冪。 */
export type TableSortDirection = 'asc' | 'desc';

/** 單表排序狀態；null＝無排序（原始順序）。 */
export type TableSortState = { col: number; dir: TableSortDirection } | null;

/** 單表篩選狀態：欄索引 → 允許值清單（JSON 可序列化，直接進 localStorage）。 */
export type TableFilters = Record<number, string[]>;

/**
 * 單一表格的檢視狀態（記憶體版；呼叫端持有並套用的形狀）。
 */
export type TableViewState = {
  /** 排序狀態；null＝無排序。 */
  sort: TableSortState;
  /** 篩選狀態；空物件＝無篩選。 */
  filters: TableFilters;
};

/**
 * localStorage 內單張表的儲存值（照設計文件 §3.5：`{headerSignature, sort, filters}`）。
 * headerSignature 於讀寫時比對，不符（筆記內容被改過）即棄用——防套錯表。
 */
type StoredTableView = TableViewState & {
  /** 寫入當下的表頭簽章。 */
  headerSignature: string;
};

/** localStorage 內的完整對照表：內層鍵＝`${noteId}:${tableIndex}`（照欄寬先例）。 */
type ViewStateMap = Record<string, StoredTableView>;

// ────────────────────────── 常數 ──────────────────────────

/** localStorage 命名空間鍵（帶版本，資料結構若變可升版避免相容問題）。 */
export const TABLE_VIEW_STORAGE_KEY = 'zonwiki:tableView:v1';

/**
 * 表頭簽章的欄位分隔符：ASCII Unit Separator（U+001F），
 * 幾乎不可能出現在表頭文字中——防止 ["ab","c"] 與 ["a","bc"] 串聯後撞簽章。
 */
const SIGNATURE_SEPARATOR = '';

/** MM/DD 日期樣式（如 3/04、12/25）。 */
const DATE_PATTERN = /^(\d{1,2})\/(\d{1,2})$/;

/** 前導數字樣式（含正負號與小數，如 3.4km、45k、-5、.5x 的前導數值部分）。 */
const LEADING_NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)/;

// ────────────────────────── 排序比較器 ──────────────────────────

/**
 * 儲存格值的型別分類結果（rank 為跨型別排位：數字 0 < 日期 1 < 文字 2）。
 */
type CellValueClass =
  | { rank: 0; numberValue: number }
  | { rank: 1; month: number; day: number }
  | { rank: 2 };

/**
 * 分類儲存格值：完整 MM/DD 日期 → 日期；有前導數字 → 數字；其他 → 文字。
 * 日期判定要在數字之前——「12/25」也有前導數字，但完整日期樣式優先。
 * @param trimmedValue 已 trim 的儲存格值。
 * @returns 型別分類與比較用的衍生值。
 */
function classifyCellValue(trimmedValue: string): CellValueClass {
  const dateMatch = DATE_PATTERN.exec(trimmedValue);
  if (dateMatch) {
    return { rank: 1, month: Number(dateMatch[1]), day: Number(dateMatch[2]) };
  }
  const numberMatch = LEADING_NUMBER_PATTERN.exec(trimmedValue);
  if (numberMatch) {
    const numberValue = Number.parseFloat(numberMatch[0]);
    // 超長數字會被 parseFloat 溢位成 Infinity，Infinity - Infinity = NaN 會違反
    // Array.sort 比較器契約（排序結果變 implementation-defined）→ 非有限值降級為文字組。
    if (Number.isFinite(numberValue)) {
      return { rank: 0, numberValue };
    }
  }
  return { rank: 2 };
}

/**
 * 表格排序比較器：數字感知（前導數字如「3.4km」「45k」取數值）→ MM/DD 日期樣式 →
 * `localeCompare('zh-Hant')`。混合型別穩定：數字組永遠在文字組前（排位固定 數字<日期<文字）。
 * 同型別平手時以 locale 比較 tie-break，確保排序結果確定性。
 * @param a 左值（儲存格字串）。
 * @param b 右值（儲存格字串）。
 * @returns 標準比較器語意：負＝a 在前、正＝b 在前、0＝相等。
 */
export function compareCellValues(a: string, b: string): number {
  const aTrimmed = a.trim();
  const bTrimmed = b.trim();
  const aClass = classifyCellValue(aTrimmed);
  const bClass = classifyCellValue(bTrimmed);

  if (aClass.rank !== bClass.rank) return aClass.rank - bClass.rank;

  if (aClass.rank === 0 && bClass.rank === 0) {
    const numberDiff = aClass.numberValue - bClass.numberValue;
    if (numberDiff !== 0) return numberDiff;
  } else if (aClass.rank === 1 && bClass.rank === 1) {
    if (aClass.month !== bClass.month) return aClass.month - bClass.month;
    if (aClass.day !== bClass.day) return aClass.day - bClass.day;
  }

  // 同型別平手（或文字組）→ zh-Hant locale 比較。
  return aTrimmed.localeCompare(bTrimmed, 'zh-Hant');
}

// ────────────────────────── 篩選述詞 ──────────────────────────

/**
 * 判斷一列是否通過所有欄的篩選（AND 語意：每個有篩選的欄都必須命中允許值）。
 * 列缺該欄（索引越界）時以空字串參與比對；允許值為空集合＝該欄全部濾掉（字面語意）。
 * @param rowValues 該列各欄的值（控件欄應傳 dataset.zwValue 取出的值）。
 * @param filters 篩選狀態：欄索引 → 允許值清單。
 * @returns 是否通過全部篩選。
 */
export function rowPassesFilters(rowValues: readonly string[], filters: TableFilters): boolean {
  return Object.entries(filters).every(([columnKey, allowedValues]) => {
    const columnIndex = Number(columnKey);
    const cellValue = rowValues[columnIndex] ?? '';
    return allowedValues.includes(cellValue);
  });
}

// ────────────────────────── 檢視狀態持久化 ──────────────────────────

/**
 * 由「剝尾碼後的原始表頭文字」建立表頭簽章（各欄文字＋欄數）。
 * 呼叫端應傳入首次增強時快照的 `th.dataset.zwHeaderRaw`（v2 修訂第 7 條）——
 * 不可傳含排序指示／漏斗文字的 textContent。
 * @param strippedHeaderTexts 各欄已剝 `{…}` 尾碼的表頭文字。
 * @returns 簽章字串（用不可見分隔符串聯＋欄數，杜絕串聯歧義）。
 */
export function buildHeaderSignature(strippedHeaderTexts: readonly string[]): string {
  return `${strippedHeaderTexts.join(SIGNATURE_SEPARATOR)}${SIGNATURE_SEPARATOR}#${strippedHeaderTexts.length}`;
}

/**
 * 讀取整份檢視狀態對照表（壞資料／無 localStorage 一律視同沒有，回空物件）。
 * @returns 目前儲存的對照表。
 */
function readViewStateMap(): ViewStateMap {
  try {
    const raw = localStorage.getItem(TABLE_VIEW_STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as ViewStateMap;
      }
    }
  } catch {
    /* 壞 JSON／無 localStorage → 視同沒有 */
  }
  return {};
}

/**
 * 寫回整份檢視狀態對照表（失敗時靜默忽略，不影響閱讀）。
 * @param map 要寫入的對照表。
 */
function writeViewStateMap(map: ViewStateMap): void {
  try {
    localStorage.setItem(TABLE_VIEW_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* localStorage 滿／被停用 → 忽略 */
  }
}

/**
 * 組出某張表在對照表中的內層鍵（照欄寬先例 `${noteId}:${tableIndex}`）。
 * @param noteId 筆記 id。
 * @param tableIndex 這張表在容器內、依文件順序的序號（0 起算）。
 * @returns 內層鍵字串。
 */
function buildEntryKey(noteId: string, tableIndex: number): string {
  return `${noteId}:${tableIndex}`;
}

/**
 * 檢查未知資料是否為合法的 StoredTableView（防被竄改／損毀的 localStorage 通過）。
 * @param candidate 待驗證的資料。
 * @returns 是否為合法形狀。
 */
function isValidStoredView(candidate: unknown): candidate is StoredTableView {
  if (!candidate || typeof candidate !== 'object') return false;
  const state = candidate as Record<string, unknown>;

  if (typeof state.headerSignature !== 'string') return false;

  const sort = state.sort;
  if (sort !== null) {
    if (!sort || typeof sort !== 'object') return false;
    const sortState = sort as Record<string, unknown>;
    if (typeof sortState.col !== 'number' || !Number.isInteger(sortState.col) || sortState.col < 0) {
      return false;
    }
    if (sortState.dir !== 'asc' && sortState.dir !== 'desc') return false;
  }

  const filters = state.filters;
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) return false;
  for (const allowedValues of Object.values(filters)) {
    if (!Array.isArray(allowedValues)) return false;
    if (!allowedValues.every((value) => typeof value === 'string')) return false;
  }

  return true;
}

/**
 * 讀取某張表的檢視狀態。簽章雙保險：儲存的 headerSignature 與目前表頭算出的簽章
 * 不符（筆記內容被改過）→ 棄用回 null；壞資料一律容錯回 null。
 * @param noteId 筆記 id。
 * @param tableIndex 表在容器內的序號（0 起算）。
 * @param currentHeaderSignature 目前表頭算出的簽章（buildHeaderSignature 的結果）。
 * @returns 合法且簽章相符的檢視狀態（{sort, filters}）；否則 null（呼叫端視同無狀態）。
 */
export function readTableView(
  noteId: string,
  tableIndex: number,
  currentHeaderSignature: string
): TableViewState | null {
  const entry: unknown = readViewStateMap()[buildEntryKey(noteId, tableIndex)];
  if (!isValidStoredView(entry)) return null;
  if (entry.headerSignature !== currentHeaderSignature) return null;
  return { sort: entry.sort, filters: entry.filters };
}

/**
 * 寫入某張表的檢視狀態（整包覆蓋該表的紀錄，儲存值＝{headerSignature, sort, filters}）。
 * @param noteId 筆記 id。
 * @param tableIndex 表在容器內的序號（0 起算）。
 * @param headerSignature 寫入當下的表頭簽章（讀取時比對用）。
 * @param state 要儲存的檢視狀態（{sort, filters}）。
 */
export function writeTableView(
  noteId: string,
  tableIndex: number,
  headerSignature: string,
  state: TableViewState
): void {
  const map = readViewStateMap();
  map[buildEntryKey(noteId, tableIndex)] = {
    headerSignature,
    sort: state.sort,
    filters: state.filters,
  };
  writeViewStateMap(map);
}

/**
 * 清除某張表的檢視狀態（排序／篩選全解除時呼叫，不影響其他表的紀錄）。
 * @param noteId 筆記 id。
 * @param tableIndex 表在容器內的序號（0 起算）。
 */
export function clearTableView(noteId: string, tableIndex: number): void {
  const map = readViewStateMap();
  delete map[buildEntryKey(noteId, tableIndex)];
  writeViewStateMap(map);
}
