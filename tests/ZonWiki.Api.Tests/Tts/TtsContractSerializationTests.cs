using System.Text.Json;
using FluentAssertions;
using Xunit;
using ZonWiki.Domain.Dtos;

namespace ZonWiki.Api.Tests.Tts;

/// <summary>
/// TTS 前端契約欄名鎖定（審查修正 #1/#2/#7）：以「與 API 相同的 Web(camelCase) 序列化」直接驗證
/// 回應 DTO 的 JSON 欄名——避免與前端契約靜默分歧（ttsAudioId／startSeconds／label）。
/// </summary>
public sealed class TtsContractSerializationTests
{
    private static readonly JsonSerializerOptions WebOptions = new(JsonSerializerDefaults.Web);

    private static string Serialize<T>(T value) => JsonSerializer.Serialize(value, WebOptions);

    [Fact]
    public void 合成回應_音檔主鍵欄名為ttsAudioId()
    {
        var json = Serialize(new TtsSynthesizeResponseDto(Guid.NewGuid(), "processing", null, null));

        json.Should().Contain("\"ttsAudioId\"");
        json.Should().NotContain("\"id\"");
    }

    [Fact]
    public void 狀態回應_音檔主鍵欄名為ttsAudioId()
    {
        var json = Serialize(new TtsStatusDto(Guid.NewGuid(), "ready", 12.3, null, null));

        json.Should().Contain("\"ttsAudioId\"");
    }

    [Fact]
    public void 章節_時間欄名為startSeconds()
    {
        var json = Serialize(new ChapterDto("第一節", 1.5));

        json.Should().Contain("\"startSeconds\"");
        json.Should().Contain("\"title\"");
        json.Should().NotContain("offsetSeconds");
    }

    [Fact]
    public void 聲音_風格標籤欄名為label()
    {
        var json = Serialize(new VoiceDto("Kore", "female", "女聲・Kore", "cmn-TW"));

        json.Should().Contain("\"label\"");
        json.Should().NotContain("styleLabel");
    }

    [Fact]
    public void 設定_聲音與格式欄名對齊前端()
    {
        var json = Serialize(new TtsSettingsDto("Kore", "cmn-TW", "MP3"));

        json.Should().Contain("\"voice\"");
        json.Should().Contain("\"format\"");
    }
}
