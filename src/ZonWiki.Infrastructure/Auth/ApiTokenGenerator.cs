using System.Security.Cryptography;
using System.Text;

namespace ZonWiki.Infrastructure.Auth;

/// <summary>
/// API 個人存取權杖（PAT）的「產生」與「雜湊」純函式工具。
///
/// 設計：
/// - 權杖 = 固定前綴 <c>zwk_</c> + 32 位元組密碼學亂數的 Base64Url 編碼（無填充），高熵、不可猜。
/// - 資料庫只存權杖的 SHA-256 雜湊；明碼僅在產生當下回傳一次。
/// - 因權杖本身即高熵亂數，驗證雜湊用 SHA-256 即足夠（不需密碼用的慢雜湊 KDF；這與 GitHub PAT 等做法一致）。
/// </summary>
public static class ApiTokenGenerator
{
    /// <summary>
    /// 權杖前綴：用於肉眼辨識「這是 ZonWiki 的權杖」。
    /// </summary>
    public const string TokenPrefixMarker = "zwk_";

    /// <summary>
    /// 產生一把新權杖。
    /// </summary>
    /// <returns>
    /// 三元組：
    /// <list type="bullet">
    /// <item><description><c>Token</c>：完整明碼權杖（僅回傳此一次，務必交給使用者後即丟棄、不落地）。</description></item>
    /// <item><description><c>Hash</c>：權杖的 SHA-256 十六進位雜湊（存入資料庫）。</description></item>
    /// <item><description><c>Prefix</c>：明碼開頭片段（存入資料庫，供清單畫面辨識）。</description></item>
    /// </list>
    /// </returns>
    public static (string Token, string Hash, string Prefix) Generate()
    {
        // 32 位元組（256 bit）密碼學亂數。
        var randomBytes = RandomNumberGenerator.GetBytes(32);
        var randomPart = Base64UrlEncode(randomBytes);
        var token = TokenPrefixMarker + randomPart;

        var hash = ComputeHash(token);

        // 顯示前綴：前綴標記 + 亂數開頭 6 字元（例如 "zwk_Ab12cd"），不足以反推完整權杖。
        var prefix = TokenPrefixMarker + randomPart[..Math.Min(6, randomPart.Length)];

        return (token, hash, prefix);
    }

    /// <summary>
    /// 計算權杖的 SHA-256 十六進位雜湊（小寫）。
    /// 驗證時把外部帶入的明碼權杖以此雜湊後與資料庫比對。
    /// </summary>
    /// <param name="token">明碼權杖字串。</param>
    /// <returns>SHA-256 十六進位字串（小寫，64 字元）。</returns>
    public static string ComputeHash(string token)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(token));
        return Convert.ToHexStringLower(bytes);
    }

    /// <summary>
    /// 將位元組以 Base64Url（URL 安全、無填充）編碼。
    /// </summary>
    /// <param name="bytes">原始位元組。</param>
    /// <returns>Base64Url 字串。</returns>
    private static string Base64UrlEncode(byte[] bytes)
    {
        return Convert.ToBase64String(bytes)
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
    }
}
