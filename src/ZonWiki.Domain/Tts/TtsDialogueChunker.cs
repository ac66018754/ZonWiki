using System.Text;

namespace ZonWiki.Domain.Tts;

/// <summary>
/// 雙主持人對談腳本的切段純函式（無 DB／無外呼，單元可測）。
///
/// 目的：多講者 Gemini-TTS 單次輸入同樣受 ≤4,000 bytes（UTF-8 計）硬限制，故長對談要「按回合聚合切段→
/// 逐段合成→ffmpeg 併檔」。切段一律以 <b>UTF-8 位元組</b>計數，且<b>不切破多位元組字元</b>；
/// 單一回合本身超過上限時，於字元邊界硬切成多個「同講者」子回合（沿用 <see cref="TtsScriptChunker.ChunkByBytes"/>）。
/// </summary>
public static class TtsDialogueChunker
{
    /// <summary>
    /// 把對談回合依「回合貪婪聚合」切成多段，每段所有回合的文字 UTF-8 位元組總和 ≤ <paramref name="maxBytes"/>。
    /// 每段是一組連續回合（保留各自講者），供一次多講者合成呼叫。
    /// </summary>
    /// <param name="turns">對談回合清單。</param>
    /// <param name="maxBytes">單段 UTF-8 位元組上限（必須 &gt; 0）。</param>
    /// <returns>切好的段清單（每段為一組回合）；空輸入回空清單。</returns>
    public static IReadOnlyList<IReadOnlyList<TtsDialogueTurn>> ChunkTurns(
        IReadOnlyList<TtsDialogueTurn>? turns,
        int maxBytes)
    {
        if (maxBytes <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(maxBytes), "maxBytes 必須大於 0。");
        }

        var result = new List<IReadOnlyList<TtsDialogueTurn>>();
        if (turns is null || turns.Count == 0)
        {
            return result;
        }

        // 先把「單一回合文字超過上限」的回合展開成多個同講者子回合（字元邊界硬切），確保每個回合都 ≤ 上限。
        var normalizedTurns = new List<TtsDialogueTurn>();
        foreach (var turn in turns)
        {
            var text = (turn.Text ?? string.Empty).Trim();
            if (text.Length == 0)
            {
                continue; // 跳過空回合。
            }

            var speaker = TtsDialogueTurn.NormalizeSpeaker(turn.Speaker);
            if (Encoding.UTF8.GetByteCount(text) <= maxBytes)
            {
                normalizedTurns.Add(new TtsDialogueTurn(speaker, text));
                continue;
            }

            foreach (var piece in TtsScriptChunker.ChunkByBytes(text, maxBytes))
            {
                normalizedTurns.Add(new TtsDialogueTurn(speaker, piece));
            }
        }

        // 貪婪聚合成段（每段回合文字位元組總和 ≤ 上限）。
        var current = new List<TtsDialogueTurn>();
        var currentBytes = 0;
        foreach (var turn in normalizedTurns)
        {
            var turnBytes = Encoding.UTF8.GetByteCount(turn.Text);
            if (current.Count > 0 && currentBytes + turnBytes > maxBytes)
            {
                result.Add(current);
                current = new List<TtsDialogueTurn>();
                currentBytes = 0;
            }

            current.Add(turn);
            currentBytes += turnBytes;
        }

        if (current.Count > 0)
        {
            result.Add(current);
        }

        return result;
    }
}
