namespace ZonWiki.Infrastructure.Tts;

/// <summary>
/// 測試用假音檔合成器：不呼叫 ffmpeg／ffprobe。
/// - 併檔＝把各塊 bytes 依序寫進輸出檔（產生真檔，供 HTTP Range 供檔測試）。
/// - 量時長＝回固定值（每塊 <see cref="FakeDurationSeconds"/> 秒），供章節時間位移測試有確定性。
/// 以設定 <c>Tts:Provider=Fake</c> 註冊。
/// </summary>
public sealed class FakeAudioComposer : ITtsAudioComposer
{
    /// <summary>Fake 量測到的固定每檔時長（秒）。</summary>
    public const double FakeDurationSeconds = 1.0;

    /// <inheritdoc />
    public async Task ConcatAsync(
        IReadOnlyList<string> inputPaths,
        string outputPath,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(inputPaths);
        if (inputPaths.Count == 0)
        {
            throw new InvalidOperationException("併檔至少需要一段音檔塊。");
        }

        // 把各塊 bytes 依序寫進輸出檔（真檔），模擬併檔結果。
        await using var output = new FileStream(outputPath, FileMode.Create, FileAccess.Write, FileShare.None);
        foreach (var inputPath in inputPaths)
        {
            await using var input = new FileStream(inputPath, FileMode.Open, FileAccess.Read, FileShare.Read);
            await input.CopyToAsync(output, cancellationToken);
        }
    }

    /// <inheritdoc />
    public Task<double?> ProbeDurationAsync(string path, CancellationToken cancellationToken)
        => Task.FromResult<double?>(FakeDurationSeconds);
}
