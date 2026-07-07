using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using ZonWiki.Domain.Dtos;
using ZonWiki.Domain.Entities;
using ZonWiki.Domain.Tts;
using ZonWiki.Infrastructure.Persistence;
using ZonWiki.Infrastructure.Tts;

namespace ZonWiki.Api.Services;

/// <summary>
/// TTS 合成管線協調服務（背景執行）：口語稿 → 章節切段（≤4000 bytes）→ 逐塊 TTS → ffmpeg 併單檔 →
/// 量時長算章節位移 → 存檔＋DB metadata＋Status=ready。含快取鍵計算與「同筆記＋聲音重合成即失效舊列」清理。
///
/// 快取鍵刻意以「筆記內容（deterministic 上游）＋聲音＋語言＋格式＋prompt 版本＋TTS 模型」計算，
/// <b>而非口語稿</b>（口語稿要先打 Vertex 才有，用它當鍵就無法「重播零成本」）——見 DECISIONS 2026-07-07。
/// </summary>
public sealed class TtsSynthesisService
{
    /// <summary>設定鍵：TTS 模型代號（＝ModelKey，入快取鍵）。</summary>
    public const string ModelNameConfigKey = "Tts:ModelName";

    /// <summary>TTS 模型代號預設值。</summary>
    public const string DefaultTtsModelName = "gemini-2.5-flash-tts";

    /// <summary>設定鍵：單塊 TTS 輸入位元組上限。</summary>
    public const string MaxInputBytesConfigKey = "Tts:MaxInputBytes";

    /// <summary>單塊 TTS 輸入位元組上限預設值（recon 硬限制 4,000 bytes）。</summary>
    public const int DefaultMaxInputBytes = 4000;

    /// <summary>設定鍵：快取檔目錄（相對 ContentRoot）。</summary>
    public const string CacheDirectoryConfigKey = "Tts:CacheDirectory";

    /// <summary>快取檔目錄預設值（相對 ContentRoot）。</summary>
    public const string DefaultCacheDirectory = "App_Data/tts-cache";

    /// <summary>設定鍵：背景合成硬預算（秒）；亦作為「processing 陳舊判定」門檻（審查修正 #4）。</summary>
    public const string SynthesisBudgetSecondsConfigKey = "Tts:SynthesisBudgetSeconds";

    /// <summary>背景合成硬預算預設值（秒）。</summary>
    public const double DefaultSynthesisBudgetSeconds = 600.0;

    /// <summary>設定鍵：單篇筆記可朗讀的內容位元組上限（審查修正 #3：防大筆記 fan-out 成不設上限的付費 TTS）。</summary>
    public const string MaxNoteContentBytesConfigKey = "Tts:MaxNoteContentBytes";

    /// <summary>單篇筆記可朗讀的內容位元組上限預設值（64 KB，約 2 萬中文字；超過即回 400）。</summary>
    public const int DefaultMaxNoteContentBytes = 65536;

    /// <summary>設定鍵：單次合成可切出的塊數上限（審查修正 #3：背景管線的成本保底閘）。</summary>
    public const string MaxChunksPerSynthesisConfigKey = "Tts:MaxChunksPerSynthesis";

    /// <summary>單次合成可切出的塊數上限預設值（超過即標 failed，不逐塊付費展開）。</summary>
    public const int DefaultMaxChunksPerSynthesis = 40;

    /// <summary>設定鍵：單一使用者同時 processing 的 TtsAudio 列數上限（審查修正 #3：防堆積長命背景工作）。</summary>
    public const string MaxConcurrentProcessingPerUserConfigKey = "Tts:MaxConcurrentProcessingPerUser";

    /// <summary>單一使用者同時 processing 的 TtsAudio 列數上限預設值（超過即回 429）。</summary>
    public const int DefaultMaxConcurrentProcessingPerUser = 3;

