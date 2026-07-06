/**
 * API 客戶端核心 — 共用的基礎 URL、回應包裝與 fetch wrapper。
 *
 * 後端基礎 URL: http://localhost:5009 (開發)
 * 環境變數:
 *   - NEXT_PUBLIC_API_URL: 瀏覽器用 (預設 http://localhost:5009)
 *   - API_INTERNAL_URL: SSR 用 (容器內服務名稱，可選)
 *
 * 回應格式: { success: boolean, data: T, error?: string, statusCode?: number }
 *
 * 說明：本檔為 lib/api 各領域模組共用的底層；apiBase / fetchJson / BROWSER_API_BASE
 * 僅供 lib/api 內部使用，不透過 barrel（index.ts）對外曝露，維持既有公開 API 介面不變。
 */

/**
 * 瀏覽器端使用的 API 基礎 URL（模組載入時決定，供產生對外連結用）。
 */
export const BROWSER_API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5009";

/**
 * 取得 API 基礎 URL
 * - SSR 時可用內部服務名稱
 * - 瀏覽器時用公開 URL
 */
export function apiBase(): string {
  if (typeof window === "undefined") {
    return (
      process.env.API_INTERNAL_URL ??
      process.env.NEXT_PUBLIC_API_URL ??
      "http://localhost:5009"
    );
  }
  return BROWSER_API_BASE;
}

// ============================================================================
// API 回應包裝
// ============================================================================

/**
 * API 統一回應格式
 */
export interface ApiResponse<T = unknown> {
  /** 請求是否成功 */
  success: boolean;
  /** 回傳資料 (成功時) */
  data?: T | null;
  /** 錯誤訊息 (失敗時) */
  error?: string | null;
  /** HTTP 狀態碼 */
  statusCode?: number;
}

// ============================================================================
// 內部函式 — 通用 fetch wrapper
// ============================================================================

/**
 * 通用 JSON fetch 函式，自動處理 ApiResponse 包裝
 */
export async function fetchJson<T>(
  path: string,
  init?: RequestInit,
  // SSR 時需手動帶入請求的 Cookie（瀏覽器 cookie 不會自動轉發到 Next 伺服器端的 fetch）
  cookieHeader?: string
): Promise<ApiResponse<T>> {
  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    credentials: "include", // 遵守 cookie auth
    headers: {
      "Content-Type": "application/json",
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      ...(init?.headers ?? {}),
    },
  });

  // 401（未登入/登入失效）：在瀏覽器端廣播事件，讓全站提示「請先登入」彈窗（見 SessionExpiryPrompt）。
  // SSR（無 window）不廣播——那是 layout 正常判斷登入狀態。
  if (res.status === 401 && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("zonwiki:unauthorized"));
  }

  // 401/404/400/409 不視為連線例外，回傳已解析的 ApiResponse 主體（含 error 訊息與 statusCode）
  // 供呼叫端就地處理。400（client error）帶明確錯誤訊息（如「目前密碼錯誤」）；
  // 409（樂觀鎖衝突，#4/#34）帶「此項已被其他來源修改」，呼叫端據 statusCode 轉成 ConflictError。
  if (
    !res.ok &&
    res.status !== 401 &&
    res.status !== 404 &&
    res.status !== 400 &&
    res.status !== 409
  ) {
    throw new Error(`API ${path} failed with ${res.status}`);
  }

  try {
    return (await res.json()) as ApiResponse<T>;
  } catch {
    return {
      success: false,
      error: "Invalid JSON response",
      statusCode: res.status,
    };
  }
}
