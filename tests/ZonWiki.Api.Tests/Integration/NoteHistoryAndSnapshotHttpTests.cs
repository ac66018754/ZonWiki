using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Xunit;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Api.Tests.Integration;

/// <summary>
/// 「筆記完整歷史」與「浮層手動快照」整合測試（真 HTTP + 真 PostgreSQL）。
///
/// 需求背景（使用者原話摘要）：
/// 1. 筆記頁「歷史」分頁要能看到該筆記的完整相關變更（版本快照之外，分類/標籤/關聯等活動也要看得到）。
/// 2. 便利貼/T 文字框/畫筆（浮層）也要版本保護，但改為「右下角工具列儲存按鈕，按了才記一筆」，
///    避免自動記錄造成筆數爆炸。
///
/// 對應實作：
/// - ActivityLogInterceptor 新增 EntityLink 與 NoteTaskLink（兩套並行的關聯系統都要攔）的活動攝影。
/// - GET /api/notes/{id}/activities：單一筆記維度的活動查詢（供歷史分頁合併時間軸）。
/// - NoteOverlaySnapshot：POST/GET /api/notes/{id}/overlay/snapshots（伺服器端讀當下狀態序列化）。
///
/// 斷言原則（測試計畫審查結論）：
/// - 活動斷言必附 EntityType/Title/Detail 精確內容，不可只數筆數（筆數對、內容錯抓不到）。
/// - 「對端不記」要反向斷言對端筆數為 0，不能只驗本端有記。
/// - 快照內容以「反序列化後逐項比對」驗證（數量＋Id＋關鍵欄位），不可只用字串 Contains。
/// - 「多次 HTTP 呼叫」必須真的分開打——同一次 PUT 的多種變更會被既有邏輯合併成一筆活動。
/// </summary>
[Collection(ApiIntegrationCollection.Name)]
public sealed class NoteHistoryAndSnapshotHttpTests
{
    private readonly ZonWikiApiFactory _factory;

    public NoteHistoryAndSnapshotHttpTests(ZonWikiApiFactory factory)
    {
        _factory = factory;
    }

    // ==================== F1：關聯活動攝影（EntityLink） ====================

