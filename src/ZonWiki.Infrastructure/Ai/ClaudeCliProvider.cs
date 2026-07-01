using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;

namespace ZonWiki.Infrastructure.Ai;

/// <summary>
/// <see cref="ClaudeCliProvider"/> 的設定。
/// </summary>
public sealed class ClaudeCliOptions
{
    /// <summary>
    /// claude 執行檔路徑或名稱（預設 "claude"，靠 PATH 解析）。
    /// </summary>
    public string BinaryPath { get; set; } = "claude";

    /// <summary>
    /// 單次提問的逾時秒數，逾時則強制結束程序。
    /// 預設 300 秒：claude -p 在記憶體受限的小機器（e2-micro 1GB）上冷啟動可達數十秒，
    /// 加上產出長內容（如整篇排版）常需 2–4 分鐘；因 note-AI 已改非同步（背景執行、前端輪詢），
    /// 拉長此逾時不會阻塞任何 HTTP 請求，只為讓 claude 有足夠時間完成而非中途被砍。
    /// 可用設定鍵 <c>Ai:ClaudeCli:TimeoutSeconds</c> 覆寫。
    /// </summary>
    public int TimeoutSeconds { get; set; } = 300;
}

/// <summary>
/// 以本機 <c>claude</c> CLI 為後端的 AI 供應者（正式環境用）。
/// 採 one-shot：每次提問 spawn 一次「claude -p --output-format stream-json --verbose」，
/// 將 prompt 寫入 stdin 後關閉，逐行解析 stdout 的 stream-json 事件，
/// 把文字增量以 Delta 串流出來，最後吐 Completed。對齊 產品管理系統 的整合方式但簡化為單次。
/// </summary>
public sealed class ClaudeCliProvider : IAiProvider
{
    private readonly ClaudeCliOptions _options;

    /// <summary>
    /// 建立 claude CLI 供應者。
    /// </summary>
    public ClaudeCliProvider(ClaudeCliOptions? options = null)
    {
        _options = options ?? new ClaudeCliOptions();
    }

    /// <summary>
    /// 啟動 claude 程序、送出 prompt、串流解析回應。
    /// </summary>
    public async IAsyncEnumerable<AiStreamEvent> StreamAsync(
        string prompt, string? resumeSessionId = null, string? model = null, string? systemPrompt = null,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var psi = CreateStartInfo(_options, model, systemPrompt, resumeSessionId);

        using var timeoutCts = new CancellationTokenSource(TimeSpan.FromSeconds(_options.TimeoutSeconds));
        using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeoutCts.Token);
        var ct = linkedCts.Token;

