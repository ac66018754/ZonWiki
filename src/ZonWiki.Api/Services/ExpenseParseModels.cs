namespace ZonWiki.Api.Services;

/// <summary>
/// 記帳文字解析的結果。<see cref="Success"/>=false 表示需降級——端點據此改建 CaptureItem 回「已暫存」。
/// </summary>
/// <param name="Success">是否成功解析出可入庫的消費（false＝壞 JSON／缺必要欄位→降級）。</param>
/// <param name="Amount">金額（decimal）。</param>
/// <param name="Currency">幣別（預設 TWD）。</param>
/// <param name="Merchant">商家（正規化後；可空）。</param>
/// <param name="ItemsJson">品項 JSON 字串陣列（可空）。</param>
/// <param name="CategoryName">分類名稱（供端點以名稱式 find-or-create 解析；空字串＝交由端點落到「其他」）。</param>
/// <param name="OccurredDateTimeUtc">消費發生時間（UTC；相對時間已由 LLM 換算）。</param>
/// <param name="NeedsConfirmation">是否需使用者確認（confidence &lt; 0.7 或降級時 true）。</param>
/// <param name="Reasoning">LLM 的推理過程（僅供除錯／記錄；不入庫）。</param>
public sealed record ExpenseParseOutcome(
    bool Success,
    decimal Amount,
    string Currency,
    string? Merchant,
    string? ItemsJson,
    string CategoryName,
    DateTime OccurredDateTimeUtc,
    bool NeedsConfirmation,
    string? Reasoning)
{
    /// <summary>
    /// 建立「降級」結果（解析失敗）：Success=false、NeedsConfirmation=true，供端點改建 CaptureItem。
    /// </summary>
    /// <param name="reasoning">可選的降級原因（供記錄）。</param>
    /// <returns>降級用的解析結果。</returns>
    public static ExpenseParseOutcome Degraded(string? reasoning = null) =>
        new(false, 0m, "TWD", null, null, string.Empty, DateTime.UtcNow, true, reasoning);
}

/// <summary>
/// 記帳解析過程中「供應者回報硬錯誤（Error 事件）」時拋出的例外。
/// 端點攔截此例外後走保底路（建 CaptureItem 回「已暫存」）。
/// </summary>
public sealed class ExpenseParseException : Exception
{
    /// <summary>
    /// 以錯誤訊息建立解析例外。
    /// </summary>
    /// <param name="message">錯誤訊息（通常來自 AI 供應者的 Error 事件）。</param>
    public ExpenseParseException(string message) : base(message)
    {
    }
}
