/**
 * API 領域模組 — 單字庫（Vocabulary，SRS 間隔複習）。
 *
 * 本檔為單字庫前端（WP-B）與後端（WP-A）之間的契約層，樣板照 `./expense.ts`：
 *   - `GET /api/vocabulary` 回 `ApiResponse{ data: VocabularyWordDto[], meta: { total } }`——
 *     清單在 `data`（裸陣列）、總數在 `meta.total`，分頁參數為 `limit`/`offset`
 *     （本函式把「page＋pageSize」換算成 limit/offset，與記帳一致）。
 *   - `GET /api/vocabulary/due` 回 `ApiResponse{ data: VocabularyWordDto[] }`（到期佇列，Due≤now）。
 *   - `POST /api/vocabulary/{id}/review` 回 `ApiResponse{ data: ReviewVocabularyResponseDto }`，
 *     其形狀為 `{ card, preview }`（更新後的卡在 `data.card`，非 `data` 本身）。
 *
 * 對齊備註（監工整合時與後端核對；標「⚠️對齊」）：
 *   1. 清單分頁：契約字面寫 `page=`，工作包指定「照記帳 limit/offset」→ 本檔採 limit/offset。
 *   2. `state` 序列化：以字串收（"new"/"learning"/"review"/"relearning"），未知值優雅降級。
 *   3. `schedulePreview`：DB-as-truth 的權威間隔預覽——建議後端於 `/due` 卡附「四評分各自的下次到期」；
 *      缺省時前端退定性詞（見 vocabularyUtils.formatSchedulePreview），不顯示可能錯誤的天數。
 *   4. 來源筆記連結：需 `sourceNoteSlug`／`sourceNoteTitle`（notes 路由為 slug 制）；
 *      只有 `sourceNoteId`（Guid）時前端以非連結「來自筆記」降級，不用 id 硬組 `/notes/{id}`。
 * 皆保留「裸陣列無 meta」「回應直接是卡」等容忍分支，避免封套微調就整段錯。
 */

import { fetchJson } from "./client";

// ============================================================================
// 資料型別 — 單字庫
// ============================================================================

/**
 * SRS 卡片狀態（DB 欄位照 FSRS 形狀、值由 SM-2 填）。
 * ⚠️對齊：後端以字串輸出；前端以字串收、未知值優雅降級。
 */
export type VocabularyState = "new" | "learning" | "review" | "relearning";

/**
 * 四鍵評分（送出值固定小寫）。
 */
export type ReviewRating = "again" | "hard" | "good" | "easy";

/**
 * 單一評分的下次到期預覽（DB-as-truth 權威值，由後端 SM-2 排程器計算）。
 */
export interface SchedulePreviewEntry {
  /** 下次間隔天數（可空；後端若只回 due 則由 due 推算）。 */
  intervalDays?: number | null;
  /** 下次到期（UTC ISO）。 */
  due: string;
}

/**
 * 四鍵各自的下次到期預覽（key＝評分）。缺省鍵表示後端未提供該鍵預覽。
 */
export type SchedulePreview = Partial<Record<ReviewRating, SchedulePreviewEntry>>;

/**
 * 一張單字卡。對應後端 VocabularyWordDto（欄名 camelCase）。
 */
