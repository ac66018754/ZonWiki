using System.Net.Http.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using Xunit;

namespace ZonWiki.Api.Tests.Integration;

/// <summary>
/// 活動明細「變更內容摘要（Detail）＋ 分類/標籤變更攔截」的真 HTTP 整合測試。
///
/// 涵蓋（對應 feature/search-and-activity-ux 的活動明細段）：
/// - 編輯筆記：Detail 記錄變更欄位摘要（標題含「舊 → 新」；內容只列名稱、不含 ContentHtml/Slug/ContentHash 噪音）；
/// - 分類/標籤變更：NoteCategory / NoteTag 的 Added ＋ ValidFlag 翻轉（軟刪/復活）→
///   依筆記分組合併成「一筆」note/updated 活動，Detail 描述加入/移出了哪個分類/標籤；
/// - 每筆記每批次只出一筆：建立即帶分類 → 只有 created；混合 PUT（欄位＋分類）→ 只有一筆 updated；
/// - 既有行為回歸：軟刪除→deleted、還原→restored、無實質變更不記錄；
/// - GET /api/me/activity-log 回傳 detail 與（note 項目的）categories。
///
/// 全部走 WebApplicationFactory ＋ 真 PostgreSQL 容器；每個測試用自己的使用者，活動紀錄天然隔離。
/// </summary>
[Collection(ApiIntegrationCollection.Name)]
public sealed class ActivityLogDetailHttpTests
{
    private readonly ZonWikiApiFactory _factory;

    /// <summary>
    /// 注入共用的整合測試基座。
    /// </summary>
    /// <param name="factory">整合測試基座。</param>
    public ActivityLogDetailHttpTests(ZonWikiApiFactory factory)
    {
        _factory = factory;
    }

    // ── 測試 1：改標題 → detail 含「標題『舊』→『新』」───────────────────────────────

    /// <summary>
    /// PUT 筆記改標題 → 產生一筆 note/updated，detail 同時含舊標題與新標題。
    /// </summary>
    [Fact]
    public async Task ActivityDetail_TitleChange_RecordsOldAndNewTitle()
    {
        var client = await NewClientAsync("act-title");
        var noteId = await CreateNoteAsync(client, "舊標題甲", "內文");

        await PutNoteAsync(client, noteId, new { title = "新標題乙" });

        var entry = await LatestEntryAsync(client, noteId, "updated");
        entry.Detail.Should().NotBeNullOrEmpty();
        entry.Detail.Should().Contain("標題");
        entry.Detail.Should().Contain("舊標題甲");
        entry.Detail.Should().Contain("新標題乙");
    }

    // ── 測試 2：改內容 → detail 含「內容」，不含衍生欄位噪音 ───────────────────────────

    /// <summary>
    /// PUT 筆記改內容 → detail 含「內容」；不得出現 ContentHtml / Slug / ContentHash / xmin
    /// 這類衍生或影子欄位的名稱（不論英文原名或任何形式）。
    /// </summary>
    [Fact]
    public async Task ActivityDetail_ContentChange_ExcludesDerivedFields()
    {
        var client = await NewClientAsync("act-content");
        var noteId = await CreateNoteAsync(client, "內容筆記", "原內文");

        await PutNoteAsync(client, noteId, new { contentRaw = "新內文" });

        var entry = await LatestEntryAsync(client, noteId, "updated");
        entry.Detail.Should().Contain("內容");
        entry.Detail.Should().NotContainAny("ContentHtml", "ContentHash", "Slug", "xmin");
    }

    // ── 測試 3：加入分類（單一分類端點）→ note/updated ＋「加入分類」────────────────────

