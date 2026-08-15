/**
 * 附件網址解析工具。
 *
 * 筆記內文與浮層資料裡的附件一律存「相對路徑」（/api/attachments/{id}），
 * 好處是跨環境通用（prod 前後端同源、本地 DB 倒回也不會夾帶錯誤的主機名）。
 * 顯示時才把相對路徑補成完整 API 網址：
 * - prod：前後端同源（https://zonwiki.pee-yang.com），補與不補等價。
 * - 本地 dev：前端 :3000、API :5009 跨埠，<img> 一定要補 API base 才載得到
 *   （同站不同埠，瀏覽器仍會自動帶認證 Cookie）。
 */

/** 附件引用網址的相對路徑前綴。 */
export const ATTACHMENT_PATH_PREFIX = "/api/attachments/";

/** 瀏覽器端 API 基礎網址（與 lib/api/client.ts 的 BROWSER_API_BASE 同源設定）。 */
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5009";

/**
 * 單一網址：附件相對路徑 → 絕對網址；其他（http(s)/data: 等，含舊筆記的 base64）原樣通過。
 *
 * @param src 圖片來源網址（可能是附件相對路徑、外部網址或 data URL）。
 * @returns 可直接給 <img src> 使用的網址。
 */
export function toAbsoluteAttachmentUrl(src: string): string {
  return src.startsWith(ATTACHMENT_PATH_PREFIX) ? `${API_BASE}${src}` : src;
}

/**
 * 整段 HTML（後端 Markdig 渲染的 ContentHtml）：把附件圖片的 src 補成絕對網址。
 * 只針對 <img src="/api/attachments/..."> 的固定樣式做字串替換（Markdig 輸出屬性一律雙引號）。
 *
 * @param html 後端渲染的筆記 HTML。
 * @returns src 已補上 API base 的 HTML。
 */
export function resolveAttachmentUrls(html: string): string {
  if (!html.includes(ATTACHMENT_PATH_PREFIX)) return html;
  return html.replaceAll(
    `src="${ATTACHMENT_PATH_PREFIX}`,
    `src="${API_BASE}${ATTACHMENT_PATH_PREFIX}`,
  );
}
