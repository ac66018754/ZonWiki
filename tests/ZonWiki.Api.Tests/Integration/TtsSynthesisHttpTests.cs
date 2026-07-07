using System.Net;
using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Xunit;
using ZonWiki.Api.Services;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Ai;
using ZonWiki.Infrastructure.Tts;

namespace ZonWiki.Api.Tests.Integration;

/// <summary>
/// TTS 合成端點整合測試（真 HTTP＋Testcontainers＋Fake TTS/Composer）：
/// 首播流程、快取命中不重合成、內容變更失效舊列與舊檔、驗證錯誤、多租戶、章節端到端、陳舊 processing 復原。
/// </summary>
[Collection(ApiIntegrationCollection.Name)]
public sealed class TtsSynthesisHttpTests
{
    private readonly ZonWikiApiFactory _factory;

    public TtsSynthesisHttpTests(ZonWikiApiFactory factory)
    {
        _factory = factory;
    }

    private static string AbsolutePath(ZonWikiApiFactory factory, string filePath)
    {
        var env = factory.Services.GetRequiredService<IHostEnvironment>();
        return Path.Combine(env.ContentRootPath, filePath);
    }

    [Fact]
    public async Task I1_首播流程_202processing含ttsAudioId_輪詢至ready且檔案落庫()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"tts-i1-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);
        var noteId = await _factory.SeedNoteAsync(userId, "這是一篇測試筆記，用來驗證朗讀合成流程。");

        var response = await client.PostAsJsonAsync(
            $"/api/tts/notes/{noteId}/synthesize", new { voice = "Kore" });

        response.StatusCode.Should().Be(HttpStatusCode.Accepted);
        var json = await response.ReadJsonAsync();
        // 契約鎖定 #1：主鍵欄名 ttsAudioId。
        var ttsAudioId = Guid.Parse(json["data"]!["ttsAudioId"]!.GetValue<string>());
        json["data"]!["status"]!.GetValue<string>().Should().Be("processing");

        var finalStatus = await client.PollStatusUntilTerminalAsync(ttsAudioId);
        finalStatus.Should().Be("ready");

