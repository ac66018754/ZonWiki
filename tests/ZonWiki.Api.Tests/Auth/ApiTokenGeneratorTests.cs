using FluentAssertions;
using Xunit;
using ZonWiki.Infrastructure.Auth;

namespace ZonWiki.Api.Tests.Auth;

/// <summary>
/// <see cref="ApiTokenGenerator"/> 的純函式單元測試（審查 #45）：
/// 驗證權杖產生（前綴、高熵、唯一性）與雜湊（決定性、單向、對輸入敏感）。
/// </summary>
public sealed class ApiTokenGeneratorTests
{
    /// <summary>
    /// 產生的權杖應帶固定前綴 <c>zwk_</c>，且回傳的顯示前綴亦以其開頭。
    /// </summary>
    [Fact]
    public void Generate_ProducesTokenWithExpectedPrefix()
    {
        var (token, hash, prefix) = ApiTokenGenerator.Generate();

        token.Should().StartWith(ApiTokenGenerator.TokenPrefixMarker);
        prefix.Should().StartWith(ApiTokenGenerator.TokenPrefixMarker);
        hash.Should().HaveLength(64); // SHA-256 十六進位 = 64 字元
    }

    /// <summary>
    /// 每次產生的權杖與雜湊皆應唯一（高熵亂數，不可重複）。
    /// </summary>
    [Fact]
    public void Generate_ProducesUniqueTokensAndHashes()
    {
        var tokens = new HashSet<string>();
        var hashes = new HashSet<string>();

        for (var i = 0; i < 200; i++)
        {
            var (token, hash, _) = ApiTokenGenerator.Generate();
            tokens.Add(token);
            hashes.Add(hash);
        }

        tokens.Should().HaveCount(200, "每把權杖都應唯一");
        hashes.Should().HaveCount(200, "每把權杖的雜湊都應唯一");
    }

    /// <summary>
    /// 雜湊為決定性：同一權杖字串兩次雜湊結果相同，且與產生時內含的雜湊一致（驗證比對得以成立）。
    /// </summary>
    [Fact]
    public void ComputeHash_IsDeterministic_AndMatchesGeneratedHash()
    {
        var (token, hash, _) = ApiTokenGenerator.Generate();

        var recomputed = ApiTokenGenerator.ComputeHash(token);

        recomputed.Should().Be(hash);
        ApiTokenGenerator.ComputeHash(token).Should().Be(ApiTokenGenerator.ComputeHash(token));
    }

    /// <summary>
    /// 雜湊對輸入敏感：不同輸入產生不同雜湊（單向、不可由前綴推得）。
    /// </summary>
    [Fact]
    public void ComputeHash_DiffersForDifferentInputs()
    {
        ApiTokenGenerator.ComputeHash("zwk_aaa")
            .Should().NotBe(ApiTokenGenerator.ComputeHash("zwk_aab"));
    }

    /// <summary>
    /// 雜湊輸出為小寫十六進位（與驗證處理常式的比對格式一致）。
    /// </summary>
    [Fact]
    public void ComputeHash_ReturnsLowercaseHex()
    {
        var hash = ApiTokenGenerator.ComputeHash("zwk_sample");

        hash.Should().MatchRegex("^[0-9a-f]{64}$");
    }
}
