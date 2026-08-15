using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using ZonWiki.Domain.Entities;
using Xunit;

namespace ZonWiki.Api.Tests.Integration;

/// <summary>
/// 全站搜尋「結果脈絡強化 ＋ 進階篩選」的真 HTTP 整合測試。
///
/// 涵蓋（對應 feature/search-and-activity-ux 的搜尋段）：
/// - 筆記結果附「分類完整路徑」（categories）、「標籤名稱」（tags）與「更新時間」（updatedAt）；
/// - 浮層（T 文字框／便利貼）結果附「所屬筆記標題」（parentTitle）；
/// - 新查詢參數：categoryId（含所有子孫分類、只回筆記型別）、tags（CSV，只回筆記型別）、
///   sort（relevance｜updated）、limit clamp（1–500，非法回退 50）；
/// - 「瀏覽模式」：空 q ＋ categoryId／tags → 回該範圍全部筆記、依更新時間排序；
/// - 邊界：他人／未知 categoryId・tagId 不外洩、DB 級分類環不掛死、多分類筆記回多條路徑。
///
/// 全部走 WebApplicationFactory ＋ 真 PostgreSQL 容器（見 <see cref="ZonWikiApiFactory"/>）。
/// 容器跨測試共用，故所有可搜尋文字皆嵌入「每測試唯一的 GUID token」以隔離資料。
/// </summary>
[Collection(ApiIntegrationCollection.Name)]
public sealed class SearchEnrichmentHttpTests
{
    private readonly ZonWikiApiFactory _factory;

    /// <summary>
    /// 注入共用的整合測試基座。
    /// </summary>
    /// <param name="factory">整合測試基座。</param>
    public SearchEnrichmentHttpTests(ZonWikiApiFactory factory)
    {
        _factory = factory;
    }

    // ── 測試 1：筆記結果附分類完整路徑、標籤與更新時間 ─────────────────────────────

    /// <summary>
    /// 筆記歸在「父 → 子」分類並貼一個標籤 → 搜尋結果的該筆記應帶：
    /// categories=["父 / 子"]（完整路徑）、tags=[標籤名]、updatedAt 非空。
    /// </summary>
    [Fact]
    public async Task Search_NoteResult_IncludesCategoryPathTagsAndUpdatedAt()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync(UniqueEmail("enrich-basic"));
        var client = _factory.CreateClientWithToken(token);

        var parentId = await CreateCategoryAsync(client, "學習");
        var childId = await CreateCategoryAsync(client, "併發", parentId);
        var tagId = await CreateTagAsync(client, "dotnet");

        var needle = Token();
        var (noteId, _) = await CreateNoteAsync(client, $"README {needle}", "內文");
        await AssignCategoriesAsync(client, noteId, childId);
        await AssignTagsAsync(client, noteId, tagId);

        var results = await SearchAsync(client, $"q={Uri.EscapeDataString(needle)}");

