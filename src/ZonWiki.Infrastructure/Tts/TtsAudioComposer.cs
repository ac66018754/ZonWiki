using System.Diagnostics;
using System.Globalization;
using System.Text;
using Microsoft.Extensions.Logging;

namespace ZonWiki.Infrastructure.Tts;

/// <summary>
/// 以 ffmpeg 併檔（concat）＋ffprobe 量時長的音檔合成器（正式實作）。
///
/// 安全與慣例（照 <c>FfmpegAudioService</c>）：
/// - 以 <see cref="ProcessStartInfo.ArgumentList"/> 傳參（不經 shell）→ 路徑不會被當指令解析（防注入）。
/// - stdout/stderr 明示 UTF-8（跨行程文字一律 UTF-8）。
/// - 併檔用 concat list 檔（每行 <c>file '&lt;abs&gt;'</c>），同源同編碼可 <c>-c copy</c>（不重新編碼、快）。
/// - 輸入/輸出路徑皆由呼叫端以「伺服器產生的檔名」提供（非使用者原始輸入），避免路徑穿越。
/// </summary>
public sealed class TtsAudioComposer : ITtsAudioComposer
{
    private readonly ILogger<TtsAudioComposer> _logger;
    private readonly string _ffmpegPath;
    private readonly string _ffprobePath;

    /// <summary>
    /// 建立音檔合成器。
    /// </summary>
    /// <param name="logger">記錄器。</param>
    /// <param name="ffmpegPath">ffmpeg 執行檔路徑（重用既有設定鍵 <c>Refine:FfmpegPath</c>，預設 "ffmpeg"）。</param>
    /// <param name="ffprobePath">ffprobe 執行檔路徑（設定鍵 <c>Tts:FfprobePath</c>；缺省從 ffmpeg 同目錄推、再退回 PATH 上 "ffprobe"）。</param>
    public TtsAudioComposer(
        ILogger<TtsAudioComposer> logger,
        string ffmpegPath = "ffmpeg",
        string? ffprobePath = null)
    {
        _logger = logger;
        _ffmpegPath = string.IsNullOrWhiteSpace(ffmpegPath) ? "ffmpeg" : ffmpegPath;
        _ffprobePath = ResolveFfprobePath(_ffmpegPath, ffprobePath);
    }

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

        // 單段：直接複製（免 ffmpeg，短筆記常見路徑不依賴 ffmpeg 併檔）。
        if (inputPaths.Count == 1)
        {
            File.Copy(inputPaths[0], outputPath, overwrite: true);
            return;
        }

        // 多段：寫 concat list 檔（UTF-8）→ ffmpeg -f concat -safe 0 -c copy。
        var listPath = outputPath + ".concat.txt";
        var listBuilder = new StringBuilder();
        foreach (var inputPath in inputPaths)
        {
            // concat demuxer 語法：file '路徑'；單引號內的單引號需轉義為 '\''。
            var absolute = Path.GetFullPath(inputPath).Replace("'", "'\\''", StringComparison.Ordinal);
            listBuilder.Append("file '").Append(absolute).Append("'\n");
        }

        await File.WriteAllTextAsync(listPath, listBuilder.ToString(), new UTF8Encoding(false), cancellationToken);

