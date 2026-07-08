/**
 * 樂觀鎖衝突錯誤（HTTP 409）。
 *
 * 當資料在前端載入之後、被其他來源（另一裝置／外部 AI）修改，
 * 後端的更新端點會回 409；API 客戶端據此丟出本錯誤，
 * 讓呼叫端可提示使用者「已被其他來源修改，請選擇覆蓋或重新載入」。
 */
export class ConflictError extends Error {
  constructor(message = "此項已被其他來源修改") {
    super(message);
    this.name = "ConflictError";
  }
}
