/**
 * API 領域模組 — 記帳（Expense）。
 *
 * 本檔為記帳前端與後端（WP-A）之間的契約層。**已於 2026-07-07 與 WP-A 實作
 * （`src/ZonWiki.Api/Endpoints/ExpenseEndpoints.cs`＋`src/ZonWiki.Domain/Dtos/ExpenseDtos.cs`）核對對齊**，
 * 解決審查 MEDIUM #5「清單封套形狀未確認」：
 *   - `GET /api/expenses` 回 `ApiResponse{ data: ExpenseDto[], meta: { total } }`——
 *     **清單在 data（裸陣列）、總數在 meta.total**（非 data 內），分頁參數為 `limit`/`offset`（非 page/pageSize）。
 *   - 分類端點為 `/api/expenses/categories`（審查 LOW；非最初臆測的 `/api/expense-categories`）。
 *   - `POST /api/expenses/parse` 回 `ExpenseParseResponseDto{ stored, expense, deferred, captureItemId, message }`
 *     （非 status enum；三態由 stored／deferred／expense.needsConfirmation 推導）。
 * 仍保留對「裸陣列無 meta」的容忍（total 退回本頁筆數），避免封套微調就整段錯。
 */

import { fetchJson } from "./client";
import { normalizeAnalytics, type ExpenseAnalytics } from "@/lib/expenseAnalytics";

// 對外轉出分析型別（維持 `@/lib/api` barrel 相容——呼叫端沿用 `import { ExpenseAnalytics } from "@/lib/api"`）。
export type {
  ExpenseAnalytics,
  TrendPoint,
  CategorySlice,
  DailyPoint,
  MerchantSlice,
} from "@/lib/expenseAnalytics";

// ============================================================================
// 資料型別 — 記帳
// ============================================================================

/**
 * 消費分類（獨立於筆記 Category；語意不同，避免污染筆記分類樹）。對應後端 ExpenseCategoryDto。
 */
export interface ExpenseCategory {
  /** 分類 ID。 */
  id: string;
  /** 分類名稱。 */
  name: string;
  /** 分類圖示（emoji，可空）。 */
  icon?: string | null;
  /** 排序權重（小者在前）。 */
  sortOrder: number;
}

/**
 * 一筆消費紀錄。對應後端 ExpenseDto。
 */
export interface Expense {
  /** 消費紀錄 ID。 */
  id: string;
  /** 消費發生時間（UTC ISO；前端依使用者時區顯示）。 */
  occurredDateTime: string;
  /** 金額。 */
  amount: number;
  /** 幣別（預設 TWD）。 */
  currency: string;
  /** 所屬分類 ID（可空＝未分類）。 */
  categoryId: string | null;
  /** 所屬分類名稱（後端 join 回傳，供清單顯示）。 */
  categoryName?: string | null;
  /** 商家（正規化後，可空）。 */
  merchant?: string | null;
  /** 品項清單（可空）。 */
  items?: string[] | null;
  /** 原始輸入文字。 */
  rawText: string;
  /** 來源（manual｜web｜api｜voice）。 */
  source: string;
  /** 是否待確認（true → 置頂待確認佇列，供快速核對修正）。 */
  needsConfirmation: boolean;
  /** 建立時間（UTC ISO）。 */
  createdDateTime: string;
}

/**
 * 記帳清單（分頁）。data＝ExpenseDto[]、total 來自 meta.total（見檔頭說明）。
 */
export interface ExpenseListResult {
  /** 本頁項目。 */
  items: Expense[];
  /** 符合條件的總筆數（來自 meta.total；缺省時退回本頁筆數）。 */
  total: number;
}

/**
 * 本月（或指定月）統計。對應後端 ExpenseStatsDto（total／count／month）。
 * 註：後端未回幣別，前端顯示一律以 TWD 格式化。
 */
export interface ExpenseStats {
  /** 該月總額。 */
  total: number;
  /** 該月筆數。 */
  count: number;
  /** 統計月份（YYYY-MM，UTC 月界）。 */
  month: string;
}

/**
 * `/api/expenses/parse` 回傳。對應後端 ExpenseParseResponseDto。
 * 三態語意（供 UI 推導）：
 * - stored=true 且 expense.needsConfirmation=false → 已記帳（created）。
 * - stored=true 且 expense.needsConfirmation=true → 已記帳但待確認（needs_confirmation）。
 * - deferred=true → AI 不可用／逾時，降級存入快速捕捉（stashed；設計書 §5.3 保底）。
 */
export interface ParseExpenseResult {
  /** 是否已入庫為一筆消費。 */
  stored: boolean;
  /** 入庫的消費 DTO（stored=true 時有值）。 */
  expense?: Expense | null;
  /** 是否降級為暫存（建了 CaptureItem）。 */
  deferred: boolean;
  /** 暫存的 CaptureItem ID（deferred=true 時有值）。 */
  captureItemId?: string | null;
  /** 後端給使用者的訊息。 */
  message: string;
}

