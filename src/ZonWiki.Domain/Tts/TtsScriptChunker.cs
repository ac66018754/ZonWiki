using System.Globalization;
using System.Text;

namespace ZonWiki.Domain.Tts;

/// <summary>
/// 一個章節（供合成管線逐章逐塊呼叫 TTS，並據以推算章節時間位移）。
/// </summary>
/// <param name="Title">章節標題（來自 heading 片段；無 heading 的隱含章節為空字串）。</param>
/// <param name="Chunks">
/// 此章節文字依 ≤maxBytes 切成的塊清單（<b>切塊絕不跨章節</b>，保證章節時間位移可精確累加）。
/// </param>
public sealed record TtsChapterChunks(string Title, IReadOnlyList<string> Chunks);

/// <summary>
/// 口語稿切塊純函式（無 DB／無外呼，單元可測）。
///
/// 目的：Gemini-TTS 單次輸入硬限制 ≤4,000 bytes（UTF-8 計；中文約 1,300 字），
/// 故長筆記要「按句界切段→逐段合成→ffmpeg 併檔」。切塊一律以 <b>UTF-8 位元組</b>計數，
/// 且<b>絕不切破多位元組字元</b>（中文一字 3 bytes）。
/// </summary>
public static class TtsScriptChunker
{
    /// <summary>句界字元（切塊時優先在這些字元之後斷開，讓語音停頓自然）。</summary>
    private static readonly char[] SentenceBoundaries = { '。', '！', '？', '!', '?', '…', '\n' };

    /// <summary>
    /// 把一段文字依「句界貪婪聚合」切成多塊，每塊的 UTF-8 位元組數 ≤ <paramref name="maxBytes"/>。
    /// 單句本身超過上限時，於 UTF-8 字元邊界硬切（絕不切破多位元組字元）。
    /// </summary>
    /// <param name="text">要切塊的純文字。</param>
    /// <param name="maxBytes">單塊 UTF-8 位元組上限（必須 &gt; 0）。</param>
    /// <returns>切好的塊清單；空白／空字串回空清單。</returns>
    public static IReadOnlyList<string> ChunkByBytes(string? text, int maxBytes)
    {
        if (maxBytes <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(maxBytes), "maxBytes 必須大於 0。");
        }

        if (string.IsNullOrWhiteSpace(text))
        {
            return Array.Empty<string>();
        }

        // 先切成「句子」（保留句界字元在句尾），再貪婪聚合成塊。
        var sentences = SplitIntoSentences(text!);

        var chunks = new List<string>();
        var current = new StringBuilder();
        var currentBytes = 0;

        foreach (var sentence in sentences)
        {
            var sentenceBytes = Encoding.UTF8.GetByteCount(sentence);

            // 單句本身就超過上限：先把目前累積的塊收尾，再對這一句做「字元邊界硬切」。
            if (sentenceBytes > maxBytes)
            {
                if (currentBytes > 0)
                {
                    chunks.Add(current.ToString());
                    current.Clear();
                    currentBytes = 0;
                }

                foreach (var hardChunk in HardSplitByBytes(sentence, maxBytes))
                {
                    chunks.Add(hardChunk);
                }

                continue;
            }

            // 加上這一句會超過上限 → 先收尾目前塊，這一句起新塊。
            if (currentBytes > 0 && currentBytes + sentenceBytes > maxBytes)
            {
                chunks.Add(current.ToString());
                current.Clear();
                currentBytes = 0;
            }

            current.Append(sentence);
            currentBytes += sentenceBytes;
        }

        if (currentBytes > 0)
        {
            chunks.Add(current.ToString());
        }

