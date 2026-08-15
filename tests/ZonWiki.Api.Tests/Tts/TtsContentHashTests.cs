using FluentAssertions;
using Xunit;
using ZonWiki.Api.Services;

namespace ZonWiki.Api.Tests.Tts;

/// <summary>
/// <see cref="TtsSynthesisService.ComputeContentHash"/> 快取鍵純函式單元測試：
/// deterministic、各輸入敏感、內容正規化。快取鍵刻意以「筆記內容」為上游（非口語稿），
/// 讓 POST /synthesize 能在產口語稿前就查快取→重播零成本（見 DECISIONS 2026-07-07）。
/// </summary>
public sealed class TtsContentHashTests
{
    private const string Content = "這是一篇筆記。\n有兩段內容。";
    private const string Voice = "Kore";
    private const string Language = "cmn-TW";
    private const string Format = "MP3";
    private const string PromptVersion = "tts-script-v1";
    private const string Model = "gemini-2.5-flash-tts";

    private static string Hash(
        string content = Content,
        string voice = Voice,
        string language = Language,
        string format = Format,
        string promptVersion = PromptVersion,
        string model = Model)
        => TtsSynthesisService.ComputeContentHash(content, voice, language, format, promptVersion, model);

    [Fact]
    public void U12_同輸入_同hash且為64字十六進位()
    {
        var a = Hash();
        var b = Hash();

        a.Should().Be(b);
        a.Should().MatchRegex("^[0-9a-f]{64}$");
    }

    [Fact]
    public void U13_改任一輸入_hash變()
    {
        var baseline = Hash();

        Hash(content: Content + "X").Should().NotBe(baseline);
        Hash(voice: "Puck").Should().NotBe(baseline);
        Hash(language: "cmn-CN").Should().NotBe(baseline);
        Hash(format: "OGG_OPUS").Should().NotBe(baseline);
        Hash(promptVersion: "tts-script-v2").Should().NotBe(baseline);
        Hash(model: "gemini-2.5-pro-tts").Should().NotBe(baseline);
    }

    [Fact]
    public void U13b_模式改變_hash變且預設為read()
    {
        // Phase 3：mode 入快取鍵——read≠dialogue 不撞快取；未帶 mode 的呼叫預設等同 mode="read"。
        var read = TtsSynthesisService.ComputeContentHash(Content, Voice, Language, Format, PromptVersion, Model);
        var readExplicit = TtsSynthesisService.ComputeContentHash(
            Content, Voice, Language, Format, PromptVersion, Model, TtsSynthesisService.ModeRead);
        var dialogue = TtsSynthesisService.ComputeContentHash(
            Content, Voice, Language, Format, PromptVersion, Model, TtsSynthesisService.ModeDialogue);

        readExplicit.Should().Be(read, "省略 mode 應等同 read");
        dialogue.Should().NotBe(read, "dialogue 與 read 不得撞快取");
    }

    [Fact]
    public void U14_內容正規化_換行與空白差異不影響hash()
    {
        var baseline = Hash(content: "第一行\n第二行");

        // \r\n ↔ \n。
        Hash(content: "第一行\r\n第二行").Should().Be(baseline);
        // 前後空白。
        Hash(content: "  第一行\n第二行  ").Should().Be(baseline);
        // 連續空白摺疊（多個空格/tab）。
        Hash(content: "第一行\n第二行").Should().Be(Hash(content: "第一行 \t\n 第二行"));
    }
}