    /// <summary>
    /// POST /api/notes/{noteId}/categories/{categoryId}（拖曳歸類）→
    /// 產生一筆 note/updated，Title=筆記標題、detail 含「加入分類『名稱』」。
    /// </summary>
    [Fact]
    public async Task ActivityDetail_AddCategory_RecordsCategoryName()
    {
        var client = await NewClientAsync("act-addcat");
        var noteId = await CreateNoteAsync(client, "歸類筆記", "內文");
        var categoryId = await CreateCategoryAsync(client, "工作分類");

        var response = await client.PostAsync($"/api/notes/{noteId}/categories/{categoryId}", null);
        response.EnsureSuccessStatusCode();

        var entry = await LatestEntryAsync(client, noteId, "updated");
        entry.Title.Should().Be("歸類筆記");
        entry.Detail.Should().Contain("加入分類");
        entry.Detail.Should().Contain("工作分類");
    }

    // ── 測試 4：移出分類（整組取代為空）→「移出分類」──────────────────────────────────

    /// <summary>
    /// 先歸入分類，再以 PUT categories=[] 清空 → detail 含「移出分類『名稱』」
    /// （本 repo 的移除＝ValidFlag 軟刪，攔截器必須把 ValidFlag 翻轉視為移出而非整筆刪除）。
    /// </summary>
    [Fact]
    public async Task ActivityDetail_RemoveCategory_RecordsRemoval()
    {
        var client = await NewClientAsync("act-rmcat");
        var noteId = await CreateNoteAsync(client, "移出筆記", "內文");
        var categoryId = await CreateCategoryAsync(client, "暫存分類");
        await AssignCategoriesAsync(client, noteId, categoryId);

        await AssignCategoriesAsync(client, noteId /* 清空 */);

        var entry = await LatestEntryAsync(client, noteId, "updated");
        entry.Detail.Should().Contain("移出分類");
        entry.Detail.Should().Contain("暫存分類");
    }

    // ── 測試 5：一次換分類 → 恰一筆活動、detail 同含加入與移出 ─────────────────────────

    /// <summary>
    /// 筆記從分類甲換到分類乙（單一 PUT 整組取代）→ 只產生「一筆」新活動，
    /// detail 同時含「加入分類『乙』」與「移出分類『甲』」。
    /// </summary>
    [Fact]
    public async Task ActivityDetail_SwapCategories_ProducesSingleMergedEntry()
    {
        var client = await NewClientAsync("act-swapcat");
        var noteId = await CreateNoteAsync(client, "換類筆記", "內文");
        var fromId = await CreateCategoryAsync(client, "來源分類");
        var toId = await CreateCategoryAsync(client, "目的分類");
        await AssignCategoriesAsync(client, noteId, fromId);

        var countBefore = await CountEntriesAsync(client, noteId);
        await AssignCategoriesAsync(client, noteId, toId);
        var countAfter = await CountEntriesAsync(client, noteId);

        countAfter.Should().Be(countBefore + 1, "一次換分類只能產生一筆活動");
        var entry = await LatestEntryAsync(client, noteId, "updated");
        entry.Detail.Should().Contain("加入分類").And.Contain("目的分類");
        entry.Detail.Should().Contain("移出分類").And.Contain("來源分類");
    }

    // ── 測試 6：標籤加入/移除 ───────────────────────────────────────────────────────────

    /// <summary>
    /// 加標籤（單一標籤端點）→「加入標籤『名稱』」；移除（DELETE）→「移除標籤『名稱』」。
    /// </summary>
    [Fact]
    public async Task ActivityDetail_AddAndRemoveTag_RecordsTagName()
    {
        var client = await NewClientAsync("act-tag");
        var noteId = await CreateNoteAsync(client, "標籤筆記", "內文");
        var tagId = await CreateTagAsync(client, "急件");

        var addResponse = await client.PostAsync($"/api/notes/{noteId}/tags/{tagId}", null);
        addResponse.EnsureSuccessStatusCode();
        (await LatestEntryAsync(client, noteId, "updated")).Detail
            .Should().Contain("加入標籤").And.Contain("急件");

        var removeResponse = await client.DeleteAsync($"/api/notes/{noteId}/tags/{tagId}");
        removeResponse.EnsureSuccessStatusCode();
        (await LatestEntryAsync(client, noteId, "updated")).Detail
            .Should().Contain("移除標籤").And.Contain("急件");
    }

