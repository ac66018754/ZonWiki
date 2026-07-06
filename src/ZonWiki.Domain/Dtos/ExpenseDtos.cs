namespace ZonWiki.Domain.Dtos;

/// <summary>
/// 消費紀錄的回應 DTO（時間為 UTC，前端依裝置時區顯示）。
/// </summary>
/// <param name="Id">消費紀錄識別碼。</param>
/// <param name="OccurredDateTime">消費發生時間（UTC）。</param>
/// <param name="Amount">金額。</param>
/// <param name="Currency">幣別。</param>
/// <param name="CategoryId">分類識別碼（可空）。</param>
/// <param name="CategoryName">分類名稱（可空）。</param>
/// <param name="Merchant">商家（可空）。</param>
/// <param name="Items">品項清單（由 ItemsJson 反序列化；可空）。</param>
/// <param name="RawText">原始輸入文字。</param>
/// <param name="Source">建立來源（manual／web／api／voice）。</param>
/// <param name="NeedsConfirmation">是否需使用者確認。</param>
/// <param name="CreatedDateTime">建立時間（UTC）。</param>
public sealed record ExpenseDto(
    Guid Id,
    DateTime OccurredDateTime,
    decimal Amount,
    string Currency,
    Guid? CategoryId,
    string? CategoryName,
    string? Merchant,
    List<string>? Items,
    string RawText,
    string Source,
    bool NeedsConfirmation,
    DateTime CreatedDateTime);

/// <summary>
/// 記帳分類的回應 DTO。
/// </summary>
/// <param name="Id">分類識別碼。</param>
/// <param name="Name">分類名稱。</param>
/// <param name="Icon">圖示（可空）。</param>
/// <param name="SortOrder">排序權重。</param>
public sealed record ExpenseCategoryDto(
    Guid Id,
    string Name,
    string? Icon,
    int SortOrder);

/// <summary>
/// 手動建立消費的請求。
/// </summary>
/// <param name="Amount">金額（必填，須為正）。</param>
/// <param name="Currency">幣別（可空，預設 TWD）。</param>
/// <param name="CategoryId">分類識別碼（可空；若給須屬本人）。</param>
/// <param name="Merchant">商家（可空）。</param>
/// <param name="Items">品項清單（可空）。</param>
/// <param name="OccurredDateTime">消費時間（可空，預設 UtcNow）。</param>
/// <param name="RawText">原始文字（可空；未給時以商家／金額組後備字串）。</param>
/// <param name="NeedsConfirmation">是否需確認（可空，預設 false）。</param>
public sealed record CreateExpenseRequest(
    decimal Amount,
    string? Currency = null,
    Guid? CategoryId = null,
    string? Merchant = null,
    List<string>? Items = null,
    DateTime? OccurredDateTime = null,
    string? RawText = null,
    bool? NeedsConfirmation = null);

/// <summary>
/// 更新消費的請求（只更新有給的欄位）。
/// </summary>
/// <param name="Amount">金額（可空；給了須為正）。</param>
/// <param name="Currency">幣別（可空）。</param>
/// <param name="CategoryId">分類識別碼（可空；若給須屬本人）。</param>
/// <param name="Merchant">商家（可空）。</param>
/// <param name="Items">品項清單（可空）。</param>
/// <param name="OccurredDateTime">消費時間（可空）。</param>
/// <param name="NeedsConfirmation">是否需確認（可空；就地清除待確認用）。</param>
public sealed record UpdateExpenseRequest(
    decimal? Amount = null,
    string? Currency = null,
    Guid? CategoryId = null,
    string? Merchant = null,
    List<string>? Items = null,
    DateTime? OccurredDateTime = null,
    bool? NeedsConfirmation = null);

/// <summary>
/// 建立記帳分類的請求。
/// </summary>
/// <param name="Name">分類名稱（必填）。</param>
/// <param name="Icon">圖示（可空）。</param>
public sealed record CreateExpenseCategoryRequest(
    string Name,
    string? Icon = null);

/// <summary>
/// 網頁內文字→解析→入庫的請求（Cookie 路）。
/// </summary>
/// <param name="Text">一句話消費描述（必填）。</param>
/// <param name="DeviceNowIso">裝置目前時間 ISO8601（可空；供相對時間換算）。</param>
/// <param name="TimeZone">IANA 時區（可空）。</param>
/// <param name="ClientRequestId">冪等鍵（可空）。</param>
public sealed record ParseExpenseRequest(
    string Text,
    string? DeviceNowIso = null,
    string? TimeZone = null,
    string? ClientRequestId = null);

/// <summary>
/// 外部 AI／捷徑（PAT 路）一句話記帳的請求。
/// </summary>
/// <param name="Text">一句話消費描述（必填）。</param>
/// <param name="ClientRequestId">冪等鍵（可空；重送回既有結果）。</param>
/// <param name="DeviceNowIso">裝置目前時間 ISO8601（可空）。</param>
/// <param name="TimeZone">IANA 時區（可空）。</param>
public sealed record AiExpenseRequest(
    string Text,
    string? ClientRequestId = null,
    string? DeviceNowIso = null,
    string? TimeZone = null);

/// <summary>
/// 本月（或指定月）記帳彙總。
/// </summary>
/// <param name="Total">總額。</param>
/// <param name="Count">筆數。</param>
/// <param name="Month">月份（YYYY-MM，UTC 月界）。</param>
public sealed record ExpenseStatsDto(
    decimal Total,
    int Count,
    string Month);

/// <summary>
/// 解析入庫的回應：回「已入庫」或「已暫存（降級）」。
/// </summary>
/// <param name="Stored">是否已入庫為一筆消費。</param>
/// <param name="Expense">入庫的消費 DTO（Stored=true 時有值）。</param>
/// <param name="Deferred">是否降級為暫存（建了 CaptureItem）。</param>
/// <param name="CaptureItemId">暫存的 CaptureItem 識別碼（Deferred=true 時有值）。</param>
/// <param name="Message">給使用者的訊息。</param>
public sealed record ExpenseParseResponseDto(
    bool Stored,
    ExpenseDto? Expense,
    bool Deferred,
    Guid? CaptureItemId,
    string Message);
