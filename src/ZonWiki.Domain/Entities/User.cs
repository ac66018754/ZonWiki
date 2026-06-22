namespace ZonWiki.Domain.Entities;

/// <summary>
/// 使用者（透過 Google OAuth 登入建立）。同時保存個人化偏好（時區、顯示模式）。
/// </summary>
public class User : AuditableEntity
{
    /// <summary>
    /// Google 帳號的穩定識別碼（OAuth 的 sub claim），用於比對同一位使用者。
    /// 本機（密碼）帳號沒有 Google 身分，此欄位為 null——不可用空字串，否則多個本機帳號會
    /// 在 GoogleSub 唯一索引上互相衝突（Postgres 唯一索引允許多個 NULL，但不允許多個 ""）。
    /// </summary>
    public string? GoogleSub { get; set; }

    /// <summary>
    /// 電子郵件。
    /// </summary>
    public string Email { get; set; } = string.Empty;

    /// <summary>
    /// 顯示名稱。
    /// </summary>
    public string DisplayName { get; set; } = string.Empty;

    /// <summary>
    /// 頭像 URL（nullable）。
    /// </summary>
    public string? AvatarUrl { get; set; }

    /// <summary>
    /// 偏好時區（IANA 名稱，例如 "Asia/Taipei"）。空字串代表「跟隨裝置 / 系統預設」。
    /// 資料一律以 UTC 儲存，前端依此值換算顯示。
    /// </summary>
    public string TimeZone { get; set; } = string.Empty;

    /// <summary>
    /// 顯示模式（佈景主題）："warmpaper"（暖紙）、"light"（明亮）、"dark"（暗色）、"night"（夜間）。
    /// 全站共用此偏好（由開問啦的主題系統抽出）。預設暖紙。
    /// </summary>
    public string DisplayMode { get; set; } = "warmpaper";

    /// <summary>
    /// 密碼雜湊（本機帳號用）。使用 ASP.NET Core PasswordHasher 生成。
    /// OAuth 使用者可能無此欄位（null）。
    /// </summary>
    public string? PasswordHash { get; set; }

    /// <summary>
    /// 鍵盤快捷鍵的自訂覆寫（JSON 字串，格式為 { "動作ID": "按鍵" } 的對應表）。
    /// 只保存「與預設不同」的覆寫項；前端載入時會與內建預設合併成最終生效的鍵位。
    /// null 代表完全沿用預設。DB 為真實來源，故快捷鍵設定可跨裝置同步。
    /// </summary>
    public string? ShortcutsJson { get; set; }

    /// <summary>
    /// 導覽屬性：此使用者發表的留言清單。
    /// </summary>
    public ICollection<Comment> Comments { get; set; } = new List<Comment>();
}
