using FluentAssertions;
using Xunit;
using ZonWiki.Api.Tts;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Services;

namespace ZonWiki.Api.Tests.Tts;

/// <summary>
/// TtsAudio 白名單「不」登記回歸（純靜態，準則 §2.3、設計書 §9）：
/// TtsAudio 是快取品——<b>不</b>進垃圾桶（TrashTypeRegistry），故 GetEntityType 應回 null、
/// GetAllSupportedTypes 不含 "TtsAudio"。ActivityLog 不登記由 HTTP 活動流測試（I19）覆蓋。
/// </summary>
public sealed class TtsWhitelistTests
{
    [Fact]
    public void TrashTypeRegistry_未登記TtsAudio型別()
    {
        TrashTypeRegistry.GetEntityType("TtsAudio").Should().BeNull();
        TrashTypeRegistry.GetAllSupportedTypes().Should().NotContain("TtsAudio");
    }

    [Fact]
    public void TrashTypeRegistry_TtsAudio無標題對應()
    {
        // 未登記型別 → GetTitle 回預設「(無標題)」。
        var audio = new TtsAudio { VoiceName = "Kore" };

        TrashTypeRegistry.GetTitle(audio).Should().Be("(無標題)");
    }

    // ── 語言白名單（審查修正 #4）──────────────────────────────────────────────

    [Theory]
    [InlineData("cmn-TW")]
    [InlineData("cmn-CN")]
    [InlineData("yue-HK")]
    [InlineData("en-US")]
    [InlineData("CMN-tw")] // 不分大小寫
    public void IsValidLanguage_白名單語言_回true(string languageCode)
    {
        TtsVoiceCatalog.IsValidLanguage(languageCode).Should().BeTrue();
    }

    [Theory]
    [InlineData("fr-FR")]
    [InlineData("ja-JP")]
    [InlineData("cmn")]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public void IsValidLanguage_非白名單或空_回false(string? languageCode)
    {
        TtsVoiceCatalog.IsValidLanguage(languageCode).Should().BeFalse();
    }
}
