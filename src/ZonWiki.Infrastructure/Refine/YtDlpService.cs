using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging;

namespace ZonWiki.Infrastructure.Refine;

/// <summary>
/// 取得內容的「種類」：純文字（抓到字幕）或音訊檔（沒字幕、需轉錄）。
/// </summary>
public enum RefineSourceKind
{
    /// <summary>抓到字幕，已是純文字。</summary>
    Text,

    /// <summary>沒有字幕，下載了音訊檔，需要轉錄。</summary>
    Audio,
}

/// <summary>
/// yt-dlp 擷取結果。<see cref="WorkDir"/> 由呼叫端負責清理。
/// </summary>
/// <param name="Kind">種類（文字 / 音訊）。</param>
/// <param name="Title">內容標題。</param>
/// <param name="Text">字幕純文字（Kind=Text 時）。</param>
/// <param name="AudioPath">音訊檔路徑（Kind=Audio 時）。</param>
/// <param name="WorkDir">暫存工作目錄（用完請刪）。</param>
public sealed record RefineExtractResult(
    RefineSourceKind Kind,
    string Title,
    string? Text,
    string? AudioPath,
    string WorkDir);

/// <summary>
/// 以 yt-dlp 子行程從一個 URL 擷取「字幕（純文字）」或「音訊檔」。
///
/// 安全：
/// - URL 嚴格驗證（只允許 http/https；阻擋 localhost / 私有 IP / 雲端中繼資料端點，防 SSRF）。
/// - 子行程以 ArgumentList 傳參（不經過 shell），URL 與參數不會被當指令解析（防注入）。
/// - stdout/stderr 明示 UTF-8（跨行程文字一律 UTF-8）。
/// </summary>
public sealed class YtDlpService
{
    private readonly ILogger<YtDlpService> _logger;
    private readonly string _ytDlpPath;

    /// <summary>字幕語言偏好（中英日優先）。</summary>
    private const string SubLangs = "zh-Hant,zh-TW,zh-Hans,zh,zh.*,en,en.*,ja,ja.*";

    /// <summary>
    /// 建立 yt-dlp 服務。
    /// </summary>
    /// <param name="logger">記錄器。</param>
    /// <param name="ytDlpPath">yt-dlp 執行檔路徑（預設取 PATH 上的 "yt-dlp"）。</param>
    public YtDlpService(ILogger<YtDlpService> logger, string ytDlpPath = "yt-dlp")
    {
        _logger = logger;
        _ytDlpPath = ytDlpPath;
    }