// ============================================================================
// 查詢字串輔助
// ============================================================================

/**
 * 由清單篩選/分頁選項組出 query string（略過空值）。
 * 後端 `GET /api/expenses` 用 `from`/`to`/`categoryId`/`limit`/`offset`（非 page/pageSize/month）；
 * 本函式把「page＋pageSize」換算成 limit/offset。
 * @param opts 篩選與分頁選項。
 * @returns 以 `?` 起頭的 query string；無任何條件時回空字串。
 */
function buildExpenseQuery(opts?: {
  from?: string | null;
  to?: string | null;
  categoryId?: string | null;
  page?: number | null;
  pageSize?: number | null;
}): string {
  if (!opts) return "";
  const params = new URLSearchParams();
  if (opts.from) params.append("from", opts.from);
  if (opts.to) params.append("to", opts.to);
  if (opts.categoryId) params.append("categoryId", opts.categoryId);
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
// API 方法 — Expense
// ============================================================================

/**
 * 列出消費紀錄（分頁）。
 *
 * 回傳封套：`data` 為 ExpenseDto 裸陣列，總數取自 `meta.total`（後端未提供時退回本頁筆數）。
 * 失敗（含未登入 / 端點未就緒）一律回空結果，讓 UI 顯示空狀態而非崩潰。
 * @param opts 篩選與分頁選項（month 目前後端不吃，保留供未來擴充）。
 * @returns 正規化後的清單與總數。
 */
export async function listExpenses(opts?: {
  month?: string | null;
  from?: string | null;
  to?: string | null;
  categoryId?: string | null;
  page?: number | null;
  pageSize?: number | null;
}): Promise<ExpenseListResult> {
  const response = await fetchJson<Expense[]>(`/api/expenses${buildExpenseQuery(opts)}`);
  const items = Array.isArray(response.data) ? response.data : [];
  // total 在 ApiResponse.meta.total（前端 ApiResponse 型別未含 meta，執行期仍有此欄）。
  const meta = (response as { meta?: { total?: number } }).meta;
  const total = typeof meta?.total === "number" ? meta.total : items.length;
  return { items, total };
}

/**
 * 新增一筆消費紀錄（手動表單）。對應 CreateExpenseRequest。
 * @param payload 消費欄位。
 * @returns 建立的消費紀錄；失敗回 null。
 */
export async function createExpense(payload: {
  amount: number;
  categoryId?: string | null;
  merchant?: string | null;
  items?: string[] | null;
  occurredDateTime: string;
  currency?: string;
  rawText?: string | null;
  needsConfirmation?: boolean;
}): Promise<Expense | null> {
  const r = await fetchJson<Expense>("/api/expenses", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return r.data ?? null;
}

/**
 * 更新一筆消費紀錄（部分欄位）。對應 UpdateExpenseRequest。
 * @param id 消費紀錄 ID。
 * @param payload 欲更新的欄位。
 * @returns 更新後的消費紀錄；失敗回 null。
 */
export async function updateExpense(
  id: string,
  payload: Partial<{
    amount: number;
    categoryId: string | null;
    merchant: string | null;
    items: string[] | null;
    occurredDateTime: string;
    currency: string;
    needsConfirmation: boolean;
  }>
): Promise<Expense | null> {
  const r = await fetchJson<Expense>(`/api/expenses/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  return r.data ?? null;
}

/**
 * 刪除一筆消費紀錄（後端軟刪除，回 204 NoContent，會進垃圾桶）。
 * 比照 deleteCapture：204 無 body，fetchJson 不丟例外即視為成功（不看 r.success，因 204 解析 JSON 會失敗）。
 * @param id 消費紀錄 ID。
 * @returns 是否成功。
 */
export async function deleteExpense(id: string): Promise<boolean> {
  await fetchJson(`/api/expenses/${encodeURIComponent(id)}`, { method: "DELETE" });
  return true; // 未丟例外（非 5xx）即視為成功；204 無 body 屬正常。
}

/**
 * 文字「一句話記帳」→ 後端 AI 解析 → 入庫（三態）。對應 ParseExpenseRequest / ExpenseParseResponseDto。
 *
 * `clientRequestId` 為**冪等鍵**（設計書 §5.1／§5.3）：對「同一筆邏輯提交」必須穩定，
 * 讓「請求已送達但回應遺失、使用者再送一次」時後端可去重、直接回既有結果，避免重複消費。
 * **呼叫端須傳入穩定的 clientRequestId（在 state/ref 產生一次、跨重試沿用）**，
 * 嚴禁每次呼叫在此處或按鈕 onClick 內以 `crypto.randomUUID()` 現產（審查 MEDIUM #1）。
 * 註：後端網頁路 `/api/expenses/parse` 目前將 source 固定為 "web"（其 DTO 無 source 欄），
 * 故 source 為前端內部記錄用（§5.2 R7）、送出被後端忽略、無害且向前相容。
 * @param payload 記帳文字與去重/時區脈絡。
 * @returns 三態解析結果；連線層失敗回 null。
 */
export async function parseExpense(payload: {
  text: string;
  source?: string;
  clientRequestId: string;
  deviceNowIso: string;
  timeZone: string;
}): Promise<ParseExpenseResult | null> {
  const r = await fetchJson<ParseExpenseResult>("/api/expenses/parse", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return r.data ?? null;
}

/**
 * 取得某月統計（Phase 1 只用總額）。對應 ExpenseStatsDto。
 * @param month 月份（YYYY-MM）。
 * @returns 統計；失敗回 null。
 */
export async function getExpenseStats(month: string): Promise<ExpenseStats | null> {
  const r = await fetchJson<ExpenseStats>(
    `/api/expenses/stats?month=${encodeURIComponent(month)}`
  );
  return r.data ?? null;
}

/**
 * 取得某月「記帳分析」彙總（一次回全部圖表所需資料）。對應後端 WP-A `ExpenseAnalyticsDto`。
 *
 * 契約權威＝後端 §0（欄名見 `lib/expenseAnalytics.ts`）。
 * **錯誤語意分流（審查 MEDIUM #1，修「失敗偽裝成本月無資料」）**——
 * 過去一律吞成 null，導致 500／斷線與「真的零消費」無法區分、AnalyticsView 的錯誤四態成死碼。現在：
 *   - **not-ready／未登入（404／401）→ 回 null**：顯示友善空狀態，不誤報錯誤
 *     （前後端平行開發時後端未好即 404；401 另有全站登入彈窗處理）。
 *   - **真正失敗（5xx／網路例外／回應 JSON 損毀／其餘 4xx）→ throw**：讓 SWR 的 `error` 被填、
 *     AnalyticsView 進錯誤框並可自動重試，而非把失敗畫成「本月無資料」。
 * @param month 月份（YYYY-MM）。
 * @param options 近 N 月（months）與商家 Top N（topN）；不傳則由後端套預設。
 * @returns 正規化後的分析模型（成功）或 null（not-ready／未登入）；真正失敗則 throw。
 */
export async function getExpenseAnalytics(
  month: string,
  options?: {
    months?: number | null;
    topN?: number | null;
  }
): Promise<ExpenseAnalytics | null> {
  const params = new URLSearchParams();
  if (month) params.append("month", month);
  if (options?.months != null) params.append("months", String(options.months));
  if (options?.topN != null) params.append("topN", String(options.topN));
  const query = params.toString();

  // fetchJson 對 5xx／網路例外會 throw（此處**不吞**，直接冒泡給 SWR）；對 401/404/400/409 與
  // JSON 損毀回 { success:false, statusCode }。據此分流 not-ready（回 null）vs 真正失敗（throw）。
  const r = await fetchJson<unknown>(
    `/api/expenses/analytics${query ? `?${query}` : ""}`
  );
  if (r.success === false) {
    if (r.statusCode === 404 || r.statusCode === 401) {
      return null; // 端點未就緒／未登入：友善空狀態，不當錯誤處理
    }
    throw new Error(r.error ?? `分析載入失敗（HTTP ${r.statusCode ?? "unknown"}）`);
  }
  return normalizeAnalytics(r.data);
}

// ============================================================================
// API 方法 — ExpenseCategory（端點在 /api/expenses/categories）
// ============================================================================

/**
 * 列出消費分類（供手動表單的分類下拉）。端點 `GET /api/expenses/categories`
 *（後端惰性種子 8 個預設分類）。抓取失敗回空陣列，由記帳頁優雅降級。
 * @returns 消費分類清單；失敗回空陣列。
 */
export async function listExpenseCategories(): Promise<ExpenseCategory[]> {
  const r = await fetchJson<ExpenseCategory[]>("/api/expenses/categories");
  return r.data ?? [];
}

/**
 * 就地新增一個消費分類（後端名稱式 find-or-create＋復活）。端點 `POST /api/expenses/categories`。
 * @param payload 分類名稱與（可選）圖示。
 * @returns 建立的分類；失敗回 null。
 */
export async function createExpenseCategory(payload: {
  name: string;
  icon?: string;
}): Promise<ExpenseCategory | null> {
  const r = await fetchJson<ExpenseCategory>("/api/expenses/categories", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return r.data ?? null;
}