    // ── 測試 7：復活路徑（加→移→再加）仍記「加入」──────────────────────────────────────

    /// <summary>
    /// 同一分類「加入 → 移出 → 再加入」：第三步在 DB 是「復活軟刪列」（Modified，ValidFlag false→true），
    /// 仍必須記為「加入分類」。
    /// </summary>
    [Fact]
    public async Task ActivityDetail_ReAddCategoryAfterRemoval_RecordsAddAgain()
    {
        var client = await NewClientAsync("act-revive");
        var noteId = await CreateNoteAsync(client, "復活筆記", "內文");
        var categoryId = await CreateCategoryAsync(client, "循環分類");

        await AssignCategoriesAsync(client, noteId, categoryId);
        await AssignCategoriesAsync(client, noteId /* 清空 */);
        await AssignCategoriesAsync(client, noteId, categoryId); // 復活軟刪列

        var entry = await LatestEntryAsync(client, noteId, "updated");
        entry.Detail.Should().Contain("加入分類").And.Contain("循環分類");
    }

    // ── 測試 8：建立即帶分類 → 恰一筆 created、無 updated ──────────────────────────────

    /// <summary>
    /// POST /api/notes 一次帶入 categoryIds → 該筆記只產生「一筆 created」活動，
    /// 不得再多出「updated（加入分類）」的雜訊。
    /// </summary>
    [Fact]
    public async Task ActivityDetail_CreateNoteWithCategories_ProducesOnlyCreated()
    {
        var client = await NewClientAsync("act-createcat");
        var categoryId = await CreateCategoryAsync(client, "初始分類");

        var response = await client.PostAsJsonAsync("/api/notes", new
        {
            title = "含分類新筆記",
            contentRaw = "內文",
            categoryIds = new[] { categoryId },
        });
        response.EnsureSuccessStatusCode();
        var noteId = Guid.Parse(
            (await response.ReadJsonAsync())["data"]!["id"]!.GetValue<string>());

        var entries = await EntriesAsync(client, noteId);
        entries.Should().ContainSingle("建立即帶分類只能有一筆活動")
            .Which.Action.Should().Be("created");
    }

    // ── 測試 9：混合 PUT（標題＋分類）→ 恰一筆 updated、detail 兩者都有 ──────────────────

    /// <summary>
    /// 單一 PUT 同時改標題與分類 → 只產生「一筆」updated，detail 同時含標題變更與分類變更。
    /// </summary>
    [Fact]
    public async Task ActivityDetail_MixedUpdate_ProducesSingleEntryWithBothChanges()
    {
        var client = await NewClientAsync("act-mixed");
        var noteId = await CreateNoteAsync(client, "混合舊標", "內文");
        var categoryId = await CreateCategoryAsync(client, "混合分類");

        var countBefore = await CountEntriesAsync(client, noteId);
        await PutNoteAsync(client, noteId, new
        {
            title = "混合新標",
            categoryIds = new[] { categoryId },
        });
        var countAfter = await CountEntriesAsync(client, noteId);

        countAfter.Should().Be(countBefore + 1, "混合更新只能產生一筆活動");
        var entry = await LatestEntryAsync(client, noteId, "updated");
        entry.Detail.Should().Contain("標題").And.Contain("混合新標");
        entry.Detail.Should().Contain("加入分類").And.Contain("混合分類");
    }

    // ── 測試 10：軟刪除／還原行為不變 ───────────────────────────────────────────────────