    /// <summary>失敗回給客戶端的固定泛用訊息（不洩漏伺服器檔案系統路徑／堆疊；審查修正 #2）。</summary>
    public const string GenericFailureMessage = "音檔合成失敗，請稍後再試";

    /// <summary>朗讀模式：單人朗讀（預設）。</summary>
    public const string ModeRead = "read";

    /// <summary>朗讀模式：雙主持人 Podcast 對談（Phase 3）。</summary>
    public const string ModeDialogue = "dialogue";

    /// <summary>合法朗讀模式集合（端點驗證用）。</summary>
    public static readonly IReadOnlySet<string> ValidModes =
        new HashSet<string>(StringComparer.OrdinalIgnoreCase) { ModeRead, ModeDialogue };

    /// <summary>雙主持人對談中「講者 B」的預設聲音（講者 A＝使用者選定聲音；A 若同為此聲音則 B 改用備援）。</summary>
    public const string DefaultDialogueVoiceB = "Charon";

    /// <summary>當講者 A 剛好選到 <see cref="DefaultDialogueVoiceB"/> 時，講者 B 改用的備援聲音（避免兩人同聲）。</summary>
    public const string DialogueVoiceBFallback = "Kore";

    private readonly ZonWikiDbContext _db;
    private readonly TtsScriptService _scriptService;
    private readonly TtsDialogueScriptService _dialogueScriptService;
    private readonly ITextToSpeechService _ttsService;
    private readonly ITtsAudioComposer _composer;
    private readonly IConfiguration _configuration;
    private readonly IHostEnvironment _environment;
    private readonly ILogger<TtsSynthesisService> _logger;

    /// <summary>
    /// 建立合成管線服務。
    /// </summary>
    public TtsSynthesisService(
        ZonWikiDbContext db,
        TtsScriptService scriptService,
        TtsDialogueScriptService dialogueScriptService,
        ITextToSpeechService ttsService,
        ITtsAudioComposer composer,
        IConfiguration configuration,
        IHostEnvironment environment,
        ILogger<TtsSynthesisService> logger)
    {
        _db = db;
        _scriptService = scriptService;
        _dialogueScriptService = dialogueScriptService;
        _ttsService = ttsService;
        _composer = composer;
        _configuration = configuration;
        _environment = environment;
        _logger = logger;
    }

    // ── 快取鍵（純函式，單元可測）───────────────────────────────────────────────