    /// <summary>
    /// 測試：POST /api/links 建立 任務↔筆記 關聯 → 兩端各恰一筆「建立關聯」活動，
    /// Title＝該端自己的標題、Detail＝「建立關聯：{對端型別}「{對端標題}」」。
    /// </summary>
    [Fact]
    public async Task EntityLink_Create_RecordsActivityOnBothEnds()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"link-create-{Guid.NewGuid():N}@test.local");
        using var client = _factory.CreateClientWithToken(token);
        var taskId = await client.CreateTaskAsync("關聯來源任務");
        var noteId = await CreateNoteViaApiAsync(client, "關聯目標筆記", "內容");

        var response = await client.PostAsJsonAsync("/api/links", new
        {
            sourceType = "taskcard",
            sourceId = taskId,
            targetType = "note",
            targetId = noteId,
        });
        response.EnsureSuccessStatusCode();

        var noteLinkActivities = await GetLinkActivitiesAsync("note", noteId);
        noteLinkActivities.Should().HaveCount(1);
        noteLinkActivities[0].ActionType.Should().Be("updated");
        noteLinkActivities[0].Title.Should().Be("關聯目標筆記", "活動標題應是本端（筆記）自己的標題");
        noteLinkActivities[0].Detail.Should().Contain("建立關聯：任務「關聯來源任務」");

        var taskLinkActivities = await GetLinkActivitiesAsync("taskcard", taskId);
        taskLinkActivities.Should().HaveCount(1);
        taskLinkActivities[0].Title.Should().Be("關聯來源任務", "活動標題應是本端（任務）自己的標題");
        taskLinkActivities[0].Detail.Should().Contain("建立關聯：筆記「關聯目標筆記」");
    }

    /// <summary>
    /// 測試：解除關聯（DELETE /api/links/{linkId}，軟刪）→ 兩端各恰一筆「移除關聯」；
    /// 對已刪除的關聯重複 DELETE → 不重複記錄（ValidFlag false→false 不觸發）。
    /// </summary>
    [Fact]
    public async Task EntityLink_Unlink_RecordsRemovalOnce_RepeatedDeleteDoesNotDuplicate()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"link-unlink-{Guid.NewGuid():N}@test.local");
        using var client = _factory.CreateClientWithToken(token);
        var taskId = await client.CreateTaskAsync("解除關聯任務");
        var noteId = await CreateNoteViaApiAsync(client, "解除關聯筆記", "內容");

        var create = await client.PostAsJsonAsync("/api/links", new
        {
            sourceType = "taskcard",
            sourceId = taskId,
            targetType = "note",
            targetId = noteId,
        });
        create.EnsureSuccessStatusCode();
        var linkId = Guid.Parse((await create.ReadJsonAsync())["data"]!["linkId"]!.GetValue<string>());

        (await client.DeleteAsync($"/api/links/{linkId}")).EnsureSuccessStatusCode();
        // 重複刪除：不論回應碼為何（冪等 200），不得多記活動。
        await client.DeleteAsync($"/api/links/{linkId}");

        var noteActivities = await GetLinkActivitiesAsync("note", noteId);
        noteActivities.Where(a => a.Detail!.Contains("移除關聯：任務「解除關聯任務」"))
            .Should().HaveCount(1, "重複刪除不得重複記錄");

        var taskActivities = await GetLinkActivitiesAsync("taskcard", taskId);
        taskActivities.Where(a => a.Detail!.Contains("移除關聯：筆記「解除關聯筆記」"))
            .Should().HaveCount(1);
    }

    /// <summary>
    /// 測試：筆記↔筆記 關聯 → 兩篇筆記各自恰一筆「建立關聯」活動（EntityType 同為 note、EntityId 不同）。
    /// </summary>
    [Fact]
    public async Task EntityLink_NoteToNote_RecordsOnBothNotes()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"link-nn-{Guid.NewGuid():N}@test.local");
        using var client = _factory.CreateClientWithToken(token);
        var noteAId = await CreateNoteViaApiAsync(client, "筆記甲", "內容");
        var noteBId = await CreateNoteViaApiAsync(client, "筆記乙", "內容");

        var response = await client.PostAsJsonAsync("/api/links", new
        {
            sourceType = "note",
            sourceId = noteAId,
            targetType = "note",
            targetId = noteBId,
        });
        response.EnsureSuccessStatusCode();

        var noteAActivities = await GetLinkActivitiesAsync("note", noteAId);
        noteAActivities.Should().HaveCount(1);
        noteAActivities[0].Detail.Should().Contain("建立關聯：筆記「筆記乙」");

        var noteBActivities = await GetLinkActivitiesAsync("note", noteBId);
        noteBActivities.Should().HaveCount(1);
        noteBActivities[0].Detail.Should().Contain("建立關聯：筆記「筆記甲」");
    }

    /// <summary>
    /// 測試：筆記↔子任務 關聯 → 筆記端記「建立關聯：子任務「S」」；
    /// 子任務端「不記」（反向斷言 EntityType=subtask 的活動筆數為 0——不能只靠筆記端有記倒推）。
    /// </summary>
    [Fact]
    public async Task EntityLink_SubtaskEnd_NoteRecorded_SubtaskNotRecorded()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"link-sub-{Guid.NewGuid():N}@test.local");
        using var client = _factory.CreateClientWithToken(token);
        var taskId = await client.CreateTaskAsync("父任務");
        var noteId = await CreateNoteViaApiAsync(client, "連子任務的筆記", "內容");
        var subTaskId = await SeedSubTaskAsync(userId, taskId, "測試子任務");

        var response = await client.PostAsJsonAsync("/api/links", new
        {
            sourceType = "note",
            sourceId = noteId,
            targetType = "subtask",
            targetId = subTaskId,
        });
        response.EnsureSuccessStatusCode();

        var noteActivities = await GetLinkActivitiesAsync("note", noteId);
        noteActivities.Should().HaveCount(1);
        noteActivities[0].Detail.Should().Contain("建立關聯：子任務「測試子任務」");

        var subTaskActivities = await GetLinkActivitiesAsync("subtask", subTaskId);
        subTaskActivities.Should().BeEmpty("子任務端沒有歷史檢視，依設計不記關聯活動");
    }

    // ==================== F1：關聯活動攝影（NoteTaskLink 並行系統） ====================

    /// <summary>
    /// 測試：NoteTaskLink（任務關聯管理 UI 走的另一套系統）建立與刪除 → 兩端也都要記活動。
    /// POST /api/notes/{noteId}/tasks、DELETE 對應端點。
    /// </summary>
    [Fact]
    public async Task NoteTaskLink_CreateAndDelete_RecordsOnBothEnds()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"ntl-{Guid.NewGuid():N}@test.local");
        using var client = _factory.CreateClientWithToken(token);
        var taskId = await client.CreateTaskAsync("NTL任務");
        var noteId = await CreateNoteViaApiAsync(client, "NTL筆記", "內容");

        var create = await client.PostAsJsonAsync(
            $"/api/notes/{noteId}/tasks",
            new { noteId, taskCardId = taskId });
        create.EnsureSuccessStatusCode();

        (await GetLinkActivitiesAsync("note", noteId))
            .Where(a => a.Detail!.Contains("建立關聯：任務「NTL任務」"))
            .Should().HaveCount(1);
        (await GetLinkActivitiesAsync("taskcard", taskId))
            .Where(a => a.Detail!.Contains("建立關聯：筆記「NTL筆記」"))
            .Should().HaveCount(1);

        // 刪除連結（筆記視角端點）。
        var deleteResponse = await client.DeleteAsync($"/api/notes/{noteId}/tasks/{taskId}");
        deleteResponse.EnsureSuccessStatusCode();

        (await GetLinkActivitiesAsync("note", noteId))
            .Where(a => a.Detail!.Contains("移除關聯：任務「NTL任務」"))
            .Should().HaveCount(1);
        (await GetLinkActivitiesAsync("taskcard", taskId))
            .Where(a => a.Detail!.Contains("移除關聯：筆記「NTL筆記」"))
            .Should().HaveCount(1);
    }

    // ==================== F2：筆記維度活動查詢 ====================

    /// <summary>
    /// 測試：GET /api/notes/{id}/activities 依時間倒序回傳「這篇筆記」的完整活動：
    /// created（建立）→ updated（改內容）→ updated（改分類，含明細）→ updated（建立關聯）。
    /// 各變更以「分開的 HTTP 呼叫」觸發（同一次 PUT 的多種變更會被合併成一筆——刻意分開）。
    /// 別篇筆記的活動不得混入。
    /// </summary>
    [Fact]
    public async Task NoteActivities_ReturnsCompleteHistoryForThisNoteOnly()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"acts-{Guid.NewGuid():N}@test.local");
        using var client = _factory.CreateClientWithToken(token);
        var noteId = await CreateNoteViaApiAsync(client, "活動查詢筆記", "第一版");
        var otherNoteId = await CreateNoteViaApiAsync(client, "別篇筆記", "不該出現");
        var categoryId = await SeedCategoryAsync(userId, "活動測試分類");
        var taskId = await client.CreateTaskAsync("活動測試任務");

        // 各自分開的 HTTP 呼叫（不可合併，否則活動會被壓成一筆）。
        (await client.PutAsJsonAsync($"/api/notes/{noteId}", new { contentRaw = "第二版" }))
            .EnsureSuccessStatusCode();
        (await client.PutAsJsonAsync($"/api/notes/{noteId}", new { categoryIds = new[] { categoryId } }))
            .EnsureSuccessStatusCode();
        (await client.PostAsJsonAsync("/api/links", new
        {
            sourceType = "note",
            sourceId = noteId,
            targetType = "taskcard",
            targetId = taskId,
        })).EnsureSuccessStatusCode();

        var response = await client.GetAsync($"/api/notes/{noteId}/activities");
        response.EnsureSuccessStatusCode();
        var data = (await response.ReadJsonAsync())["data"]!.AsArray();

        var actions = data.Select(x => x!["action"]!.GetValue<string>()).ToList();
        actions.Should().HaveCount(4, "created + 內容 updated + 分類 updated + 關聯 updated");
        actions[^1].Should().Be("created", "倒序排列，最舊的是建立");

        var details = data.Select(x => x!["detail"]?.GetValue<string>() ?? string.Empty).ToList();
        details.Should().ContainSingle(d => d.Contains("加入分類「活動測試分類」"));
        details.Should().ContainSingle(d => d.Contains("建立關聯：任務「活動測試任務」"));

        // 別篇筆記的活動不得混入。
        data.Select(x => x!["title"]!.GetValue<string>())
            .Should().NotContain("別篇筆記");
    }

    /// <summary>
    /// 測試：不存在／已軟刪除（垃圾桶內）的筆記 → 404（比照 revisions 端點慣例：垃圾桶內須先還原）。
    /// </summary>
    [Fact]
    public async Task NoteActivities_UnknownOrSoftDeletedNote_Returns404()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"acts-404-{Guid.NewGuid():N}@test.local");
        using var client = _factory.CreateClientWithToken(token);

        (await client.GetAsync($"/api/notes/{Guid.NewGuid()}/activities"))
            .StatusCode.Should().Be(HttpStatusCode.NotFound);

        var noteId = await CreateNoteViaApiAsync(client, "將被刪的筆記", "內容");
        (await client.DeleteAsync($"/api/notes/{noteId}")).EnsureSuccessStatusCode();
        (await client.GetAsync($"/api/notes/{noteId}/activities"))
            .StatusCode.Should().Be(HttpStatusCode.NotFound, "垃圾桶內的筆記比照 revisions 慣例回 404");
    }

    // ==================== F3：浮層手動快照 ====================

    /// <summary>
    /// 測試：建立便利貼×2＋文字框×1＋畫記×1 → POST snapshot → snapshotNo=1、
    /// ItemsJson 反序列化後恰含 3 個浮層元件與 1 筆畫記（逐項比對 Id/Kind，不用字串 Contains）、
    /// Summary 正確、稽核欄位有蓋章。
    /// </summary>
    [Fact]
    public async Task Snapshot_CapturesCurrentOverlayItemsAndMarks()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"snap-{Guid.NewGuid():N}@test.local");
        using var client = _factory.CreateClientWithToken(token);
        var noteId = await CreateNoteViaApiAsync(client, "快照筆記", "內容主體");

        var sticky1 = await CreateOverlayItemAsync(client, noteId, "sticky", "便利貼一");
        var sticky2 = await CreateOverlayItemAsync(client, noteId, "sticky", "便利貼二");
        var textBox = await CreateOverlayItemAsync(client, noteId, "text", "文字框一");
        var markResponse = await client.PostAsJsonAsync($"/api/notes/{noteId}/marks", new
        {
            kind = "highlight",
            anchorText = "內容主體",
            anchorStart = 0,
            anchorEnd = 4,
            anchorPrefix = "",
            anchorSuffix = "",
            color = "yellow",
        });
        markResponse.EnsureSuccessStatusCode();
        var markId = Guid.Parse((await markResponse.ReadJsonAsync())["data"]!["id"]!.GetValue<string>());

        var snapshotResponse = await client.PostAsync($"/api/notes/{noteId}/overlay/snapshots", null);
        snapshotResponse.EnsureSuccessStatusCode();
        var snapJson = (await snapshotResponse.ReadJsonAsync())["data"]!;
        snapJson["snapshotNo"]!.GetValue<int>().Should().Be(1);
        snapJson["summary"]!.GetValue<string>().Should().Contain("便利貼2").And.Contain("文字框1").And.Contain("畫記1");

        var row = (await GetSnapshotRowsAsync(noteId)).Single();
        row.UserId.Should().Be(userId);
        row.ValidFlag.Should().BeTrue();
        row.CreatedDateTime.Should().BeAfter(DateTime.UtcNow.AddMinutes(-10), "快照列稽核欄位必須有蓋章");

        var items = JsonNode.Parse(row.ItemsJson)!;
        var overlayIds = items["overlayItems"]!.AsArray()
            .Select(x => Guid.Parse(x!["id"]!.GetValue<string>())).ToList();
        overlayIds.Should().BeEquivalentTo(new[] { sticky1, sticky2, textBox });
        var markIds = items["marks"]!.AsArray()
            .Select(x => Guid.Parse(x!["id"]!.GetValue<string>())).ToList();
        markIds.Should().BeEquivalentTo(new[] { markId });
    }

    /// <summary>
    /// 測試：內容未變再按一次儲存 → 照樣記第二筆（「不去重」是刻意設計——使用者按下儲存＝明確存檔意圖，
    /// 與 NoteRevision 的同值不寫相反，此測試防止後人「順手」加去重）；
    /// GET 清單依序號倒序、恰 2 筆、不含 itemsJson 重欄位。
    /// </summary>
    [Fact]
    public async Task Snapshot_IdenticalContentSecondPress_StillRecords_ListExcludesHeavyJson()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"snap2-{Guid.NewGuid():N}@test.local");
        using var client = _factory.CreateClientWithToken(token);
        var noteId = await CreateNoteViaApiAsync(client, "重複快照筆記", "內容");
        await CreateOverlayItemAsync(client, noteId, "sticky", "唯一便利貼");

        (await client.PostAsync($"/api/notes/{noteId}/overlay/snapshots", null)).EnsureSuccessStatusCode();
        var second = await client.PostAsync($"/api/notes/{noteId}/overlay/snapshots", null);
        second.EnsureSuccessStatusCode();
        (await second.ReadJsonAsync())["data"]!["snapshotNo"]!.GetValue<int>().Should().Be(2);

        var list = await client.GetAsync($"/api/notes/{noteId}/overlay/snapshots");
        list.EnsureSuccessStatusCode();
        var data = (await list.ReadJsonAsync())["data"]!.AsArray();
        data.Should().HaveCount(2);
        data[0]!["snapshotNo"]!.GetValue<int>().Should().Be(2, "清單依序號倒序");
        data[1]!["snapshotNo"]!.GetValue<int>().Should().Be(1);
        (data[0] as JsonObject)!.ContainsKey("itemsJson").Should().BeFalse("清單不得夾帶重量級 JSON");
    }

    /// <summary>
    /// 測試：空浮層也允許儲存（快照＝「當下就是空」的狀態證明）。
    /// </summary>
    [Fact]
    public async Task Snapshot_EmptyOverlay_IsAllowed()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"snap-empty-{Guid.NewGuid():N}@test.local");
        using var client = _factory.CreateClientWithToken(token);
        var noteId = await CreateNoteViaApiAsync(client, "空浮層筆記", "內容");

        var response = await client.PostAsync($"/api/notes/{noteId}/overlay/snapshots", null);
        response.EnsureSuccessStatusCode();
        var data = (await response.ReadJsonAsync())["data"]!;
        data["snapshotNo"]!.GetValue<int>().Should().Be(1);
        data["summary"]!.GetValue<string>().Should().Be("（空浮層）");
    }

    /// <summary>
    /// 測試：使用者隔離——他人筆記 POST/GET 皆 404，且 DB 無殘留列（雙重驗證，不只看狀態碼）。
    /// </summary>
    [Fact]
    public async Task Snapshot_OtherUsersNote_Returns404_NoRowLeaked()
    {
        var (_, tokenA) = await _factory.SeedUserWithTokenAsync($"snap-a-{Guid.NewGuid():N}@test.local");
        var (_, tokenB) = await _factory.SeedUserWithTokenAsync($"snap-b-{Guid.NewGuid():N}@test.local");
        using var clientA = _factory.CreateClientWithToken(tokenA);
        using var clientB = _factory.CreateClientWithToken(tokenB);
        var noteId = await CreateNoteViaApiAsync(clientA, "甲的筆記", "內容");

        (await clientB.PostAsync($"/api/notes/{noteId}/overlay/snapshots", null))
            .StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await clientB.GetAsync($"/api/notes/{noteId}/overlay/snapshots"))
            .StatusCode.Should().Be(HttpStatusCode.NotFound);

        (await GetSnapshotRowsAsync(noteId)).Should().BeEmpty("他人嘗試不得留下任何快照列");
    }

    /// <summary>
    /// 測試：不可變快照語意——刪掉一個便利貼後再快照，新快照不含它（依 Id 與數量雙重斷言）、
    /// 舊快照仍含它。
    /// </summary>
    [Fact]
    public async Task Snapshot_AfterItemDeleted_NewExcludesIt_OldStillContainsIt()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"snap-del-{Guid.NewGuid():N}@test.local");
        using var client = _factory.CreateClientWithToken(token);
        var noteId = await CreateNoteViaApiAsync(client, "不可變快照筆記", "內容");
        var keepId = await CreateOverlayItemAsync(client, noteId, "sticky", "留著的");
        var removeId = await CreateOverlayItemAsync(client, noteId, "sticky", "會被刪的");

        (await client.PostAsync($"/api/notes/{noteId}/overlay/snapshots", null)).EnsureSuccessStatusCode();
        (await client.DeleteAsync($"/api/notes/overlay/{removeId}")).EnsureSuccessStatusCode();
        (await client.PostAsync($"/api/notes/{noteId}/overlay/snapshots", null)).EnsureSuccessStatusCode();

        var rows = (await GetSnapshotRowsAsync(noteId)).OrderBy(r => r.SnapshotNo).ToList();
        rows.Should().HaveCount(2);

        var oldIds = JsonNode.Parse(rows[0].ItemsJson)!["overlayItems"]!.AsArray()
            .Select(x => Guid.Parse(x!["id"]!.GetValue<string>())).ToList();
        oldIds.Should().BeEquivalentTo(new[] { keepId, removeId }, "舊快照不可變");

        var newIds = JsonNode.Parse(rows[1].ItemsJson)!["overlayItems"]!.AsArray()
            .Select(x => Guid.Parse(x!["id"]!.GetValue<string>())).ToList();
        newIds.Should().BeEquivalentTo(new[] { keepId }, "新快照只含仍存活的項目（軟刪列不得被 IgnoreQueryFilters 撈進來）");
    }

    /// <summary>
    /// 測試：並發雙擊儲存 → 絕不裸 500（允許一方 409 或兩者都成功）；
    /// 成功的快照序號連續、無重複（唯一索引防護）。
    /// </summary>
    [Fact]
    public async Task Snapshot_ConcurrentPresses_NoBareServerError_SequentialNumbering()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"snap-conc-{Guid.NewGuid():N}@test.local");
        using var client = _factory.CreateClientWithToken(token);
        var noteId = await CreateNoteViaApiAsync(client, "並發快照筆記", "內容");

        var pressA = client.PostAsync($"/api/notes/{noteId}/overlay/snapshots", null);
        var pressB = client.PostAsync($"/api/notes/{noteId}/overlay/snapshots", null);
        var responses = await Task.WhenAll(pressA, pressB);

        responses.Select(r => r.StatusCode)
            .Should().NotContain(HttpStatusCode.InternalServerError, "並發雙擊不得外洩裸 500");
        responses.Count(r => r.IsSuccessStatusCode).Should().BeGreaterThanOrEqualTo(1);
        responses.Where(r => !r.IsSuccessStatusCode)
            .Should().OnlyContain(r => r.StatusCode == HttpStatusCode.Conflict, "敗方只能是 409");

        var numbers = (await GetSnapshotRowsAsync(noteId)).Select(r => r.SnapshotNo).OrderBy(n => n).ToList();
        numbers.Should().OnlyHaveUniqueItems();
        numbers.Should().BeEquivalentTo(Enumerable.Range(1, numbers.Count), "序號必須從 1 連續、無跳號");
    }

    // ==================== 共用輔助 ====================

    /// <summary>
    /// 以 API 建立筆記並回傳其 Id。
    /// </summary>
    /// <param name="client">已帶權杖的用戶端。</param>
    /// <param name="title">筆記標題。</param>
    /// <param name="contentRaw">筆記內容。</param>
    /// <returns>新筆記 Id。</returns>
    private static async Task<Guid> CreateNoteViaApiAsync(HttpClient client, string title, string contentRaw)
    {
        var response = await client.PostAsJsonAsync("/api/notes", new { title, contentRaw });
        response.EnsureSuccessStatusCode();
        return Guid.Parse((await response.ReadJsonAsync())["data"]!["id"]!.GetValue<string>());
    }

    /// <summary>
    /// 以 API 建立浮層元件並回傳其 Id。
    /// </summary>
    /// <param name="client">已帶權杖的用戶端。</param>
    /// <param name="noteId">所屬筆記。</param>
    /// <param name="kind">元件型別（sticky / text / drawing / slide）。</param>
    /// <param name="text">文字內容。</param>
    /// <returns>新元件 Id。</returns>
    private static async Task<Guid> CreateOverlayItemAsync(HttpClient client, Guid noteId, string kind, string text)
    {
        var response = await client.PostAsJsonAsync($"/api/notes/{noteId}/overlay", new
        {
            kind,
            x = 10.0,
            y = 20.0,
            width = 200.0,
            height = 150.0,
            zIndex = 1,
            color = "#FFF176",
            text,
        });
        response.EnsureSuccessStatusCode();
        return Guid.Parse((await response.ReadJsonAsync())["data"]!["id"]!.GetValue<string>());
    }

    /// <summary>
    /// 直接從 DB 讀取某實體的「關聯活動」列（Detail 含「關聯：」者），依時間排序。
    /// </summary>
    /// <param name="entityType">活動實體型別（note / taskcard / subtask…）。</param>
    /// <param name="entityId">實體 Id。</param>
    /// <returns>符合的活動列。</returns>
    private async Task<List<ActivityLog>> GetLinkActivitiesAsync(string entityType, Guid entityId)
    {
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            return await db.ActivityLog
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(a => a.EntityType == entityType && a.EntityId == entityId
                    && a.Detail != null && a.Detail.Contains("關聯："))
                .OrderBy(a => a.CreatedDateTime)
                .ToListAsync();
        }
    }

    /// <summary>
    /// 直接從 DB 讀取某筆記的全部快照列。
    /// </summary>
    /// <param name="noteId">筆記 Id。</param>
    /// <returns>快照列清單。</returns>
    private async Task<List<NoteOverlaySnapshot>> GetSnapshotRowsAsync(Guid noteId)
    {
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            return await db.NoteOverlaySnapshot
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(s => s.NoteId == noteId)
                .OrderBy(s => s.SnapshotNo)
                .ToListAsync();
        }
    }

    /// <summary>
    /// 直接在 DB 種一個分類。
    /// </summary>
    /// <param name="userId">擁有者。</param>
    /// <param name="name">分類名稱。</param>
    /// <returns>分類 Id。</returns>
    private async Task<Guid> SeedCategoryAsync(Guid userId, string name)
    {
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            var now = DateTime.UtcNow;
            var category = new Category
            {
                UserId = userId,
                Name = name,
                FolderPath = string.Empty,
                CreatedDateTime = now,
                UpdatedDateTime = now,
                CreatedUser = userId.ToString(),
                UpdatedUser = userId.ToString(),
            };
            db.Category.Add(category);
            await db.SaveChangesAsync();
            return category.Id;
        }
    }

    /// <summary>
    /// 直接在 DB 種一個子任務（掛在指定任務卡下）。
    /// </summary>
    /// <param name="userId">擁有者。</param>
    /// <param name="taskCardId">父任務卡。</param>
    /// <param name="title">子任務標題。</param>
    /// <returns>子任務 Id。</returns>
    private async Task<Guid> SeedSubTaskAsync(Guid userId, Guid taskCardId, string title)
    {
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            var now = DateTime.UtcNow;
            var subTask = new SubTask
            {
                UserId = userId,
                TaskCardId = taskCardId,
                Title = title,
                CreatedDateTime = now,
                UpdatedDateTime = now,
                CreatedUser = userId.ToString(),
                UpdatedUser = userId.ToString(),
            };
            db.SubTask.Add(subTask);
            await db.SaveChangesAsync();
            return subTask.Id;
        }
    }
}