    /// <summary>
    /// DELETE 筆記 → deleted；trash 還原 → restored（既有行為回歸；不得被連結攔截邏輯干擾）。
    /// </summary>
    [Fact]
    public async Task ActivityDetail_SoftDeleteAndRestore_KeepExistingBehavior()
    {
        var client = await NewClientAsync("act-delres");
        var noteId = await CreateNoteAsync(client, "刪還筆記", "內文");
        var categoryId = await CreateCategoryAsync(client, "刪還分類");
        await AssignCategoriesAsync(client, noteId, categoryId);

        (await client.DeleteAsync($"/api/notes/{noteId}")).EnsureSuccessStatusCode();
        (await LatestEntryAsync(client, noteId)).Action.Should().Be("deleted");

        (await client.PostAsync($"/api/trash/Note/{noteId}/restore", null)).EnsureSuccessStatusCode();
        (await LatestEntryAsync(client, noteId)).Action.Should().Be("restored");
    }

    // ── 測試 11：無實質變更不記錄（回歸）────────────────────────────────────────────────

    /// <summary>
    /// PUT 傳入與現值完全相同的標題、且分類集合不變 → 不產生新活動（既有「只動稽核欄不算編輯」回歸）。
    /// </summary>
    [Fact]
    public async Task ActivityDetail_NoRealChange_ProducesNoEntry()
    {
        var client = await NewClientAsync("act-nochange");
        var noteId = await CreateNoteAsync(client, "不變筆記", "內文");
        var categoryId = await CreateCategoryAsync(client, "不變分類");
        await AssignCategoriesAsync(client, noteId, categoryId);

        var countBefore = await CountEntriesAsync(client, noteId);
        await PutNoteAsync(client, noteId, new
        {
            title = "不變筆記",
            categoryIds = new[] { categoryId },
        });
        var countAfter = await CountEntriesAsync(client, noteId);

        countAfter.Should().Be(countBefore, "沒有任何實質變更不應記活動");
    }

    // ── 測試 12：activity-log 端點回 detail 與 note 項目的 categories ────────────────────

    /// <summary>
    /// GET /api/me/activity-log：每筆含 detail 欄位；entityType=note 的項目含
    /// categories（該筆記「目前」的分類完整路徑，用於區分同名筆記）。
    /// </summary>
    [Fact]
    public async Task ActivityLog_Endpoint_ReturnsDetailAndCurrentCategories()
    {
        var client = await NewClientAsync("act-endpoint");
        var parentId = await CreateCategoryAsync(client, "端點父");
        var childId = await CreateCategoryAsync(client, "端點子", parentId);
        var noteId = await CreateNoteAsync(client, "端點筆記", "內文");
        await AssignCategoriesAsync(client, noteId, childId);
        await PutNoteAsync(client, noteId, new { title = "端點筆記改" });

        var entry = await LatestEntryAsync(client, noteId, "updated");
        entry.Detail.Should().NotBeNullOrEmpty();
        entry.Categories.Should().NotBeNull();
        entry.Categories.Should().Contain("端點父 / 端點子");
    }

    // ── 測試 13：超長變更摘要不得溢位 DB 欄位（對抗式復審 CRITICAL 回歸）──────────────

    /// <summary>
    /// 一次加入兩個「超長名稱」分類 → 合併後的變更摘要超過 500 字元。
    /// 摘要必須被截到 ≤ 500 且存檔成功（不得因 varchar(500) 溢位使整批交易 rollback、讓使用者存檔回 500）。
    /// </summary>
    [Fact]
    public async Task ActivityDetail_LongChangeSummary_TruncatedAndDoesNotOverflow()
    {
        var client = await NewClientAsync("act-longdetail");
        var noteId = await CreateNoteAsync(client, "長摘要筆記", "內文");
        var longName1 = new string('甲', 250);
        var longName2 = new string('乙', 250);
        var cat1 = await CreateCategoryAsync(client, longName1);
        var cat2 = await CreateCategoryAsync(client, longName2);

        // 合併摘要「加入分類「甲×250」；加入分類「乙×250」」> 500；AssignCategoriesAsync 內含 EnsureSuccessStatusCode，
        // 若 log 因溢位使交易 rollback，這裡就會拋（RED，即修正前的行為）。
        await AssignCategoriesAsync(client, noteId, cat1, cat2);

        var entry = await LatestEntryAsync(client, noteId, "updated");
        entry.Detail.Should().NotBeNullOrEmpty();
        entry.Detail!.Length.Should().BeLessThanOrEqualTo(500, "摘要必須截到欄位上限內");
    }

