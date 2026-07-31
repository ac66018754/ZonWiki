/**
 * 段落引用字串（`zonwiki-mark:{noteId}:{markId}`）的格式化與解析（feature/paragraph-links 包4）。
 *
 * 「複製段落引用」（方案 C）會把此字串寫進剪貼簿；建立關聯的搜尋框偵測到貼上此格式，
 * 即可「直取段落目標」建立段落級關聯——不需再走渲染預覽點段落的完整流程。
 *
 * 設計取捨：解析刻意「嚴格驗 GUID」——搜尋框每次輸入都會呼叫 parseMarkRef，
 * 一般搜尋文字（含使用者亂打的字）絕不可被誤判成段落引用，故 noteId/markId 都必須是合法 GUID。
 */

/** 段落引用字串的固定前綴。 */
const MARK_REF_PREFIX = "zonwiki-mark:";

/**
 * GUID（含連字號、大小寫皆可）比對：8-4-4-4-12。
 * 用「整串錨定」（^…$）確保片段不含多餘字元。
 */
const GUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * 把（noteId, markId）格式化成段落引用字串。
 * @param noteId 目標筆記識別碼。
 * @param markId 目標段落錨點（kind="anchor"）識別碼。
 * @returns `zonwiki-mark:{noteId}:{markId}`。
 */
export function formatMarkRef(noteId: string, markId: string): string {
  return `${MARK_REF_PREFIX}${noteId}:${markId}`;
}

/**
 * 解析段落引用字串。容忍前後空白（貼上常帶空白/換行）；
 * 前綴不符、缺欄位、或 GUID 格式錯誤一律回 null（一般搜尋文字不得被誤判）。
 * @param raw 待解析字串（可能是使用者貼上或搜尋框輸入）。
 * @returns 解析出的 { noteId, markId }，或 null。
 */
export function parseMarkRef(raw: string): { noteId: string; markId: string } | null {
  if (!raw) return null;

  const trimmed = raw.trim();
  if (!trimmed.startsWith(MARK_REF_PREFIX)) return null;

  const rest = trimmed.slice(MARK_REF_PREFIX.length);
  const parts = rest.split(":");
  if (parts.length !== 2) return null;

  const [noteId, markId] = parts;
  if (!GUID_PATTERN.test(noteId) || !GUID_PATTERN.test(markId)) return null;

  return { noteId, markId };
}
