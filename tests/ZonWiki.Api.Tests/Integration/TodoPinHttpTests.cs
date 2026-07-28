using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using Xunit;

namespace ZonWiki.Api.Tests.Integration;

/// <summary>
/// 任務「置頂（Todo 側欄）」旗標（TaskCard.IsPinnedToTodo）的真 HTTP 整合測試。
///
/// 功能背景：Todo 頁左側欄新增「置頂的任務」分頁，內容為所有 IsPinnedToTodo=true 的任務。
/// 此旗標與既有「首頁釘選」（IsPinnedToHome＋HomeSortOrder 自動指派）**完全獨立**：
/// 無排序欄位、無自動排序副作用，兩者互不影響——本檔以測試明確鎖住這個不變式。
///
/// 設計裁示（TDD 計畫審查 2026-07-28）：查詢參數 `pinnedToTodo` **只作用於 list 視圖**；
/// board / calendar 視圖忽略該參數、維持既有行為（亦以測試鎖住，防止未來重構
/// 把過濾誤挪到三視圖共用的基礎查詢上）。
///
/// 全部走 WebApplicationFactory ＋ 真 PostgreSQL 容器 ＋ 真 PAT Bearer 驗證。
/// </summary>
[Collection(ApiIntegrationCollection.Name)]
public sealed class TodoPinHttpTests
{
    private readonly ZonWikiApiFactory _factory;

    /// <summary>
    /// 注入共用的整合測試基座（同集合共用同一顆容器與 API 主機）。
    /// </summary>
    /// <param name="factory">整合測試基座。</param>
    public TodoPinHttpTests(ZonWikiApiFactory factory)
    {
        _factory = factory;
    }

    // ── 建立（POST /api/tasks）───────────────────────────────────────────────

    /// <summary>
    /// 建立任務時帶 isPinnedToTodo=true → 201、回傳 DTO 為 true、DB 落地為 true。
    /// </summary>
    [Fact]
    public async Task CreateTask_WithIsPinnedToTodo_PersistsAndReturnsFlag()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"todopin-create-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);

        var response = await client.PostAsJsonAsync(
            "/api/tasks",
            new { title = "置頂建立測試", isPinnedToTodo = true });

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var json = await response.ReadJsonAsync();
        json["data"]!["isPinnedToTodo"]!.GetValue<bool>().Should().BeTrue();

