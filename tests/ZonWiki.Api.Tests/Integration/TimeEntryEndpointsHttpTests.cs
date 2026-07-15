using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Xunit;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Api.Tests.Integration;

/// <summary>
/// 時間追蹤（TimeEntry）端點的「真 HTTP」整合測試。
///
/// 涵蓋（對應 docs/design/時間追蹤-設計與測試計畫.md 第 7 節，已經 sub-agent 對抗式審查修訂）：
/// - 建立（預設 now、明確時間、Unspecified/offset Kind 正規化、長度/空白驗證、修剪）；
/// - 結束（預設 now、明確時間、零時長邊界、已結束/不存在/跨使用者、時長精確計算）；
/// - stop-latest（最近開始優先、平局 tie-break 確定性、只看自己的、無進行中 404）；
/// - 查詢（[from,to) 五點邊界、長時項目歸開始日、缺參數/亂格式 400、隔離、進行中排序、分類去重）；
/// - 編輯（部分更新、交叉時間驗證雙向、空白分類清空、補結束時間、last-write-wins、長度驗證、隔離）；
/// - 刪除（軟刪除不變式、跨使用者、進行中可刪、垃圾桶可還原）；
/// - PAT（iOS 捷徑實際走法）、未驗證 401、寫入端點限流 429；
/// - ActivityLog（created/updated/deleted；時間欄位只列欄名不附值——避免同日改時分記成「相同→相同」）。
///
/// 全部走 WebApplicationFactory ＋ 真 PostgreSQL 容器；每個測試各自建立獨立使用者（獨立 PAT），
/// 共用容器下靠使用者隔離天然防測試互染（比照 ActivityLogDetailHttpTests）。
/// 時間斷言原則：「預設 now」類用呼叫前後夾區間；「時長計算」類兩端都用明確時間戳、斷言精確值（零 flaky）。
/// </summary>
[Collection(ApiIntegrationCollection.Name)]
public sealed class TimeEntryEndpointsHttpTests
{
    private readonly ZonWikiApiFactory _factory;

    /// <summary>
    /// 注入共用的整合測試基座。
    /// </summary>
    /// <param name="factory">整合測試基座。</param>
    public TimeEntryEndpointsHttpTests(ZonWikiApiFactory factory)
    {
        _factory = factory;
    }

    // ══════════════════════════ 7.1 建立（Create） ══════════════════════════

    /// <summary>
    /// 不帶 startedDateTime 建立 → 201；開始時間預設為伺服器當下（落在呼叫前後夾出的區間）、
    /// 結束時間為 null（計時中）、durationSeconds 為 null。
    /// </summary>
    [Fact]
    public async Task Create_DefaultsStartToUtcNow_AndIsRunning()
    {
        var (client, _) = await NewClientAsync("te-create-now");

        var before = DateTime.UtcNow;
        var response = await client.PostAsJsonAsync("/api/time-entries", new { title = "讀書" });
        var after = DateTime.UtcNow;

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var data = (await response.ReadJsonAsync())["data"]!;
        data["title"]!.GetValue<string>().Should().Be("讀書");
        data["endedDateTime"].Should().BeNull();
        data["durationSeconds"].Should().BeNull();
        var started = GetUtc(data, "startedDateTime");
        started.Should().BeOnOrAfter(before.AddSeconds(-1)).And.BeOnOrBefore(after.AddSeconds(1));
    }

    /// <summary>
    /// 帶明確 UTC 開始時間（Z 尾碼）建立 → 原樣儲存同一 UTC 時刻。
    /// </summary>
    [Fact]
    public async Task Create_WithExplicitStart_StoresGivenTime()
    {
        var (client, _) = await NewClientAsync("te-create-explicit");

        var response = await client.PostAsJsonAsync("/api/time-entries",
            new { title = "寫程式", startedDateTime = "2026-07-01T02:00:00Z" });

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        GetUtc((await response.ReadJsonAsync())["data"]!, "startedDateTime")
            .Should().Be(new DateTime(2026, 7, 1, 2, 0, 0, DateTimeKind.Utc));
    }

    /// <summary>
    /// 帶「無時區尾碼」的開始時間（JSON 解析成 Kind=Unspecified）→ 不得 500，
    /// 依決策視為 UTC 儲存同值（Npgsql timestamptz 要求 Utc Kind 的正規化防線）。
    /// </summary>
    [Fact]
    public async Task Create_WithUnspecifiedKindStart_TreatedAsUtc()
    {
        var (client, _) = await NewClientAsync("te-create-unspec");

        var response = await client.PostAsJsonAsync("/api/time-entries",
            new { title = "無尾碼時間", startedDateTime = "2026-07-01T02:00:00" });

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        GetUtc((await response.ReadJsonAsync())["data"]!, "startedDateTime")
            .Should().Be(new DateTime(2026, 7, 1, 2, 0, 0, DateTimeKind.Utc));
    }

    /// <summary>
    /// 帶「+08:00 offset」的開始時間（iOS 捷徑最可能組出的格式）→ 正確換算成對應 UTC 時刻儲存。
    /// </summary>
    [Fact]
    public async Task Create_WithOffsetStart_ConvertsToUtc()
    {
        var (client, _) = await NewClientAsync("te-create-offset");

        var response = await client.PostAsJsonAsync("/api/time-entries",
            new { title = "帶時區時間", startedDateTime = "2026-07-15T14:30:00+08:00" });

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        GetUtc((await response.ReadJsonAsync())["data"]!, "startedDateTime")
            .Should().Be(new DateTime(2026, 7, 15, 6, 30, 0, DateTimeKind.Utc));
    }