    /// <summary>
    /// 從 URL 擷取字幕或音訊。先嘗試抓字幕；沒有字幕才下載音訊。
    /// </summary>
    /// <param name="url">內容連結。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    /// <returns>擷取結果（呼叫端負責刪除 WorkDir）。</returns>
    public async Task<RefineExtractResult> ExtractAsync(string url, CancellationToken cancellationToken)
    {
        await RefineUrlGuard.ValidateAsync(url, cancellationToken);

        var workDir = Path.Combine(Path.GetTempPath(), "zonwiki-refine", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(workDir);

        // 取標題（快速、不下載）。
        var title = await GetTitleAsync(url, cancellationToken);

        // 1) 嘗試只抓字幕（含自動字幕），不下載影片。
        await RunAsync(
            new[]
            {
                "--skip-download", "--write-subs", "--write-auto-subs",
                "--sub-format", "vtt", "--sub-langs", SubLangs,
                "--no-playlist", "--no-warnings",
                "-o", Path.Combine(workDir, "sub.%(ext)s"),
                url,
            },
            workDir, cancellationToken, throwOnError: false);

        var vtt = Directory.GetFiles(workDir, "*.vtt").FirstOrDefault();
        if (vtt is not null)
        {
            var text = CleanVtt(await File.ReadAllTextAsync(vtt, Encoding.UTF8, cancellationToken));
            if (!string.IsNullOrWhiteSpace(text))
            {
                return new RefineExtractResult(RefineSourceKind.Text, title, text, null, workDir);
            }
        }

        // 2) 沒字幕 → 下載音訊並轉成 16kHz 單聲道 mp3（小、好送轉錄）。
        await RunAsync(
            new[]
            {
                "-x", "--audio-format", "mp3",
                "--postprocessor-args", "ffmpeg:-ar 16000 -ac 1",
                "--no-playlist", "--no-warnings",
                "-o", Path.Combine(workDir, "audio.%(ext)s"),
                url,
            },
            workDir, cancellationToken, throwOnError: true);

        var audio = Directory.GetFiles(workDir, "audio.*")
            .FirstOrDefault(f => f.EndsWith(".mp3", StringComparison.OrdinalIgnoreCase))
            ?? Directory.GetFiles(workDir, "audio.*").FirstOrDefault();

        if (audio is null)
        {
            throw new InvalidOperationException("這個連結抓不到字幕、也下載不到音訊（可能有登入牆、DRM 或不支援）。");
        }

        return new RefineExtractResult(RefineSourceKind.Audio, title, null, audio, workDir);
    }

    /// <summary>取得標題（--print，不下載）。失敗則回退「未命名」。</summary>
    private async Task<string> GetTitleAsync(string url, CancellationToken cancellationToken)
    {
        try
        {
            var (output, _) = await RunAsync(
                new[] { "--skip-download", "--no-playlist", "--no-warnings", "--print", "%(title)s", url },
                Path.GetTempPath(), cancellationToken, throwOnError: false);
            var title = output.Trim().Split('\n').FirstOrDefault()?.Trim();
            return string.IsNullOrWhiteSpace(title) ? "未命名內容" : title;
        }
        catch
        {
            return "未命名內容";
        }
    }

    /// <summary>
    /// 執行 yt-dlp 子行程（ArgumentList 傳參、不經 shell；stdout/stderr 明示 UTF-8）。
    /// </summary>
    private async Task<(string StdOut, string StdErr)> RunAsync(
        string[] args, string workDir, CancellationToken cancellationToken, bool throwOnError)
    {
        var psi = new ProcessStartInfo
        {
            FileName = _ytDlpPath,
            WorkingDirectory = Directory.Exists(workDir) ? workDir : Path.GetTempPath(),
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        foreach (var a in args)
        {
            psi.ArgumentList.Add(a);
        }

        using var process = new Process { StartInfo = psi };
        process.Start();

        var stdoutTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
        var stderrTask = process.StandardError.ReadToEndAsync(cancellationToken);
        await process.WaitForExitAsync(cancellationToken);
        var stdout = await stdoutTask;
        var stderr = await stderrTask;

        if (process.ExitCode != 0 && throwOnError)
        {
            _logger.LogError("yt-dlp 失敗（exit {Code}）：{Err}", process.ExitCode, Truncate(stderr, 500));
            throw new InvalidOperationException($"yt-dlp 失敗：{Truncate(stderr, 200)}");
        }

        return (stdout, stderr);
    }

    /// <summary>
    /// 把 WebVTT 字幕清成純文字：去掉 WEBVTT 標頭、時間軸、序號、行內標記與重複行。
    /// </summary>
    private static string CleanVtt(string vtt)
    {
        var lines = vtt.Replace("\r\n", "\n").Split('\n');
        var output = new List<string>();
        string? last = null;

        foreach (var raw in lines)
        {
            var line = raw.Trim();
            if (line.Length == 0
                || line.StartsWith("WEBVTT", StringComparison.OrdinalIgnoreCase)
                || line.StartsWith("Kind:", StringComparison.OrdinalIgnoreCase)
                || line.StartsWith("Language:", StringComparison.OrdinalIgnoreCase)
                || line.Contains("-->")
                || Regex.IsMatch(line, @"^\d+$"))
            {
                continue;
            }

            // 去掉行內時間/樣式標記：<00:00:01.000><c> ... </c>
            line = Regex.Replace(line, "<[^>]+>", "").Trim();
            if (line.Length == 0 || line == last)
            {
                continue;
            }

            output.Add(line);
            last = line;
        }

        return string.Join("\n", output).Trim();
    }

    /// <summary>截斷字串（記錄用）。</summary>
    private static string Truncate(string s, int max) => s.Length > max ? s[..max] + "…" : s;
}
