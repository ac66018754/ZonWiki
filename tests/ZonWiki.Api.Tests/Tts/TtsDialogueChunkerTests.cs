using System.Text;
using FluentAssertions;
using Xunit;
using ZonWiki.Domain.Tts;

namespace ZonWiki.Api.Tests.Tts;

/// <summary>
/// <see cref="TtsDialogueChunker"/> 對談切段純函式單元測試（Phase 3）：
/// 依回合貪婪聚合成段（每段 ≤maxBytes）、單一超長回合以字元邊界硬切成同講者子回合、空輸入回空、
/// 講者正規化為 A／B、切點不破多位元組字元。
/// </summary>
public sealed class TtsDialogueChunkerTests
{
    private static int Bytes(string s) => Encoding.UTF8.GetByteCount(s);

    [Fact]
    public void 空輸入_回空清單()
    {
        TtsDialogueChunker.ChunkTurns(null, 4000).Should().BeEmpty();
        TtsDialogueChunker.ChunkTurns(new List<TtsDialogueTurn>(), 4000).Should().BeEmpty();
    }

    [Fact]
    public void 短對談_全部聚合成單一段()
    {
        var turns = new List<TtsDialogueTurn>
        {
            new("A", "歡迎回到節目。"),
            new("B", "今天聊這篇筆記。"),
            new("A", "好，開始吧。"),
        };

        var chunks = TtsDialogueChunker.ChunkTurns(turns, 4000);

        chunks.Should().HaveCount(1);
        chunks[0].Should().HaveCount(3);
    }

    [Fact]
    public void 超過位元組上限_分成多段且每段不超過上限()
    {
        // 每回合約 30 bytes；上限設 40 → 每段最多裝一個回合。
        var turns = new List<TtsDialogueTurn>
        {
            new("A", "這是第一句話喔喔喔喔。"),
            new("B", "這是第二句話喔喔喔喔。"),
            new("A", "這是第三句話喔喔喔喔。"),
        };

        var chunks = TtsDialogueChunker.ChunkTurns(turns, 40);

        chunks.Count.Should().BeGreaterThan(1);
        foreach (var chunk in chunks)
        {
            var totalBytes = chunk.Sum(t => Bytes(t.Text));
            totalBytes.Should().BeLessThanOrEqualTo(40);
        }
    }

    [Fact]
    public void 單一超長回合_硬切成多個同講者子回合()
    {
        var longText = new string('字', 100); // 300 bytes，遠超上限。
        var turns = new List<TtsDialogueTurn> { new("B", longText) };

        var chunks = TtsDialogueChunker.ChunkTurns(turns, 60);

        // 展開成多段，且所有子回合講者仍為 B、每段 ≤ 上限、切點不破字元（總字數守恆）。
        chunks.Count.Should().BeGreaterThan(1);
        var allTurns = chunks.SelectMany(c => c).ToList();
        allTurns.Should().OnlyContain(t => t.Speaker == TtsDialogueTurn.SpeakerB);
        allTurns.Sum(t => t.Text.Length).Should().Be(100);
        foreach (var chunk in chunks)
        {
            chunk.Sum(t => Bytes(t.Text)).Should().BeLessThanOrEqualTo(60);
        }
    }

    [Fact]
    public void 講者非AB_正規化為A()
    {
        var turns = new List<TtsDialogueTurn> { new("主持人X", "內容"), new("b", "內容2") };

        var chunks = TtsDialogueChunker.ChunkTurns(turns, 4000);

        var flat = chunks.SelectMany(c => c).ToList();
        flat[0].Speaker.Should().Be(TtsDialogueTurn.SpeakerA); // 未知講者→A
        flat[1].Speaker.Should().Be(TtsDialogueTurn.SpeakerB); // "b"（不分大小寫）→B
    }

    [Fact]
    public void maxBytes非正_擲例外()
    {
        var act = () => TtsDialogueChunker.ChunkTurns(new List<TtsDialogueTurn> { new("A", "x") }, 0);
        act.Should().Throw<ArgumentOutOfRangeException>();
    }
}
