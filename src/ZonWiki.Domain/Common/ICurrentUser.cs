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
}