        try
        {
            var args = new[]
            {
                "-hide_banner", "-loglevel", "error",
                "-f", "concat", "-safe", "0",
                "-i", listPath,
                "-c", "copy",
                "-y", outputPath,
            };

            var (exitCode, stderr) = await RunProcessAsync(_ffmpegPath, args, "ffmpeg", cancellationToken);
            if (exitCode != 0 || !File.Exists(outputPath))
            {
                _logger.LogError("ffmpeg 併檔失敗（exit {Code}）：{Err}", exitCode, Truncate(stderr, 500));
                throw new TtsSynthesisException("音檔併檔失敗（ffmpeg）。");
            }
        }
        finally
        {
            TryDelete(listPath);
        }
    }

    /// <inheritdoc />
    public async Task<double?> ProbeDurationAsync(string path, CancellationToken cancellationToken)
    {
        try
        {
            var args = new[]
            {
                "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                path,
            };

            var (exitCode, stdout, _) = await RunProcessCaptureStdoutAsync(_ffprobePath, args, cancellationToken);
            if (exitCode != 0)
            {
                return null;
            }

            var trimmed = stdout.Trim();
            if (double.TryParse(trimmed, NumberStyles.Float, CultureInfo.InvariantCulture, out var seconds)
                && seconds >= 0)
            {
                return seconds;
            }

            return null;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // ffprobe 不可用／解析失敗 → best-effort 回 null（時長改由前端 <audio>.duration 提供）。
            _logger.LogInformation(ex, "ffprobe 量時長失敗（path={Path}），退回 null（best-effort）", path);
            return null;
        }
    }

    /// <summary>推算 ffprobe 路徑：優先用設定值 → ffmpeg 同目錄的 ffprobe → PATH 上的 "ffprobe"。</summary>
    private static string ResolveFfprobePath(string ffmpegPath, string? configuredFfprobePath)
    {
        if (!string.IsNullOrWhiteSpace(configuredFfprobePath))
        {
            return configuredFfprobePath;
        }

        try
        {
            var directory = Path.GetDirectoryName(ffmpegPath);
            if (!string.IsNullOrEmpty(directory))
            {
                var ffmpegFileName = Path.GetFileName(ffmpegPath);
                var probeFileName = ffmpegFileName.Replace("ffmpeg", "ffprobe", StringComparison.OrdinalIgnoreCase);
                if (string.Equals(probeFileName, ffmpegFileName, StringComparison.Ordinal))
                {
                    probeFileName = "ffprobe";
                }

                var candidate = Path.Combine(directory, probeFileName);
                if (File.Exists(candidate))
                {
                    return candidate;
                }
            }
        }
        catch
        {
            // 路徑解析失敗：退回 PATH 上的 ffprobe。
        }

        return "ffprobe";
    }

    /// <summary>啟動子行程、讀掉兩個輸出串流、回 (exitCode, stderr)。stdout 讀掉但不回傳。</summary>
    private async Task<(int ExitCode, string Stderr)> RunProcessAsync(
        string fileName,
        string[] args,
        string toolName,
        CancellationToken cancellationToken)
    {
        var (exitCode, _, stderr) = await RunProcessCaptureStdoutAsync(fileName, args, cancellationToken, toolName);
        return (exitCode, stderr);
    }

    /// <summary>啟動子行程、讀掉兩個輸出串流、回 (exitCode, stdout, stderr)。</summary>
    private async Task<(int ExitCode, string Stdout, string Stderr)> RunProcessCaptureStdoutAsync(
        string fileName,
        string[] args,
        CancellationToken cancellationToken,
        string? toolName = null)
    {
        var psi = new ProcessStartInfo
        {
            FileName = fileName,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };

        foreach (var arg in args)
        {
            psi.ArgumentList.Add(arg);
        }

        using var process = new Process { StartInfo = psi };
        // 對客戶端只揭露執行檔檔名（如 "ffmpeg"），絕不含目錄絕對路徑（審查修正 #2；完整路徑只寫日誌）。
        var safeToolName = toolName ?? SafeExecutableName(fileName);
        try
        {
            process.Start();
        }
        catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or FileNotFoundException)
        {
            _logger.LogError(ex, "找不到或無法啟動 {Tool}（路徑：{Path}）", safeToolName, fileName);
            throw new TtsSynthesisException(
                $"伺服器找不到或無法啟動 {safeToolName}，請確認已安裝並設定執行檔路徑。");
        }

        try
        {
            // 兩個輸出串流都要讀掉，避免緩衝區填滿造成子行程阻塞。
            var stdoutTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
            var stderrTask = process.StandardError.ReadToEndAsync(cancellationToken);
            await process.WaitForExitAsync(cancellationToken);
            var stdout = await stdoutTask;
            var stderr = await stderrTask;

            return (process.ExitCode, stdout, stderr);
        }
        finally
        {
            // 取消（合成預算逾時）或任何離開時，若子行程仍在跑，連同其子孫行程一併終止，
            // 避免 ffmpeg／ffprobe 變孤兒行程續跑（鐵則 #19；審查修正 #5）。best-effort，不掩蓋原例外。
            try
            {
                if (!process.HasExited)
                {
                    process.Kill(entireProcessTree: true);
                }
            }
            catch (Exception ex)
            {
                _logger.LogInformation(ex, "終止子行程失敗（tool={Tool}）", safeToolName);
            }
        }
    }

    /// <summary>取執行檔的「純檔名」（去除目錄，避免對外洩漏伺服器絕對路徑）。</summary>
    private static string SafeExecutableName(string fileName)
    {
        try
        {
            var name = Path.GetFileName(fileName);
            return string.IsNullOrWhiteSpace(name) ? "外部音檔工具" : name;
        }
        catch
        {
            return "外部音檔工具";
        }
    }

    /// <summary>盡力刪除暫存 list 檔（失敗只記錄，不影響主流程）。</summary>
    private void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }
        catch (Exception ex)
        {
            _logger.LogInformation(ex, "刪除暫存併檔清單失敗（path={Path}）", path);
        }
    }

    /// <summary>截斷字串（記錄用）。</summary>
    private static string Truncate(string text, int max) => text.Length > max ? text[..max] + "…" : text;
}