    // ── 測試 14：刪除整個標籤不得為每篇筆記各記一筆假活動（對抗式復審 MEDIUM 回歸）──────

    /// <summary>
    /// 刪除一個貼在多篇筆記上的標籤 → 連帶移除各筆記的關聯，但這不是「逐一編輯那些筆記」，
    /// 不得為每篇筆記各產生一筆「移除標籤」活動。
    /// </summary>
    [Fact]
    public async Task ActivityDetail_DeletingWholeTag_DoesNotEmitPerNoteActivities()
    {
        var client = await NewClientAsync("act-deltag");
        var noteA = await CreateNoteAsync(client, "共標筆記A", "內文");
        var noteB = await CreateNoteAsync(client, "共標筆記B", "內文");
        var tagId = await CreateTagAsync(client, "共用標籤");
        (await client.PostAsync($"/api/notes/{noteA}/tags/{tagId}", null)).EnsureSuccessStatusCode();
        (await client.PostAsync($"/api/notes/{noteB}/tags/{tagId}", null)).EnsureSuccessStatusCode();

        var beforeA = await CountEntriesAsync(client, noteA);
        var beforeB = await CountEntriesAsync(client, noteB);

        // 刪除整個標籤（軟刪標籤本身＋硬刪各筆記關聯）。
        (await client.DeleteAsync($"/api/notes/tags/{tagId}")).EnsureSuccessStatusCode();

        (await CountEntriesAsync(client, noteA)).Should().Be(beforeA, "刪標籤不應為筆記A新增活動");
        (await CountEntriesAsync(client, noteB)).Should().Be(beforeB, "刪標籤不應為筆記B新增活動");
    }

    // ══════════════════════════════ 測試輔助 ══════════════════════════════

