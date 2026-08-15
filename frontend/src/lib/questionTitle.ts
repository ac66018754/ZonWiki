/**
 * 從浮層元件推導「問題顯示標題」（與後端 NoteQuestionHelpers.DeriveQuestionTitle 規則一致）：
 * - sticky（便利貼）：優先取 DataJson.title；無則取文字前段；再無則預設字樣。
 * - text（T 文字框）：取文字前段；無則預設字樣。
 */

/** 問題標題最大顯示長度（超過即截斷加省略號）。 */
const QUESTION_TITLE_MAX_LENGTH = 30;

/** 無可用文字時的預設字樣。 */
const EMPTY_QUESTION_TITLE = '(未命名問題)';

/** 取文字前段（空白正規化、超長截斷）；空文字回退預設字樣。 */
function truncate(text: string | null | undefined): string {
  if (!text || text.trim() === '') return EMPTY_QUESTION_TITLE;
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length <= QUESTION_TITLE_MAX_LENGTH
    ? normalized
    : normalized.slice(0, QUESTION_TITLE_MAX_LENGTH) + '…';
}

/** 安全解析 DataJson 取字串屬性（壞資料回 null）。 */
function readJsonStringProperty(json: string | null | undefined, prop: string): string | null {
  if (!json) return null;
  try {
    const obj = JSON.parse(json) as unknown;
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      const value = (obj as Record<string, unknown>)[prop];
      return typeof value === 'string' ? value : null;
    }
  } catch {
    // 壞 JSON → 視為沒有標題。
  }
  return null;
}

/**
 * 推導問題顯示標題。
 *
 * @param kind 浮層型別（"sticky" / "text"）。
 * @param text 浮層文字內容。
 * @param dataJson 浮層的 DataJson（sticky 可能含 title）。
 */
export function deriveQuestionTitle(
  kind: string,
  text: string | null | undefined,
  dataJson: string | null | undefined
): string {
  if (kind === 'sticky') {
    const title = readJsonStringProperty(dataJson, 'title');
    if (title && title.trim() !== '') return truncate(title);
  }
  return truncate(text);
}
