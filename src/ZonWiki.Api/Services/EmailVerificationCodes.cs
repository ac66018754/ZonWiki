using Microsoft.Extensions.Caching.Memory;

namespace ZonWiki.Api.Services;

/// <summary>
/// email 驗證碼的產生與驗證（暫存於 IMemoryCache，10 分鐘過期）。
/// 用於「註冊」與「修改 email」兩種情境（以 purpose 區分）。
/// 注意：真正寄信需要 SMTP 設定；目前無 SMTP，故由端點在開發環境直接回傳驗證碼（devCode）並寫入記錄。
/// </summary>
public sealed class EmailVerificationCodes(IMemoryCache cache)
{
    private readonly IMemoryCache _cache = cache;

    /// <summary>驗證碼有效時間。</summary>
    private static readonly TimeSpan Ttl = TimeSpan.FromMinutes(10);

    /// <summary>
    /// 產生並暫存一組 6 位數驗證碼。
    /// </summary>
    /// <param name="purpose">用途（"register" 或 "change_email"）。</param>
    /// <param name="email">目標 email。</param>
    /// <returns>6 位數驗證碼。</returns>
    public string Issue(string purpose, string email)
    {
        var code = Random.Shared.Next(0, 1_000_000).ToString("D6");
        _cache.Set(Key(purpose, email), code, Ttl);
        return code;
    }

    /// <summary>
    /// 驗證一組驗證碼是否正確且未過期；成功後即作廢（一次性）。
    /// </summary>
    /// <param name="purpose">用途。</param>
    /// <param name="email">目標 email。</param>
    /// <param name="code">使用者輸入的驗證碼。</param>
    /// <returns>是否通過。</returns>
    public bool Verify(string purpose, string email, string? code)
    {
        if (string.IsNullOrWhiteSpace(code))
        {
            return false;
        }

        var key = Key(purpose, email);
        if (_cache.TryGetValue(key, out string? stored) && stored == code.Trim())
        {
            _cache.Remove(key); // 一次性
            return true;
        }
        return false;
    }

    /// <summary>
    /// 組合快取鍵（email 正規化為小寫去空白）。
    /// </summary>
    private static string Key(string purpose, string email) =>
        $"emailcode:{purpose}:{email.Trim().ToLowerInvariant()}";
}
