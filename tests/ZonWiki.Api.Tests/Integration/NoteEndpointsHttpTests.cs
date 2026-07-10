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

    // ==================== 「開啟即假衝突」回歸（樂觀鎖 xmin 與 LastOpened 交互作用） ====================
    //
    // 背景（實測根因）：標記「最後打開時間」（POST /api/notes/{id}/opened）會直接 UPDATE 筆記那一列的
    // Note_LastOpenedDateTime。PostgreSQL 的 xmin（樂觀鎖權杖，#4/#34）是「整列」的系統欄——只要該列被
    // UPDATE，xmin 一定改變，無法只更新某欄而不動它。因此「載入筆記 → 前端手上記著載入時的 Version」之後，
    // 標記打開就會讓資料庫的 xmin 前進，前端手上的 Version 立刻過期；使用者接著存檔（帶著過期 Version 當
    // baseVersion）便撲空，收到假的 409「此筆記已被其他來源修改」——即使全程只有本人、也沒真的改過別處。
    //
    // 修法：POST /opened 於更新後回傳「更新後的最新 Version」，前端據此把手上的 baseVersion 同步成最新，
    // 存檔即不再假衝突。以下兩則測試分別鎖住「修法契約」與「根因機制（不可回歸）」。

    /// <summary>
    /// 回歸（修法契約）：標記筆記打開（POST /opened）必須回傳「更新後的最新 Version」，
    /// 且該 Version 與載入時的 Version 不同（證明打開確實推進了 xmin）；再以此最新 Version 當
    /// baseVersion 更新 → 200（不假衝突）。這正是前端同步 baseVersion、消除「開啟即假衝突」所依賴的契約。
    /// </summary>
    [Fact]
    public async Task MarkOpened_ReturnsFreshVersion_MakingSubsequentUpdateConflictFree()
    {
        // Arrange：建立一則筆記並取得其 id 與 slug。
        var (_, token) = await _factory.SeedUserWithTokenAsync($"note-opened-fresh-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);
        var created = (await (await client.PostAsJsonAsync("/api/notes",
            new { title = "開啟即假衝突回歸", contentRaw = "內容" })).ReadJsonAsync())["data"]!;
        var noteId = Guid.Parse(created["id"]!.GetValue<string>());
        var slug = created["slug"]!.GetValue<string>();

        // 載入筆記詳情，記下當下的 Version（前端就是在此刻把 Version 記進 note.version）。
        var loadedVersion = (await (await client.GetAsync($"/api/notes/{slug}")).ReadJsonAsync())
            ["data"]!["version"]!.GetValue<long>();
        loadedVersion.Should().BeGreaterThan(0L, "載入時應回傳非 0 的 xmin 版本");

        // Act：標記筆記打開——這會 UPDATE 該列（推進 xmin），並應回傳更新後的最新 Version。
        var openedResponse = await client.PostAsync($"/api/notes/{noteId}/opened", content: null);
        openedResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var openedVersion = (await openedResponse.ReadJsonAsync())["data"]!["version"]!.GetValue<long>();

        // Assert：打開確實推進了 xmin（載入時的 Version 已過期）。
        openedVersion.Should().NotBe(loadedVersion,
            "標記打開會 UPDATE 該列，xmin 必然改變——這正是『開啟即假衝突』的根因");

        // Assert（修法核心）：以「打開後回傳的最新 Version」當 baseVersion 更新 → 200，不假衝突。
        var updateResponse = await client.PutAsJsonAsync($"/api/notes/{noteId}",
            new { title = "存檔（帶最新 baseVersion）", baseVersion = openedVersion });
        updateResponse.StatusCode.Should().Be(HttpStatusCode.OK,
            "帶著『打開後的最新版本』存檔，不應再收到假的 409");
    }

    /// <summary>
    /// 回歸（根因機制，不可回歸）：以「打開之前」的 Version 當 baseVersion 更新 → 409。
    /// 這鎖住兩件事：(1) 標記打開確實會使既有 Version 過期（xmin 推進）；(2) 樂觀鎖併發檢查仍正常運作
    /// （修法只是讓前端改帶最新版本，並未關閉併發保護）。
    /// </summary>
    [Fact]
    public async Task MarkOpened_ThenUpdateWithPreOpenVersion_Returns409()
    {
        // Arrange：建立筆記、載入取得「打開前」的 Version。
        var (_, token) = await _factory.SeedUserWithTokenAsync($"note-opened-stale-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);
        var created = (await (await client.PostAsJsonAsync("/api/notes",
            new { title = "併發保護仍生效", contentRaw = "內容" })).ReadJsonAsync())["data"]!;
        var noteId = Guid.Parse(created["id"]!.GetValue<string>());
        var slug = created["slug"]!.GetValue<string>();
        var preOpenVersion = (await (await client.GetAsync($"/api/notes/{slug}")).ReadJsonAsync())
            ["data"]!["version"]!.GetValue<long>();

        // Act：先標記打開（推進 xmin，使 preOpenVersion 過期），再以「打開前」的版本存檔。
        (await client.PostAsync($"/api/notes/{noteId}/opened", content: null))
            .StatusCode.Should().Be(HttpStatusCode.OK);
        var updateResponse = await client.PutAsJsonAsync($"/api/notes/{noteId}",
            new { title = "帶過期版本存檔", baseVersion = preOpenVersion });

        // Assert：帶過期版本 → 409（併發保護仍生效）。
        updateResponse.StatusCode.Should().Be(HttpStatusCode.Conflict);
    }
}
