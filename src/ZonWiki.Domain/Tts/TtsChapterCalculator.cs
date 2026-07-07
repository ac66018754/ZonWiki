using ZonWiki.Domain.Dtos;

namespace ZonWiki.Domain.Tts;

/// <summary>
/// 章節時間位移計算純函式（無 DB／無外呼，單元可測）。
///
/// 章節切塊絕不跨章節（見 <see cref="TtsScriptChunker.ChunkByChapter"/>），故每章音檔＝其塊檔的連續片段；
/// 章節 <c>startSeconds</c> ＝「其前所有塊時長的累積和」。只有<b>有標題</b>的章節會被列進導覽章節清單
/// （無標題的隱含開頭章節仍計入時間累積，但不產生跳段項）。
/// </summary>
public static class TtsChapterCalculator
{
    /// <summary>
    /// 依「章節→塊數」與「逐塊時長（依合成順序攤平）」計算各<b>有標題</b>章節的起始秒數。
    /// </summary>
    /// <param name="chapters">章節（標題＋該章塊數），依合成順序。</param>
    /// <param name="chunkDurationsSeconds">逐塊時長（秒），依合成順序攤平；長度須等於所有章節塊數總和。</param>
    /// <returns>
    /// 有標題章節的 <see cref="ChapterDto"/> 清單（title＋startSeconds）；
    /// 無任何有標題章節時回 <c>null</c>（前端不顯示章節列表）。
    /// </returns>
    public static IReadOnlyList<ChapterDto>? ComputeChapterStarts(
        IReadOnlyList<(string Title, int ChunkCount)> chapters,
        IReadOnlyList<double> chunkDurationsSeconds)
    {
        ArgumentNullException.ThrowIfNull(chapters);
        ArgumentNullException.ThrowIfNull(chunkDurationsSeconds);

        var marks = new List<ChapterDto>();
        var cumulativeSeconds = 0.0;
        var chunkIndex = 0;

        foreach (var (title, chunkCount) in chapters)
        {
            var chapterStart = cumulativeSeconds;

            // 累加本章各塊時長，推進攤平游標（超出範圍的塊視為 0，容錯）。
            for (var i = 0; i < chunkCount; i++)
            {
                if (chunkIndex < chunkDurationsSeconds.Count)
                {
                    cumulativeSeconds += chunkDurationsSeconds[chunkIndex];
                }

                chunkIndex++;
            }

            // 只有「有標題」的章節列進導覽清單（隱含開頭章節仍計入時間累積）。
            if (!string.IsNullOrWhiteSpace(title))
            {
                marks.Add(new ChapterDto(title, chapterStart));
            }
        }

        return marks.Count > 0 ? marks : null;
    }
}
