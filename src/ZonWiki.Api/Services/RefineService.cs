using System.Text.Json;
using Markdig;
using Microsoft.EntityFrameworkCore;
using ZonWiki.Api.Notes;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Ai;
using ZonWiki.Infrastructure.Notes;
using ZonWiki.Infrastructure.Persistence;
using ZonWiki.Infrastructure.Refine;

namespace ZonWiki.Api.Services;

/// <summary>
/// 「精煉成筆記」協調器：URL → yt-dlp 抓字幕/音訊 →（必要時）轉錄 → Gemini 分類+結構化 → 建立分類筆記。
/// 設計成在「背景工作的子服務範圍」內執行（呼叫端先 SetCurrentUserId 再解析本服務）。
/// 以 AiSession 追蹤進度（顯示在「AI 處理中」佇列）。
/// </summary>
public sealed class RefineService
{
    private readonly ZonWikiDbContext _db;
    private readonly YtDlpService _ytDlp;
    private readonly ArticleFetchService _articleFetch;
    private readonly FfmpegAudioService _ffmpeg;
    private readonly ITranscriptionService _transcription;
    private readonly INoteAiService _noteAi;
    private readonly AiModelResolver _keyResolver;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<RefineService> _logger;

    /// <summary>Groq 端點（OpenAI 相容；轉錄與聊天共用同一把金鑰）。</summary>
    private const string GroqBaseUrl = "https://api.groq.com/openai/v1";

    /// <summary>Groq 轉錄模型（Whisper；note-gen 已改走後援鏈，Groq 僅用於音訊轉錄）。</summary>
    private const string GroqModel = "whisper-large-v3-turbo";

    /// <summary>
    /// 給 AI 的系統提示：依內容類型整理成結構化筆記，並以嚴格 JSON 輸出（供程式解析後建立筆記）。
    /// </summary>
    private const string RefineSystemPrompt =
        "你是知識整理助理。使用者會提供一段「來自影片/播客/文章的逐字稿或字幕」與其標題。\n" +
        "請判斷內容類型（教學、播客/訪談、文章/觀點、短影音、其它），用最適合該類型的結構，整理成一篇可日後複習的繁體中文 Markdown 筆記，並決定分類與標籤。\n" +
        "規範：正文繁體中文但保留原文專有名詞/程式碼/金句；抓重點不逐字流水帳；忠實、不腦補。\n" +
        "可善用「摺疊區塊」讓筆記更易讀：把『長證據/完整程式碼或指令/延伸補充/FAQ 答案』收進一行 :::toggle 摘要標題、內容、再一行 ::: 之間（預設收合；想預設展開用 :::toggle-open）。但重點與結論要留在外面、大架構仍用 # 與 ## 標題、巢狀勿超過兩層、摺疊標題要能一眼看出裡面是什麼。\n" +
        "你必須只輸出一個 JSON 物件（不要任何多餘文字、不要用 ``` 圍欄），格式如下：\n" +
        "{\n" +
        "  \"title\": \"精簡標題\",\n" +
        "  \"categoryPath\": [\"上層分類\", \"子分類\"],\n" +
        "  \"tags\": [\"標籤1\", \"標籤2\"],\n" +
        "  \"contentRaw\": \"# 標題\\n整篇 Markdown 筆記內容…\"\n" +
        "}";

    /// <summary>
    /// 建立精煉協調器。
    /// </summary>
    public RefineService(
        ZonWikiDbContext db,
        YtDlpService ytDlp,
        ArticleFetchService articleFetch,
        FfmpegAudioService ffmpeg,
        ITranscriptionService transcription,
        INoteAiService noteAi,
        AiModelResolver keyResolver,
        IHttpClientFactory httpClientFactory,
        ILogger<RefineService> logger)
    {
        _db = db;
        _ytDlp = ytDlp;
        _articleFetch = articleFetch;
        _ffmpeg = ffmpeg;
        _transcription = transcription;
        _noteAi = noteAi;
        _keyResolver = keyResolver;
        _httpClientFactory = httpClientFactory;
        _logger = logger;
    }