    /// <summary>建立一位新使用者並回傳已帶 Bearer 權杖的用戶端。</summary>
    /// <param name="prefix">Email 前綴（辨識用）。</param>
    private async Task<HttpClient> NewClientAsync(string prefix)
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync(
            $"{prefix}-{Guid.NewGuid():N}@example.com");
        return _factory.CreateClientWithToken(token);
    }

    /// <summary>透過真實 HTTP 建立一則筆記，回傳其 Id。</summary>
    /// <param name="client">已帶 Bearer 權杖的用戶端。</param>
    /// <param name="title">筆記標題。</param>
    /// <param name="content">筆記原始內容。</param>
    private static async Task<Guid> CreateNoteAsync(HttpClient client, string title, string content)
    {
        var response = await client.PostAsJsonAsync("/api/notes", new { title, contentRaw = content });
        response.EnsureSuccessStatusCode();
        return Guid.Parse((await response.ReadJsonAsync())["data"]!["id"]!.GetValue<string>());
    }

    /// <summary>透過真實 HTTP 建立分類，回傳分類 Id。</summary>
    /// <param name="client">已帶 Bearer 權杖的用戶端。</param>
    /// <param name="name">分類名稱。</param>
    /// <param name="parentId">上層分類 Id（可空＝頂層）。</param>
    private static async Task<Guid> CreateCategoryAsync(
        HttpClient client,
        string name,
        Guid? parentId = null)
    {
        var response = await client.PostAsJsonAsync("/api/categories", new { name, parentId });
        response.EnsureSuccessStatusCode();
        return Guid.Parse((await response.ReadJsonAsync())["data"]!["id"]!.GetValue<string>());
    }

    /// <summary>透過真實 HTTP 建立標籤，回傳標籤 Id。</summary>
    /// <param name="client">已帶 Bearer 權杖的用戶端。</param>
    /// <param name="name">標籤名稱。</param>
    private static async Task<Guid> CreateTagAsync(HttpClient client, string name)
    {
        var response = await client.PostAsJsonAsync("/api/notes/tags", new { name });
        response.EnsureSuccessStatusCode();
        return Guid.Parse((await response.ReadJsonAsync())["data"]!["id"]!.GetValue<string>());
    }

    /// <summary>PUT /api/notes/{id}（PATCH 語意）。</summary>
    /// <param name="client">已帶 Bearer 權杖的用戶端。</param>
    /// <param name="noteId">筆記 Id。</param>
    /// <param name="body">請求主體（匿名物件）。</param>
    private static async Task PutNoteAsync(HttpClient client, Guid noteId, object body)
    {
        var response = await client.PutAsJsonAsync($"/api/notes/{noteId}", body);
        response.EnsureSuccessStatusCode();
    }

    /// <summary>以「整組取代」端點設定筆記分類（不帶＝清空）。</summary>
    /// <param name="client">已帶 Bearer 權杖的用戶端。</param>
    /// <param name="noteId">筆記 Id。</param>
    /// <param name="categoryIds">目標分類 Id（可為空）。</param>
    private static async Task AssignCategoriesAsync(
        HttpClient client,
        Guid noteId,
        params Guid[] categoryIds)
    {
        var response = await client.PutAsJsonAsync($"/api/notes/{noteId}/categories", categoryIds);
        response.EnsureSuccessStatusCode();
    }

    /// <summary>讀取 activity-log 中屬於某實體的全部項目（新→舊）。</summary>
    /// <param name="client">已帶 Bearer 權杖的用戶端。</param>
    /// <param name="entityId">實體 Id。</param>
    private static async Task<List<ActivityEntry>> EntriesAsync(HttpClient client, Guid entityId)
    {
        var response = await client.GetAsync("/api/me/activity-log");
        response.EnsureSuccessStatusCode();
        var data = (await response.ReadJsonAsync())["data"]!.AsArray();

        return data
            .Where(node => node!["entityId"]!.GetValue<string>() == entityId.ToString())
            .Select(node => new ActivityEntry(
                node!["action"]!.GetValue<string>(),
                node["entityType"]!.GetValue<string>(),
                node["title"]!.GetValue<string>(),
                node["detail"]?.GetValue<string>(),
                node["categories"] is JsonArray array
                    ? array.Select(item => item!.GetValue<string>()).ToList()
                    : null))
            .ToList();
    }

    /// <summary>屬於某實體的活動筆數。</summary>
    /// <param name="client">已帶 Bearer 權杖的用戶端。</param>
    /// <param name="entityId">實體 Id。</param>
    private static async Task<int> CountEntriesAsync(HttpClient client, Guid entityId)
        => (await EntriesAsync(client, entityId)).Count;

    /// <summary>取某實體最新一筆活動（可選指定動作）。</summary>
    /// <param name="client">已帶 Bearer 權杖的用戶端。</param>
    /// <param name="entityId">實體 Id。</param>
    /// <param name="action">要求的動作（null＝不限）。</param>
    private static async Task<ActivityEntry> LatestEntryAsync(
        HttpClient client,
        Guid entityId,
        string? action = null)
    {
        var entries = await EntriesAsync(client, entityId);
        var filtered = action is null ? entries : entries.Where(e => e.Action == action).ToList();
        filtered.Should().NotBeEmpty($"實體 {entityId} 應有{action ?? "任意"}活動");
        return filtered.First();
    }

    /// <summary>
    /// 活動明細的輕量投影（僅取斷言需要的欄位）。
    /// </summary>
    /// <param name="Action">動作（created/updated/deleted/restored）。</param>
    /// <param name="EntityType">實體型別。</param>
    /// <param name="Title">實體標題。</param>
    /// <param name="Detail">變更內容摘要（可空）。</param>
    /// <param name="Categories">筆記目前分類路徑（非筆記或未回傳為 null）。</param>
    private sealed record ActivityEntry(
        string Action,
        string EntityType,
        string Title,
        string? Detail,
        List<string>? Categories);
}