        var hit = results.Single(r => r.Type == "note" && r.Id == noteId.ToString());
        hit.Categories.Should().NotBeNull();
        hit.Categories.Should().ContainSingle().Which.Should().Be("學習 / 併發");
        hit.Tags.Should().NotBeNull();
        hit.Tags.Should().ContainSingle().Which.Should().Be("dotnet");
        hit.UpdatedAt.Should().NotBeNull();
    }

    // ── 測試 2：無分類無標籤的筆記 → categories / tags 為空陣列（非 null）─────────────

    /// <summary>
    /// 未歸類、未貼標籤的筆記：categories 與 tags 應為「空陣列」而非缺欄位或 null
    /// （釘死回傳形狀，前端不需 null 防禦分支）。
    /// </summary>
    [Fact]
    public async Task Search_NoteWithoutCategoriesOrTags_ReturnsEmptyArrays()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync(UniqueEmail("enrich-empty"));
        var client = _factory.CreateClientWithToken(token);

        var needle = Token();
        var (noteId, _) = await CreateNoteAsync(client, $"孤兒筆記 {needle}", "內文");

        var results = await SearchAsync(client, $"q={Uri.EscapeDataString(needle)}");

        var hit = results.Single(r => r.Type == "note" && r.Id == noteId.ToString());
        hit.Categories.Should().NotBeNull().And.BeEmpty();
        hit.Tags.Should().NotBeNull().And.BeEmpty();
    }

    // ── 測試 3：浮層結果附所屬筆記標題（text 與 sticky 都要）───────────────────────────

    /// <summary>
    /// T 文字框與便利貼浮層的搜尋結果應帶 parentTitle=所屬筆記標題，
    /// 讓使用者知道這段浮層文字「在哪篇筆記裡」。
    /// </summary>
    [Fact]
    public async Task Search_OverlayResults_IncludeParentNoteTitle()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync(UniqueEmail("enrich-overlay"));
        var client = _factory.CreateClientWithToken(token);
        var (noteId, _) = await CreateNoteAsync(client, "宿主筆記標題", "內文");

        var textNeedle = Token();
        await SeedOverlayAsync(userId, noteId, "text", text: $"文字框 {textNeedle}");
        var stickyNeedle = Token();
        await SeedOverlayAsync(userId, noteId, "sticky", text: $"便利貼 {stickyNeedle}");

        var textHit = (await SearchAsync(client, $"q={Uri.EscapeDataString(textNeedle)}"))
            .Single(r => r.Type == "overlay-text");
        textHit.ParentTitle.Should().Be("宿主筆記標題");

        var stickyHit = (await SearchAsync(client, $"q={Uri.EscapeDataString(stickyNeedle)}"))
            .Single(r => r.Type == "overlay-sticky");
        stickyHit.ParentTitle.Should().Be("宿主筆記標題");
    }

    // ── 測試 4：categoryId 篩選（含子孫分類；非筆記型別一律排除）─────────────────────

    /// <summary>
    /// 兩篇同名筆記分屬「目標分類的子分類」與「不相干分類」；另有同 token 的任務。
    /// 帶 categoryId=目標分類 → 只回「子分類那篇」筆記；不相干筆記與任務都不出現。
    /// </summary>
    [Fact]
    public async Task Search_CategoryIdFilter_IncludesDescendants_ExcludesOtherTypes()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync(UniqueEmail("enrich-catfilter"));
        var client = _factory.CreateClientWithToken(token);

        var targetId = await CreateCategoryAsync(client, "目標");
        var childId = await CreateCategoryAsync(client, "目標子", targetId);
        var unrelatedId = await CreateCategoryAsync(client, "不相干");

        var needle = Token();
        var (inScopeId, _) = await CreateNoteAsync(client, $"README {needle}", "內文");
        await AssignCategoriesAsync(client, inScopeId, childId);
        var (outScopeId, _) = await CreateNoteAsync(client, $"README2 {needle}", "內文");
        await AssignCategoriesAsync(client, outScopeId, unrelatedId);
        await client.CreateTaskAsync($"任務 {needle}");

        var results = await SearchAsync(
            client,
            $"q={Uri.EscapeDataString(needle)}&categoryId={targetId}");

        results.Should().Contain(r => r.Type == "note" && r.Id == inScopeId.ToString());
        results.Should().NotContain(r => r.Id == outScopeId.ToString());
        results.Should().OnlyContain(r => r.Type == "note");
    }

    // ── 測試 5：tags 篩選（只回含任一指定標籤的筆記）───────────────────────────────────

    /// <summary>
    /// 兩篇筆記只有一篇貼了指定標籤 → 帶 tags={tagId} 只回那一篇；任務等其他型別不出現。
    /// </summary>
    [Fact]
    public async Task Search_TagsFilter_ReturnsOnlyTaggedNotes()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync(UniqueEmail("enrich-tagfilter"));
        var client = _factory.CreateClientWithToken(token);

        var tagId = await CreateTagAsync(client, "重要");

        var needle = Token();
        var (taggedId, _) = await CreateNoteAsync(client, $"筆記A {needle}", "內文");
        await AssignTagsAsync(client, taggedId, tagId);
        var (untaggedId, _) = await CreateNoteAsync(client, $"筆記B {needle}", "內文");
        await client.CreateTaskAsync($"任務 {needle}");

        var results = await SearchAsync(
            client,
            $"q={Uri.EscapeDataString(needle)}&tags={tagId}");

        results.Should().Contain(r => r.Type == "note" && r.Id == taggedId.ToString());
        results.Should().NotContain(r => r.Id == untaggedId.ToString());
        results.Should().OnlyContain(r => r.Type == "note");
    }

    // ── 測試 6：sort=updated 依更新時間新→舊排序 ───────────────────────────────────────

    /// <summary>
    /// 先建 A 再建 B（B 較新），之後再更新 A（A 變最新）→ sort=updated 時 A 應排在 B 之前。
    /// </summary>
    [Fact]
    public async Task Search_SortUpdated_OrdersByUpdatedAtDescending()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync(UniqueEmail("enrich-sort"));
        var client = _factory.CreateClientWithToken(token);

        var needle = Token();
        var (noteAId, _) = await CreateNoteAsync(client, $"甲 {needle}", "內文");
        var (noteBId, _) = await CreateNoteAsync(client, $"乙 {needle}", "內文");

        // 更新 A，讓 A 的 UpdatedDateTime 晚於 B。
        var putResponse = await client.PutAsJsonAsync(
            $"/api/notes/{noteAId}",
            new { contentRaw = $"更新後內文 {needle}" });
        putResponse.EnsureSuccessStatusCode();

        var results = await SearchAsync(
            client,
            $"q={Uri.EscapeDataString(needle)}&sort=updated");

        var indexA = results.FindIndex(r => r.Id == noteAId.ToString());
        var indexB = results.FindIndex(r => r.Id == noteBId.ToString());
        indexA.Should().BeGreaterThanOrEqualTo(0);
        indexB.Should().BeGreaterThanOrEqualTo(0);
        indexA.Should().BeLessThan(indexB, "A 後更新，sort=updated 應排在 B 前面");
    }

    // ── 測試 7：瀏覽模式（空 q ＋ categoryId → 回該範圍全部筆記）────────────────────────

    /// <summary>
    /// 不帶 q、只帶 categoryId → 回該分類（含子孫）全部筆記（依更新時間新→舊）；
    /// 不帶 q 也不帶任何篩選 → 維持現狀回空結果。
    /// </summary>
    [Fact]
    public async Task Search_BrowseMode_EmptyQueryWithCategoryReturnsScopedNotes()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync(UniqueEmail("enrich-browse"));
        var client = _factory.CreateClientWithToken(token);

        var categoryId = await CreateCategoryAsync(client, "瀏覽分類");
        var (noteId, _) = await CreateNoteAsync(client, "瀏覽筆記（無關鍵字）", "內文");
        await AssignCategoriesAsync(client, noteId, categoryId);

        // 空 q ＋ categoryId → 瀏覽模式。
        var browseResults = await SearchAsync(client, $"categoryId={categoryId}");
        browseResults.Should().Contain(r => r.Type == "note" && r.Id == noteId.ToString());

        // 空 q ＋ 無篩選 → 空結果（回歸既有行為）。
        var emptyResults = await SearchAsync(client, "q=");
        emptyResults.Should().BeEmpty();
    }

    // ── 測試 8：他人／未知的 categoryId・tagId → 空結果、不外洩、不 500 ─────────────────

    /// <summary>
    /// 帶「別人的分類 Id」「不存在的分類 Id」「不存在的標籤 Id」當篩選 → 一律回 200＋空結果
    /// （不可外洩他人資料、不可噴 500）。
    /// </summary>
    [Fact]
    public async Task Search_ForeignOrUnknownFilterIds_ReturnEmptyWithoutLeak()
    {
        var (_, tokenA) = await _factory.SeedUserWithTokenAsync(UniqueEmail("enrich-foreign-a"));
        var clientA = _factory.CreateClientWithToken(tokenA);
        var (_, tokenB) = await _factory.SeedUserWithTokenAsync(UniqueEmail("enrich-foreign-b"));
        var clientB = _factory.CreateClientWithToken(tokenB);

        // B 的分類與筆記。
        var bCategoryId = await CreateCategoryAsync(clientB, "B的分類");
        var needle = Token();
        var (bNoteId, _) = await CreateNoteAsync(clientB, $"B的筆記 {needle}", "內文");
        await AssignCategoriesAsync(clientB, bNoteId, bCategoryId);

        // A 拿 B 的 categoryId 搜（帶 B 才命中的 token）→ 空結果。
        (await SearchAsync(clientA, $"q={Uri.EscapeDataString(needle)}&categoryId={bCategoryId}"))
            .Should().BeEmpty();

        // 不存在的 categoryId / tagId → 空結果（不 500）。
        (await SearchAsync(clientA, $"q={Uri.EscapeDataString(needle)}&categoryId={Guid.NewGuid()}"))
            .Should().BeEmpty();
        (await SearchAsync(clientA, $"q={Uri.EscapeDataString(needle)}&tags={Guid.NewGuid()}"))
            .Should().BeEmpty();
    }

    // ── 測試 9：多分類筆記回多條路徑 ─────────────────────────────────────────────────────

    /// <summary>
    /// 一篇筆記同時屬於兩個分類 → categories 應包含兩條完整路徑。
    /// </summary>
    [Fact]
    public async Task Search_NoteInMultipleCategories_ReturnsAllPaths()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync(UniqueEmail("enrich-multicat"));
        var client = _factory.CreateClientWithToken(token);

        var firstId = await CreateCategoryAsync(client, "甲分類");
        var secondId = await CreateCategoryAsync(client, "乙分類");

        var needle = Token();
        var (noteId, _) = await CreateNoteAsync(client, $"雙分類 {needle}", "內文");
        await AssignCategoriesAsync(client, noteId, firstId, secondId);

        var results = await SearchAsync(client, $"q={Uri.EscapeDataString(needle)}");

        var hit = results.Single(r => r.Type == "note" && r.Id == noteId.ToString());
        hit.Categories.Should().BeEquivalentTo(new[] { "甲分類", "乙分類" });
    }

    // ── 測試 10：DB 級分類環不掛死（路徑拼接與子孫展開都要 cycle-safe）──────────────────

    /// <summary>
    /// 直接在 DB 種一個「甲 ↔ 乙 互為父子」的分類環（API 有防環、DB 直改可繞過），
    /// 筆記歸入其中一個 → 搜尋（含 categoryId 篩選）應正常回 200、路徑有限長、不無窮迴圈。
    /// </summary>
    [Fact]
    public async Task Search_CategoryCycleInDb_DoesNotHang()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync(UniqueEmail("enrich-cycle"));
        var client = _factory.CreateClientWithToken(token);

        var firstId = await CreateCategoryAsync(client, "環甲");
        var secondId = await CreateCategoryAsync(client, "環乙", firstId);
        // DB 直改：把「環甲」的 Parent 指到「環乙」→ 形成 甲→乙→甲 的環。
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            var first = await db.Category.IgnoreQueryFilters().FirstAsync(c => c.Id == firstId);
            first.ParentId = secondId;
            await db.SaveChangesAsync();
        }

        var needle = Token();
        var (noteId, _) = await CreateNoteAsync(client, $"環中筆記 {needle}", "內文");
        await AssignCategoriesAsync(client, noteId, secondId);

        // 一般搜尋：路徑拼接不得無窮迴圈。
        var results = await SearchAsync(client, $"q={Uri.EscapeDataString(needle)}");
        var hit = results.Single(r => r.Type == "note" && r.Id == noteId.ToString());
        hit.Categories.Should().NotBeNull();
        hit.Categories!.Single().Length.Should().BeLessThan(200, "環必須被截斷，不可無限增長");

        // categoryId 篩選：子孫展開不得無窮迴圈。
        var filtered = await SearchAsync(client, $"q={Uri.EscapeDataString(needle)}&categoryId={firstId}");
        filtered.Should().Contain(r => r.Id == noteId.ToString());
        _ = userId;
    }

    // ── 測試 11：limit clamp 與未知 sort 值回退 ─────────────────────────────────────────

    /// <summary>
    /// limit=0／limit=99999／sort=bogus → 皆回 200 且結果正常（clamp 與回退，不噴錯）。
    /// </summary>
    [Fact]
    public async Task Search_InvalidLimitOrSort_FallsBackGracefully()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync(UniqueEmail("enrich-clamp"));
        var client = _factory.CreateClientWithToken(token);

        var needle = Token();
        var (noteId, _) = await CreateNoteAsync(client, $"夾筆記 {needle}", "內文");

        foreach (var query in new[]
        {
            $"q={Uri.EscapeDataString(needle)}&limit=0",
            $"q={Uri.EscapeDataString(needle)}&limit=99999",
            $"q={Uri.EscapeDataString(needle)}&sort=bogus",
        })
        {
            var results = await SearchAsync(client, query);
            results.Should().Contain(r => r.Id == noteId.ToString(), $"query「{query}」應正常運作");
        }
    }

    // ── 測試 12：enrichment 不外洩他人分類（DB 級跨租戶連結）────────────────────────────

    /// <summary>
    /// 直接在 DB 種一列「A 的筆記 → B 的分類」的異常連結（正常 API 建不出來）→
    /// A 搜尋自己的筆記時，categories 不得出現 B 的分類名（enrichment join 必須套用使用者過濾）。
    /// </summary>
    [Fact]
    public async Task Search_CrossUserCategoryLink_DoesNotLeakName()
    {
        var (userAId, tokenA) = await _factory.SeedUserWithTokenAsync(UniqueEmail("enrich-leak-a"));
        var clientA = _factory.CreateClientWithToken(tokenA);
        var (_, tokenB) = await _factory.SeedUserWithTokenAsync(UniqueEmail("enrich-leak-b"));
        var clientB = _factory.CreateClientWithToken(tokenB);

        var bCategoryId = await CreateCategoryAsync(clientB, "B機密分類");
        var needle = Token();
        var (aNoteId, _) = await CreateNoteAsync(clientA, $"A的筆記 {needle}", "內文");

        // DB 直種異常連結：A 的筆記指到 B 的分類。
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            db.NoteCategory.Add(new NoteCategory
            {
                UserId = userAId,
                NoteId = aNoteId,
                CategoryId = bCategoryId,
                CreatedUser = "test",
                UpdatedUser = "test",
            });
            await db.SaveChangesAsync();
        }

        var results = await SearchAsync(clientA, $"q={Uri.EscapeDataString(needle)}");
        var hit = results.Single(r => r.Type == "note" && r.Id == aNoteId.ToString());
        hit.Categories.Should().NotContain(name => name.Contains("B機密分類"));
    }

    // ══════════════════════════════ 測試輔助 ══════════════════════════════

    /// <summary>產生每次唯一的搜尋 token（GUID 十六進位，確保 ILIKE 只命中本測試資料）。</summary>
    private static string Token() => "zwtok" + Guid.NewGuid().ToString("N");

    /// <summary>產生每次唯一的測試用 Email。</summary>
    /// <param name="prefix">辨識用前綴。</param>
    private static string UniqueEmail(string prefix) => $"{prefix}-{Guid.NewGuid():N}@example.com";

    /// <summary>
    /// 透過真實 HTTP 建立一則筆記，回傳其 Id 與 slug。
    /// </summary>
    /// <param name="client">已帶 Bearer 權杖的用戶端。</param>
    /// <param name="title">筆記標題。</param>
    /// <param name="content">筆記原始內容。</param>
    /// <returns>新筆記的 Id 與 slug。</returns>
    private static async Task<(Guid NoteId, string Slug)> CreateNoteAsync(
        HttpClient client,
        string title,
        string content)
    {
        var response = await client.PostAsJsonAsync("/api/notes", new { title, contentRaw = content });
        response.EnsureSuccessStatusCode();
        var data = (await response.ReadJsonAsync())["data"]!;
        return (Guid.Parse(data["id"]!.GetValue<string>()), data["slug"]!.GetValue<string>());
    }

    /// <summary>
    /// 透過真實 HTTP 建立分類，回傳分類 Id。
    /// </summary>
    /// <param name="client">已帶 Bearer 權杖的用戶端。</param>
    /// <param name="name">分類名稱。</param>
    /// <param name="parentId">上層分類 Id（可空＝頂層）。</param>
    /// <returns>新分類 Id。</returns>
    private static async Task<Guid> CreateCategoryAsync(
        HttpClient client,
        string name,
        Guid? parentId = null)
    {
        var response = await client.PostAsJsonAsync("/api/categories", new { name, parentId });
        response.EnsureSuccessStatusCode();
        var data = (await response.ReadJsonAsync())["data"]!;
        return Guid.Parse(data["id"]!.GetValue<string>());
    }

    /// <summary>
    /// 透過真實 HTTP 建立標籤，回傳標籤 Id。
    /// </summary>
    /// <param name="client">已帶 Bearer 權杖的用戶端。</param>
    /// <param name="name">標籤名稱。</param>
    /// <returns>新標籤 Id。</returns>
    private static async Task<Guid> CreateTagAsync(HttpClient client, string name)
    {
        var response = await client.PostAsJsonAsync("/api/notes/tags", new { name });
        response.EnsureSuccessStatusCode();
        var data = (await response.ReadJsonAsync())["data"]!;
        return Guid.Parse(data["id"]!.GetValue<string>());
    }

    /// <summary>
    /// 以「整組取代」端點設定筆記分類（body 為裸 Guid 陣列）。
    /// </summary>
    /// <param name="client">已帶 Bearer 權杖的用戶端。</param>
    /// <param name="noteId">筆記 Id。</param>
    /// <param name="categoryIds">目標分類 Id（可多個）。</param>
    private static async Task AssignCategoriesAsync(
        HttpClient client,
        Guid noteId,
        params Guid[] categoryIds)
    {
        var response = await client.PutAsJsonAsync($"/api/notes/{noteId}/categories", categoryIds);
        response.EnsureSuccessStatusCode();
    }

    /// <summary>
    /// 以「整組取代」端點設定筆記標籤（body 為裸 Guid 陣列）。
    /// </summary>
    /// <param name="client">已帶 Bearer 權杖的用戶端。</param>
    /// <param name="noteId">筆記 Id。</param>
    /// <param name="tagIds">目標標籤 Id（可多個）。</param>
    private static async Task AssignTagsAsync(
        HttpClient client,
        Guid noteId,
        params Guid[] tagIds)
    {
        var response = await client.PutAsJsonAsync($"/api/notes/{noteId}/tags", tagIds);
        response.EnsureSuccessStatusCode();
    }

    /// <summary>
    /// 直接寫 DB 種一個浮層元件（比照 SearchOverlayHttpTests；供 parentTitle 測試）。
    /// </summary>
    /// <param name="userId">擁有者使用者 Id。</param>
    /// <param name="noteId">所屬筆記 Id。</param>
    /// <param name="kind">型別（sticky / text）。</param>
    /// <param name="text">Text 欄位內容。</param>
    /// <returns>新浮層元件的 Id。</returns>
    private async Task<Guid> SeedOverlayAsync(
        Guid userId,
        Guid noteId,
        string kind,
        string? text)
    {
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            var item = new NoteOverlayItem
            {
                UserId = userId,
                NoteId = noteId,
                Kind = kind,
                X = 10,
                Y = 20,
                Width = 200,
                Height = 120,
                ZIndex = 1,
                Text = text,
                CreatedUser = userId.ToString(),
                UpdatedUser = userId.ToString(),
                ValidFlag = true,
            };
            db.NoteOverlayItem.Add(item);
            await db.SaveChangesAsync();
            return item.Id;
        }
    }

    /// <summary>
    /// 呼叫 <c>GET /api/search?{queryString}</c> 並解析結果（含 enrichment 欄位）。
    /// </summary>
    /// <param name="client">已帶 Bearer 權杖的用戶端。</param>
    /// <param name="queryString">查詢字串（不含 ?，例如 "q=abc&amp;sort=updated"）。</param>
    /// <returns>結果清單（含 categories / tags / updatedAt / parentTitle）。</returns>
    private static async Task<List<EnrichedSearchHit>> SearchAsync(
        HttpClient client,
        string queryString)
    {
        var response = await client.GetAsync($"/api/search?{queryString}");
        response.StatusCode.Should().Be(HttpStatusCode.OK, $"query「{queryString}」不應失敗");
        var data = (await response.ReadJsonAsync())["data"]!.AsArray();

        return data
            .Select(node => new EnrichedSearchHit(
                node!["type"]!.GetValue<string>(),
                node["id"]!.GetValue<string>(),
                node["title"]!.GetValue<string>(),
                node["url"]!.GetValue<string>(),
                ParseStringArray(node["categories"]),
                ParseStringArray(node["tags"]),
                node["updatedAt"]?.GetValue<DateTime?>(),
                node["parentTitle"]?.GetValue<string>()))
            .ToList();
    }

    /// <summary>
    /// 把 JSON 節點解析為字串清單；節點缺席或為 null → 回 null（供「必須是空陣列而非 null」的斷言區分）。
    /// </summary>
    /// <param name="node">JSON 陣列節點（可空）。</param>
    /// <returns>字串清單或 null。</returns>
    private static List<string>? ParseStringArray(JsonNode? node)
    {
        if (node is not JsonArray array) return null;
        return array.Select(item => item!.GetValue<string>()).ToList();
    }

    /// <summary>
    /// 搜尋結果的輕量投影（含 enrichment 欄位）。
    /// </summary>
    /// <param name="Type">結果類型。</param>
    /// <param name="Id">結果識別碼。</param>
    /// <param name="Title">結果標題。</param>
    /// <param name="Url">結果導航 URL。</param>
    /// <param name="Categories">筆記分類完整路徑清單（非筆記型別為 null）。</param>
    /// <param name="Tags">筆記標籤名稱清單（非筆記型別為 null）。</param>
    /// <param name="UpdatedAt">結果實體更新時間。</param>
    /// <param name="ParentTitle">浮層所屬筆記標題（非浮層為 null）。</param>
    private sealed record EnrichedSearchHit(
        string Type,
        string Id,
        string Title,
        string Url,
        List<string>? Categories,
        List<string>? Tags,
        DateTime? UpdatedAt,
        string? ParentTitle);
}
