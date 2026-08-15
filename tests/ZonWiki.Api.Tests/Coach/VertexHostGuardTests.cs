using FluentAssertions;
using Xunit;
using ZonWiki.Infrastructure.Coach;

namespace ZonWiki.Api.Tests.Coach;

/// <summary>
/// <see cref="VertexHostGuard"/> 單元測試（【審修-S6】ADC token 只送 Vertex 官方 wss host）。
/// 釘死：正確 host 放行、http／ws／錯 host／混淆 host 一律拒——防日後 region／BaseUrl 污染導致 token 外洩。
/// </summary>
public sealed class VertexHostGuardTests
{
    [Theory]
    [InlineData("wss://us-central1-aiplatform.googleapis.com/ws/x")]
    [InlineData("wss://us-east1-aiplatform.googleapis.com/ws/x")]
    [InlineData("wss://aiplatform.googleapis.com/ws/x")] // global（無 region 前綴）
    public void IsAllowed_Vertex官方wss_放行(string url)
    {
        VertexHostGuard.IsAllowedVertexWssUrl(url).Should().BeTrue();
    }

    [Theory]
    [InlineData("https://us-central1-aiplatform.googleapis.com/ws/x")] // 非 wss（REST scheme）
    [InlineData("ws://us-central1-aiplatform.googleapis.com/ws/x")]    // 明文 ws
    [InlineData("wss://aiplatform.googleapis.com.evil.com/ws/x")]      // 結尾 .evil.com
    [InlineData("wss://evil.com/ws/x")]                                 // 完全不相干 host
    [InlineData("wss://aiplatformXgoogleapis.com/ws/x")]               // 無 dot 分隔混淆
    [InlineData("wss://notaiplatform.googleapis.com.attacker.net/x")]  // 攻擊者網域
    [InlineData("")]
    [InlineData("not a url")]
    public void IsAllowed_非Vertex官方wss_一律拒(string url)
    {
        VertexHostGuard.IsAllowedVertexWssUrl(url).Should().BeFalse();
    }
}