        var taskId = Guid.Parse(json["data"]!["id"]!.GetValue<string>());
        (await _factory.GetTaskCardFromDbAsync(taskId))!.IsPinnedToTodo.Should().BeTrue();
    }

    /// <summary>
    /// 建立任務不帶該欄位 → 預設不置頂（DTO 與 DB 皆 false）。
    /// </summary>
    [Fact]
    public async Task CreateTask_Default_IsNotPinnedToTodo()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"todopin-default-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);

        var response = await client.PostAsJsonAsync("/api/tasks", new { title = "預設不置頂" });

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var json = await response.ReadJsonAsync();
        json["data"]!["isPinnedToTodo"]!.GetValue<bool>().Should().BeFalse();

        var taskId = Guid.Parse(json["data"]!["id"]!.GetValue<string>());
        (await _factory.GetTaskCardFromDbAsync(taskId))!.IsPinnedToTodo.Should().BeFalse();
    }

    /// <summary>
    /// 建立時設 Todo 置頂 → 不影響首頁釘選（兩個釘選完全獨立，防止實作誤共用旗標）。
    /// </summary>
    [Fact]
    public async Task CreateTask_PinnedToTodo_DoesNotAffectHomePin()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"todopin-indep-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);

        var response = await client.PostAsJsonAsync(
            "/api/tasks",
            new { title = "獨立性測試", isPinnedToTodo = true });

        response.EnsureSuccessStatusCode();
        var taskId = Guid.Parse((await response.ReadJsonAsync())["data"]!["id"]!.GetValue<string>());

        var card = (await _factory.GetTaskCardFromDbAsync(taskId))!;
        card.IsPinnedToTodo.Should().BeTrue();
        card.IsPinnedToHome.Should().BeFalse("Todo 置頂不得連動首頁釘選");
    }

    // ── 更新（PUT /api/tasks/{id}）──────────────────────────────────────────

    /// <summary>
    /// PUT 置頂再取消置頂 → 每一步都 200、DTO 與 DB 同步翻轉。
    /// </summary>
    [Fact]
    public async Task UpdateTask_PinThenUnpin_TogglesFlag()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"todopin-toggle-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);
        var taskId = await client.CreateTaskAsync("切換置頂測試");

        // Act 1：置頂。
        var pin = await client.PutAsJsonAsync($"/api/tasks/{taskId}", new { isPinnedToTodo = true });
        pin.StatusCode.Should().Be(HttpStatusCode.OK);
        (await pin.ReadJsonAsync())["data"]!["isPinnedToTodo"]!.GetValue<bool>().Should().BeTrue();
        (await _factory.GetTaskCardFromDbAsync(taskId))!.IsPinnedToTodo.Should().BeTrue();

        // Act 2：取消置頂。
        var unpin = await client.PutAsJsonAsync($"/api/tasks/{taskId}", new { isPinnedToTodo = false });
        unpin.StatusCode.Should().Be(HttpStatusCode.OK);
        (await unpin.ReadJsonAsync())["data"]!["isPinnedToTodo"]!.GetValue<bool>().Should().BeFalse();
        (await _factory.GetTaskCardFromDbAsync(taskId))!.IsPinnedToTodo.Should().BeFalse();
    }

    /// <summary>
    /// PATCH 語意：已置頂的任務，PUT 只帶其他欄位（不帶 isPinnedToTodo）→ 置頂維持不變。
    /// </summary>
    [Fact]
    public async Task UpdateTask_OmittedFlag_KeepsExisting()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"todopin-patch-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);
        var taskId = await client.CreateTaskAsync("PATCH 語意測試");
        (await client.PutAsJsonAsync($"/api/tasks/{taskId}", new { isPinnedToTodo = true }))
            .EnsureSuccessStatusCode();

        // Act：只改標題，不帶 isPinnedToTodo。
        var response = await client.PutAsJsonAsync($"/api/tasks/{taskId}", new { title = "改了標題" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var card = await _factory.GetTaskCardFromDbAsync(taskId);
        card!.Title.Should().Be("改了標題");
        card.IsPinnedToTodo.Should().BeTrue("未帶 isPinnedToTodo 時不得改動既有置頂狀態");
    }

    /// <summary>
    /// 獨立性（PUT 方向）：先首頁釘選（HomeSortOrder 已被自動指派），再切 Todo 置頂 →
    /// IsPinnedToHome／HomeSortOrder 完全不變。
    /// 防止實作複製 IsPinnedToHome 那段「自動指派排序」副作用邏輯時誤植耦合（審查修正 #1）。
    /// </summary>
    [Fact]
    public async Task UpdateTask_TogglePinToTodo_DoesNotAffectHomePinOrSortOrder()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"todopin-homesafe-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);

        // Arrange：兩張首頁釘選卡（讓第二張的 HomeSortOrder 為非零值，更能偵測被重算）。
        var firstResponse = await client.PostAsJsonAsync(
            "/api/tasks", new { title = "首頁釘選甲", isPinnedToHome = true });
        firstResponse.EnsureSuccessStatusCode();
        var secondResponse = await client.PostAsJsonAsync(
            "/api/tasks", new { title = "首頁釘選乙", isPinnedToHome = true });
        secondResponse.EnsureSuccessStatusCode();
        var taskId = Guid.Parse((await secondResponse.ReadJsonAsync())["data"]!["id"]!.GetValue<string>());

        var before = await _factory.GetTaskCardFromDbAsync(taskId);
        before!.IsPinnedToHome.Should().BeTrue();
        var homeSortOrderBefore = before.HomeSortOrder;

        // Act：切換 Todo 置頂（開→關各一次）。
        (await client.PutAsJsonAsync($"/api/tasks/{taskId}", new { isPinnedToTodo = true }))
            .EnsureSuccessStatusCode();
        (await client.PutAsJsonAsync($"/api/tasks/{taskId}", new { isPinnedToTodo = false }))
            .EnsureSuccessStatusCode();

        // Assert：首頁釘選與其排序完全不受影響。
        var after = await _factory.GetTaskCardFromDbAsync(taskId);
        after!.IsPinnedToHome.Should().BeTrue("切換 Todo 置頂不得改動首頁釘選");
        after.HomeSortOrder.Should().Be(homeSortOrderBefore, "切換 Todo 置頂不得重算 HomeSortOrder");
    }

    // ── 清單過濾（GET /api/tasks?view=list&pinnedToTodo=…）──────────────────

    /// <summary>
    /// pinnedToTodo=true → 只回置頂任務，且每筆 summary DTO 的 isPinnedToTodo 皆為 true。
    /// </summary>
    [Fact]
    public async Task ListTasks_PinnedToTodoFilter_ReturnsOnlyPinned()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"todopin-list-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);

        var pinnedA = await CreatePinnedTaskAsync(client, "置頂Ａ");
        var pinnedB = await CreatePinnedTaskAsync(client, "置頂Ｂ");
        var normal = await client.CreateTaskAsync("一般任務");

        var response = await client.GetAsync("/api/tasks?view=list&pinnedToTodo=true");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var items = (await response.ReadJsonAsync())["data"]!.AsArray();
        var ids = items.Select(n => Guid.Parse(n!["id"]!.GetValue<string>())).ToList();

        ids.Should().BeEquivalentTo(new[] { pinnedA, pinnedB });
        ids.Should().NotContain(normal);
        items.Should().OnlyContain(n => n!["isPinnedToTodo"]!.GetValue<bool>());
    }

    /// <summary>
    /// 顯式帶 pinnedToTodo=false → 不過濾、回全部（false 與「未帶」同義；審查修正 #2）。
    /// </summary>
    [Fact]
    public async Task ListTasks_ExplicitPinnedFalse_ReturnsAll()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"todopin-false-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);

        var pinned = await CreatePinnedTaskAsync(client, "置頂卡");
        var normal = await client.CreateTaskAsync("一般卡");

        var response = await client.GetAsync("/api/tasks?view=list&pinnedToTodo=false");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var ids = (await response.ReadJsonAsync())["data"]!.AsArray()
            .Select(n => Guid.Parse(n!["id"]!.GetValue<string>()))
            .ToList();
        ids.Should().Contain(new[] { pinned, normal });
    }

    /// <summary>
    /// 回歸保護：不帶 pinnedToTodo → 既有行為不變（置頂與非置頂都回）。
    /// </summary>
    [Fact]
    public async Task ListTasks_WithoutFilter_ReturnsAll()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"todopin-nofilter-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);

        var pinned = await CreatePinnedTaskAsync(client, "置頂卡");
        var normal = await client.CreateTaskAsync("一般卡");

        var response = await client.GetAsync("/api/tasks?view=list");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var ids = (await response.ReadJsonAsync())["data"]!.AsArray()
            .Select(n => Guid.Parse(n!["id"]!.GetValue<string>()))
            .ToList();
        ids.Should().Contain(new[] { pinned, normal });
    }

    /// <summary>
    /// 多租戶隔離：使用者 B 的置頂任務不得出現在使用者 A 的 pinnedToTodo=true 結果中。
    /// </summary>
    [Fact]
    public async Task ListTasks_PinnedFilter_DoesNotLeakOtherUsers()
    {
        var (_, tokenA) = await _factory.SeedUserWithTokenAsync($"todopin-usera-{Guid.NewGuid():N}@example.com");
        var (_, tokenB) = await _factory.SeedUserWithTokenAsync($"todopin-userb-{Guid.NewGuid():N}@example.com");
        var clientA = _factory.CreateClientWithToken(tokenA);
        var clientB = _factory.CreateClientWithToken(tokenB);

        var pinnedOfA = await CreatePinnedTaskAsync(clientA, "Ａ的置頂");
        var pinnedOfB = await CreatePinnedTaskAsync(clientB, "Ｂ的置頂");

        var response = await clientA.GetAsync("/api/tasks?view=list&pinnedToTodo=true");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var ids = (await response.ReadJsonAsync())["data"]!.AsArray()
            .Select(n => Guid.Parse(n!["id"]!.GetValue<string>()))
            .ToList();
        ids.Should().Contain(pinnedOfA);
        ids.Should().NotContain(pinnedOfB, "不得洩漏其他使用者的置頂任務");
    }

    /// <summary>
    /// 空集合邊界：使用者沒有任何置頂任務時帶 pinnedToTodo=true → 200＋空陣列（非例外）。
    /// </summary>
    [Fact]
    public async Task ListTasks_PinnedToTodoFilter_NoneReturnsEmptyArray()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"todopin-empty-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);
        await client.CreateTaskAsync("只有一張非置頂卡");

        var response = await client.GetAsync("/api/tasks?view=list&pinnedToTodo=true");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await response.ReadJsonAsync())["data"]!.AsArray().Should().BeEmpty();
    }

    /// <summary>
    /// 設計裁示鎖定（審查修正 #3）：pinnedToTodo 只作用於 list 視圖——
    /// board 視圖帶 pinnedToTodo=true 仍回傳未置頂任務（參數被忽略）。
    /// </summary>
    [Fact]
    public async Task ListTasks_BoardView_IgnoresPinnedToTodoParam()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"todopin-board-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);

        var pinned = await CreatePinnedTaskAsync(client, "置頂卡");
        var normal = await client.CreateTaskAsync("一般卡");

        var response = await client.GetAsync("/api/tasks?view=board&pinnedToTodo=true");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var ids = (await response.ReadJsonAsync())["data"]!["cards"]!.AsArray()
            .Select(n => Guid.Parse(n!["id"]!.GetValue<string>()))
            .ToList();
        ids.Should().Contain(new[] { pinned, normal }, "board 視圖不吃 pinnedToTodo 參數、維持既有行為");
    }

    /// <summary>
    /// 軟刪除回歸：置頂後刪除（軟刪除）→ 不再出現在 pinnedToTodo=true 結果中。
    /// </summary>
    [Fact]
    public async Task SoftDeletedCard_NotInPinnedToTodoFilter()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"todopin-softdel-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);
        var taskId = await CreatePinnedTaskAsync(client, "置頂後刪除");

        (await client.DeleteAsync($"/api/tasks/{taskId}")).EnsureSuccessStatusCode();

        var response = await client.GetAsync("/api/tasks?view=list&pinnedToTodo=true");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var ids = (await response.ReadJsonAsync())["data"]!.AsArray()
            .Select(n => Guid.Parse(n!["id"]!.GetValue<string>()))
            .ToList();
        ids.Should().NotContain(taskId, "軟刪除的卡片不得出現在置頂清單");
    }

    // ── 活動明細（GET /api/me/activity-log）─────────────────────────────────

    /// <summary>
    /// 切換置頂會進活動明細：PUT 置頂後，該卡片最新 updated 活動的 Detail 應含「Todo 置頂」
    /// （與既有 IsPinnedToHome＝「首頁釘選」的 FieldLabels 模式對齊）。
    /// </summary>
    [Fact]
    public async Task UpdateTask_TogglePin_ActivityDetailShowsLabel()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"todopin-actlog-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);
        var taskId = await client.CreateTaskAsync("置頂活動紀錄測試");

        (await client.PutAsJsonAsync($"/api/tasks/{taskId}", new { isPinnedToTodo = true }))
            .EnsureSuccessStatusCode();

        var response = await client.GetAsync("/api/me/activity-log");
        response.EnsureSuccessStatusCode();
        var entries = (await response.ReadJsonAsync())["data"]!.AsArray()
            .Where(n => n!["entityId"]!.GetValue<string>() == taskId.ToString())
            .Where(n => n!["action"]!.GetValue<string>() == "updated")
            .ToList();

        entries.Should().NotBeEmpty("切換置頂應產生一筆 updated 活動");
        entries.First()!["detail"]!.GetValue<string>().Should().Contain("Todo 置頂");
    }

    // ── 共用 helper ─────────────────────────────────────────────────────────

    /// <summary>
    /// 以真實 POST /api/tasks 建立一張「已置頂（Todo 側欄）」的卡片，回傳其 Id。
    /// </summary>
    /// <param name="client">已帶 Bearer 權杖的用戶端。</param>
    /// <param name="title">卡片標題。</param>
    /// <returns>新卡片 Id。</returns>
    private static async Task<Guid> CreatePinnedTaskAsync(HttpClient client, string title)
    {
        var response = await client.PostAsJsonAsync(
            "/api/tasks",
            new { title, isPinnedToTodo = true });
        response.EnsureSuccessStatusCode();
        var json = await response.Content.ReadFromJsonAsync<JsonNode>();
        return Guid.Parse(json!["data"]!["id"]!.GetValue<string>());
    }
}