        var row = await _factory.GetTtsAudioAsync(ttsAudioId);
        row.Should().NotBeNull();
        row!.Status.Should().Be("ready");
        row.SizeBytes.Should().BeGreaterThan(0);
        File.Exists(AbsolutePath(_factory, row.FilePath)).Should().BeTrue();
    }

    [Fact]
    public async Task I2_快取命中不重合成_第二次POST回200ready同id()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"tts-i2-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);
        var noteId = await _factory.SeedNoteAsync(userId, "重播零成本測試筆記內容。");

        var first = await client.PostAsJsonAsync($"/api/tts/notes/{noteId}/synthesize", new { voice = "Kore" });
        var firstId = Guid.Parse((await first.ReadJsonAsync())["data"]!["ttsAudioId"]!.GetValue<string>());
        (await client.PollStatusUntilTerminalAsync(firstId)).Should().Be("ready");

        // 第二次同筆記同聲音 → 快取命中：200 ready（非 202 processing）＋同一 id（＝不再合成）。
        var second = await client.PostAsJsonAsync($"/api/tts/notes/{noteId}/synthesize", new { voice = "Kore" });
        second.StatusCode.Should().Be(HttpStatusCode.OK, "快取命中應直接回 200 ready，不重新合成");
        var secondJson = await second.ReadJsonAsync();
        secondJson["data"]!["status"]!.GetValue<string>().Should().Be("ready");
        Guid.Parse(secondJson["data"]!["ttsAudioId"]!.GetValue<string>()).Should().Be(firstId);

        // DB 僅一列有效（未重建）。
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            var validCount = await db.TtsAudio.IgnoreQueryFilters()
                .CountAsync(t => t.UserId == userId && t.NoteId == noteId && t.ValidFlag);
            validCount.Should().Be(1);
        }
    }

    [Fact]
    public async Task I3_內容變更後重合成_舊列失效且舊檔刪除_新列不同hash()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"tts-i3-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);
        var noteId = await _factory.SeedNoteAsync(userId, "原始內容第一版。");

        var first = await client.PostAsJsonAsync($"/api/tts/notes/{noteId}/synthesize", new { voice = "Kore" });
        var firstId = Guid.Parse((await first.ReadJsonAsync())["data"]!["ttsAudioId"]!.GetValue<string>());
        (await client.PollStatusUntilTerminalAsync(firstId)).Should().Be("ready");
        var oldRow = await _factory.GetTtsAudioAsync(firstId);
        var oldFile = AbsolutePath(_factory, oldRow!.FilePath);
        File.Exists(oldFile).Should().BeTrue();

        // 變更內容 → 重新合成（不同 hash）。
        await _factory.UpdateNoteContentAsync(noteId, "改過的內容第二版，明顯不同。");
        var second = await client.PostAsJsonAsync($"/api/tts/notes/{noteId}/synthesize", new { voice = "Kore" });
        second.StatusCode.Should().Be(HttpStatusCode.Accepted);
        var secondId = Guid.Parse((await second.ReadJsonAsync())["data"]!["ttsAudioId"]!.GetValue<string>());
        secondId.Should().NotBe(firstId);
        (await client.PollStatusUntilTerminalAsync(secondId)).Should().Be("ready");

        // 舊列軟刪＋舊檔已刪；新列 ready 且 hash 不同。
        var oldAfter = await _factory.GetTtsAudioAsync(firstId);
        oldAfter!.ValidFlag.Should().BeFalse("舊列應被軟刪除");
        File.Exists(oldFile).Should().BeFalse("舊快取檔應被刪除");
        var newRow = await _factory.GetTtsAudioAsync(secondId);
        newRow!.Status.Should().Be("ready");
        newRow.ContentHash.Should().NotBe(oldRow.ContentHash);
    }

    [Theory]
    [InlineData("NotARealVoice", "cmn-TW", "MP3")] // 非白名單聲音 → 400
    [InlineData("Kore", "cmn-TW", "WAV")]           // 非白名單格式 → 400
    public async Task I4_非法voice或format_回400(string voice, string language, string format)
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"tts-i4-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);
        var noteId = await _factory.SeedNoteAsync(userId, "驗證內容。");

        var response = await client.PostAsJsonAsync(
            $"/api/tts/notes/{noteId}/synthesize", new { voice, language, format });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task I4b_空language回退系統預設_不400()
    {
        // 空字串 language 視為「用預設」（與省略 voice/format 一致），回退 cmn-TW → 正常受理（202）。
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"tts-i4b-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);
        var noteId = await _factory.SeedNoteAsync(userId, "空語言回退測試。");

        var response = await client.PostAsJsonAsync(
            $"/api/tts/notes/{noteId}/synthesize", new { voice = "Kore", language = "", format = "MP3" });

        response.StatusCode.Should().Be(HttpStatusCode.Accepted);
    }

    [Fact]
    public async Task I5_筆記非本人或不存在_回404()
    {
        var (_, tokenA) = await _factory.SeedUserWithTokenAsync($"tts-i5a-{Guid.NewGuid():N}@example.com");
        var (userIdB, _) = await _factory.SeedUserWithTokenAsync($"tts-i5b-{Guid.NewGuid():N}@example.com");
        var clientA = _factory.CreateClientWithToken(tokenA);
        var noteOfB = await _factory.SeedNoteAsync(userIdB, "B 的筆記內容。");

        // A 對 B 的筆記合成 → 404。
        (await clientA.PostAsJsonAsync($"/api/tts/notes/{noteOfB}/synthesize", new { voice = "Kore" }))
            .StatusCode.Should().Be(HttpStatusCode.NotFound);

        // 不存在的筆記 → 404。
        (await clientA.PostAsJsonAsync($"/api/tts/notes/{Guid.NewGuid()}/synthesize", new { voice = "Kore" }))
            .StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task I6_未帶token_回401()
    {
        var (userId, _) = await _factory.SeedUserWithTokenAsync($"tts-i6-{Guid.NewGuid():N}@example.com");
        var noteId = await _factory.SeedNoteAsync(userId, "內容。");
        var anonymous = _factory.CreateClient();

        var response = await anonymous.PostAsJsonAsync($"/api/tts/notes/{noteId}/synthesize", new { voice = "Kore" });

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task I3b_多租戶隔離_A無法透過status看到B的音檔()
    {
        var (userIdA, tokenA) = await _factory.SeedUserWithTokenAsync($"tts-iso-a-{Guid.NewGuid():N}@example.com");
        var (_, tokenB) = await _factory.SeedUserWithTokenAsync($"tts-iso-b-{Guid.NewGuid():N}@example.com");
        var clientA = _factory.CreateClientWithToken(tokenA);
        var clientB = _factory.CreateClientWithToken(tokenB);
        var noteA = await _factory.SeedNoteAsync(userIdA, "A 的朗讀內容。");

        var aResp = await clientA.PostAsJsonAsync($"/api/tts/notes/{noteA}/synthesize", new { voice = "Kore" });
        var aId = Guid.Parse((await aResp.ReadJsonAsync())["data"]!["ttsAudioId"]!.GetValue<string>());
        (await clientA.PollStatusUntilTerminalAsync(aId)).Should().Be("ready");

        // B 查 A 的音檔 status → 404（不洩漏他人存在）。
        (await clientB.GetAsync($"/api/tts/audio/{aId}/status")).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task 陳舊processing_可被重新觸發至ready()
    {
        // 審查修正 #4：後端在合成中途重啟後，processing 列的 fire-and-forget CTS 已消失、列永遠停在 processing。
        // 之後同 ContentHash 的 synthesize 應偵測「陳舊」（UpdatedDateTime 超過合成硬預算）→ 重置重跑。
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"tts-stale-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);
        var content = "陳舊 processing 復原測試內容。";
        var noteId = await _factory.SeedNoteAsync(userId, content);

        const string voice = "Kore";
        const string language = "cmn-TW";
        const string format = "MP3";
        var hash = TtsSynthesisService.ComputeContentHash(
            content, voice, language, format, TtsScriptService.PromptVersion, TtsSynthesisService.DefaultTtsModelName);

        // 直接種一列「陳舊」的 processing 列（模擬背景死於重啟）。
        Guid staleId;
        {
            var (scope, db) = _factory.CreateDbScope();
            using (scope)
            {
                var now = DateTime.UtcNow;
                var row = new TtsAudio
                {
                    Id = Guid.NewGuid(),
                    UserId = userId,
                    NoteId = noteId,
                    ContentHash = hash,
                    ScriptJson = string.Empty,
                    Status = "processing",
                    VoiceName = voice,
                    ModelKey = TtsSynthesisService.DefaultTtsModelName,
                    FilePath = string.Empty,
                    ContentType = "audio/mpeg",
                    CreatedDateTime = now,
                    UpdatedDateTime = now,
                    CreatedUser = userId.ToString(),
                    UpdatedUser = userId.ToString(),
                    ValidFlag = true,
                };
                db.TtsAudio.Add(row);
                await db.SaveChangesAsync();
                staleId = row.Id;

                // 把 UpdatedDateTime 回溯到「超過合成硬預算」（預設 600 秒）之前（ExecuteUpdate 繞過稽核攔截器）。
                var staleTime = DateTime.UtcNow.AddSeconds(-(TtsSynthesisService.DefaultSynthesisBudgetSeconds + 120));
                await db.TtsAudio.IgnoreQueryFilters()
                    .Where(t => t.Id == staleId)
                    .ExecuteUpdateAsync(setters => setters.SetProperty(t => t.UpdatedDateTime, staleTime));
            }
        }

        // 同筆記同聲音 synthesize → 應偵測陳舊、重置重跑（回 202 同 id），最終 ready。
        var response = await client.PostAsJsonAsync(
            $"/api/tts/notes/{noteId}/synthesize", new { voice, language, format });
        response.StatusCode.Should().Be(HttpStatusCode.Accepted);
        var reId = Guid.Parse((await response.ReadJsonAsync())["data"]!["ttsAudioId"]!.GetValue<string>());
        reId.Should().Be(staleId, "陳舊 processing 列應被重用（同 ContentHash）");

        (await client.PollStatusUntilTerminalAsync(reId)).Should().Be("ready", "陳舊 processing 應可被重新觸發至 ready");
    }

    [Fact]
    public async Task 章節端到端_status回章節含startSeconds()
    {
        // 用腳本化 AI 供應者回「含 heading 的 segments」→ 走真管線 → 驗證 status 章節欄名 startSeconds（契約 #2）。
        // 使用者/筆記/模型列種在共用容器 DB（base factory），HTTP 呼叫走腳本化主機（共用同一 DB）。
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"tts-chap-{Guid.NewGuid():N}@example.com");
        await SeedUserClaudeModelAsync(userId, TtsScriptService.DefaultScriptModelKey);
        var client = ScriptedFactory().CreateClient();
        client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        var noteId = await _factory.SeedNoteAsync(userId, "章節測試筆記內容（實際內容由腳本供應者決定 segments）。");

        var response = await client.PostAsJsonAsync($"/api/tts/notes/{noteId}/synthesize", new { voice = "Kore" });
        response.StatusCode.Should().Be(HttpStatusCode.Accepted);
        var ttsAudioId = Guid.Parse((await response.ReadJsonAsync())["data"]!["ttsAudioId"]!.GetValue<string>());
        (await client.PollStatusUntilTerminalAsync(ttsAudioId)).Should().Be("ready");

        var statusJson = await (await client.GetAsync($"/api/tts/audio/{ttsAudioId}/status")).ReadJsonAsync();
        var chapters = statusJson["data"]!["chapters"]!.AsArray();
        chapters.Should().HaveCount(2);
        chapters[0]!["title"]!.GetValue<string>().Should().Be("第一節");
        chapters[0]!["startSeconds"]!.GetValue<double>().Should().Be(0.0);
        chapters[1]!["title"]!.GetValue<string>().Should().Be("第二節");
        // 每章 1 塊、Fake 每塊 1 秒 → 第二節 startSeconds = 1。
        chapters[1]!["startSeconds"]!.GetValue<double>().Should().Be(1.0);
    }

    [Fact]
    public async Task 同列兩個近同時重跑POST_只啟一條背景工作_皆非500最終ready()
    {
        // 審查修正 #1：failed／陳舊 processing／軟刪列的「重用重跑」路徑改條件式原子轉換。
        // 兩個近同時的重跑 POST（連點「重新朗讀」）應只有一個贏得轉換啟背景工作，另一個合流回 202；
        // 皆非 500，且不會兩條管線寫同一 row／同一檔造成損毀（最終 ready、只有一列有效）。
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"tts-race-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);
        const string content = "並發重跑測試內容。";
        var noteId = await _factory.SeedNoteAsync(userId, content);

        const string voice = "Kore";
        const string language = "cmn-TW";
        const string format = "MP3";
        var hash = TtsSynthesisService.ComputeContentHash(
            content, voice, language, format, TtsScriptService.PromptVersion, TtsSynthesisService.DefaultTtsModelName);

        // 種一列 failed（同 ContentHash），模擬「首次合成失敗後使用者連點重新朗讀」。
        Guid failedId;
        {
            var (scope, db) = _factory.CreateDbScope();
            using (scope)
            {
                var now = DateTime.UtcNow;
                var row = new TtsAudio
                {
                    Id = Guid.NewGuid(),
                    UserId = userId,
                    NoteId = noteId,
                    ContentHash = hash,
                    ScriptJson = string.Empty,
                    Status = "failed",
                    ErrorText = "先前失敗",
                    VoiceName = voice,
                    ModelKey = TtsSynthesisService.DefaultTtsModelName,
                    FilePath = string.Empty,
                    ContentType = "audio/mpeg",
                    CreatedDateTime = now,
                    UpdatedDateTime = now,
                    CreatedUser = userId.ToString(),
                    UpdatedUser = userId.ToString(),
                    ValidFlag = true,
                };
                db.TtsAudio.Add(row);
                await db.SaveChangesAsync();
                failedId = row.Id;
            }
        }

        // 兩個近同時重跑 POST（HttpClient 併發送出安全）。
        var url = $"/api/tts/notes/{noteId}/synthesize";
        var body = new { voice, language, format };
        var responses = await Task.WhenAll(
            client.PostAsJsonAsync(url, body),
            client.PostAsJsonAsync(url, body));

        // 皆非 500（202 或 200）＋皆回同一既有列 id（重用同 hash 列）。
        foreach (var response in responses)
        {
            response.StatusCode.Should().BeOneOf(HttpStatusCode.Accepted, HttpStatusCode.OK);
            var json = await response.ReadJsonAsync();
            Guid.Parse(json["data"]!["ttsAudioId"]!.GetValue<string>()).Should().Be(failedId);
        }

        // 最終 ready（若兩條管線都跑同一檔會撞 FileShare.None／末寫者覆寫，故 ready 即證明只跑一條）。
        (await client.PollStatusUntilTerminalAsync(failedId)).Should().Be("ready");

        // 只有一列有效（未被重複建列）。
        var (countScope, countDb) = _factory.CreateDbScope();
        using (countScope)
        {
            var validCount = await countDb.TtsAudio.IgnoreQueryFilters()
                .CountAsync(t => t.UserId == userId && t.NoteId == noteId && t.ValidFlag);
            validCount.Should().Be(1);
        }
    }

    [Fact]
    public async Task 超大筆記_回400不啟合成()
    {
        // 審查修正 #3-①：ContentRaw 超過位元組門檻（預設 64 KB）→ 400，避免 fan-out 成不設上限的付費 TTS。
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"tts-big-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);
        // 7 萬個中文字 × 3 bytes ≈ 210 KB，遠超 64 KB 門檻。
        var hugeContent = new string('字', 70000);
        var noteId = await _factory.SeedNoteAsync(userId, hugeContent);

        var response = await client.PostAsJsonAsync(
            $"/api/tts/notes/{noteId}/synthesize", new { voice = "Kore" });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        // 未建任何 TtsAudio 列。
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            (await db.TtsAudio.IgnoreQueryFilters().CountAsync(t => t.NoteId == noteId)).Should().Be(0);
        }
    }

    [Fact]
    public async Task 同使用者並行processing超過上限_回429()
    {
        // 審查修正 #3-③：單一使用者同時 processing 列數達上限（預設 3）→ 新合成回 429。
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"tts-conc-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);

        // 種 3 列 processing（達預設上限 Tts:MaxConcurrentProcessingPerUser=3）。
        {
            var (scope, db) = _factory.CreateDbScope();
            using (scope)
            {
                var now = DateTime.UtcNow;
                for (var i = 0; i < 3; i++)
                {
                    db.TtsAudio.Add(new TtsAudio
                    {
                        Id = Guid.NewGuid(),
                        UserId = userId,
                        NoteId = null,
                        ContentHash = "conc-" + Guid.NewGuid().ToString("N"),
                        ScriptJson = string.Empty,
                        Status = "processing",
                        VoiceName = "Kore",
                        ModelKey = TtsSynthesisService.DefaultTtsModelName,
                        FilePath = string.Empty,
                        ContentType = "audio/mpeg",
                        CreatedDateTime = now,
                        UpdatedDateTime = now,
                        CreatedUser = userId.ToString(),
                        UpdatedUser = userId.ToString(),
                        ValidFlag = true,
                    });
                }

                await db.SaveChangesAsync();
            }
        }

        var noteId = await _factory.SeedNoteAsync(userId, "並發上限測試內容。");
        var response = await client.PostAsJsonAsync(
            $"/api/tts/notes/{noteId}/synthesize", new { voice = "Kore" });

        response.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
    }

    [Fact]
    public async Task 非白名單language_回400()
    {
        // 審查修正 #4：language 非白名單（如 fr-FR）→ 400（防每改 language 就鑄造相異 ContentHash 繞過去重）。
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"tts-lang-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);
        var noteId = await _factory.SeedNoteAsync(userId, "語言白名單測試內容。");

        var response = await client.PostAsJsonAsync(
            $"/api/tts/notes/{noteId}/synthesize", new { voice = "Kore", language = "fr-FR", format = "MP3" });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task ready命中但實體檔遺失_自我修復重跑至ready()
    {
        // 審查修正 #6：ready 命中時實體檔已被清 → 不回「就緒卻播不出」，而是重置 processing 重跑（快取自我修復）。
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"tts-heal-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);
        var noteId = await _factory.SeedNoteAsync(userId, "快取自我修復測試內容。");

        var first = await client.PostAsJsonAsync($"/api/tts/notes/{noteId}/synthesize", new { voice = "Kore" });
        var firstId = Guid.Parse((await first.ReadJsonAsync())["data"]!["ttsAudioId"]!.GetValue<string>());
        (await client.PollStatusUntilTerminalAsync(firstId)).Should().Be("ready");

        // 模擬快取檔被磁碟清理／外部移除（刪的是暫存目錄下可再生的測試快取檔）。
        var row = await _factory.GetTtsAudioAsync(firstId);
        var absolutePath = AbsolutePath(_factory, row!.FilePath);
        File.Exists(absolutePath).Should().BeTrue();
        File.Delete(absolutePath);
        File.Exists(absolutePath).Should().BeFalse();

        // 再次 POST → 偵測檔案遺失 → 重跑（202 processing，非 200 ready），同 id。
        var second = await client.PostAsJsonAsync($"/api/tts/notes/{noteId}/synthesize", new { voice = "Kore" });
        second.StatusCode.Should().Be(HttpStatusCode.Accepted, "檔案遺失時 ready 命中應改走重跑，而非回 200 ready");
        var secondId = Guid.Parse((await second.ReadJsonAsync())["data"]!["ttsAudioId"]!.GetValue<string>());
        secondId.Should().Be(firstId, "應重用同一列自我修復");

        (await client.PollStatusUntilTerminalAsync(secondId)).Should().Be("ready");
        var healed = await _factory.GetTtsAudioAsync(secondId);
        File.Exists(AbsolutePath(_factory, healed!.FilePath)).Should().BeTrue("重跑後實體檔應重生");
    }

    [Fact]
    public async Task 含路徑的IO例外_status錯誤欄為泛用訊息不含路徑分隔字元()
    {
        // 審查修正 #2：非 TtsSynthesisException 的 IO 例外（Message 含伺服器絕對路徑）不得外流；
        // status 的 Error 欄應為固定泛用訊息、不含路徑分隔字元／App_Data／磁碟代號。
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"tts-leak-{Guid.NewGuid():N}@example.com");
        var client = ThrowingTtsFactory().CreateClient();
        client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        var noteId = await _factory.SeedNoteAsync(userId, "路徑洩漏防護測試內容。");

        var response = await client.PostAsJsonAsync($"/api/tts/notes/{noteId}/synthesize", new { voice = "Kore" });
        response.StatusCode.Should().Be(HttpStatusCode.Accepted);
        var id = Guid.Parse((await response.ReadJsonAsync())["data"]!["ttsAudioId"]!.GetValue<string>());
        (await client.PollStatusUntilTerminalAsync(id)).Should().Be("failed");

        var statusJson = await (await client.GetAsync($"/api/tts/audio/{id}/status")).ReadJsonAsync();
        var error = statusJson["data"]!["error"]!.GetValue<string>();
        error.Should().Be(TtsSynthesisService.GenericFailureMessage);
        error.Should().NotContain("\\").And.NotContain("/")
            .And.NotContain("App_Data").And.NotContain("C:");
    }

    // ── 腳本化供應者主機（章節測試用；回固定含 heading 的 segments）─────────────

    private WebApplicationFactory<Program> ScriptedFactory() => _scriptedHostCache ??= _factory.WithWebHostBuilder(builder =>
    {
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IAiProvider>();
            services.AddSingleton<IAiProvider>(new FixedSegmentsAiProvider());
        });
    });

    private WebApplicationFactory<Program>? _scriptedHostCache;

    /// <summary>為使用者種一筆本人 ClaudeCli 列，讓口語稿模型解析確定回退到腳本供應者（測試隔離）。</summary>
    private async Task SeedUserClaudeModelAsync(Guid userId, string key)
    {
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            db.AiModel.Add(new AiModel
            {
                UserId = userId,
                Key = key,
                Label = "test-claude",
                Provider = "ClaudeCli",
                Kind = "chat",
                Enabled = true,
                ModelId = "sonnet",
                CreatedUser = "test",
                UpdatedUser = "test",
            });
            await db.SaveChangesAsync();
        }
    }

    /// <summary>回固定含兩個 heading 的 segments JSON（非-Fake，讓工廠不短路、經本人 ClaudeCli 列回退到此供應者）。</summary>
    private sealed class FixedSegmentsAiProvider : IAiProvider
    {
        private const string Json =
            "{\"segments\":[{\"kind\":\"heading\",\"text\":\"第一節\"},{\"kind\":\"speech\",\"text\":\"第一段內容\"}," +
            "{\"kind\":\"heading\",\"text\":\"第二節\"},{\"kind\":\"speech\",\"text\":\"第二段內容\"}]}";

        public async IAsyncEnumerable<AiStreamEvent> StreamAsync(
            string prompt, string? resumeSessionId = null, string? model = null, string? systemPrompt = null,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            await Task.CompletedTask;
            yield return new AiStreamEvent(AiStreamEventType.Delta, Json);
            yield return new AiStreamEvent(AiStreamEventType.Completed, Json);
        }
    }

    // ── 路徑洩漏防護主機（審查修正 #2；TTS 服務擲含絕對路徑的 IO 例外）─────────────

    /// <summary>共用同一 DB、但把 TTS 服務換成「擲含伺服器絕對路徑之 IO 例外」的測試主機。</summary>
    private WebApplicationFactory<Program> ThrowingTtsFactory() => _throwingTtsHostCache ??= _factory.WithWebHostBuilder(builder =>
    {
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<ITextToSpeechService>();
            services.AddScoped<ITextToSpeechService, PathLeakingThrowingTtsService>();
        });
    });

    private WebApplicationFactory<Program>? _throwingTtsHostCache;

    /// <summary>模擬「寫暫存塊檔時磁碟／權限錯誤」：擲一個 Message 含伺服器絕對路徑的 IOException。</summary>
    private sealed class PathLeakingThrowingTtsService : ITextToSpeechService
    {
        public Task<byte[]> SynthesizeAsync(
            string text,
            string voiceName,
            string languageCode,
            string modelName,
            string audioEncoding,
            CancellationToken cancellationToken)
            => throw new IOException(@"存取被拒：C:\Repos\ZonWiki\App_Data\tts-cache\seg-0.mp3");
    }
}
