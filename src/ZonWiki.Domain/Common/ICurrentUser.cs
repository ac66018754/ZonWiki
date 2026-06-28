namespace ZonWiki.Domain.Common;

/// <summary>
/// 抽象化「目前登入使用者」的身分資訊。
/// 由 HttpContext 的宣告 (claim) 構成，若未登入則傳回預設值。
/// </summary>
public interface ICurrentUser
{
    /// <summary>
    /// 目前登入使用者的唯一識別碼（Guid）。
    /// 若未登入，則傳回 Guid.Empty。
    /// </summary>
    Guid UserId { get; }

    /// <summary>
    /// 目前登入使用者的電子郵件。
    /// 若未登入，則傳回 null。
    /// </summary>
    string? Email { get; }

    /// <summary>
    /// 目前登入使用者是否已驗證。
    /// </summary>
    bool IsAuthenticated { get; }

    /// <summary>
    /// 目前請求的操作來源："web"（Cookie 登入、人類在瀏覽器操作），
    /// 或 API 權杖名稱（例如 "Claude Code"，表示外部 AI 助理透過權杖操作）。
    /// 供活動紀錄標示「是誰/哪個 AI 做的」。未登入或網頁操作時為 "web"。
    /// </summary>
    string Source { get; }
}
