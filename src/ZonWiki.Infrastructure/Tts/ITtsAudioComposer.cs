namespace ZonWiki.Infrastructure.Tts;

/// <summary>
/// 音檔併檔與時長量測抽象：把多段音檔塊併成單一檔（ffmpeg concat），並量測音檔時長（ffprobe）。
/// 便於測試以 Fake 覆寫（避免真外呼 ffmpeg／ffprobe）。
/// </summary>
public interface ITtsAudioComposer
{
    /// <summary>
    /// 把多段音檔塊依序併成單一輸出檔。單段時直接複製（免 ffmpeg）；多段時走 ffmpeg concat（-c copy）。
    /// </summary>
    /// <param name="inputPaths">依播放順序的塊檔路徑（至少一段）。</param>
    /// <param name="outputPath">輸出檔路徑（呼叫端負責目錄存在與清理）。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    Task ConcatAsync(
        IReadOnlyList<string> inputPaths,
        string outputPath,
        CancellationToken cancellationToken);

    /// <summary>
    /// 量測音檔時長（秒）。ffprobe 不可用／解析失敗 → 回 null（best-effort，不讓合成失敗）。
    /// </summary>
    /// <param name="path">音檔路徑。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    /// <returns>時長（秒）或 null。</returns>
    Task<double?> ProbeDurationAsync(string path, CancellationToken cancellationToken);
}