        Process? process = null;
        try
        {
            process = Process.Start(psi)
                ?? throw new InvalidOperationException($"無法啟動 claude（路徑：{_options.BinaryPath}）。");

            // 以 UTF-8（不含 BOM）把 prompt 寫入 stdin 後關閉，觸發 claude 開始處理。
            await using (var stdin = process.StandardInput)
            {
                await stdin.WriteAsync(prompt.AsMemory(), ct);
            }

            var accumulated = new StringBuilder();
            var completedEmitted = false;
            string? sessionId = null;

            string? line;
            while ((line = await process.StandardOutput.ReadLineAsync(ct)) is not null)
            {
                if (string.IsNullOrWhiteSpace(line))
                {
                    continue;
                }

                var (parsed, lineSessionId) = ParseLine(line, accumulated);
                if (lineSessionId is not null)
                {
                    sessionId = lineSessionId;
                }
                if (parsed is { } evt)
                {
                    if (evt.Type == AiStreamEventType.Completed)
                    {
                        completedEmitted = true;
                        yield return evt with { SessionId = sessionId };
                    }
                    else
                    {
                        yield return evt;
                    }
                }
            }

            await process.WaitForExitAsync(ct);

            if (!completedEmitted)
            {
                if (process.ExitCode != 0)
                {
                    var stderr = await process.StandardError.ReadToEndAsync(ct);
                    yield return new AiStreamEvent(
                        AiStreamEventType.Error,
                        $"claude 以非零代碼 {process.ExitCode} 結束。{stderr}".Trim());
                }
                else
                {
                    yield return new AiStreamEvent(AiStreamEventType.Completed, accumulated.ToString(), SessionId: sessionId);
                }
            }
        }
        finally
        {
            if (process is not null)
            {
                try
                {
                    if (!process.HasExited)
                    {
                        process.Kill(entireProcessTree: true);
                    }
                }
                catch
                {
                    // 程序可能已自行結束，忽略。
                }

                process.Dispose();
            }
        }
    }

    /// <summary>
    /// 依設定組出啟動 claude 程序的 <see cref="ProcessStartInfo"/>（含重導 stdio、各旗標）。
    /// 抽成獨立方法，以便單元測試驗證編碼與參數組裝（特別是 stdin 編碼，避免中文亂碼）。
    /// </summary>
    /// <param name="options">claude CLI 設定（執行檔路徑等）。</param>
    /// <param name="model">指定的模型名稱（可空，空則不帶 --model）。</param>
    /// <param name="systemPrompt">附加的系統提示（可空，空則不帶 --append-system-prompt）。</param>
    /// <param name="resumeSessionId">要接續的 session id（可空，空則不帶 --resume）。</param>
    /// <returns>組裝完成、可直接 <see cref="Process.Start(ProcessStartInfo)"/> 的設定。</returns>
    internal static ProcessStartInfo CreateStartInfo(
        ClaudeCliOptions options,
        string? model,
        string? systemPrompt,
        string? resumeSessionId)
    {
        var psi = new ProcessStartInfo
        {
            FileName = options.BinaryPath,
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
            // stdin/stdout/stderr 一律明示 UTF-8：Windows 預設 console 編碼為 CP950/Big5，
            // 若不指定 StandardInputEncoding，Process.StandardInput 會以該預設編碼把中文 prompt 寫出，
            // 而 claude 端以 UTF-8 讀入 → 亂碼（mojibake）。stdin 用不帶 BOM 的 UTF-8，避免 claude 把開頭 BOM 當內容。
            StandardInputEncoding = new UTF8Encoding(false),
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        psi.ArgumentList.Add("-p");
        psi.ArgumentList.Add("--output-format");
        psi.ArgumentList.Add("stream-json");
        psi.ArgumentList.Add("--verbose");
        if (!string.IsNullOrWhiteSpace(model))
        {
            psi.ArgumentList.Add("--model");
            psi.ArgumentList.Add(model);
        }
        if (!string.IsNullOrWhiteSpace(systemPrompt))
        {
            // 以原生旗標附加系統提示（接在 claude 預設 system prompt 之後）。
            psi.ArgumentList.Add("--append-system-prompt");
            psi.ArgumentList.Add(systemPrompt);
        }
        if (!string.IsNullOrEmpty(resumeSessionId))
        {
            psi.ArgumentList.Add("--resume");
            psi.ArgumentList.Add(resumeSessionId);
        }
        return psi;
    }

    /// <summary>
    /// 解析一行 stream-json：assistant 文字 → Delta；result → Completed；其餘忽略。
    /// 同時嘗試取出 session_id（任何事件都可能帶）。解析失敗的行視為雜訊忽略。
    /// </summary>
    private static (AiStreamEvent? Event, string? SessionId) ParseLine(string line, StringBuilder accumulated)
    {
        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(line);
        }
        catch (JsonException)
        {
            return (null, null);
        }

        using (doc)
        {
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object
                || !root.TryGetProperty("type", out var typeEl))
            {
                return (null, null);
            }

            var sessionId = root.TryGetProperty("session_id", out var sidEl) && sidEl.ValueKind == JsonValueKind.String
                ? sidEl.GetString()
                : null;

            var type = typeEl.GetString();

            if (type == "assistant"
                && root.TryGetProperty("message", out var message)
                && message.TryGetProperty("content", out var content)
                && content.ValueKind == JsonValueKind.Array)
            {
                var sb = new StringBuilder();
                foreach (var item in content.EnumerateArray())
                {
                    if (item.TryGetProperty("type", out var itemType)
                        && itemType.GetString() == "text"
                        && item.TryGetProperty("text", out var textEl))
                    {
                        sb.Append(textEl.GetString());
                    }
                }

                var text = sb.ToString();
                if (text.Length == 0)
                {
                    return (null, sessionId);
                }

                accumulated.Append(text);
                return (new AiStreamEvent(AiStreamEventType.Delta, text, line), sessionId);
            }

            if (type == "result")
            {
                var final = root.TryGetProperty("result", out var resultEl) && resultEl.ValueKind == JsonValueKind.String
                    ? resultEl.GetString() ?? accumulated.ToString()
                    : accumulated.ToString();
                return (new AiStreamEvent(AiStreamEventType.Completed, final, line), sessionId);
            }

            return (null, sessionId);
        }
    }
}
