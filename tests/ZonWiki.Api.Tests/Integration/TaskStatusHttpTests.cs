using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using Xunit;

namespace ZonWiki.Api.Tests.Integration;

/// <summary>
/// 任務狀態流轉的「真 HTTP」整合測試（審查 #41 / #42）。
///
/// 背景（修同義反覆）：原本 <c>TaskEndpointsTests.UpdateTaskStatus_TransitionsCorrectly</c> 只是
/// 「把實體的 Status 設成 X、再讀出來斷言等於 X」——這是同義反覆（tautology），不觸及任何端點邏輯，
/// 就算把 PUT 端點整段刪掉也照樣綠燈。此處改以「真實 PUT /api/tasks/{id}」呼叫，
/// 驗證端點實際的狀態流轉與 CompletedDateTime 副作用、以及跨使用者拒絕與不存在資源等負面案例。
/// </summary>
[Collection(ApiIntegrationCollection.Name)]
public sealed class TaskStatusHttpTests
{
    private readonly ZonWikiApiFactory _factory;

    /// <summary>
    /// 注入共用的整合測試基座（同集合共用同一顆容器與 API 主機）。
    /// </summary>
    /// <param name="factory">整合測試基座。</param>
    public TaskStatusHttpTests(ZonWikiApiFactory factory)
    {
        _factory = factory;
    }

