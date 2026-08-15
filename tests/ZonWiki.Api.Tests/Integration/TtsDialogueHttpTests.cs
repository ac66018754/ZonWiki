using System.Net;
using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Xunit;
using ZonWiki.Api.Services;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Ai;

namespace ZonWiki.Api.Tests.Integration;

/// <summary>
/// 雙主持人 Podcast（dialogue 模式）合成管線整合測試（Phase 3；真 HTTP＋Testcontainers＋Fake 多講者 TTS）：
/// dialogue 模式端到端至 ready＋Mode 落庫、read 與 dialogue 各自獨立快取並存、非法 mode 回 400、
/// 腳本化多回合對談經多講者合成至 ready。
/// </summary>
[Collection(ApiIntegrationCollection.Name)]
public sealed class TtsDialogueHttpTests
{
    private readonly ZonWikiApiFactory _factory;

    public TtsDialogueHttpTests(ZonWikiApiFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task dialogue模式_合成至ready且Mode落庫為dialogue()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"tts-dlg-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);
        var noteId = await _factory.SeedNoteAsync(userId, "這是一篇要做成雙人 Podcast 的測試筆記。");

        var response = await client.PostAsJsonAsync(
            $"/api/tts/notes/{noteId}/synthesize", new { voice = "Kore", mode = "dialogue" });

        response.StatusCode.Should().Be(HttpStatusCode.Accepted);
        var ttsAudioId = Guid.Parse((await response.ReadJsonAsync())["data"]!["ttsAudioId"]!.GetValue<string>());

        (await client.PollStatusUntilTerminalAsync(ttsAudioId)).Should().Be("ready");

        var row = await _factory.GetTtsAudioAsync(ttsAudioId);
        row.Should().NotBeNull();
        row!.Mode.Should().Be("dialogue");
        row.Status.Should().Be("ready");
        row.SizeBytes.Should().BeGreaterThan(0);
        row.ScriptJson.Should().NotBeNullOrEmpty();
    }

    [Fact]
    public async Task read與dialogue_各自獨立快取並存()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"tts-coex-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);
        var noteId = await _factory.SeedNoteAsync(userId, "同一篇筆記，兩種模式應各自快取並存。");

        var readResp = await client.PostAsJsonAsync(
            $"/api/tts/notes/{noteId}/synthesize", new { voice = "Kore", mode = "read" });
        var readId = Guid.Parse((await readResp.ReadJsonAsync())["data"]!["ttsAudioId"]!.GetValue<string>());
        (await client.PollStatusUntilTerminalAsync(readId)).Should().Be("ready");

        var dlgResp = await client.PostAsJsonAsync(
            $"/api/tts/notes/{noteId}/synthesize", new { voice = "Kore", mode = "dialogue" });
        var dlgId = Guid.Parse((await dlgResp.ReadJsonAsync())["data"]!["ttsAudioId"]!.GetValue<string>());
        dlgId.Should().NotBe(readId, "不同模式應是不同列（不撞快取）");
        (await client.PollStatusUntilTerminalAsync(dlgId)).Should().Be("ready");

        // 兩列皆有效並存（dialogue 合成未失效 read 快取）。
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            var rows = await db.TtsAudio.IgnoreQueryFilters()
                .Where(t => t.UserId == userId && t.NoteId == noteId && t.ValidFlag)
                .ToListAsync();
            rows.Should().HaveCount(2);
            rows.Select(r => r.Mode).Should().BeEquivalentTo(new[] { "read", "dialogue" });
        }
    }

    [Fact]
    public async Task 非法mode_回400()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"tts-badmode-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);
        var noteId = await _factory.SeedNoteAsync(userId, "非法模式測試。");

        var response = await client.PostAsJsonAsync(
            $"/api/tts/notes/{noteId}/synthesize", new { voice = "Kore", mode = "sing" });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task 腳本化多回合對談_經多講者合成至ready()
    {
        // 用腳本化 AI 供應者回「含 A/B 兩回合的 turns JSON」→ 走真 dialogue 管線（多講者 Fake TTS）→ ready。
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"tts-dlg2-{Guid.NewGuid():N}@example.com");
        await SeedUserClaudeModelAsync(userId, TtsScriptService.DefaultScriptModelKey);
        var client = ScriptedFactory().CreateClient();
        client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        var noteId = await _factory.SeedNoteAsync(userId, "多回合對談測試筆記（turns 由腳本供應者決定）。");

        var response = await client.PostAsJsonAsync(
            $"/api/tts/notes/{noteId}/synthesize", new { voice = "Kore", mode = "dialogue" });
        response.StatusCode.Should().Be(HttpStatusCode.Accepted);
        var ttsAudioId = Guid.Parse((await response.ReadJsonAsync())["data"]!["ttsAudioId"]!.GetValue<string>());
        (await client.PollStatusUntilTerminalAsync(ttsAudioId)).Should().Be("ready");

        var row = await _factory.GetTtsAudioAsync(ttsAudioId);
        row!.Mode.Should().Be("dialogue");
        // ScriptJson 應含腳本兩回合（反序列化比對；JsonSerializer 預設會把 CJK 逸出成 \uXXXX，故不直接子字串比對）。
        var turns = System.Text.Json.JsonSerializer.Deserialize<List<ZonWiki.Domain.Tts.TtsDialogueTurn>>(row.ScriptJson);
        turns.Should().NotBeNull();
        turns!.Should().HaveCount(2);
        turns[0].Text.Should().Be("歡迎回到節目");
        turns[1].Text.Should().Be("我先整理三個重點");
    }

    // ── 腳本化供應者主機（回固定 turns JSON）─────────────────────────────────────

    private WebApplicationFactory<Program> ScriptedFactory() => _scriptedHostCache ??= _factory.WithWebHostBuilder(builder =>
    {
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IAiProvider>();
            services.AddSingleton<IAiProvider>(new FixedTurnsAiProvider());
        });
    });

    private WebApplicationFactory<Program>? _scriptedHostCache;

    /// <summary>為使用者種一筆本人 ClaudeCli 列，讓對談模型解析確定回退到腳本供應者（測試隔離）。</summary>
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

    /// <summary>回固定含 A/B 兩回合的 turns JSON（非-Fake，讓工廠不短路、經本人 ClaudeCli 列回退到此供應者）。</summary>
    private sealed class FixedTurnsAiProvider : IAiProvider
    {
        private const string Json =
            "{\"turns\":[{\"speaker\":\"A\",\"text\":\"歡迎回到節目\"},{\"speaker\":\"B\",\"text\":\"我先整理三個重點\"}]}";

        public async IAsyncEnumerable<AiStreamEvent> StreamAsync(
            string prompt, string? resumeSessionId = null, string? model = null, string? systemPrompt = null,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            await Task.CompletedTask;
            yield return new AiStreamEvent(AiStreamEventType.Delta, Json);
            yield return new AiStreamEvent(AiStreamEventType.Completed, Json);
        }
    }
}