export interface VocabularyWord {
  /** 單字卡 ID。 */
  id: string;
  /** 單字（後端已 trim＋小寫正規化）。 */
  word: string;
  /** 音標（IPA，可空）。 */
  phonetic?: string | null;
  /** 詞性（可空）。 */
  partOfSpeech?: string | null;
  /** 英文釋義（可空）。 */
  definitionEn?: string | null;
  /** 中文釋義（可空）。 */
  definitionZh?: string | null;
  /** 例句（可空）。 */
  exampleSentence?: string | null;
  /** 來源筆記 ID（Guid，可空）。 */
  sourceNoteId?: string | null;
  /** ⚠️對齊：來源筆記 slug（連結需要；後端若未給則來源以非連結標示）。 */
  sourceNoteSlug?: string | null;
  /** ⚠️對齊：來源筆記標題（連結可讀標籤）。 */
  sourceNoteTitle?: string | null;
  /** 下次到期（UTC ISO）。 */
  due: string;
  /** 卡片狀態（見 {@link VocabularyState}；以字串收，未知值降級顯示原字串）。 */
  state: string;
  /** 連續成功次數。 */
  reps: number;
  /** 遺忘次數。 */
  lapses: number;
  /** 最後複習時間（UTC ISO，新卡為 null）。 */
  lastReviewDateTime?: string | null;
  /** 建立時間（UTC ISO）。 */
  createdDateTime: string;
  /**
   * SM-2 內部欄位（後端序列化即帶）：stability＝目前排程間隔（天）、difficulty＝EF（易度）。
   * 前端不直接顯示，保留供間隔預覽降級估算對齊後端演算法（見 vocabularyUtils）。
   */
  stability?: number | null;
  /** SM-2 易度因子（EF）。 */
  difficulty?: number | null;
  /**
   * ⚠️對齊（DB-as-truth 權威預覽）：四鍵按下後的下次到期預覽。
   * 建議後端於 `/due` 卡附上，且與實際 Review 走同一段間隔計算（共用程式碼路徑）以保證預覽＝實際結果。
   * 缺省時前端退定性詞（不顯示可能錯誤的天數），見 vocabularyUtils.formatSchedulePreview。
   */
  schedulePreview?: SchedulePreview | null;
}

/**
 * 單字清單（分頁）。data＝VocabularyWordDto[]、total 來自 meta.total（缺省退回本頁筆數）。
 */
export interface VocabularyListResult {
  /** 本頁項目。 */
  items: VocabularyWord[];
  /** 符合條件的總筆數（來自 meta.total；缺省時退回本頁筆數）。 */
  total: number;
}

/**
 * `POST /api/vocabulary/{id}/review` 回傳。對應後端 ReviewVocabularyResponseDto。
 * 更新後的卡在 `card`；`preview` 為剛評完卡的事後間隔預覽（前端目前不消費，見檔頭對齊備註 3）。
 */
export interface ReviewVocabularyResponse {
  /** 更新後的單字卡（含新的 due）。 */
  card: VocabularyWord;
  /** 四鍵事後間隔預覽（可選）。 */
  preview?: SchedulePreview | null;
}

// ============================================================================
// 查詢字串輔助
// ============================================================================

/**
 * 由清單篩選/分頁選項組出 query string（略過空值）。
 * 後端 `GET /api/vocabulary` 用 `state`/`search`/`limit`/`offset`；
 * 本函式把「page＋pageSize」換算成 limit/offset（與 buildExpenseQuery 一致）。
 * @param opts 篩選與分頁選項。
 * @returns 以 `?` 起頭的 query string；無任何條件時回空字串。
 */
