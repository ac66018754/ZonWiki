/**
 * 附件 API — 圖片上傳（貼上/選檔改走「存磁碟＋短網址」，取代舊的 base64 內嵌）。
 *
 * 後端：POST /api/attachments（multipart/form-data，欄位名 file）
 * 回傳的 url 為「相對路徑」（/api/attachments/{id}），跨環境通用；
 * 顯示時再用 lib/attachmentUrl.ts 補上 API base（本地 dev 前後端跨埠需要）。
 */

import { apiBase, type ApiResponse } from "./client";

/**
 * 上傳成功後回傳的附件資訊。
 */
export interface AttachmentUploadResult {
  /** 附件識別碼。 */
  id: string;
  /** 引用網址（相對路徑，例如 /api/attachments/{id}）。 */
  url: string;
  /** 清洗後的原始檔名（顯示用）。 */
  fileName: string;
  /** 落地內容型別（image/webp 或 image/gif）。 */
  contentType: string;
  /** 落地檔案大小（bytes）。 */
  fileSizeBytes: number;
  /** 影像寬（像素）。 */
  width: number;
  /** 影像高（像素）。 */
  height: number;
}

/**
 * 上傳一張圖片附件。
 *
 * 注意：這裡刻意不用 fetchJson —— multipart 上傳「不可」手動設定 Content-Type，
 * 必須讓瀏覽器自帶 boundary，而 fetchJson 會強制 application/json。
 *
 * @param file 要上傳的圖片檔（剪貼簿貼上或選檔取得的 File）。
 * @returns 附件資訊（含引用用的相對網址）。
 * @throws Error 上傳失敗時丟出（message 為可直接顯示給使用者的繁中訊息）。
 */
export async function uploadAttachment(file: File): Promise<AttachmentUploadResult> {
  const form = new FormData();
  form.append("file", file, file.name || "貼上的圖片");

  const res = await fetch(`${apiBase()}/api/attachments`, {
    method: "POST",
    credentials: "include", // Cookie auth
    body: form,
  });

  // 與 fetchJson 一致：401 廣播「請先登入」事件。
  if (res.status === 401 && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("zonwiki:unauthorized"));
  }

  let json: ApiResponse<AttachmentUploadResult> | null = null;
  try {
    json = (await res.json()) as ApiResponse<AttachmentUploadResult>;
  } catch {
    // 非 JSON 回應（例如 413 或代理錯誤頁）→ 走下方統一錯誤。
  }

  if (!res.ok || !json?.success || !json.data) {
    throw new Error(json?.error || `圖片上傳失敗（HTTP ${res.status}）`);
  }
  return json.data;
}