    /// <summary>
    /// 執行整條精煉流程，並把 AiSession 更新為 Completed/Failed。
    /// 呼叫端須在背景子範圍中先 <c>db.SetCurrentUserId(userId)</c> 再解析本服務。
    /// </summary>
    /// <param name="userId">使用者識別碼。</param>
    /// <param name="url">內容連結。</param>
    /// <param name="sessionId">追蹤用的 AiSession 識別碼（呼叫端已建立 Running 列）。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    public async Task ExecuteAsync(Guid userId, string url, Guid sessionId, CancellationToken cancellationToken)
    {
        var session = await _db.AiSession.FirstOrDefaultAsync(s => s.Id == sessionId, cancellationToken);
        RefineExtractResult? extract = null;
        try
        {
            var user = await _db.User.FirstOrDefaultAsync(u => u.Id == userId, cancellationToken)
                ?? throw new InvalidOperationException("使用者不存在。");

            // 1)+2) 取得「標題 + 逐字稿/內文」：先試影音（yt-dlp 抓字幕或音訊轉錄），
            //        抓不到影音（InvalidOperationException）就退而求其次當「文章」抓網頁文字。
            //        （SSRF 等 ArgumentException 不在此攔截，直接往外拋讓工作失敗。）
            string title;
            string transcript;
            try
            {
                extract = await _ytDlp.ExtractAsync(url, cancellationToken);
                title = extract.Title;
                transcript = extract.Kind == RefineSourceKind.Text
                    ? extract.Text ?? string.Empty
                    : await TranscribeAudioAsync(user, extract.AudioPath!, cancellationToken);
            }
            catch (InvalidOperationException)
            {
                var article = await _articleFetch.FetchAsync(url, cancellationToken)
                    ?? throw new InvalidOperationException(
                        "這個連結既不是可抓的影音、也讀不到文章內文（可能是 Threads/X/IG 等需登入或靠 JS 渲染的頁面）。");
                title = article.Title;
                transcript = article.Text;
            }

            if (string.IsNullOrWhiteSpace(transcript))
            {
                throw new InvalidOperationException("沒有取得任何可整理的文字內容。");
            }

            // 3)+4) AI 分類結構化 → 建立分類筆記（與「上傳檔案精煉」共用同一段核心）。
            var note = await RefineTranscriptToNoteAsync(user, session, title, transcript, url, cancellationToken);

            // 5) 標記完成（連結答案筆記）。
            if (session is not null)
            {
                AskQueueService.ApplyCompleted(session, note.Id);
                await _db.SaveChangesAsync(cancellationToken);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "精煉成筆記失敗（userId={UserId}, url={Url}）", userId, url);
            if (session is not null)
            {
                try
                {
                    AskQueueService.ApplyFailed(session, ex.Message);
                    await _db.SaveChangesAsync(cancellationToken);
                }
                catch (Exception logEx)
                {
                    _logger.LogError(logEx, "更新精煉失敗狀態時又出錯");
                }
            }
        }
        finally
        {
            // 清理 yt-dlp 暫存目錄（音訊檔等）。
            if (extract is not null && Directory.Exists(extract.WorkDir))
            {
                try { Directory.Delete(extract.WorkDir, recursive: true); }
                catch (Exception cleanupEx) { _logger.LogWarning(cleanupEx, "清理精煉暫存目錄失敗：{Dir}", extract.WorkDir); }
            }
        }
    }