        return chunks;
    }

    /// <summary>
    /// 把口語稿片段依章節（heading 起新章）組成「章節→塊」結構。
    /// <b>切塊絕不跨章節</b>：每章文字先組合（含被朗讀的標題文字）再 <see cref="ChunkByBytes"/>。
    /// 無任何 heading → 單一隱含章節（Title=""）。
    /// </summary>
    /// <param name="segments">口語稿片段清單。</param>
    /// <param name="maxBytes">單塊 UTF-8 位元組上限。</param>
    /// <returns>章節→塊清單（不含空章節）。</returns>
    public static IReadOnlyList<TtsChapterChunks> ChunkByChapter(
        IReadOnlyList<TtsScriptSegment>? segments,
        int maxBytes)
    {
        var result = new List<TtsChapterChunks>();
        if (segments is null || segments.Count == 0)
        {
            return result;
        }

        string currentTitle = string.Empty;
        var currentText = new StringBuilder();
        var hasContent = false;

        void Flush()
        {
            if (!hasContent)
            {
                return;
            }

            var chunks = ChunkByBytes(currentText.ToString(), maxBytes);
            if (chunks.Count > 0)
            {
                result.Add(new TtsChapterChunks(currentTitle, chunks));
            }

            currentText.Clear();
            hasContent = false;
        }

        foreach (var segment in segments)
        {
            var text = segment.Text ?? string.Empty;

            if (segment.IsHeading)
            {
                // heading 起新章：先收尾前一章，標題文字本身也要被朗讀。
                Flush();
                currentTitle = text.Trim();
                AppendSpoken(currentText, text, ref hasContent);
            }
            else
            {
                AppendSpoken(currentText, text, ref hasContent);
            }
        }

        Flush();
        return result;
    }

    /// <summary>把一段朗讀文字接到章節緩衝（以換行分隔，維持自然停頓）；非空白才標記有內容。</summary>
    private static void AppendSpoken(StringBuilder buffer, string text, ref bool hasContent)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return;
        }

        if (buffer.Length > 0)
        {
            buffer.Append('\n');
        }

        buffer.Append(text.Trim());
        hasContent = true;
    }

    /// <summary>
    /// 把文字切成「句子」清單：在句界字元之後斷句（句界字元保留在該句句尾），
    /// 讓貪婪聚合能在自然停頓處斷塊。
    /// </summary>
    private static List<string> SplitIntoSentences(string text)
    {
        var sentences = new List<string>();
        var start = 0;

        for (var i = 0; i < text.Length; i++)
        {
            if (Array.IndexOf(SentenceBoundaries, text[i]) < 0)
            {
                continue;
            }

            // 含句界字元（含之）切一句；跳過純換行造成的空句。
            var sentence = text[start..(i + 1)];
            if (!string.IsNullOrEmpty(sentence))
            {
                sentences.Add(sentence);
            }

            start = i + 1;
        }

        if (start < text.Length)
        {
            sentences.Add(text[start..]);
        }

        return sentences;
    }

    /// <summary>
    /// 對「單句超過位元組上限」的情形做硬切：以 Unicode 文字元素（grapheme/字元）為單位逐步累加，
    /// 累到「再加下一個字元會超過上限」就切一塊，<b>絕不切破多位元組字元</b>。
    /// </summary>
    private static IEnumerable<string> HardSplitByBytes(string sentence, int maxBytes)
    {
        var chunks = new List<string>();
        var current = new StringBuilder();
        var currentBytes = 0;

        // 以 StringInfo 逐「文字元素」切（正確處理代理對／組合字元），確保切點永遠落在合法字元邊界。
        var enumerator = StringInfo.GetTextElementEnumerator(sentence);
        while (enumerator.MoveNext())
        {
            var element = (string)enumerator.Current;
            var elementBytes = Encoding.UTF8.GetByteCount(element);

            if (currentBytes > 0 && currentBytes + elementBytes > maxBytes)
            {
                chunks.Add(current.ToString());
                current.Clear();
                currentBytes = 0;
            }

            current.Append(element);
            currentBytes += elementBytes;
        }

        if (currentBytes > 0)
        {
            chunks.Add(current.ToString());
        }

        return chunks;
    }
}