    /// <summary>
    /// 計算快取鍵 ContentHash＝SHA-256_hex( Normalize(內容) ∥ 聲音 ∥ 語言 ∥ 格式 ∥ prompt 版本 ∥ TTS 模型 )。
    /// Normalize＝Trim＋換行正規化(\r\n→\n)＋摺疊連續空白。以 '' 分隔各段避免拼接歧義。
    /// </summary>
    /// <param name="noteContentRaw">筆記原始內容（deterministic 上游）。</param>
    /// <param name="voiceName">聲音代號。</param>
    /// <param name="languageCode">語言（BCP-47）。</param>
    /// <param name="audioEncoding">音檔格式（正規化後，如 MP3／OGG_OPUS）。</param>
    /// <param name="promptVersion">口語化 prompt 版本（<see cref="TtsScriptService.PromptVersion"/>）。</param>
    /// <param name="ttsModelName">TTS 模型代號。</param>
    /// <param name="mode">朗讀模式（"read"／"dialogue"；預設 "read" 以相容既有呼叫。Phase 3：read≠dialogue 不撞快取）。</param>
    /// <returns>SHA-256 十六進位小寫字串（64 字）。</returns>
    public static string ComputeContentHash(
        string noteContentRaw,
        string voiceName,
        string languageCode,
        string audioEncoding,
        string promptVersion,
        string ttsModelName,
        string mode = ModeRead)
    {
        var normalizedContent = NormalizeContent(noteContentRaw);
        // 用 ASCII 單元分隔字元（0x1F）分隔各段，避免不同欄位值拼接產生歧義碰撞。
        const char separator = (char)0x1F;
        var material = string.Join(
            separator,
            normalizedContent,
            voiceName ?? string.Empty,
            languageCode ?? string.Empty,
            audioEncoding ?? string.Empty,
            promptVersion ?? string.Empty,
            ttsModelName ?? string.Empty,
            NormalizeMode(mode));

        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(material));
        return Convert.ToHexStringLower(bytes);
    }

    /// <summary>正規化朗讀模式（未知一律回 "read"，避免非法模式製造相異快取鍵）。</summary>
    /// <param name="mode">原始模式字串。</param>
    /// <returns>正規化後的模式（"read" 或 "dialogue"）。</returns>
    public static string NormalizeMode(string? mode)
        => string.Equals(mode?.Trim(), ModeDialogue, StringComparison.OrdinalIgnoreCase)
            ? ModeDialogue
            : ModeRead;

    /// <summary>內容正規化：Trim＋換行正規化(\r\n→\n)＋摺疊連續空白（含全形空白）為單一空白。</summary>
    private static string NormalizeContent(string? raw)
    {
        var text = (raw ?? string.Empty).Replace("\r\n", "\n", StringComparison.Ordinal)
            .Replace("\r", "\n", StringComparison.Ordinal)
            .Trim();
        // 摺疊連續空白（空格/tab/換行/全形空白）為單一空格，讓純排版差異不影響快取鍵。
        return Regex.Replace(text, "\\s+", " ");
    }

    // ── 格式對照 ────────────────────────────────────────────────────────────────

    /// <summary>合法音檔格式（正規化後）。</summary>
    public static readonly IReadOnlySet<string> ValidFormats =
        new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "MP3", "OGG_OPUS" };

    /// <summary>
    /// 把格式字串解析成 (正規化格式, 副檔名, MIME)。未知格式一律回 MP3（保底格式）。
    /// </summary>
    /// <param name="format">格式字串（如 "mp3"／"OGG_OPUS"）。</param>
    /// <returns>(Canonical 正規化格式, Extension 副檔名, Mime 內容型別)。</returns>
    public static (string Canonical, string Extension, string Mime) ResolveFormat(string? format)
        => (format ?? string.Empty).Trim().ToUpperInvariant() switch
        {
            "OGG_OPUS" => ("OGG_OPUS", "ogg", "audio/ogg"),
            _ => ("MP3", "mp3", "audio/mpeg"),
        };

    // ── 設定值存取 ──────────────────────────────────────────────────────────────

    /// <summary>取 TTS 模型代號（設定值，入快取鍵）。</summary>
    public string ResolveModelName()
    {
        var model = _configuration[ModelNameConfigKey];
        return string.IsNullOrWhiteSpace(model) ? DefaultTtsModelName : model;
    }

    /// <summary>取背景合成硬預算（秒；亦為 processing 陳舊判定門檻）。</summary>
    public double ResolveSynthesisBudgetSeconds()
    {
        var configured = _configuration.GetValue<double?>(SynthesisBudgetSecondsConfigKey);
        return configured is > 0 ? configured.Value : DefaultSynthesisBudgetSeconds;
    }

    /// <summary>取單篇筆記可朗讀的內容位元組上限（審查修正 #3）。</summary>
    public int ResolveMaxNoteContentBytes()
    {
        var configured = _configuration.GetValue<int?>(MaxNoteContentBytesConfigKey);
        return configured is > 0 ? configured.Value : DefaultMaxNoteContentBytes;
    }

    /// <summary>取單次合成可切出的塊數上限（審查修正 #3）。</summary>
    public int ResolveMaxChunksPerSynthesis()
    {
        var configured = _configuration.GetValue<int?>(MaxChunksPerSynthesisConfigKey);
        return configured is > 0 ? configured.Value : DefaultMaxChunksPerSynthesis;
    }

    /// <summary>取單一使用者同時 processing 的 TtsAudio 列數上限（審查修正 #3）。</summary>
    public int ResolveMaxConcurrentProcessingPerUser()
    {
        var configured = _configuration.GetValue<int?>(MaxConcurrentProcessingPerUserConfigKey);
        return configured is > 0 ? configured.Value : DefaultMaxConcurrentProcessingPerUser;
    }

    /// <summary>取單塊 TTS 輸入位元組上限（設定值）。</summary>
    private int ResolveMaxInputBytes()
    {
        var configured = _configuration.GetValue<int?>(MaxInputBytesConfigKey);
        return configured is > 0 ? configured.Value : DefaultMaxInputBytes;
    }

    /// <summary>取快取檔目錄（相對 ContentRoot）。</summary>
    private string ResolveCacheDirectoryRelative()
    {
        var configured = _configuration[CacheDirectoryConfigKey];
        return string.IsNullOrWhiteSpace(configured) ? DefaultCacheDirectory : configured.Replace('\\', '/').TrimEnd('/');
    }

    // ── 清理：同筆記＋聲音重合成即失效舊列與舊檔 ────────────────────────────────

    /// <summary>
    /// 失效同一使用者＋筆記＋聲音＋<b>同模式</b>、但 ContentHash 不同的既有列（軟刪除 DB 列＋刪除其實體快取檔）。
    /// 快取檔是可完全再生的快取產物，故刪實體檔符合「TtsAudio 是快取品」定位；DB 列走軟刪保留 metadata。
    /// 由 <c>POST /synthesize</c> 在「未命中要建新列」前呼叫（設計 §6.3「同 NoteId＋聲音重合成即失效舊列」）。
    /// <b>Phase 3</b>：加入 <paramref name="mode"/> 過濾，讓 read 與 dialogue 兩份快取各自獨立、互不失效。
    /// </summary>
    /// <param name="userId">使用者識別碼。</param>
    /// <param name="noteId">筆記識別碼。</param>
    /// <param name="voiceName">聲音代號。</param>
    /// <param name="mode">朗讀模式（"read"／"dialogue"）；只失效同模式的舊列。</param>
    /// <param name="keepContentHash">要保留（不失效）的 ContentHash（即本次要建的新列）。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    public async Task InvalidateOtherVersionsAsync(
        Guid userId,
        Guid noteId,
        string voiceName,
        string mode,
        string keepContentHash,
        CancellationToken cancellationToken)
    {
        var normalizedMode = NormalizeMode(mode);
        var stale = await _db.TtsAudio.IgnoreQueryFilters()
            .Where(t => t.UserId == userId
                && t.NoteId == noteId
                && t.VoiceName == voiceName
                && t.Mode == normalizedMode
                && t.ValidFlag
                && t.ContentHash != keepContentHash)
            .ToListAsync(cancellationToken);

        if (stale.Count == 0)
        {
            return;
        }

        var now = DateTime.UtcNow;
        foreach (var row in stale)
        {
            row.ValidFlag = false;
            row.DeletedDateTime = now;
            row.UpdatedUser = userId.ToString();
            DeletePhysicalFile(row.FilePath);
        }

        await _db.SaveChangesAsync(cancellationToken);
    }

    // ── 背景合成管線 ────────────────────────────────────────────────────────────

    /// <summary>
    /// 背景合成管線（於 child scope 內呼叫）：載入 processing 列 → 腳本 → 切段 → 逐段 TTS →
    /// 併單檔 → 量時長算章節 → 存檔＋Status=ready。任何例外一律 catch 標 failed（絕不冒成未攔截）。
    /// <b>Phase 3</b>：依 <paramref name="mode"/> 分兩支——"read"＝單人朗讀（口語稿＋章節）、
    /// "dialogue"＝雙主持人 Podcast（對談 turns＋多講者合成，無章節）。
    /// </summary>
    /// <param name="ttsAudioId">要合成的 TtsAudio 列 Id。</param>
    /// <param name="userId">擁有者（背景無 HttpContext，先 SetCurrentUserId）。</param>
    /// <param name="noteId">來源筆記 Id。</param>
    /// <param name="voiceName">聲音代號（dialogue 模式：講者 A 用此聲音，講者 B 用備援聲音）。</param>
    /// <param name="languageCode">語言（BCP-47）。</param>
    /// <param name="format">音檔格式（MP3／OGG_OPUS）。</param>
    /// <param name="mode">朗讀模式（"read"／"dialogue"）。</param>
    /// <param name="cancellationToken">取消權杖（由合成預算 CTS 控制）。</param>
    public async Task RunPipelineAsync(
        Guid ttsAudioId,
        Guid userId,
        Guid noteId,
        string voiceName,
        string languageCode,
        string format,
        string mode,
        CancellationToken cancellationToken)
    {
        // 背景無 HttpContext → 先設目前使用者，否則全域過濾以 Guid.Empty 濾掉一切（見 AskQueueService 範式）。
        _db.SetCurrentUserId(userId);

        var row = await _db.TtsAudio.IgnoreQueryFilters()
            .FirstOrDefaultAsync(t => t.Id == ttsAudioId && t.UserId == userId, cancellationToken);
        if (row is null)
        {
            return; // 列已不存在（理論上不會發生）。
        }

        var normalizedMode = NormalizeMode(mode);
        var tempDirectory = string.Empty;
        try
        {
            var note = await _db.Note.IgnoreQueryFilters()
                .FirstOrDefaultAsync(n => n.Id == noteId && n.UserId == userId && n.ValidFlag, cancellationToken);
            if (note is null)
            {
                throw new TtsSynthesisException("來源筆記不存在或不屬於你。");
            }

            var (canonicalFormat, extension, mime) = ResolveFormat(format);
            var modelName = ResolveModelName();
            var maxInputBytes = ResolveMaxInputBytes();
            var maxChunks = ResolveMaxChunksPerSynthesis();

            // 1) 產腳本 → 切段 →「每段的合成委派」（read＝單人、dialogue＝多講者），並記錄 ScriptJson 與章節形狀。
            //    章節僅 read 模式有（chapterShapes 非 null）；dialogue 無章節（chapterShapes 為 null）。
            List<Func<CancellationToken, Task<byte[]>>> segmentSynths;
            List<(string Title, int ChunkCount)>? chapterShapes;

            if (normalizedMode == ModeDialogue)
            {
                // 對談腳本（VertexAdc；失敗降級為單一講者純文字，不 throw）。
                var turns = await _dialogueScriptService.GenerateAsync(
                    userId, note.Title, note.ContentRaw, cancellationToken);
                row.ScriptJson = JsonSerializer.Serialize(turns);

                // 講者 A＝使用者選定聲音，講者 B＝備援聲音（避免兩人同聲）。
                var voiceA = voiceName;
                var voiceB = string.Equals(voiceName, DefaultDialogueVoiceB, StringComparison.OrdinalIgnoreCase)
                    ? DialogueVoiceBFallback
                    : DefaultDialogueVoiceB;

                var turnChunks = TtsDialogueChunker.ChunkTurns(turns, maxInputBytes);
                segmentSynths = turnChunks
                    .Select(chunk => (Func<CancellationToken, Task<byte[]>>)(token =>
                        _ttsService.SynthesizeMultiSpeakerAsync(
                            chunk.Select(t => (t.Speaker, t.Text)).ToList(),
                            voiceA, voiceB, languageCode, modelName, canonicalFormat, token)))
                    .ToList();
                chapterShapes = null;
            }
            else
            {
                // 口語稿（VertexAdc；失敗降級為純文字，不 throw）。
                var segments = await _scriptService.GenerateAsync(
                    userId, note.Title, note.ContentRaw, cancellationToken);
                row.ScriptJson = JsonSerializer.Serialize(segments);

                // 章節切段（≤maxInputBytes，切塊絕不跨章節）。
                var chapters = TtsScriptChunker.ChunkByChapter(segments, maxInputBytes);
                chapterShapes = new List<(string Title, int ChunkCount)>();
                var flatChunks = new List<string>();
                foreach (var chapter in chapters)
                {
                    chapterShapes.Add((chapter.Title, chapter.Chunks.Count));
                    flatChunks.AddRange(chapter.Chunks);
                }

                segmentSynths = flatChunks
                    .Select(text => (Func<CancellationToken, Task<byte[]>>)(token =>
                        _ttsService.SynthesizeAsync(text, voiceName, languageCode, modelName, canonicalFormat, token)))
                    .ToList();
            }

            if (segmentSynths.Count == 0)
            {
                throw new TtsSynthesisException("筆記內容為空，無可朗讀的文字。");
            }

            // 成本保底閘（審查修正 #3-②）：段數超上限即標 failed，不逐段付費展開（端點的內容位元組門檻是第一道；
            // 這是章節／回合邊界切段可能放大段數時的第二道防線）。安全訊息（不含路徑）。
            if (segmentSynths.Count > maxChunks)
            {
                throw new TtsSynthesisException(
                    $"筆記過長，切段後超過單次朗讀上限（{maxChunks} 段），請縮短內容後再試。");
            }

            // 2) 逐段合成 → 暫存塊檔 → 逐段量時長。
            var cacheDirectoryRelative = ResolveCacheDirectoryRelative();
            var cacheDirectoryAbsolute = Path.Combine(_environment.ContentRootPath, cacheDirectoryRelative);
            Directory.CreateDirectory(cacheDirectoryAbsolute);
            tempDirectory = Path.Combine(cacheDirectoryAbsolute, $"tmp-{ttsAudioId:N}");
            Directory.CreateDirectory(tempDirectory);

            var segmentFiles = new List<string>(segmentSynths.Count);
            var chunkDurations = new List<double>(segmentSynths.Count);
            var allDurationsAvailable = true;

            for (var i = 0; i < segmentSynths.Count; i++)
            {
                var audioBytes = await segmentSynths[i](cancellationToken);

                var segmentPath = Path.Combine(tempDirectory, $"seg-{i}.{extension}");
                await File.WriteAllBytesAsync(segmentPath, audioBytes, cancellationToken);
                segmentFiles.Add(segmentPath);

                var duration = await _composer.ProbeDurationAsync(segmentPath, cancellationToken);
                if (duration.HasValue)
                {
                    chunkDurations.Add(duration.Value);
                }
                else
                {
                    chunkDurations.Add(0);
                    allDurationsAvailable = false;
                }
            }

            // 3) 併成單檔。
            var relativeFilePath = $"{cacheDirectoryRelative}/{ttsAudioId:N}.{extension}";
            var finalAbsolutePath = Path.Combine(_environment.ContentRootPath, relativeFilePath);
            await _composer.ConcatAsync(segmentFiles, finalAbsolutePath, cancellationToken);

            // 4) 總時長（優先量最終檔；缺則以逐塊時長加總，皆缺則 null 由前端 <audio>.duration 補）。
            var totalDuration = await _composer.ProbeDurationAsync(finalAbsolutePath, cancellationToken);
            if (!totalDuration.HasValue && allDurationsAvailable)
            {
                totalDuration = chunkDurations.Sum();
            }

            // 5) 章節時間位移（僅 read 模式有章節形狀，且逐塊時長皆可得才算；dialogue 或缺時長 → null＝best-effort）。
            IReadOnlyList<ChapterDto>? chapterMarks = chapterShapes is not null && allDurationsAvailable
                ? TtsChapterCalculator.ComputeChapterStarts(chapterShapes, chunkDurations)
                : null;

            // 6) 寫回 metadata＋Status=ready（保底存檔用 CancellationToken.None，避免逾時 CTS 讓 SaveChanges 立即取消）。
            row.ChaptersJson = chapterMarks is null ? null : JsonSerializer.Serialize(chapterMarks);
            row.DurationSeconds = totalDuration;
            row.SizeBytes = new FileInfo(finalAbsolutePath).Length;
            row.FilePath = relativeFilePath;
            row.ContentType = mime;
            row.ModelKey = modelName;
            row.Status = "ready";
            row.ErrorText = null;
            row.UpdatedUser = userId.ToString();
            await _db.SaveChangesAsync(CancellationToken.None);
        }
        catch (Exception exception)
        {
            // 任何例外（含取消）→ 標 failed（安全摘要），保底存檔用未取消的權杖。絕不讓例外冒成未攔截。
            _logger.LogWarning(exception, "TTS 合成失敗（ttsAudioId={TtsAudioId}）", ttsAudioId);
            row.Status = "failed";
            row.ErrorText = BuildSafeErrorText(exception);
            row.UpdatedUser = userId.ToString();
            try
            {
                await _db.SaveChangesAsync(CancellationToken.None);
            }
            catch (Exception saveException)
            {
                _logger.LogError(saveException, "TTS 合成失敗後標記 failed 也失敗（ttsAudioId={TtsAudioId}）", ttsAudioId);
            }
        }
        finally
        {
            TryDeleteDirectory(tempDirectory);
        }
    }

    /// <summary>
    /// 組安全的失敗摘要（回給客戶端的 <c>TtsAudio_ErrorText</c>，經 GET /status 外流）。
    ///
    /// 安全硬規則（審查修正 #2；csharp/security：API 回應不得暴露檔案系統路徑）：
    /// 只有<b>已知安全型別</b>（<see cref="TtsSynthesisException"/>——其訊息一律由我方以固定字串建構、
    /// 保證不含伺服器絕對路徑／token／堆疊）才採用其原始訊息；其餘例外（IO／權限／找不到 ffmpeg 等，
    /// <c>Message</c> 可能含 <c>C:\...\App_Data\tts-cache\...</c> 這類絕對路徑）一律回固定泛用訊息，
    /// 完整例外只寫伺服器日誌（見呼叫端的 <c>LogWarning</c>）。
    /// </summary>
    private static string BuildSafeErrorText(Exception exception)
    {
        if (exception is not TtsSynthesisException)
        {
            return GenericFailureMessage;
        }

        var message = exception.Message;
        if (string.IsNullOrWhiteSpace(message))
        {
            return GenericFailureMessage;
        }

        var firstLine = message.Split('\n')[0].Trim();
        return firstLine.Length > 500 ? firstLine[..500] : firstLine;
    }

    /// <summary>刪除快取實體檔（best-effort；只在檔存在時刪；失敗只記錄）。</summary>
    private void DeletePhysicalFile(string relativeFilePath)
    {
        if (string.IsNullOrWhiteSpace(relativeFilePath))
        {
            return;
        }

        try
        {
            var absolutePath = Path.Combine(_environment.ContentRootPath, relativeFilePath);
            if (File.Exists(absolutePath))
            {
                File.Delete(absolutePath);
            }
        }
        catch (Exception exception)
        {
            _logger.LogInformation(exception, "刪除快取音檔失敗（path={Path}）", relativeFilePath);
        }
    }

    /// <summary>盡力刪除暫存塊目錄（失敗只記錄）。</summary>
    private void TryDeleteDirectory(string directory)
    {
        if (string.IsNullOrWhiteSpace(directory))
        {
            return;
        }

        try
        {
            if (Directory.Exists(directory))
            {
                Directory.Delete(directory, recursive: true);
            }
        }
        catch (Exception exception)
        {
            _logger.LogInformation(exception, "刪除 TTS 暫存目錄失敗（dir={Dir}）", directory);
        }
    }
}
