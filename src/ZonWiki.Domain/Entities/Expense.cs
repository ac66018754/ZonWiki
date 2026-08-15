namespace ZonWiki.Domain.Entities;

/// <summary>
/// 一筆消費紀錄（記帳）。可由手動表單、網頁文字解析、外部 AI（iPhone 捷徑 PAT）或語音輸入建立。
///
/// 重要慣例：
/// - 金額以 <see cref="decimal"/> 儲存（config 設 precision(18,2)），避免浮點誤差。
/// - 時間一律以 UTC 儲存（<see cref="OccurredDateTime"/>）；相對時間（剛剛／昨天中午）由 LLM
///   依裝置時區換算後存 UTC，前端再依使用者時區顯示。
/// - 一律軟刪除（繼承 <see cref="AuditableEntity"/> 的 ValidFlag）。
/// </summary>
public class Expense : AuditableEntity, IUserOwned
{
    /// <summary>
    /// 擁有此消費紀錄的使用者識別碼。對應資料表欄位 Expense_UserId。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 消費發生時間（UTC）。相對時間由 LLM 依裝置時區換算後存 UTC。
    /// </summary>
    public DateTime OccurredDateTime { get; set; }

    /// <summary>
    /// 金額（以 decimal 儲存，config 設 precision(18,2)）。
    /// </summary>
    public decimal Amount { get; set; }

    /// <summary>
    /// 幣別（ISO 4217；預設新台幣 TWD）。
    /// </summary>
    public string Currency { get; set; } = "TWD";

    /// <summary>
    /// 所屬分類識別碼（可空）。用可空 FK 避免分類軟刪時外鍵卡死；
    /// 「無法歸類」時解析服務仍會落到「其他」分類並給值。
    /// </summary>
    public Guid? CategoryId { get; set; }

    /// <summary>
    /// 商家名稱（正規化後；可空）。例如「小七／7-11／seven」正規化為「統一超商」。
    /// </summary>
    public string? Merchant { get; set; }

    /// <summary>
    /// 品項清單（JSON 字串陣列；可空）。例如 ["書","茶葉蛋"]。
    /// </summary>
    public string? ItemsJson { get; set; }

    /// <summary>
    /// 原始輸入文字（永久保留，供回溯與重新解析）。
    /// </summary>
    public string RawText { get; set; } = string.Empty;

    /// <summary>
    /// 建立來源："manual"（手動表單）／"web"（網頁文字解析）／"api"（外部 AI／PAT）／"voice"（語音）。
    /// </summary>
    public string Source { get; set; } = "manual";

    /// <summary>
    /// 降級暫存時對應的 CaptureItem 識別碼（可空）。目前主要保留欄位，供日後由 CaptureItem 回填。
    /// </summary>
    public Guid? CaptureItemId { get; set; }

    /// <summary>
    /// 冪等鍵（可空）。外部 AI／捷徑重送同一鍵時，後端直接回既有結果、不重複建立。
    /// 唯一索引 (UserId, ClientRequestId) 為「過濾式唯一」——僅約束非 null 值。
    /// </summary>
    public string? ClientRequestId { get; set; }

    /// <summary>
    /// 是否需要使用者確認（confidence &lt; 0.7 或降級時為 true）。
    /// 前端把待確認的消費置頂，供一鍵修正金額／分類。
    /// </summary>
    public bool NeedsConfirmation { get; set; }

    /// <summary>
    /// 導覽屬性：所屬分類（可空）。
    /// </summary>
    public ExpenseCategory? Category { get; set; }
}