function buildVocabularyQuery(opts?: {
  state?: string | null;
  search?: string | null;
  page?: number | null;
  pageSize?: number | null;
}): string {
  if (!opts) return "";
  const params = new URLSearchParams();
  if (opts.state) params.append("state", opts.state);
  const search = opts.search?.trim();
  if (search) params.append("search", search);
  const pageSize = opts.pageSize ?? null;
  if (pageSize != null && pageSize > 0) {
    params.append("limit", String(pageSize));
    const page = opts.page ?? 1;
    const offset = Math.max(0, (page - 1) * pageSize);
    if (offset > 0) params.append("offset", String(offset));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

// ============================================================================
// API 方法 — Vocabulary
// ============================================================================

/**
 * 列出單字卡（分頁）。
 *
 * 回傳封套：`data` 為 VocabularyWordDto 裸陣列，總數取自 `meta.total`（後端未提供時退回本頁筆數）。
 * 失敗（含未登入 / 端點未就緒）一律回空結果，讓 UI 顯示空狀態而非崩潰。
 * @param opts 篩選與分頁選項。
 * @returns 正規化後的清單與總數。
 */
export async function listVocabulary(opts?: {
  state?: string | null;
  search?: string | null;
  page?: number | null;
  pageSize?: number | null;
}): Promise<VocabularyListResult> {
  const response = await fetchJson<VocabularyWord[]>(
    `/api/vocabulary${buildVocabularyQuery(opts)}`,
  );
  const items = Array.isArray(response.data) ? response.data : [];
  // total 在 ApiResponse.meta.total（前端 ApiResponse 型別未含 meta，執行期仍有此欄）。
  const meta = (response as { meta?: { total?: number } }).meta;
  const total = typeof meta?.total === "number" ? meta.total : items.length;
  return { items, total };
}

/**
 * 取得到期複習佇列（Due≤now，Due 遞增）。
 *
 * 回傳 `data` 裸陣列；失敗回空陣列，讓複習模式顯示「今日沒有到期單字」而非崩潰。
 * @returns 到期單字卡陣列。
 */
export async function fetchDueVocabulary(): Promise<VocabularyWord[]> {
  const response = await fetchJson<VocabularyWord[]>("/api/vocabulary/due");
  return Array.isArray(response.data) ? response.data : [];
}

/**
 * 新增一張單字卡（手動表單）。對應 CreateVocabularyRequest。
 * 後端對重複字走「復活軟刪列 upsert」，新增既有字會回既有卡（前端照常 revalidate 即可）。
 * @param payload 單字欄位（word 必填）。
 * @returns 建立/復活的單字卡；失敗回 null。
 */
export async function createVocabulary(payload: {
  word: string;
  phonetic?: string | null;
  partOfSpeech?: string | null;
  definitionEn?: string | null;
  definitionZh?: string | null;
  exampleSentence?: string | null;
  sourceNoteId?: string | null;
}): Promise<VocabularyWord | null> {
  const r = await fetchJson<VocabularyWord>("/api/vocabulary", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return r.data ?? null;
}

/**
 * 更新一張單字卡（部分欄位；不含 word 與 SRS 排程欄）。對應 UpdateVocabularyRequest。
 * @param id 單字卡 ID。
 * @param payload 欲更新的欄位。
 * @returns 更新後的單字卡；失敗回 null。
 */
export async function updateVocabulary(
  id: string,
  payload: Partial<{
    phonetic: string | null;
    partOfSpeech: string | null;
    definitionEn: string | null;
    definitionZh: string | null;
    exampleSentence: string | null;
    sourceNoteId: string | null;
  }>,
): Promise<VocabularyWord | null> {
  const r = await fetchJson<VocabularyWord>(`/api/vocabulary/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  return r.data ?? null;
}

/**
 * 刪除一張單字卡（後端軟刪除，回 204 NoContent，會進垃圾桶）。
 * 比照 deleteExpense：204 無 body，fetchJson 不丟例外即視為成功。
 * @param id 單字卡 ID。
 * @returns 是否成功。
 */
export async function deleteVocabulary(id: string): Promise<boolean> {
  await fetchJson(`/api/vocabulary/${encodeURIComponent(id)}`, { method: "DELETE" });
  return true; // 未丟例外（非 5xx）即視為成功；204 無 body 屬正常。
}

/**
 * 送出一次複習評分。對應 ReviewVocabularyRequest / ReviewVocabularyResponseDto。
 *
 * 後端回應形狀為 `{ card, preview }`（排程由後端計算＝DB-as-truth）；本函式取出更新後的卡。
 * 容忍「回應直接是卡」的形狀（無 `card` 包裝時退回 data 本身），避免封套微調就整段錯。
 * @param id 單字卡 ID。
 * @param rating 四鍵評分。
 * @returns 更新後的單字卡（含新的 due）；失敗回 null。
 */
export async function reviewVocabulary(
  id: string,
  rating: ReviewRating,
): Promise<VocabularyWord | null> {
  const r = await fetchJson<ReviewVocabularyResponse>(
    `/api/vocabulary/${encodeURIComponent(id)}/review`,
    {
      method: "POST",
      body: JSON.stringify({ rating }),
    },
  );
  const data = r.data;
  if (!data) return null;
  const wrapped = data as { card?: VocabularyWord };
  // 標準形狀 { card, preview }→取 card；若後端直接回卡則退回 data 本身。
  return wrapped.card ?? (data as unknown as VocabularyWord);
}