    /// <summary>
    /// 從「使用者上傳的音訊／影片檔」精煉成筆記：ffmpeg 轉 16kHz 單聲道 mp3 → 轉錄 → AI 整理分類 → 建立筆記。
    /// 上傳檔一律無字幕，故必須在個人頁把轉錄引擎設為 Groq。背景執行；以 AiSession 追蹤進度。
    /// 呼叫端須在背景子範圍中先 <c>db.SetCurrentUserId(userId)</c> 再解析本服務。
    /// </summary>
    /// <param name="userId">使用者識別碼。</param>
    /// <param name="uploadFilePath">已存到伺服器暫存區的上傳檔路徑（產生的檔名；本方法負責用完刪除）。</param>
    /// <param name="displayName">使用者原始檔名（僅供標題／來源顯示；不用於檔案系統路徑）。</param>
    /// <param name="sessionId">追蹤用的 AiSession 識別碼（呼叫端已建立 Running 列）。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    public async Task ExecuteFromFileAsync(
        Guid userId,
        string uploadFilePath,
        string displayName,
        Guid sessionId,
        CancellationToken cancellationToken)
    {
        var session = await _db.AiSession.FirstOrDefaultAsync(s => s.Id == sessionId, cancellationToken);
        string? workDir = null;
        try
        {
            var user = await _db.User.FirstOrDefaultAsync(u => u.Id == userId, cancellationToken)
                ?? throw new InvalidOperationException("使用者不存在。");

            // 1) ffmpeg 把上傳檔（音訊或影片）轉成 16kHz 單聲道 mp3。
            workDir = Path.Combine(Path.GetTempPath(), "zonwiki-refine", Guid.NewGuid().ToString("N"));
            var mp3Path = await _ffmpeg.ExtractTo16kMonoMp3Async(uploadFilePath, workDir, cancellationToken);

            // 2) 轉錄（上傳檔一律需要轉錄 → 需 Groq）。
            var transcript = await TranscribeAudioAsync(user, mp3Path, cancellationToken);
            if (string.IsNullOrWhiteSpace(transcript))
            {
                throw new InvalidOperationException("這個檔案轉錄不出任何文字（可能沒有語音內容）。");
            }

            // 3)+4) AI 分類結構化 → 建立分類筆記。標題以原始檔名為後備（AI 會給更好的標題）。
            var fallbackTitle = Path.GetFileNameWithoutExtension(displayName);
            if (string.IsNullOrWhiteSpace(fallbackTitle)) fallbackTitle = "上傳的內容";
            var sourceLabel = $"上傳檔案：{displayName}";
            var note = await RefineTranscriptToNoteAsync(user, session, fallbackTitle, transcript, sourceLabel, cancellationToken);

            // 5) 標記完成（連結答案筆記）。
            if (session is not null)
            {
                AskQueueService.ApplyCompleted(session, note.Id);
                await _db.SaveChangesAsync(cancellationToken);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "上傳檔案精煉失敗（userId={UserId}, file={File}）", userId, displayName);
            if (session is not null)
            {
                try
                {
                    AskQueueService.ApplyFailed(session, ex.Message);
                    await _db.SaveChangesAsync(cancellationToken);
                }
                catch (Exception logEx)
                {
                    _logger.LogError(logEx, "更新上傳精煉失敗狀態時又出錯");
                }
            }
        }
        finally
        {
            // 清理：上傳暫存檔 + ffmpeg 工作目錄。
            try
            {
                if (File.Exists(uploadFilePath)) File.Delete(uploadFilePath);
            }
            catch (Exception cleanupEx)
            {
                _logger.LogWarning(cleanupEx, "清理上傳暫存檔失敗：{Path}", uploadFilePath);
            }
            if (workDir is not null && Directory.Exists(workDir))
            {
                try { Directory.Delete(workDir, recursive: true); }
                catch (Exception cleanupEx) { _logger.LogWarning(cleanupEx, "清理精煉暫存目錄失敗：{Dir}", workDir); }
            }
        }
    }

    /// <summary>
    /// 精煉核心（URL 與上傳檔共用）：截斷過長逐字稿 → AI 分類結構化（JSON）→ 解析 → 建立分類筆記。
    /// </summary>
    /// <param name="userId">使用者識別碼。</param>
    /// <param name="title">後備標題（AI 沒給標題時用）。</param>
    /// <param name="transcript">逐字稿／內文。</param>
    /// <param name="sourceLabel">來源標示（URL 或「上傳檔案：檔名」），寫入筆記尾端供回溯。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    /// <returns>建立好的筆記。</returns>
    private async Task<Note> RefineTranscriptToNoteAsync(
        User user,
        AiSession? session,
        string title,
        string transcript,
        string sourceLabel,
        CancellationToken cancellationToken)
    {
        // 逐字稿過長時截斷（保護 prompt 長度；多數模型上下文足夠，但仍設上限）。
        // 明確標註「已截斷」，讓 AI 與使用者都知道只整理了前段（避免誤以為涵蓋全片）。
        const int maxChars = 40000;
        if (transcript.Length > maxChars)
        {
            _logger.LogInformation("精煉逐字稿超過 {Max} 字已截斷（來源：{Source}）", maxChars, sourceLabel);
            transcript = transcript[..maxChars] + "\n\n[已截斷：內容超過字數上限，以上僅為前段]";
        }

        var userPrompt = $"標題：{title}\n來源：{sourceLabel}\n\n內容：\n{transcript}";

        // note-gen（文字整理/分類）一律走「後援鏈」（Claude → Google AI Studio → banana）——決策 b。
        // 不再優先用 Groq；Groq（GroqBaseUrl/GroqModel）僅保留給「音訊轉錄」(TranscribeAudioAsync)。
        // 每次嘗試/失敗經由 onStage 寫進 AiSession/AiMessage（與框選提問共用同一套階段記錄器，供佇列顯示）。
        var onStage = session is null
            ? null
            : AskQueueService.BuildStageRecorder(_db, session, cancellationToken);
        var aiOutput = await _noteAi.GenerateAsync(RefineSystemPrompt, userPrompt, cancellationToken, onStage);

        var parsed = ParseAiOutput(aiOutput, fallbackTitle: title, sourceLabel: sourceLabel);
        return await CreateNoteAsync(user.Id, parsed, sourceLabel, cancellationToken);
    }

    /// <summary>
    /// 轉錄音訊：依使用者設定的引擎。Groq → 用其金鑰打 Groq Whisper；Gemini → v1 暫不支援音訊（提示改用 Groq）。
    /// </summary>
    private async Task<string> TranscribeAudioAsync(User user, string audioPath, CancellationToken cancellationToken)
    {
        if (string.Equals(user.TranscriptionEngine, "groq", StringComparison.OrdinalIgnoreCase))
        {
            var key = _keyResolver.ResolveApiKey(user.GroqApiKeyEncrypted)
                ?? throw new InvalidOperationException("轉錄引擎設為 Groq，但尚未在個人頁填入 Groq 金鑰。");
            return await _transcription.TranscribeAsync(audioPath, GroqBaseUrl, key, GroqModel, cancellationToken);
        }

        // Gemini（預設）：v1 尚未接音訊轉錄（需 Gemini File API）。引導使用者改用 Groq。
        throw new InvalidOperationException(
            "這個內容沒有字幕，需要音訊轉錄。請到「個人頁 → 精煉成筆記」把轉錄引擎設為 Groq（免費）並填入金鑰，或改用有字幕的內容。");
    }

    /// <summary>解析 AI 的 JSON 輸出；失敗則退回「整段當內容」的保底結果。</summary>
    private static RefineNoteResult ParseAiOutput(string aiOutput, string fallbackTitle, string sourceLabel)
    {
        var text = StripFence(aiOutput.Trim());
        try
        {
            using var doc = JsonDocument.Parse(text);
            var root = doc.RootElement;
            var title = root.TryGetProperty("title", out var t) ? t.GetString() : null;
            var content = root.TryGetProperty("contentRaw", out var c) ? c.GetString() : null;
            var path = root.TryGetProperty("categoryPath", out var p) && p.ValueKind == JsonValueKind.Array
                ? p.EnumerateArray().Select(x => x.GetString() ?? "").Where(s => s.Length > 0).ToList()
                : new List<string>();
            var tags = root.TryGetProperty("tags", out var g) && g.ValueKind == JsonValueKind.Array
                ? g.EnumerateArray().Select(x => x.GetString() ?? "").Where(s => s.Length > 0).ToList()
                : new List<string>();

            if (!string.IsNullOrWhiteSpace(content))
            {
                return new RefineNoteResult(
                    string.IsNullOrWhiteSpace(title) ? fallbackTitle : title!,
                    content!,
                    path,
                    tags);
            }
        }
        catch (JsonException)
        {
            // 落到保底。
        }

        // 保底：AI 沒給合法 JSON → 直接把整段輸出當筆記內容。
        var body = string.IsNullOrWhiteSpace(text) ? $"（無法整理內容）\n\n來源：{sourceLabel}" : text;
        return new RefineNoteResult(fallbackTitle, body, new List<string>(), new List<string>());
    }

    /// <summary>建立筆記：解析分類路徑（自動建巢狀分類）→ 建 Note + 版本 + 分類 + 標籤。</summary>
    private async Task<Note> CreateNoteAsync(Guid userId, RefineNoteResult r, string sourceLabel, CancellationToken ct)
    {
        var userKey = userId.ToString();
        var title = r.Title.Length > 500 ? r.Title[..500] : r.Title;

        // 內容尾端附上來源（URL 或上傳檔名）方便回溯。
        var contentRaw = r.ContentRaw.TrimEnd() + $"\n\n---\n> 來源（精煉自）：{sourceLabel}\n";

        // slug 去重。
        var baseSlug = NoteContentHelpers.GenerateSlug(title);
        if (string.IsNullOrEmpty(baseSlug)) baseSlug = "note";
        var slug = baseSlug;
        for (var i = 2; await _db.Note.AnyAsync(n => n.UserId == userId && n.Slug == slug && n.ValidFlag, ct); i++)
        {
            slug = $"{baseSlug}-{i}";
        }

        var note = new Note
        {
            UserId = userId,
            Title = title,
            Slug = slug,
            ContentRaw = contentRaw,
            ContentHtml = Markdown.ToHtml(contentRaw, NoteContentHelpers.MarkdownPipeline),
            ContentHash = NoteContentHelpers.ComputeContentHash(contentRaw),
            Kind = "note",
            CreatedUser = userKey,
            UpdatedUser = userKey,
        };
        _db.Note.Add(note);
        await _db.SaveChangesAsync(ct);

        _db.NoteRevision.Add(new NoteRevision
        {
            UserId = userId,
            NoteId = note.Id,
            RevisionNo = 1,
            ChangeKind = "create",
            Title = note.Title,
            ContentRaw = note.ContentRaw,
            CreatedUser = userKey,
            UpdatedUser = userKey,
        });

        // 分類路徑 → 巢狀分類（找不到就建立）。
        var leafId = await ResolveCategoryPathAsync(userId, userKey, r.CategoryPath, ct);
        if (leafId is Guid leaf)
        {
            _db.NoteCategory.Add(new NoteCategory
            {
                UserId = userId,
                NoteId = note.Id,
                CategoryId = leaf,
                CreatedUser = userKey,
                UpdatedUser = userKey,
            });
        }

        // 標籤（依名稱，找不到就建立）。
        foreach (var rawName in r.Tags)
        {
            var name = rawName.Trim();
            if (name.Length == 0) continue;
            var tag = await _db.Tag.FirstOrDefaultAsync(x => x.Name == name, ct);
            if (tag is null)
            {
                tag = new Tag { UserId = userId, Name = name, CreatedUser = userKey, UpdatedUser = userKey };
                _db.Tag.Add(tag);
                await _db.SaveChangesAsync(ct);
            }
            _db.NoteTag.Add(new NoteTag
            {
                UserId = userId,
                NoteId = note.Id,
                TagId = tag.Id,
                CreatedUser = userKey,
                UpdatedUser = userKey,
            });
        }

        await _db.SaveChangesAsync(ct);
        return note;
    }

    /// <summary>解析分類名稱路徑成巢狀分類（找不到就建立），回最末層 Id。</summary>
    private async Task<Guid?> ResolveCategoryPathAsync(Guid userId, string userKey, List<string> path, CancellationToken ct)
    {
        Guid? parentId = null;
        var folderPath = string.Empty;
        foreach (var seg in path)
        {
            var name = seg.Trim();
            if (name.Length == 0) continue;
            folderPath = folderPath.Length == 0 ? name : $"{folderPath}/{name}";

            var existing = parentId is null
                ? await _db.Category.FirstOrDefaultAsync(c => c.ParentId == null && c.Name == name, ct)
                : await _db.Category.FirstOrDefaultAsync(c => c.ParentId == parentId && c.Name == name, ct);

            if (existing is null)
            {
                existing = new Category
                {
                    UserId = userId,
                    Name = name,
                    ParentId = parentId,
                    FolderPath = folderPath,
                    CreatedUser = userKey,
                    UpdatedUser = userKey,
                };
                _db.Category.Add(existing);
                await _db.SaveChangesAsync(ct);
            }
            parentId = existing.Id;
        }
        return parentId;
    }

    /// <summary>去掉整段被 ``` 圍欄包住的情形。</summary>
    private static string StripFence(string text)
    {
        if (!text.StartsWith("```", StringComparison.Ordinal)) return text;
        var firstNl = text.IndexOf('\n');
        if (firstNl < 0) return text;
        var lastFence = text.LastIndexOf("```", StringComparison.Ordinal);
        if (lastFence <= firstNl) return text;
        return text[(firstNl + 1)..lastFence].Trim();
    }

    /// <summary>精煉結果（解析自 AI 的 JSON）。</summary>
    private sealed record RefineNoteResult(string Title, string ContentRaw, List<string> CategoryPath, List<string> Tags);
}