    /// <summary>
    /// 名稱空白 → 400（必填驗證）。
    /// </summary>
    [Fact]
    public async Task Create_EmptyTitle_Returns400()
    {
        var (client, _) = await NewClientAsync("te-create-notitle");

        var response = await client.PostAsJsonAsync("/api/time-entries", new { title = "   " });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    /// <summary>
    /// 名稱超過 200 字 → 400（長度驗證，超界側）。
    /// </summary>
    [Fact]
    public async Task Create_TitleOver200_Returns400()
    {
        var (client, _) = await NewClientAsync("te-create-longtitle");

        var response = await client.PostAsJsonAsync("/api/time-entries",
            new { title = new string('字', 201) });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    /// <summary>
    /// 分類超過 128 字 → 400（長度驗證，超界側）。
    /// </summary>
    [Fact]
    public async Task Create_CategoryOver128_Returns400()
    {
        var (client, _) = await NewClientAsync("te-create-longcat");

        var response = await client.PostAsJsonAsync("/api/time-entries",
            new { title = "合法名稱", category = new string('類', 129) });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    /// <summary>
    /// 名稱恰 200 字、分類恰 128 字 → 成功（長度驗證，合法邊界側）。
    /// </summary>
    [Fact]
    public async Task Create_TitleExactly200_CategoryExactly128_Succeeds()
    {
        var (client, _) = await NewClientAsync("te-create-maxlen");

        var response = await client.PostAsJsonAsync("/api/time-entries",
            new { title = new string('字', 200), category = new string('類', 128) });

        response.StatusCode.Should().Be(HttpStatusCode.Created);
    }

    /// <summary>
    /// 名稱/分類前後空白會修剪；分類為純空白 → 存 null（未分類），與 QuickLink 同款語意。
    /// </summary>
    [Fact]
    public async Task Create_TrimsTitleAndCategory_EmptyCategoryStoredAsNull()
    {
        var (client, _) = await NewClientAsync("te-create-trim");

        var response = await client.PostAsJsonAsync("/api/time-entries",
            new { title = "  讀書  ", category = "   " });

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var data = (await response.ReadJsonAsync())["data"]!;
        data["title"]!.GetValue<string>().Should().Be("讀書");
        data["category"].Should().BeNull();
    }

    // ══════════════════════════ 7.2 結束（Stop / Stop-latest） ══════════════════════════

    /// <summary>
    /// 不帶 body 呼叫 stop → 200；結束時間預設為伺服器當下（落在呼叫前後夾出的區間）。
    /// </summary>
    [Fact]
    public async Task Stop_WithoutBody_DefaultsEndToUtcNow()
    {
        var (client, _) = await NewClientAsync("te-stop-now");
        var id = await StartEntryAsync(client, "跑步");

        var before = DateTime.UtcNow;
        var response = await client.PostAsync($"/api/time-entries/{id}/stop", content: null);
        var after = DateTime.UtcNow;

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var ended = GetUtc((await response.ReadJsonAsync())["data"]!, "endedDateTime");
        ended.Should().BeOnOrAfter(before.AddSeconds(-1)).And.BeOnOrBefore(after.AddSeconds(1));
    }

    /// <summary>
    /// 時長計算：開始/結束兩端都用測試指定的明確 UTC 時間戳（相差 90 分）→
    /// durationSeconds 精確等於 5400（完全不依賴 UtcNow，零 flaky）。
    /// </summary>
    [Fact]
    public async Task Stop_DurationComputation_IsExact()
    {
        var (client, _) = await NewClientAsync("te-stop-duration");
        var id = await StartEntryAsync(client, "剪影片", startedIso: "2026-07-01T00:00:00Z");

        var response = await client.PostAsJsonAsync($"/api/time-entries/{id}/stop",
            new { endedDateTime = "2026-07-01T01:30:00Z" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await response.ReadJsonAsync())["data"]!["durationSeconds"]!.GetValue<long>().Should().Be(5400);
    }

    /// <summary>
    /// 帶明確結束時間 → 原樣採用該 UTC 時刻。
    /// </summary>
    [Fact]
    public async Task Stop_WithExplicitEnd_UsesGivenTime()
    {
        var (client, _) = await NewClientAsync("te-stop-explicit");
        var id = await StartEntryAsync(client, "備課", startedIso: "2026-07-01T00:00:00Z");

        var response = await client.PostAsJsonAsync($"/api/time-entries/{id}/stop",
            new { endedDateTime = "2026-07-01T02:15:00Z" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        GetUtc((await response.ReadJsonAsync())["data"]!, "endedDateTime")
            .Should().Be(new DateTime(2026, 7, 1, 2, 15, 0, DateTimeKind.Utc));
    }

    /// <summary>
    /// 結束時間早於開始時間 → 400。
    /// </summary>
    [Fact]
    public async Task Stop_EndBeforeStart_Returns400()
    {
        var (client, _) = await NewClientAsync("te-stop-endfirst");
        var id = await StartEntryAsync(client, "倒著走", startedIso: "2026-07-01T10:00:00Z");

        var response = await client.PostAsJsonAsync($"/api/time-entries/{id}/stop",
            new { endedDateTime = "2026-07-01T09:59:59Z" });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    /// <summary>
    /// 結束時間等於開始時間（零時長）→ 合法邊界：200 且 durationSeconds == 0。
    /// </summary>
    [Fact]
    public async Task Stop_EndEqualsStart_Returns200WithZeroDuration()
    {
        var (client, _) = await NewClientAsync("te-stop-zero");
        var id = await StartEntryAsync(client, "秒殺", startedIso: "2026-07-01T10:00:00Z");

        var response = await client.PostAsJsonAsync($"/api/time-entries/{id}/stop",
            new { endedDateTime = "2026-07-01T10:00:00Z" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await response.ReadJsonAsync())["data"]!["durationSeconds"]!.GetValue<long>().Should().Be(0);
    }

    /// <summary>
    /// 對已結束的項目再呼叫 stop → 400（不可重複結束）。
    /// </summary>
    [Fact]
    public async Task Stop_AlreadyStopped_Returns400()
    {
        var (client, _) = await NewClientAsync("te-stop-twice");
        var id = await StartEntryAsync(client, "重複結束", startedIso: "2026-07-01T00:00:00Z");
        (await client.PostAsJsonAsync($"/api/time-entries/{id}/stop",
            new { endedDateTime = "2026-07-01T01:00:00Z" })).EnsureSuccessStatusCode();

        var response = await client.PostAsJsonAsync($"/api/time-entries/{id}/stop",
            new { endedDateTime = "2026-07-01T02:00:00Z" });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    /// <summary>
    /// 不存在的項目 Id → 404。
    /// </summary>
    [Fact]
    public async Task Stop_NotFound_Returns404()
    {
        var (client, _) = await NewClientAsync("te-stop-missing");

        var response = await client.PostAsync($"/api/time-entries/{Guid.NewGuid()}/stop", content: null);

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    /// <summary>
    /// 跨使用者：以 A 的權杖結束 B 的項目 → 404（隔離：資源對 A 不可見）。
    /// </summary>
    [Fact]
    public async Task Stop_OtherUsersEntry_Returns404()
    {
        var (clientA, _) = await NewClientAsync("te-stop-isoA");
        var (clientB, _) = await NewClientAsync("te-stop-isoB");
        var idB = await StartEntryAsync(clientB, "B 的計時");

        var response = await clientA.PostAsync($"/api/time-entries/{idB}/stop", content: null);

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    /// <summary>
    /// stop-latest：兩筆進行中（開始時間顯式相差 1 小時）→ 結束「較晚開始」那筆，較早那筆仍在計時。
    /// </summary>
    [Fact]
    public async Task StopLatest_StopsMostRecentlyStartedRunning()
    {
        var (client, _) = await NewClientAsync("te-latest-basic");
        var earlierId = await StartEntryAsync(client, "較早開始", startedIso: "2026-07-01T00:00:00Z");
        var laterId = await StartEntryAsync(client, "較晚開始", startedIso: "2026-07-01T01:00:00Z");

        var response = await client.PostAsync("/api/time-entries/stop-latest", content: null);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var stoppedId = Guid.Parse((await response.ReadJsonAsync())["data"]!["id"]!.GetValue<string>());
        stoppedId.Should().Be(laterId);

        var running = await GetRunningIdsAsync(client);
        running.Should().Contain(earlierId).And.NotContain(laterId);
    }

    /// <summary>
    /// stop-latest 平局 tie-break：兩筆開始時間「完全相同」時，依
    /// StartedDateTime DESC → CreatedDateTime DESC → Id DESC 的確定性排序結束
    /// 「建立時間較晚」那筆（CreatedDateTime 以 ExecuteUpdate 繞過稽核攔截器設定為確定值）。
    /// </summary>
    [Fact]
    public async Task StopLatest_TiedStartTimes_UsesDeterministicTiebreak()
    {
        var (client, _) = await NewClientAsync("te-latest-tie");
        var sameStart = "2026-07-01T08:00:00Z";
        var firstId = await StartEntryAsync(client, "平局一", startedIso: sameStart);
        var secondId = await StartEntryAsync(client, "平局二", startedIso: sameStart);

        // 以 ExecuteUpdate 繞過稽核攔截器，把 CreatedDateTime 設成確定值（second 較晚建立）。
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            await db.TimeEntry.IgnoreQueryFilters().Where(t => t.Id == firstId)
                .ExecuteUpdateAsync(s => s.SetProperty(
                    t => t.CreatedDateTime, new DateTime(2026, 7, 1, 8, 0, 0, DateTimeKind.Utc)));
            await db.TimeEntry.IgnoreQueryFilters().Where(t => t.Id == secondId)
                .ExecuteUpdateAsync(s => s.SetProperty(
                    t => t.CreatedDateTime, new DateTime(2026, 7, 1, 8, 0, 1, DateTimeKind.Utc)));
        }

        var response = await client.PostAsync("/api/time-entries/stop-latest", content: null);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        Guid.Parse((await response.ReadJsonAsync())["data"]!["id"]!.GetValue<string>())
            .Should().Be(secondId, "開始時間平局時應以建立時間較晚者為「最近」（確定性 tie-break）");
    }

    /// <summary>
    /// stop-latest 只考慮「自己的」進行中項目：B 有更晚開始的進行中項目，
    /// A 呼叫 stop-latest → 結束的是 A 自己的、B 的不受影響。
    /// </summary>
    [Fact]
    public async Task StopLatest_OnlyConsidersOwnRunningEntries()
    {
        var (clientA, _) = await NewClientAsync("te-latest-isoA");
        var (clientB, _) = await NewClientAsync("te-latest-isoB");
        var idA = await StartEntryAsync(clientA, "A 的計時", startedIso: "2026-07-01T00:00:00Z");
        var idB = await StartEntryAsync(clientB, "B 更晚的計時", startedIso: "2026-07-02T00:00:00Z");

        var response = await clientA.PostAsync("/api/time-entries/stop-latest", content: null);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        Guid.Parse((await response.ReadJsonAsync())["data"]!["id"]!.GetValue<string>()).Should().Be(idA);
        (await GetRunningIdsAsync(clientB)).Should().Contain(idB, "B 的進行中項目不得被 A 的 stop-latest 影響");
    }

    /// <summary>
    /// 沒有任何進行中項目時呼叫 stop-latest → 404。
    /// </summary>
    [Fact]
    public async Task StopLatest_NoRunning_Returns404()
    {
        var (client, _) = await NewClientAsync("te-latest-none");

        var response = await client.PostAsync("/api/time-entries/stop-latest", content: null);

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    // ══════════════════════════ 7.3 查詢（List / Running / Categories） ══════════════════════════

    /// <summary>
    /// 區間過濾 [from, to) 的五點邊界：from-1s（排除）、==from（含）、to-1s（含）、==to（排除）、to+1s（排除）。
    /// </summary>
    [Fact]
    public async Task List_FiltersByStartedRange_InclusiveFrom_ExclusiveTo()
    {
        var (client, _) = await NewClientAsync("te-list-range");
        var beforeFromId = await StartEntryAsync(client, "from 前 1 秒", startedIso: "2026-07-14T23:59:59Z");
        var atFromId = await StartEntryAsync(client, "等於 from", startedIso: "2026-07-15T00:00:00Z");
        var beforeToId = await StartEntryAsync(client, "to 前 1 秒", startedIso: "2026-07-15T23:59:59Z");
        var atToId = await StartEntryAsync(client, "等於 to", startedIso: "2026-07-16T00:00:00Z");
        var afterToId = await StartEntryAsync(client, "to 後 1 秒", startedIso: "2026-07-16T00:00:01Z");

        var ids = await ListIdsAsync(client, "2026-07-15T00:00:00Z", "2026-07-16T00:00:00Z");

        ids.Should().Contain(atFromId).And.Contain(beforeToId);
        ids.Should().NotContain(beforeFromId).And.NotContain(atToId).And.NotContain(afterToId);
    }

    /// <summary>
    /// 「昨天開始、還在計時」的長時項目：查「今天」的 List 不含它（依開始日歸組的取捨），
    /// 但 GET /running 仍看得到——鎖住這個刻意的語意，避免日後被當 bug 亂改。
    /// </summary>
    [Fact]
    public async Task List_LongRunningEntryStartedBeforeRange_ExcludedFromList_ButVisibleViaRunning()
    {
        var (client, _) = await NewClientAsync("te-list-longrun");
        var id = await StartEntryAsync(client, "跨日長時任務", startedIso: "2026-07-14T20:00:00Z");

        var listIds = await ListIdsAsync(client, "2026-07-15T00:00:00Z", "2026-07-16T00:00:00Z");
        var runningIds = await GetRunningIdsAsync(client);

        listIds.Should().NotContain(id, "List 依「開始時間」歸組，開始日在區間外者不列入");
        runningIds.Should().Contain(id, "進行中項目一律可由 /running 看到");
    }

    /// <summary>
    /// 缺 from/to、只帶其一、from ≥ to → 皆 400。
    /// </summary>
    [Fact]
    public async Task List_MissingOrInvalidRange_Returns400()
    {
        var (client, _) = await NewClientAsync("te-list-badrange");

        (await client.GetAsync("/api/time-entries")).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await client.GetAsync("/api/time-entries?from=2026-07-15T00:00:00Z"))
            .StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await client.GetAsync(
                "/api/time-entries?from=2026-07-15T00:00:00Z&to=2026-07-15T00:00:00Z"))
            .StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    /// <summary>
    /// from 為無法解析的字串（model binding 失敗路徑）→ 400，不得 500。
    /// </summary>
    [Fact]
    public async Task List_MalformedDateQueryString_Returns400NotServerError()
    {
        var (client, _) = await NewClientAsync("te-list-malformed");

        var response = await client.GetAsync("/api/time-entries?from=abc&to=2026-07-16T00:00:00Z");

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    /// <summary>
    /// 隔離：List 只回自己的項目；另一使用者同區間的項目不可見。
    /// </summary>
    [Fact]
    public async Task List_OnlyReturnsOwnEntries()
    {
        var (clientA, _) = await NewClientAsync("te-list-isoA");
        var (clientB, _) = await NewClientAsync("te-list-isoB");
        var idA = await StartEntryAsync(clientA, "A 的項目", startedIso: "2026-07-15T10:00:00Z");
        var idB = await StartEntryAsync(clientB, "B 的項目", startedIso: "2026-07-15T11:00:00Z");

        var ids = await ListIdsAsync(clientA, "2026-07-15T00:00:00Z", "2026-07-16T00:00:00Z");

        ids.Should().Contain(idA).And.NotContain(idB);
    }

    /// <summary>
    /// /running 只回「進行中」（已結束者不出現）、依開始時間逆序（開始時間顯式指定）、且只回自己的。
    /// </summary>
    [Fact]
    public async Task Running_ReturnsOnlyRunning_OrderedByStartDesc_OwnOnly()
    {
        var (client, _) = await NewClientAsync("te-running");
        var (clientOther, _) = await NewClientAsync("te-running-other");
        var olderId = await StartEntryAsync(client, "較早進行中", startedIso: "2026-07-01T00:00:00Z");
        var newerId = await StartEntryAsync(client, "較晚進行中", startedIso: "2026-07-02T00:00:00Z");
        var stoppedId = await StartEntryAsync(client, "已結束", startedIso: "2026-07-03T00:00:00Z");
        (await client.PostAsJsonAsync($"/api/time-entries/{stoppedId}/stop",
            new { endedDateTime = "2026-07-03T01:00:00Z" })).EnsureSuccessStatusCode();
        var otherId = await StartEntryAsync(clientOther, "別人的進行中", startedIso: "2026-07-04T00:00:00Z");

        var ids = await GetRunningIdsAsync(client);

        ids.Should().Equal(newerId, olderId);
        ids.Should().NotContain(stoppedId).And.NotContain(otherId);
    }

    /// <summary>
    /// /categories 回自己用過的 distinct 非空分類（重複只出現一次、未分類不出現、別人的不出現）。
    /// </summary>
    [Fact]
    public async Task Categories_ReturnsDistinctNonNull_OwnOnly()
    {
        var (client, _) = await NewClientAsync("te-cats");
        var (clientOther, _) = await NewClientAsync("te-cats-other");
        await StartEntryAsync(client, "一", category: "工作");
        await StartEntryAsync(client, "二", category: "工作");
        await StartEntryAsync(client, "三", category: "運動");
        await StartEntryAsync(client, "四"); // 未分類
        await StartEntryAsync(clientOther, "他人", category: "別人的分類");

        var response = await client.GetAsync("/api/time-entries/categories");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var categories = ((JsonArray)(await response.ReadJsonAsync())["data"]!)
            .Select(n => n!.GetValue<string>()).ToList();
        categories.Should().BeEquivalentTo(new[] { "工作", "運動" });
    }

    // ══════════════════════════ 7.4 編輯／刪除（Update / Delete） ══════════════════════════

    /// <summary>
    /// 全欄位更新（名稱/分類/開始/結束）→ 回傳與資料庫皆更新；durationSeconds 依新時間精確重算。
    /// </summary>
    [Fact]
    public async Task Update_ChangesTitleCategoryStartEnd()
    {
        var (client, _) = await NewClientAsync("te-upd-all");
        var id = await StartEntryAsync(client, "舊名", category: "舊類", startedIso: "2026-07-01T00:00:00Z");
        (await client.PostAsJsonAsync($"/api/time-entries/{id}/stop",
            new { endedDateTime = "2026-07-01T01:00:00Z" })).EnsureSuccessStatusCode();

        var response = await client.PutAsJsonAsync($"/api/time-entries/{id}", new
        {
            title = "新名",
            category = "新類",
            startedDateTime = "2026-07-01T02:00:00Z",
            endedDateTime = "2026-07-01T04:30:00Z",
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var data = (await response.ReadJsonAsync())["data"]!;
        data["title"]!.GetValue<string>().Should().Be("新名");
        data["category"]!.GetValue<string>().Should().Be("新類");
        GetUtc(data, "startedDateTime").Should().Be(new DateTime(2026, 7, 1, 2, 0, 0, DateTimeKind.Utc));
        GetUtc(data, "endedDateTime").Should().Be(new DateTime(2026, 7, 1, 4, 30, 0, DateTimeKind.Utc));
        data["durationSeconds"]!.GetValue<long>().Should().Be(9000, "2 小時 30 分 = 9000 秒");

        var entity = await GetEntryFromDbAsync(id);
        entity!.Title.Should().Be("新名");
        entity.Category.Should().Be("新類");
    }

    /// <summary>
    /// 部分更新：只帶 title，其餘欄位（分類/開始/結束）維持不變。
    /// </summary>
    [Fact]
    public async Task Update_PartialNullFieldsUnchanged()
    {
        var (client, _) = await NewClientAsync("te-upd-partial");
        var id = await StartEntryAsync(client, "原名", category: "原類", startedIso: "2026-07-01T00:00:00Z");

        var response = await client.PutAsJsonAsync($"/api/time-entries/{id}", new { title = "改名" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var data = (await response.ReadJsonAsync())["data"]!;
        data["title"]!.GetValue<string>().Should().Be("改名");
        data["category"]!.GetValue<string>().Should().Be("原類");
        GetUtc(data, "startedDateTime").Should().Be(new DateTime(2026, 7, 1, 0, 0, 0, DateTimeKind.Utc));
        data["endedDateTime"].Should().BeNull();
    }

    /// <summary>
    /// 分類帶空字串或純空白 → 清為未分類（null）；與 QuickLink 的 IsNullOrWhiteSpace 語意一致。
    /// </summary>
    [Fact]
    public async Task Update_CategoryEmptyOrWhitespace_ClearsToNull()
    {
        var (client, _) = await NewClientAsync("te-upd-clearcat");
        var id = await StartEntryAsync(client, "清分類", category: "有分類");

        var emptyResponse = await client.PutAsJsonAsync($"/api/time-entries/{id}", new { category = "" });
        emptyResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        (await emptyResponse.ReadJsonAsync())["data"]!["category"].Should().BeNull();

        (await client.PutAsJsonAsync($"/api/time-entries/{id}", new { category = "再設回" }))
            .EnsureSuccessStatusCode();
        var blankResponse = await client.PutAsJsonAsync($"/api/time-entries/{id}", new { category = "   " });
        blankResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        (await blankResponse.ReadJsonAsync())["data"]!["category"].Should().BeNull();
    }

    /// <summary>
    /// 交叉驗證方向一：只改「開始」使其晚於既有「結束」→ 400。
    /// </summary>
    [Fact]
    public async Task Update_NewStartAfterExistingEnd_Returns400()
    {
        var (client, _) = await NewClientAsync("te-upd-crossstart");
        var id = await StartEntryAsync(client, "交叉一", startedIso: "2026-07-01T00:00:00Z");
        (await client.PostAsJsonAsync($"/api/time-entries/{id}/stop",
            new { endedDateTime = "2026-07-01T01:00:00Z" })).EnsureSuccessStatusCode();

        var response = await client.PutAsJsonAsync($"/api/time-entries/{id}",
            new { startedDateTime = "2026-07-01T01:00:01Z" });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    /// <summary>
    /// 交叉驗證方向二：只改「結束」使其早於既有「開始」→ 400。
    /// </summary>
    [Fact]
    public async Task Update_NewEndBeforeExistingStart_Returns400()
    {
        var (client, _) = await NewClientAsync("te-upd-crossend");
        var id = await StartEntryAsync(client, "交叉二", startedIso: "2026-07-01T10:00:00Z");

        var response = await client.PutAsJsonAsync($"/api/time-entries/{id}",
            new { endedDateTime = "2026-07-01T09:00:00Z" });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    /// <summary>
    /// 編輯後開始 == 結束（零時長）→ 合法。
    /// </summary>
    [Fact]
    public async Task Update_EndEqualsStart_Allowed()
    {
        var (client, _) = await NewClientAsync("te-upd-zero");
        var id = await StartEntryAsync(client, "零時長", startedIso: "2026-07-01T10:00:00Z");

        var response = await client.PutAsJsonAsync($"/api/time-entries/{id}",
            new { endedDateTime = "2026-07-01T10:00:00Z" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await response.ReadJsonAsync())["data"]!["durationSeconds"]!.GetValue<long>().Should().Be(0);
    }

    /// <summary>
    /// PUT 對「進行中」項目補上結束時間 → 等同結束（事後補記的合法路徑）。
    /// </summary>
    [Fact]
    public async Task Update_SetsEndOnRunningEntry_StopsIt()
    {
        var (client, _) = await NewClientAsync("te-upd-lateend");
        var id = await StartEntryAsync(client, "事後補記", startedIso: "2026-07-01T08:00:00Z");

        var response = await client.PutAsJsonAsync($"/api/time-entries/{id}",
            new { endedDateTime = "2026-07-01T09:00:00Z" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await response.ReadJsonAsync())["data"]!["durationSeconds"]!.GetValue<long>().Should().Be(3600);
        (await GetRunningIdsAsync(client)).Should().NotContain(id);
    }

    /// <summary>
    /// last-write-wins 決策鎖定：結束後再 PUT 修改 → 200 直接覆寫，無版本衝突檢查（無 409 流程）。
    /// </summary>
    [Fact]
    public async Task Update_AfterStop_OverwritesWithoutConflict()
    {
        var (client, _) = await NewClientAsync("te-upd-lww");
        var id = await StartEntryAsync(client, "併發語意", startedIso: "2026-07-01T00:00:00Z");
        (await client.PostAsync($"/api/time-entries/{id}/stop", content: null)).EnsureSuccessStatusCode();

        var response = await client.PutAsJsonAsync($"/api/time-entries/{id}", new
        {
            startedDateTime = "2026-07-01T05:00:00Z",
            endedDateTime = "2026-07-01T06:00:00Z",
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await response.ReadJsonAsync())["data"]!["durationSeconds"]!.GetValue<long>().Should().Be(3600);
    }

    /// <summary>
    /// 名稱帶了但為空白 → 400（不允許把名稱清空）。
    /// </summary>
    [Fact]
    public async Task Update_BlankTitle_Returns400()
    {
        var (client, _) = await NewClientAsync("te-upd-blanktitle");
        var id = await StartEntryAsync(client, "有名字");

        var response = await client.PutAsJsonAsync($"/api/time-entries/{id}", new { title = "   " });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    /// <summary>
    /// Update 側長度驗證：名稱超過 200 或分類超過 128 → 400（Create/Update 是兩段獨立驗證，各自要測）。
    /// </summary>
    [Fact]
    public async Task Update_FieldLengthViolations_Return400()
    {
        var (client, _) = await NewClientAsync("te-upd-length");
        var id = await StartEntryAsync(client, "長度驗證");

        (await client.PutAsJsonAsync($"/api/time-entries/{id}", new { title = new string('字', 201) }))
            .StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await client.PutAsJsonAsync($"/api/time-entries/{id}", new { category = new string('類', 129) }))
            .StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    /// <summary>
    /// 更新不存在的項目 → 404。
    /// </summary>
    [Fact]
    public async Task Update_NotFound_Returns404()
    {
        var (client, _) = await NewClientAsync("te-upd-missing");

        var response = await client.PutAsJsonAsync($"/api/time-entries/{Guid.NewGuid()}",
            new { title = "改誰" });

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    /// <summary>
    /// 跨使用者：以 A 的權杖更新 B 的項目 → 404。
    /// </summary>
    [Fact]
    public async Task Update_OtherUsers_Returns404()
    {
        var (clientA, _) = await NewClientAsync("te-upd-isoA");
        var (clientB, _) = await NewClientAsync("te-upd-isoB");
        var idB = await StartEntryAsync(clientB, "B 的項目");

        var response = await clientA.PutAsJsonAsync($"/api/time-entries/{idB}", new { title = "偷改" });

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    /// <summary>
    /// 刪除＝軟刪除：204 → List 查不到；IgnoreQueryFilters 仍在、ValidFlag=false、DeletedDateTime 已設
    /// （「絕不硬刪除」鐵則）。
    /// </summary>
    [Fact]
    public async Task Delete_SoftDeletes_EntryGoneFromListButRowRemains()
    {
        var (client, _) = await NewClientAsync("te-del-soft");
        var id = await StartEntryAsync(client, "要刪的", startedIso: "2026-07-15T10:00:00Z");

        var response = await client.DeleteAsync($"/api/time-entries/{id}");

        response.StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await ListIdsAsync(client, "2026-07-15T00:00:00Z", "2026-07-16T00:00:00Z"))
            .Should().NotContain(id);

        var entity = await GetEntryFromDbAsync(id);
        entity.Should().NotBeNull("軟刪除後資料列必須仍存在（不可硬刪）");
        entity!.ValidFlag.Should().BeFalse();
        entity.DeletedDateTime.Should().NotBeNull();
    }

    /// <summary>
    /// 跨使用者：以 A 的權杖刪 B 的項目 → 404（Delete 側隔離）。
    /// </summary>
    [Fact]
    public async Task Delete_OtherUsersEntry_Returns404()
    {
        var (clientA, _) = await NewClientAsync("te-del-isoA");
        var (clientB, _) = await NewClientAsync("te-del-isoB");
        var idB = await StartEntryAsync(clientB, "B 的項目");

        var response = await clientA.DeleteAsync($"/api/time-entries/{idB}");

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    /// <summary>
    /// 進行中的項目也可以刪（軟刪除成功、從 /running 消失）。
    /// </summary>
    [Fact]
    public async Task Delete_RunningEntry_SoftDeletesSuccessfully()
    {
        var (client, _) = await NewClientAsync("te-del-running");
        var id = await StartEntryAsync(client, "刪進行中");

        var response = await client.DeleteAsync($"/api/time-entries/{id}");

        response.StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await GetRunningIdsAsync(client)).Should().NotContain(id);
    }

    /// <summary>
    /// 垃圾桶整合：刪除後出現在 GET /api/trash，POST /api/trash/TimeEntry/{id}/restore 可還原、
    /// 還原後重新出現在清單。
    /// </summary>
    [Fact]
    public async Task Delete_TimeEntry_AppearsInTrashAndCanBeRestored()
    {
        var (client, _) = await NewClientAsync("te-del-trash");
        var id = await StartEntryAsync(client, "進垃圾桶", startedIso: "2026-07-15T10:00:00Z");
        (await client.DeleteAsync($"/api/time-entries/{id}")).EnsureSuccessStatusCode();

        var trashBody = await (await client.GetAsync("/api/trash")).Content.ReadAsStringAsync();
        trashBody.Should().Contain(id.ToString(), "軟刪除的時間追蹤項目必須出現在垃圾桶");

        var restore = await client.PostAsync($"/api/trash/TimeEntry/{id}/restore", content: null);
        restore.IsSuccessStatusCode.Should().BeTrue("垃圾桶還原必須成功");

        (await ListIdsAsync(client, "2026-07-15T00:00:00Z", "2026-07-16T00:00:00Z"))
            .Should().Contain(id, "還原後項目必須重新出現在清單");
    }

    // ══════════════════════════ 7.5 PAT（iOS 捷徑路徑）＋限流 ══════════════════════════

    /// <summary>
    /// iOS 捷徑實際走法端到端：以 PAT Bearer 建立（帶分類）→ stop-latest → 回傳含名稱與時長，
    /// 供捷徑顯示「已結束：讀書（N 秒）」通知。
    /// </summary>
    [Fact]
    public async Task PatBearer_CanCreateAndStopLatest()
    {
        var (client, _) = await NewClientAsync("te-pat-e2e");

        var createResponse = await client.PostAsJsonAsync("/api/time-entries",
            new { title = "捷徑計時", category = "工作", startedDateTime = "2026-07-01T00:00:00Z" });
        createResponse.StatusCode.Should().Be(HttpStatusCode.Created);

        var stopResponse = await client.PostAsync("/api/time-entries/stop-latest", content: null);
        stopResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var data = (await stopResponse.ReadJsonAsync())["data"]!;
        data["title"]!.GetValue<string>().Should().Be("捷徑計時");
        data["durationSeconds"]!.GetValue<long>().Should().BeGreaterThanOrEqualTo(0);
    }

    /// <summary>
    /// 未帶任何憑證 → 401（全域 FallbackPolicy 防線）。
    /// </summary>
    [Fact]
    public async Task NoAuth_Returns401()
    {
        var client = _factory.CreateClient();

        var response = await client.PostAsJsonAsync("/api/time-entries", new { title = "未登入" });

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    /// <summary>
    /// 寫入端點限流（PatPolicy，TokenBucket 以 UserId 分區）：專屬使用者連打 40 發建立，
    /// 超過桶容量後必出現 429；前段正常量不應被誤傷。
    /// </summary>
    [Fact]
    public async Task WriteEndpoints_Burst_TriggersRateLimit429()
    {
        var (client, _) = await NewClientAsync("te-rate");

        var statuses = new List<HttpStatusCode>();
        for (var i = 0; i < 40; i++)
        {
            var response = await client.PostAsJsonAsync("/api/time-entries",
                new { title = $"爆量 {i}", startedDateTime = "2026-07-01T00:00:00Z" });
            statuses.Add(response.StatusCode);
        }

        statuses.Should().Contain(HttpStatusCode.TooManyRequests, "連續爆量寫入必須被限流");
        statuses.Take(10).Should().OnlyContain(s => s == HttpStatusCode.Created, "前段正常量不應被誤傷");
    }

    // ══════════════════════════ 7.6 ActivityLog ══════════════════════════

    /// <summary>
    /// 建立時間追蹤項目 → ActivityLog 記一筆 timeentry/created（標題＝項目名稱）。
    /// </summary>
    [Fact]
    public async Task Create_WritesTimeEntryCreatedActivity()
    {
        var (client, userId) = await NewClientAsync("te-act-create");
        var id = await StartEntryAsync(client, "活動紀錄建立");

        var log = await GetLatestActivityAsync(userId, id);

        log.Should().NotBeNull("建立必須記入活動紀錄");
        log!.EntityType.Should().Be("timeentry");
        log.ActionType.Should().Be("created");
        log.Title.Should().Be("活動紀錄建立");
    }

    /// <summary>
    /// 編輯名稱與分類 → updated 且 Detail 含「標題『舊』→『新』」與分類變更（短欄位附前後值）。
    /// </summary>
    [Fact]
    public async Task UpdateTitleAndCategory_DetailShowsOldToNew()
    {
        var (client, userId) = await NewClientAsync("te-act-update");
        var id = await StartEntryAsync(client, "舊名字", category: "舊分類");

        (await client.PutAsJsonAsync($"/api/time-entries/{id}",
            new { title = "新名字", category = "新分類" })).EnsureSuccessStatusCode();

        var log = await GetLatestActivityAsync(userId, id);
        log.Should().NotBeNull();
        log!.ActionType.Should().Be("updated");
        log.Detail.Should().Contain("標題").And.Contain("舊名字").And.Contain("新名字")
            .And.Contain("分類").And.Contain("舊分類").And.Contain("新分類");
    }

    /// <summary>
    /// 同日只改「開始時間」的時分 → Detail 只列欄名「開始時間」、不附前後值（不含「→」）——
    /// 既有 FormatValue 對 DateTime 只印日期，附值會記成「相同→相同」的白紀錄（審查 CRITICAL 決策鎖定）。
    /// </summary>
    [Fact]
    public async Task UpdateStartTimeOnly_DetailListsFieldNameWithoutValues()
    {
        var (client, userId) = await NewClientAsync("te-act-timeonly");
        var id = await StartEntryAsync(client, "只改時分", startedIso: "2026-07-01T08:00:00Z");

        (await client.PutAsJsonAsync($"/api/time-entries/{id}",
            new { startedDateTime = "2026-07-01T08:30:00Z" })).EnsureSuccessStatusCode();

        var log = await GetLatestActivityAsync(userId, id);
        log.Should().NotBeNull();
        log!.ActionType.Should().Be("updated");
        log.Detail.Should().Contain("開始時間");
        log.Detail.Should().NotContain("→", "時間欄位只列欄名，不得附「相同日期→相同日期」的誤導值");
    }

    /// <summary>
    /// 對抗式復審鎖定的「連帶行為變更」：FieldLabels 以「屬性名稱字串」為全域鍵，
    /// 本次為 TimeEntry 加入 "Category" 標籤後，QuickLink.Category（同名屬性）的變更
    /// 也會開始出現在其活動摘要 Detail——經評估為合理行為（語意正確、資訊無外洩），
    /// 以本測試明確鎖住，避免未來被當成意外行為修掉或無聲改變。
    /// </summary>
    [Fact]
    public async Task QuickLinkCategoryUpdate_DetailShowsCategoryChange_LockedBehaviorChange()
    {
        var (client, userId) = await NewClientAsync("te-act-quicklink");
        var createResponse = await client.PostAsJsonAsync("/api/quick-links",
            new { title = "測試連結", url = "https://example.com", category = "舊分類" });
        createResponse.EnsureSuccessStatusCode();
        var quickLinkId = Guid.Parse(
            (await createResponse.ReadJsonAsync())["data"]!["id"]!.GetValue<string>());

        (await client.PutAsJsonAsync($"/api/quick-links/{quickLinkId}",
            new { category = "新分類" })).EnsureSuccessStatusCode();

        var log = await GetLatestActivityAsync(userId, quickLinkId);
        log.Should().NotBeNull();
        log!.EntityType.Should().Be("quicklink");
        log.ActionType.Should().Be("updated");
        log.Detail.Should().Contain("分類").And.Contain("舊分類").And.Contain("新分類");
    }

    /// <summary>
    /// 刪除 → ActivityLog 記一筆 timeentry/deleted（軟刪除的 ValidFlag 翻轉被分類為刪除）。
    /// </summary>
    [Fact]
    public async Task Delete_WritesTimeEntryDeletedActivity()
    {
        var (client, userId) = await NewClientAsync("te-act-delete");
        var id = await StartEntryAsync(client, "活動紀錄刪除");

        (await client.DeleteAsync($"/api/time-entries/{id}")).EnsureSuccessStatusCode();

        var log = await GetLatestActivityAsync(userId, id);
        log.Should().NotBeNull();
        log!.ActionType.Should().Be("deleted");
    }

    // ══════════════════════════ 共用 helper ══════════════════════════

    /// <summary>
    /// 建立一位獨立使用者（獨立 GUID email）與其 PAT，回傳已帶 Bearer 的用戶端與使用者 Id。
    /// 每個測試各自呼叫、不得共用——共用 DB 容器下靠使用者隔離防測試互染。
    /// </summary>
    /// <param name="prefix">email 前綴（辨識用）。</param>
    /// <returns>已帶 Bearer 權杖的用戶端與使用者 Id。</returns>
    private async Task<(HttpClient Client, Guid UserId)> NewClientAsync(string prefix)
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync(
            $"{prefix}-{Guid.NewGuid():N}@example.com");
        return (_factory.CreateClientWithToken(token), userId);
    }

    /// <summary>
    /// 透過真實 HTTP 建立一筆時間追蹤項目（＝開始計時），回傳其 Id。
    /// </summary>
    /// <param name="client">已帶 Bearer 權杖的用戶端。</param>
    /// <param name="title">項目名稱。</param>
    /// <param name="category">分類（可空）。</param>
    /// <param name="startedIso">開始時間 ISO 字串（可空＝伺服器預設 now）。</param>
    /// <returns>新項目 Id。</returns>
    private static async Task<Guid> StartEntryAsync(
        HttpClient client,
        string title,
        string? category = null,
        string? startedIso = null)
    {
        var response = await client.PostAsJsonAsync("/api/time-entries",
            new { title, category, startedDateTime = startedIso });
        response.EnsureSuccessStatusCode();
        return Guid.Parse((await response.ReadJsonAsync())["data"]!["id"]!.GetValue<string>());
    }

    /// <summary>
    /// 讀取 GET /api/time-entries?from=&to= 的項目 Id 清單（依回傳順序）。
    /// </summary>
    /// <param name="client">已帶 Bearer 權杖的用戶端。</param>
    /// <param name="fromIso">區間起（UTC ISO，含）。</param>
    /// <param name="toIso">區間迄（UTC ISO，不含）。</param>
    /// <returns>項目 Id 清單。</returns>
    private static async Task<List<Guid>> ListIdsAsync(HttpClient client, string fromIso, string toIso)
    {
        var response = await client.GetAsync(
            $"/api/time-entries?from={Uri.EscapeDataString(fromIso)}&to={Uri.EscapeDataString(toIso)}");
        response.EnsureSuccessStatusCode();
        return ((JsonArray)(await response.ReadJsonAsync())["data"]!)
            .Select(n => Guid.Parse(n!["id"]!.GetValue<string>())).ToList();
    }

    /// <summary>
    /// 讀取 GET /api/time-entries/running 的項目 Id 清單（依回傳順序）。
    /// </summary>
    /// <param name="client">已帶 Bearer 權杖的用戶端。</param>
    /// <returns>進行中項目 Id 清單。</returns>
    private static async Task<List<Guid>> GetRunningIdsAsync(HttpClient client)
    {
        var response = await client.GetAsync("/api/time-entries/running");
        response.EnsureSuccessStatusCode();
        return ((JsonArray)(await response.ReadJsonAsync())["data"]!)
            .Select(n => Guid.Parse(n!["id"]!.GetValue<string>())).ToList();
    }

    /// <summary>
    /// 直接自資料庫讀取一筆時間追蹤項目（略過全域過濾），供驗證軟刪除等 DTO 未暴露的欄位。
    /// </summary>
    /// <param name="id">項目 Id。</param>
    /// <returns>實體（找不到為 null）。</returns>
    private async Task<TimeEntry?> GetEntryFromDbAsync(Guid id)
    {
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            return await db.TimeEntry
                .IgnoreQueryFilters()
                .AsNoTracking()
                .FirstOrDefaultAsync(t => t.Id == id);
        }
    }

    /// <summary>
    /// 直接自資料庫讀取某使用者對某實體「最新」的一筆活動紀錄（依建立時間逆序）。
    /// </summary>
    /// <param name="userId">使用者 Id。</param>
    /// <param name="entityId">實體 Id。</param>
    /// <returns>最新活動紀錄（沒有為 null）。</returns>
    private async Task<ActivityLog?> GetLatestActivityAsync(Guid userId, Guid entityId)
    {
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            return await db.ActivityLog
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(a => a.UserId == userId && a.EntityId == entityId)
                .OrderByDescending(a => a.CreatedDateTime)
                .FirstOrDefaultAsync();
        }
    }

    /// <summary>
    /// 自 JSON 節點讀取指定屬性為 UTC 時刻（以 DateTimeOffset 解析再取 UtcDateTime，避免 Kind 歧義）。
    /// </summary>
    /// <param name="node">資料節點。</param>
    /// <param name="property">屬性名稱（camelCase）。</param>
    /// <returns>UTC 時刻。</returns>
    private static DateTime GetUtc(JsonNode node, string property) =>
        DateTimeOffset.Parse(node[property]!.GetValue<string>()).UtcDateTime;
}
