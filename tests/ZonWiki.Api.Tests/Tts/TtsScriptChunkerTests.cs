using System.Text;
using FluentAssertions;
using Xunit;
using ZonWiki.Domain.Tts;

namespace ZonWiki.Api.Tests.Tts;

/// <summary>
/// <see cref="TtsScriptChunker"/> 切塊純函式單元測試：
/// 句界貪婪聚合、UTF-8 位元組計數、單句硬切不切破多位元組字元、章節切塊不跨章節。
/// </summary>
public sealed class TtsScriptChunkerTests
{
    private static int Utf8Bytes(string text) => Encoding.UTF8.GetByteCount(text);

    [Fact]
    public void U1_短文_單塊()
    {
        var chunks = TtsScriptChunker.ChunkByBytes("你好世界", 4000);

        chunks.Should().ContainSingle();
        chunks[0].Should().Be("你好世界");
    }

    [Fact]
    public void U2_多句超過上限_多塊且每塊在句界不超上限()
    {
        // 「一。」「二。」「三。」各 6 bytes；maxBytes=6 → 三塊，每塊剛好一句。
        var chunks = TtsScriptChunker.ChunkByBytes("一。二。三。", 6);

        chunks.Should().HaveCount(3);
        chunks.Should().OnlyContain(c => Utf8Bytes(c) <= 6);
        chunks.Should().OnlyContain(c => c.EndsWith('。'));
        string.Concat(chunks).Should().Be("一。二。三。");
    }

    [Fact]
    public void U3_單句超過上限_硬切且每塊皆合法UTF8字元守恆()
    {
        // 一整段無標點（＝單句），每字 3 bytes；maxBytes=6 → 每塊 2 字。
        const string sentence = "這是一段沒有標點的長句子";
        var chunks = TtsScriptChunker.ChunkByBytes(sentence, 6);

        chunks.Should().OnlyContain(c => Utf8Bytes(c) <= 6);
        // 重新 decode 不丟例外＋字元數守恆＝絕無切破多位元組字元。
        string.Concat(chunks).Should().Be(sentence);
        chunks.Sum(c => c.Length).Should().Be(sentence.Length);
    }

    [Fact]
    public void U4_CJK邊界剛好maxBytes_不誤切()
    {
        // 「中文」＝6 bytes，maxBytes=6 → 單塊（邊界剛好不切）。
        TtsScriptChunker.ChunkByBytes("中文", 6).Should().ContainSingle().Which.Should().Be("中文");

        // 「中文字」＝9 bytes，maxBytes=6 → 硬切成 6+3。
        var three = TtsScriptChunker.ChunkByBytes("中文字", 6);
        three.Should().HaveCount(2);
        three[0].Should().Be("中文");
        three[1].Should().Be("字");
    }

    [Fact]
    public void U5_空或全空白_回空清單()
    {
        TtsScriptChunker.ChunkByBytes("", 4000).Should().BeEmpty();
        TtsScriptChunker.ChunkByBytes("   ", 4000).Should().BeEmpty();
        TtsScriptChunker.ChunkByBytes(null, 4000).Should().BeEmpty();
    }

    [Fact]
    public void U6_ChunkByChapter_兩個heading_兩章且塊不跨章()
    {
        var segments = new[]
        {
            new TtsScriptSegment(TtsScriptSegment.HeadingKind, "第一章"),
            new TtsScriptSegment(TtsScriptSegment.SpeechKind, "內容一"),
            new TtsScriptSegment(TtsScriptSegment.HeadingKind, "第二章"),
            new TtsScriptSegment(TtsScriptSegment.SpeechKind, "內容二"),
        };

        var chapters = TtsScriptChunker.ChunkByChapter(segments, 4000);

        chapters.Should().HaveCount(2);
        chapters[0].Title.Should().Be("第一章");
        chapters[1].Title.Should().Be("第二章");
        // 塊絕不跨章：第一章的塊含「第一章」「內容一」但不含「第二章」。
        var chapterOneText = string.Concat(chapters[0].Chunks);
        chapterOneText.Should().Contain("第一章").And.Contain("內容一");
        chapterOneText.Should().NotContain("第二章");
        string.Concat(chapters[1].Chunks).Should().Contain("第二章").And.Contain("內容二");
    }

    [Fact]
    public void U7_無heading_單章Title為空()
    {
        var segments = new[]
        {
            new TtsScriptSegment(TtsScriptSegment.SpeechKind, "只是一段內容"),
        };

        var chapters = TtsScriptChunker.ChunkByChapter(segments, 4000);

        chapters.Should().ContainSingle();
        chapters[0].Title.Should().BeEmpty();
        string.Concat(chapters[0].Chunks).Should().Be("只是一段內容");
    }

    [Fact]
    public void ChunkByChapter_空片段_回空清單()
    {
        TtsScriptChunker.ChunkByChapter(Array.Empty<TtsScriptSegment>(), 4000).Should().BeEmpty();
        TtsScriptChunker.ChunkByChapter(null, 4000).Should().BeEmpty();
    }
}
