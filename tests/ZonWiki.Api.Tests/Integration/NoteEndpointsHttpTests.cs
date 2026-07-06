using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace ZonWiki.Api.Tests.Integration;

/// <summary>
/// 筆記端點的「真 HTTP」整合測試（審查 #41）：示範以 WebApplicationFactory 對
/// 建立/更新筆記端點做真實 HTTP 呼叫，驗證 HTTP 狀態碼、回傳 DTO 與資料庫落地。
/// </summary>
[Collection(ApiIntegrationCollection.Name)]
public sealed class NoteEndpointsHttpTests
{
    private readonly ZonWikiApiFactory _factory;

    /// <summary>
    /// 注入共用的整合測試基座。
    /// </summary>
    /// <param name="factory">整合測試基座。</param>
    public NoteEndpointsHttpTests(ZonWikiApiFactory factory)
    {
        _factory = factory;
    }

    /// <summary>
    /// 建立筆記（POST /api/notes）：斷言 201 Created、回傳 DTO 欄位、Markdown 已渲染成 HTML、且資料庫落地。
    /// </summary>
    [Fact]
    public async Task CreateNote_ViaHttp_ReturnsCreatedAndPersists()
    {
        // Arrange。
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"note-create-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);

        // Act：建立一則含 Markdown 標題的筆記。
        var response = await client.PostAsJsonAsync("/api/notes",
            new { title = "整合測試筆記", contentRaw = "# 標題\n\n內文一段。" });

        // Assert：201 Created、DTO 正確、HTML 已渲染。
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var data = (await response.ReadJsonAsync())["data"]!;
        data["title"]!.GetValue<string>().Should().Be("整合測試筆記");
        data["slug"]!.GetValue<string>().Should().NotBeNullOrWhiteSpace();
        data["contentHtml"]!.GetValue<string>().Should().Contain("<h1");
        var noteId = Guid.Parse(data["id"]!.GetValue<string>());

        // Assert：資料庫實際落地（屬於該使用者）。
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            var saved = await db.Note.IgnoreQueryFilters().AsNoTracking()
                .FirstOrDefaultAsync(n => n.Id == noteId);
            saved.Should().NotBeNull();
            saved!.UserId.Should().Be(userId);
            saved.Title.Should().Be("整合測試筆記");
            saved.ValidFlag.Should().BeTrue();
        }
    }

    /// <summary>
    /// 更新筆記（PUT /api/notes/{id}）：斷言 200、DTO 標題更新、資料庫落地為新標題。
    /// </summary>
    [Fact]
    public async Task UpdateNote_ViaHttp_UpdatesTitleAndPersists()
    {
        // Arrange：先建立一則筆記。
        var (_, token) = await _factory.SeedUserWithTokenAsync($"note-update-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);
        var createResponse = await client.PostAsJsonAsync("/api/notes",
            new { title = "更新前標題", contentRaw = "內容" });
        var noteId = Guid.Parse((await createResponse.ReadJsonAsync())["data"]!["id"]!.GetValue<string>());

        // Act：更新標題。
        var updateResponse = await client.PutAsJsonAsync($"/api/notes/{noteId}",
            new { title = "更新後標題" });

        // Assert：200、DTO 標題已更新。
        updateResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        (await updateResponse.ReadJsonAsync())["data"]!["title"]!.GetValue<string>()
            .Should().Be("更新後標題");

        // Assert：資料庫落地。
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            var saved = await db.Note.IgnoreQueryFilters().AsNoTracking()
                .FirstOrDefaultAsync(n => n.Id == noteId);
            saved!.Title.Should().Be("更新後標題");
        }
    }

    /// <summary>
    /// 負面（400）：更新筆記時把標題清成純空白 → 端點以 400 拒絕（筆記必須有標題）。
    /// </summary>
    [Fact]
    public async Task UpdateNote_BlankTitle_ReturnsBadRequest()
    {
        // Arrange。
        var (_, token) = await _factory.SeedUserWithTokenAsync($"note-blank-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);
        var createResponse = await client.PostAsJsonAsync("/api/notes",
            new { title = "有效標題", contentRaw = "內容" });
        var noteId = Guid.Parse((await createResponse.ReadJsonAsync())["data"]!["id"]!.GetValue<string>());

        // Act：把標題改成純空白。
        var response = await client.PutAsJsonAsync($"/api/notes/{noteId}", new { title = "   " });

        // Assert：400 Bad Request。
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    /// <summary>
    /// 負面（401）：未帶任何憑證建立筆記 → 401 Unauthorized（受全域 FallbackPolicy 保護）。
    /// </summary>
    [Fact]
    public async Task CreateNote_Unauthenticated_ReturnsUnauthorized()
    {
        var client = _factory.CreateClient();

        var response = await client.PostAsJsonAsync("/api/notes",
            new { title = "匿名不可建立", contentRaw = "x" });

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }
}
