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
    private readonly ITranscriptionService _transcription;
    private readonly INoteAiService _noteAi;
    private readonly AiModelResolver _keyResolver;
    private readonly ILogger<RefineService> _logger;

    /// <summary>Groq 轉錄端點與模型（OpenAI 相容）。</summary>
    private const string GroqBaseUrl = "https://api.groq.com/openai/v1";
    private const string GroqModel = "whisper-large-v3-turbo";

    /// <summary>
    /// 給 AI 的系統提示：依內容類型整理成結構化筆記，並以嚴格 JSON 輸出（供程式解析後建立筆記）。
    /// </summary>
    private const string RefineSystemPrompt =
        "你是知識整理助理。使用者會提供一段「來自影片/播客/文章的逐字稿或字幕」與其標題。\n" +
        "請判斷內容類型（教學、播客/訪談、文章/觀點、短影音、其它），用最適合該類型的結構，整理成一篇可日後複習的繁體中文 Markdown 筆記，並決定分類與標籤。\n" +
        "規範：正文繁體中文但保留原文專有名詞/程式碼/金句；抓重點不逐字流水帳；忠實、不腦補。\n" +
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
        ITranscriptionService transcription,
        INoteAiService noteAi,
        AiModelResolver keyResolver,
        ILogger<RefineService> logger)
    {
        _db = db;
        _ytDlp = ytDlp;
        _transcription = transcription;
        _noteAi = noteAi;
        _keyResolver = keyResolver;
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

            // 1) 抓字幕 / 下載音訊。
            extract = await _ytDlp.ExtractAsync(url, cancellationToken);

            // 2) 取得逐字稿文字。
            string transcript;
            if (extract.Kind == RefineSourceKind.Text)
            {
                transcript = extract.Text ?? string.Empty;
            }
            else
            {
                transcript = await TranscribeAudioAsync(user, extract.AudioPath!, cancellationToken);
            }

            if (string.IsNullOrWhiteSpace(transcript))
            {
                throw new InvalidOperationException("沒有取得任何可整理的文字內容。");
            }

            // 逐字稿過長時截斷（保護 prompt 長度；多數模型上下文足夠，但仍設上限）。
            const int maxChars = 40000;
            if (transcript.Length > maxChars)
            {
                transcript = transcript[..maxChars];
            }

            // 3) AI 分類 + 結構化（回傳 JSON）。
            var userPrompt = $"標題：{extract.Title}\n來源：{url}\n\n逐字稿：\n{transcript}";
            var aiOutput = await _noteAi.GenerateAsync(RefineSystemPrompt, userPrompt, cancellationToken);
            var parsed = ParseAiOutput(aiOutput, fallbackTitle: extract.Title, sourceUrl: url);

            // 4) 建立分類筆記。
            var note = await CreateNoteAsync(userId, parsed, url, cancellationToken);

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
    private static RefineNoteResult ParseAiOutput(string aiOutput, string fallbackTitle, string sourceUrl)
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
        var body = string.IsNullOrWhiteSpace(text) ? $"（無法整理內容）\n\n來源：{sourceUrl}" : text;
        return new RefineNoteResult(fallbackTitle, body, new List<string>(), new List<string>());
    }

    /// <summary>建立筆記：解析分類路徑（自動建巢狀分類）→ 建 Note + 版本 + 分類 + 標籤。</summary>
    private async Task<Note> CreateNoteAsync(Guid userId, RefineNoteResult r, string sourceUrl, CancellationToken ct)
    {
        var userKey = userId.ToString();
        var title = r.Title.Length > 500 ? r.Title[..500] : r.Title;

        // 內容尾端附上來源連結（方便回溯）。
        var contentRaw = r.ContentRaw.TrimEnd() + $"\n\n---\n> 來源（精煉自）：{sourceUrl}\n";

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