    /// <summary>
    /// 正向流轉（todo → doing → done）：每一步都真的打端點，
    /// 斷言 HTTP 200、回傳 DTO 的 status 正確、且「進入 done 才記 CompletedDateTime」。
    /// </summary>
    [Fact]
    public async Task UpdateTaskStatus_TodoToDoingToDone_PersistsAndSetsCompletedDateTimeOnlyOnDone()
    {
        // Arrange：建立一位使用者與其 PAT，建立一張 todo 卡片。
        var (_, token) = await _factory.SeedUserWithTokenAsync($"task-flow-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);
        var taskId = await client.CreateTaskAsync("狀態流轉測試", status: "todo");

        // 初始 todo：CompletedDateTime 應為 null。
        (await _factory.GetTaskCardFromDbAsync(taskId))!.CompletedDateTime.Should().BeNull();

        // Act 1：todo → doing。
        var toDoing = await client.PutAsJsonAsync($"/api/tasks/{taskId}", new { status = "doing" });

        // Assert 1：200、DTO 狀態為 doing、CompletedDateTime 仍為 null（doing 非完成態）。
        toDoing.StatusCode.Should().Be(HttpStatusCode.OK);
        (await toDoing.ReadJsonAsync())["data"]!["status"]!.GetValue<string>().Should().Be("doing");
        (await _factory.GetTaskCardFromDbAsync(taskId))!.CompletedDateTime.Should().BeNull();

        // Act 2：doing → done。
        var toDone = await client.PutAsJsonAsync($"/api/tasks/{taskId}", new { status = "done" });

        // Assert 2：200、DTO 狀態為 done、CompletedDateTime 已被記錄。
        toDone.StatusCode.Should().Be(HttpStatusCode.OK);
        (await toDone.ReadJsonAsync())["data"]!["status"]!.GetValue<string>().Should().Be("done");
        (await _factory.GetTaskCardFromDbAsync(taskId))!.CompletedDateTime.Should().NotBeNull();
    }

    /// <summary>
    /// 反向流轉（done → 非 done）：斷言離開 done 後 CompletedDateTime 被清空（審查 #42 明確要求）。
    /// </summary>
    [Fact]
    public async Task UpdateTaskStatus_DoneToTodo_ClearsCompletedDateTime()
    {
        // Arrange：建立一張「一開始就是 done」的卡片（建立端點會即時記 CompletedDateTime）。
        var (_, token) = await _factory.SeedUserWithTokenAsync($"task-reopen-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);
        var taskId = await client.CreateTaskAsync("完成後又重開", status: "done");
        (await _factory.GetTaskCardFromDbAsync(taskId))!.CompletedDateTime
            .Should().NotBeNull("建立時即為 done 應記錄完成時間");

        // Act：done → todo（重新打開）。
        var reopen = await client.PutAsJsonAsync($"/api/tasks/{taskId}", new { status = "todo" });

        // Assert：200、狀態回到 todo、CompletedDateTime 被清空為 null。
        reopen.StatusCode.Should().Be(HttpStatusCode.OK);
        (await reopen.ReadJsonAsync())["data"]!["status"]!.GetValue<string>().Should().Be("todo");
        (await _factory.GetTaskCardFromDbAsync(taskId))!.CompletedDateTime
            .Should().BeNull("離開 done 應清空完成時間");
    }

    /// <summary>
    /// 負面：更新請求帶「空字串狀態」時，端點以 PATCH 語意「略過」該欄位（不覆寫現有狀態）。
    /// 這鎖住實際合約：空狀態不會把卡片狀態意外清成空字串。
    /// </summary>
    [Fact]
    public async Task UpdateTaskStatus_EmptyStatus_IsIgnored_KeepsExistingStatus()
    {
        // Arrange：一張 doing 卡片。
        var (_, token) = await _factory.SeedUserWithTokenAsync($"task-empty-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);
        var taskId = await client.CreateTaskAsync("空狀態應被忽略", status: "doing");

        // Act：PUT 帶空字串 status。
        var response = await client.PutAsJsonAsync($"/api/tasks/{taskId}", new { status = "" });

        // Assert：仍為 200，但狀態維持 doing（空狀態被略過、非清空）。
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await response.ReadJsonAsync())["data"]!["status"]!.GetValue<string>().Should().Be("doing");
    }

    /// <summary>
    /// 負面（非法狀態值）：更新請求帶「未知／非法 status（例如 "bogus"）」時，端點必須回 400，
    /// 且卡片實際狀態不被寫入該非法值（審查 #42 明確要求的必達負面案例）。
    /// 此測試鎖住 allow-list 驗證：只有 todo／doing／done 可被寫入。
    /// </summary>
    [Fact]
    public async Task UpdateTaskStatus_UnknownStatus_ReturnsBadRequest_AndDoesNotPersist()
    {
        // Arrange：一張 todo 卡片。
        var (_, token) = await _factory.SeedUserWithTokenAsync($"task-bogus-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);
        var taskId = await client.CreateTaskAsync("非法狀態應被拒絕", status: "todo");

        // Act：PUT 帶未知狀態 "bogus"。
        var response = await client.PutAsJsonAsync($"/api/tasks/{taskId}", new { status = "bogus" });

        // Assert：回 400，且資料庫中的卡片狀態仍為原本的 todo（未被寫入非法值）。
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await _factory.GetTaskCardFromDbAsync(taskId))!.Status.Should().Be("todo");
    }

    /// <summary>
    /// 負面（建立時非法狀態值）：POST 建立卡片帶非法 status 時，端點必須回 400，
    /// 確保 allow-list 驗證同時涵蓋建立與更新兩條路徑（避免非法值從建立端偷渡進 DB）。
    /// </summary>
    [Fact]
    public async Task CreateTask_UnknownStatus_ReturnsBadRequest()
    {
        // Arrange。
        var (_, token) = await _factory.SeedUserWithTokenAsync($"task-create-bogus-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);

        // Act：POST 建立時帶未知狀態 "bogus"。
        var response = await client.PostAsJsonAsync("/api/tasks", new { title = "非法狀態建立", status = "bogus" });

        // Assert：回 400。
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    /// <summary>
    /// 負面（跨使用者隔離）：使用者 B 不可更新使用者 A 的卡片——回 404（資源對 B 不可見）。
    /// 註：本系統以「查不到＝404」表達隔離（比 403「知道存在但無權」更保護隱私，不洩漏他人資源是否存在）。
    /// </summary>
    [Fact]
    public async Task UpdateTask_ByAnotherUser_ReturnsNotFound()
    {
        // Arrange：A 建立一張卡片；另備一位 B 及其權杖。
        var (_, tokenA) = await _factory.SeedUserWithTokenAsync($"owner-{Guid.NewGuid():N}@example.com");
        var (_, tokenB) = await _factory.SeedUserWithTokenAsync($"intruder-{Guid.NewGuid():N}@example.com");
        var clientA = _factory.CreateClientWithToken(tokenA);
        var clientB = _factory.CreateClientWithToken(tokenB);
        var taskId = await clientA.CreateTaskAsync("A 的私人卡片", status: "todo");

        // Act：B 嘗試把 A 的卡片改成 done。
        var response = await clientB.PutAsJsonAsync($"/api/tasks/{taskId}", new { status = "done" });

        // Assert：對 B 而言查無此卡 → 404；且 A 的卡片實際未被改動。
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
        var untouched = await _factory.GetTaskCardFromDbAsync(taskId);
        untouched!.Status.Should().Be("todo");
        untouched.CompletedDateTime.Should().BeNull();
    }

    /// <summary>
    /// 負面（不存在資源）：更新不存在的卡片 Id → 404。
    /// </summary>
    [Fact]
    public async Task UpdateTask_NonexistentId_ReturnsNotFound()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"nf-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);

        var response = await client.PutAsJsonAsync($"/api/tasks/{Guid.NewGuid()}", new { status = "done" });

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    /// <summary>
    /// #41 示範：任務卡片透過真實 HTTP 走一輪 建立 → 讀取 → 更新標題，驗證 status/DTO/落地皆正確。
    /// </summary>
    [Fact]
    public async Task CreateReadUpdateTask_ViaHttp_RoundTrips()
    {
        // Arrange。
        var (_, token) = await _factory.SeedUserWithTokenAsync($"roundtrip-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);

        // Act 1：建立卡片（真實 POST）。
        var createResponse = await client.PostAsJsonAsync("/api/tasks",
            new { title = "原始標題", status = "todo", priority = 2 });

        // Assert 1：201 Created、DTO 欄位正確。
        createResponse.StatusCode.Should().Be(HttpStatusCode.Created);
        var created = await createResponse.ReadJsonAsync();
        created["data"]!["title"]!.GetValue<string>().Should().Be("原始標題");
        created["data"]!["priority"]!.GetValue<int>().Should().Be(2);
        var taskId = Guid.Parse(created["data"]!["id"]!.GetValue<string>());

        // Act 2：讀取（真實 GET）。
        var getResponse = await client.GetAsync($"/api/tasks/{taskId}");
        getResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        (await getResponse.ReadJsonAsync())["data"]!["title"]!.GetValue<string>().Should().Be("原始標題");

        // Act 3：更新標題（真實 PUT）。
        var updateResponse = await client.PutAsJsonAsync($"/api/tasks/{taskId}", new { title = "更新後標題" });
        updateResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        (await updateResponse.ReadJsonAsync())["data"]!["title"]!.GetValue<string>().Should().Be("更新後標題");

        // Assert：資料庫實際落地為新標題。
        (await _factory.GetTaskCardFromDbAsync(taskId))!.Title.Should().Be("更新後標題");
    }
}
