using System.Diagnostics;
using System.Text;
using Microsoft.Extensions.Logging;

namespace ZonWiki.Infrastructure.Refine;

/// <summary>
/// 以 ffmpeg 子行程，把「上傳的音訊／影片檔」轉成 16kHz 單聲道 mp3
/// （檔案小、適合送 OpenAI 相容轉錄端點；影片會自動去掉視訊軌只留聲音）。
///
/// 安全：
/// - 以 ArgumentList 傳參（不經過 shell），輸入路徑不會被當指令解析（防注入）。
/// - stdout/stderr 明示 UTF-8（跨行程文字一律 UTF-8）。
/// - 輸入路徑由呼叫端以「產生的暫存檔名」提供（非使用者原始檔名），避免路徑穿越。
/// </summary>
public sealed class FfmpegAudioService
{
    private readonly ILogger<FfmpegAudioService> _logger;
    private readonly string _ffmpegPath;

    /// <summary>
    /// 建立 ffmpeg 音訊轉檔服務。
    /// </summary>
    /// <param name="logger">記錄器。</param>
    /// <param name="ffmpegPath">ffmpeg 執行檔路徑（預設取 PATH 上的 "ffmpeg"）。</param>
    public FfmpegAudioService(ILogger<FfmpegAudioService> logger, string ffmpegPath = "ffmpeg")
    {
        _logger = logger;
        _ffmpegPath = ffmpegPath;
    }

    /// <summary>
    /// 把輸入檔（音訊或影片）轉成 16kHz 單聲道 mp3，回傳輸出檔路徑。
    /// </summary>
    /// <param name="inputPath">輸入檔路徑（音訊或影片）。</param>
    /// <param name="workDir">輸出用的工作目錄（由呼叫端負責清理）。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    /// <returns>輸出的 mp3 檔路徑。</returns>
    /// <exception cref="InvalidOperationException">ffmpeg 失敗或輸出檔不存在（多半是檔案毀損或非有效影音）。</exception>
    public async Task<string> ExtractTo16kMonoMp3Async(
        string inputPath,
        string workDir,
        CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(workDir);
        var outputPath = Path.Combine(workDir, "audio.mp3");

        var psi = new ProcessStartInfo
        {
            FileName = _ffmpegPath,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        // -hide_banner/-loglevel error：少噪音；-vn：去視訊軌；-ar 16000 -ac 1：16kHz 單聲道；-y：覆寫輸出。
        foreach (var arg in new[]
        {
            "-hide_banner", "-loglevel", "error",
            "-i", inputPath,
            "-vn", "-ar", "16000", "-ac", "1",
            "-y", outputPath,
        })
        {
            psi.ArgumentList.Add(arg);
        }

        using var process = new Process { StartInfo = psi };
        try
        {
            process.Start();
        }
        catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or FileNotFoundException)
        {
            // ffmpeg 不在 PATH 或設定路徑錯誤：給清楚的部署提示，而不是讓使用者看到「檔案毀損」的誤導訊息。
            _logger.LogError(ex, "找不到或無法啟動 ffmpeg（路徑：{Path}）", _ffmpegPath);
            throw new InvalidOperationException(
                $"伺服器找不到 ffmpeg（路徑：{_ffmpegPath}）。請確認已安裝 ffmpeg 並正確設定 Refine:FfmpegPath。");
        }

        // 兩個輸出串流都要讀掉，避免緩衝區填滿造成子行程阻塞（即使預期 stdout 為空）。
        var stdoutTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
        var stderrTask = process.StandardError.ReadToEndAsync(cancellationToken);
        await process.WaitForExitAsync(cancellationToken);
        await stdoutTask;
        var stderr = await stderrTask;

        if (process.ExitCode != 0 || !File.Exists(outputPath))
        {
            _logger.LogError("ffmpeg 轉檔失敗（exit {Code}）：{Err}", process.ExitCode, Truncate(stderr, 500));
            throw new InvalidOperationException("無法處理這個檔案（可能不是有效的音訊／影片，或檔案毀損）。");
        }

        return outputPath;
    }

    /// <summary>截斷字串（記錄用）。</summary>
    private static string Truncate(string text, int max) => text.Length > max ? text[..max] + "…" : text;
}
