using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Tests.Integration;

/// <summary>
/// TTS 整合測試共用工具：直接種筆記、輪詢合成狀態、讀 TtsAudio 列。
/// </summary>
public static class TtsTestHelpers
{
    /// <summary>直接於 DB 種一篇本人有效筆記，回筆記 Id（不經 HTTP，聚焦測 TTS 流程）。</summary>
    public static async Task<Guid> SeedNoteAsync(
        this ZonWikiApiFactory factory,
        Guid userId,
        string contentRaw,
        string title = "TTS 測試筆記")
    {
        var (scope, db) = factory.CreateDbScope();
        using (scope)
        {
            var now = DateTime.UtcNow;
            var note = new Note
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                Title = title,
                Slug = "tts-" + Guid.NewGuid().ToString("N"),
                ContentRaw = contentRaw,
                ContentHtml = string.Empty,
                ContentHash = string.Empty,
                Kind = "note",
                CreatedDateTime = now,
                UpdatedDateTime = now,
                CreatedUser = "test",
                UpdatedUser = "test",
                ValidFlag = true,
            };
            db.Note.Add(note);
            await db.SaveChangesAsync();
            return note.Id;
        }
    }

    /// <summary>更新一篇筆記的內容（供「內容變更後重合成」測試）。</summary>
    public static async Task UpdateNoteContentAsync(
        this ZonWikiApiFactory factory,
        Guid noteId,
        string newContentRaw)
    {
        var (scope, db) = factory.CreateDbScope();
        using (scope)
        {
            var note = await db.Note.IgnoreQueryFilters().FirstAsync(n => n.Id == noteId);
            note.ContentRaw = newContentRaw;
            await db.SaveChangesAsync();
        }
    }

    /// <summary>讀一列 TtsAudio（略過全域過濾），供驗證 DTO 未暴露的欄位。</summary>
    public static async Task<TtsAudio?> GetTtsAudioAsync(this ZonWikiApiFactory factory, Guid id)
    {
        var (scope, db) = factory.CreateDbScope();
        using (scope)
        {
            return await db.TtsAudio.IgnoreQueryFilters().AsNoTracking().FirstOrDefaultAsync(t => t.Id == id);
        }
    }

    /// <summary>
    /// 輪詢 GET /status 直到 ready／failed 或逾時；回最後一次的 status 字串。
    /// </summary>
    public static async Task<string> PollStatusUntilTerminalAsync(
        this HttpClient client,
        Guid ttsAudioId,
        int timeoutMs = 20000,
        int intervalMs = 150)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        var status = "processing";
        while (DateTime.UtcNow < deadline)
        {
            var response = await client.GetAsync($"/api/tts/audio/{ttsAudioId}/status");
            if (response.IsSuccessStatusCode)
            {
                var json = await response.Content.ReadFromJsonAsync<JsonNode>();
                status = json?["data"]?["status"]?.GetValue<string>() ?? status;
                if (status is "ready" or "failed")
                {
                    return status;
                }
            }

            await Task.Delay(intervalMs);
        }

        return status;
    }
}
