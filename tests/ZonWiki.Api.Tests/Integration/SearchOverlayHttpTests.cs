using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using ZonWiki.Domain.Entities;
using Xunit;

namespace ZonWiki.Api.Tests.Integration;

/// <summary>
/// 全站搜尋「浮層（便利貼 / T 文字框）擴充 ＋ 類型篩選（types 參數）」的真 HTTP 整合測試。
///
/// 全部走 WebApplicationFactory ＋ 真 PostgreSQL 容器（見 <see cref="ZonWikiApiFactory"/>），
/// 對 <c>GET /api/search</c> 發真實 HTTP 請求，驗證「外部可觀察行為」：
/// - 浮層（text / sticky）是否被搜尋涵蓋、drawing / slide 是否被排除；
/// - types CSV 篩選（含 note-title / note-content 拆分、未知值視同未帶）；
/// - 使用者隔離、軟刪除排除；
/// - 回傳 DTO 的 Type、Title 推導與 Url（含 <c>?overlay={itemId}</c>）。
///
/// 由於整合測試集合共用同一顆容器（資料跨測試殘留），所有可搜尋文字皆嵌入「每測試唯一的 GUID token」，
/// 以 ILIKE 精準命中自己種下的資料、與其它測試資料完全隔離，避免相互污染。
/// </summary>
[Collection(ApiIntegrationCollection.Name)]
public sealed class SearchOverlayHttpTests
{
    private readonly ZonWikiApiFactory _factory;

    /// <summary>
    /// 注入共用的整合測試基座。
    /// </summary>
    /// <param name="factory">整合測試基座。</param>
    public SearchOverlayHttpTests(ZonWikiApiFactory factory)
    {
        _factory = factory;
    }

    // ── 測試 1：text 浮層可被內容搜到，Url 帶 slug 與 ?overlay=itemId ─────────────────

    /// <summary>
    /// text（T 文字框）浮層：其 Text 內含唯一 token → 搜尋該 token 應回一筆 type="overlay-text"，
    /// 且 Url 同時含所屬筆記 slug 與 <c>?overlay={itemId}</c>。
    /// </summary>
    [Fact]
    public async Task Search_TextOverlay_FoundByContent()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync(UniqueEmail("text-overlay"));
        var client = _factory.CreateClientWithToken(token);
        var (noteId, slug) = await CreateNoteAsync(client, "承載筆記", "內文");

        var needle = Token();
        var itemId = await SeedOverlayAsync(userId, noteId, "text", text: $"這是一段文字 {needle} 結尾");

        var results = await SearchAsync(client, needle);

        results.Should().ContainSingle(r => r.Type == "overlay-text");
        var hit = results.Single(r => r.Type == "overlay-text");
        hit.Id.Should().Be(itemId.ToString());
        hit.Url.Should().Contain(slug);
        hit.Url.Should().Contain($"?overlay={itemId}");
    }

    // ── 測試 2：sticky 便利貼可由 Text 命中、也可只由 DataJson.title 命中 ──────────────

    /// <summary>
    /// sticky（便利貼）浮層兩種命中路徑都要找得到：
    /// (a) Text 命中；(b) 只有 DataJson.title 命中（Text 空）。
    /// 且第二種情況的 Title 應取自 DataJson.title。
    /// </summary>
    [Fact]
    public async Task Search_StickyOverlay_FoundByTextAndTitle()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync(UniqueEmail("sticky-overlay"));
        var client = _factory.CreateClientWithToken(token);
        var (noteId, _) = await CreateNoteAsync(client, "便利貼筆記", "內文");

        // (a) 以 Text 命中。
        var textNeedle = Token();
        var byTextId = await SeedOverlayAsync(userId, noteId, "sticky", text: $"便利貼內文 {textNeedle}");

        // (b) 只有標題（DataJson.title）命中，Text 為空。
        var titleNeedle = Token();
        var titleValue = $"重點標題 {titleNeedle}";
        var byTitleId = await SeedOverlayAsync(
            userId, noteId, "sticky",
            text: null,
            dataJson: new JsonObject { ["title"] = titleValue }.ToJsonString());

        var byTextResults = await SearchAsync(client, textNeedle);
        byTextResults.Should().Contain(r => r.Type == "overlay-sticky" && r.Id == byTextId.ToString());

        var byTitleResults = await SearchAsync(client, titleNeedle);
        var titleHit = byTitleResults.Single(r => r.Type == "overlay-sticky" && r.Id == byTitleId.ToString());
        // 標題推導與「問題清單」共用同一規則（NoteQuestionHelpers.DeriveOverlayTitle）：
        // 取 DataJson.title，超過 30 字截斷＋省略號——此處以同規則算期望值，驗證標題確實來自 DataJson.title。
        var expectedTitle = titleValue.Length <= 30 ? titleValue : titleValue.Substring(0, 30) + "…";
        titleHit.Title.Should().Be(expectedTitle);
    }

    // ── 測試 3：drawing / slide 不可被搜尋（即使 DataJson 內含 token）──────────────────

    /// <summary>
    /// drawing（塗鴉）與 slide（圖片輪播）不納入搜尋：即使其 DataJson / Text 含 token 也不得出現在結果。
    /// </summary>
    [Fact]
    public async Task Search_DrawingAndSlide_NotSearchable()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync(UniqueEmail("drawing-slide"));
        var client = _factory.CreateClientWithToken(token);
        var (noteId, _) = await CreateNoteAsync(client, "塗鴉筆記", "內文");

        var drawingNeedle = Token();
        await SeedOverlayAsync(
            userId, noteId, "drawing",
            text: $"draw {drawingNeedle}",
            dataJson: $"[{{\"note\":\"{drawingNeedle}\"}}]");

        var slideNeedle = Token();
        await SeedOverlayAsync(
            userId, noteId, "slide",
            text: $"slide {slideNeedle}",
            dataJson: $"[\"https://example.com/{slideNeedle}.png\"]");

        (await SearchAsync(client, drawingNeedle)).Should().BeEmpty();
        (await SearchAsync(client, slideNeedle)).Should().BeEmpty();
    }

    // ── 測試 4：types=note-title / note-content 拆分（含未帶＝全部）─────────────────────

    /// <summary>
    /// note-title / note-content 篩選：
    /// A 標題命中、B 只內文命中。types=note-title 只回 A；types=note-content 只回 B；未帶回 A+B。
    /// </summary>
    [Fact]
    public async Task Search_TypesFilter_NoteTitleOnly()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync(UniqueEmail("note-title-filter"));
        var client = _factory.CreateClientWithToken(token);

        var needle = Token();
        var (noteAId, _) = await CreateNoteAsync(client, $"標題含 {needle}", "純內文無關鍵字");
        var (noteBId, _) = await CreateNoteAsync(client, "純標題無關鍵字", $"內文含 {needle}");

        var titleOnly = await SearchAsync(client, needle, types: "note-title");
        titleOnly.Should().Contain(r => r.Type == "note" && r.Id == noteAId.ToString());
        titleOnly.Should().NotContain(r => r.Type == "note" && r.Id == noteBId.ToString());

        var contentOnly = await SearchAsync(client, needle, types: "note-content");
        contentOnly.Should().Contain(r => r.Type == "note" && r.Id == noteBId.ToString());
        contentOnly.Should().NotContain(r => r.Type == "note" && r.Id == noteAId.ToString());

        var noFilter = await SearchAsync(client, needle);
        noFilter.Should().Contain(r => r.Type == "note" && r.Id == noteAId.ToString());
        noFilter.Should().Contain(r => r.Type == "note" && r.Id == noteBId.ToString());
    }

    // ── 測試 5：types=overlay-text 時不回 note / task ──────────────────────────────────

    /// <summary>
    /// types=overlay-text 時只回 overlay-text；同 token 的 note / task 一律不出現。
    /// </summary>
    [Fact]
    public async Task Search_TypesFilter_OverlayOnly()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync(UniqueEmail("overlay-only-filter"));
        var client = _factory.CreateClientWithToken(token);

        var needle = Token();
        var (noteId, _) = await CreateNoteAsync(client, $"筆記 {needle}", $"內文 {needle}");
        await client.CreateTaskAsync($"任務 {needle}");
        var overlayId = await SeedOverlayAsync(userId, noteId, "text", text: $"文字框 {needle}");

        var results = await SearchAsync(client, needle, types: "overlay-text");

        results.Should().Contain(r => r.Type == "overlay-text" && r.Id == overlayId.ToString());
        results.Should().NotContain(r => r.Type == "note");
        results.Should().NotContain(r => r.Type == "task");
    }

    // ── 測試 6：浮層依使用者隔離 ──────────────────────────────────────────────────────

    /// <summary>
    /// 使用者 B 的浮層不會被使用者 A 搜到（跨帳號隔離）。
    /// </summary>
    [Fact]
    public async Task Search_Overlay_IsolatedByUser()
    {
        var (userAId, tokenA) = await _factory.SeedUserWithTokenAsync(UniqueEmail("overlay-iso-a"));
        var clientA = _factory.CreateClientWithToken(tokenA);
        var (_, tokenB) = await _factory.SeedUserWithTokenAsync(UniqueEmail("overlay-iso-b"));
        var clientB = _factory.CreateClientWithToken(tokenB);

        // B 的筆記與浮層。
        var (noteBId, _) = await CreateNoteAsync(clientB, "B 的筆記", "內文");
        var (userBId, _) = await GetUserAndNoteOwner(noteBId);
        var needle = Token();
        await SeedOverlayAsync(userBId, noteBId, "text", text: $"只有 B 有 {needle}");

        // A 搜尋 → 找不到 B 的浮層。
        var aResults = await SearchAsync(clientA, needle);
        aResults.Should().NotContain(r => r.Type == "overlay-text");
        _ = userAId;
    }

    // ── 測試 7：軟刪除浮層被排除 ──────────────────────────────────────────────────────

    /// <summary>
    /// 軟刪除（ValidFlag=false）的浮層不出現在搜尋結果。
    /// </summary>
    [Fact]
    public async Task Search_SoftDeletedOverlay_Excluded()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync(UniqueEmail("overlay-softdel"));
        var client = _factory.CreateClientWithToken(token);
        var (noteId, _) = await CreateNoteAsync(client, "軟刪筆記", "內文");

        var needle = Token();
        await SeedOverlayAsync(userId, noteId, "text", text: $"已刪 {needle}", validFlag: false);

        (await SearchAsync(client, needle)).Should().BeEmpty();
    }

    // ── 測試 8（回歸）：未帶 types 時 note / task / node 冒煙命中 ───────────────────────

    /// <summary>
    /// 回歸：未帶 types（現行為）時，note / task / node 各自至少命中一筆。
    /// </summary>
    [Fact]
    public async Task Search_NoTypes_NoteTaskNodeSmoke()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync(UniqueEmail("smoke-all"));
        var client = _factory.CreateClientWithToken(token);

        var needle = Token();
        var (noteId, _) = await CreateNoteAsync(client, $"筆記 {needle}", "內文");
        await client.CreateTaskAsync($"任務 {needle}");
        var nodeId = await SeedCanvasNodeAsync(userId, $"節點 {needle}");

        var results = await SearchAsync(client, needle);

        results.Should().Contain(r => r.Type == "note" && r.Id == noteId.ToString());
        results.Should().Contain(r => r.Type == "task");
        results.Should().Contain(r => r.Type == "node" && r.Id == nodeId.ToString());
    }

    // ── 測試 9：types 全為未知值 → 視同未帶（回退全部型別，非空集合）──────────────────

    /// <summary>
    /// types=foo,bar（全是未知值）→ 應視同未帶、回退搜尋全部型別（易寫錯成回空集合的邊界）。
    /// </summary>
    [Fact]
    public async Task Search_TypesFilter_AllUnknownValues_TreatedAsNoFilter()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync(UniqueEmail("unknown-types"));
        var client = _factory.CreateClientWithToken(token);

        var needle = Token();
        var (noteId, _) = await CreateNoteAsync(client, $"筆記 {needle}", "內文");

        var results = await SearchAsync(client, needle, types: "foo,bar");

        results.Should().Contain(r => r.Type == "note" && r.Id == noteId.ToString());
    }

    // ── 測試 10：未認證 → 401 ─────────────────────────────────────────────────────────

    /// <summary>
    /// 未帶任何憑證打 /api/search → 401 Unauthorized（比照筆記端點慣例）。
    /// </summary>
    [Fact]
    public async Task Search_Unauthenticated_Returns401()
    {
        var client = _factory.CreateClient();

        var response = await client.GetAsync("/api/search?q=anything");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    // ══════════════════════════════ 測試輔助 ══════════════════════════════

    /// <summary>
    /// 產生每次唯一的搜尋 token（GUID 十六進位，確保 ILIKE 只命中本測試種下的資料）。
    /// </summary>
    private static string Token() => "zwtok" + Guid.NewGuid().ToString("N");

    /// <summary>
    /// 產生每次唯一的測試用 Email。
    /// </summary>
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
    /// 直接寫 DB 種一個浮層元件（略過 API 白名單，方便種 drawing / slide / 軟刪除 / 跨使用者等邊界）。
    /// </summary>
    /// <param name="userId">擁有者使用者 Id。</param>
    /// <param name="noteId">所屬筆記 Id。</param>
    /// <param name="kind">型別（sticky / text / drawing / slide）。</param>
    /// <param name="text">Text 欄位內容（可空）。</param>
    /// <param name="dataJson">DataJson 欄位內容（可空）。</param>
    /// <param name="validFlag">是否有效（false＝軟刪除）。</param>
    /// <returns>新浮層元件的 Id。</returns>
    private async Task<Guid> SeedOverlayAsync(
        Guid userId,
        Guid noteId,
        string kind,
        string? text = null,
        string? dataJson = null,
        bool validFlag = true)
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
                DataJson = dataJson,
                CreatedUser = userId.ToString(),
                UpdatedUser = userId.ToString(),
                ValidFlag = validFlag,
                DeletedDateTime = validFlag ? null : DateTime.UtcNow,
            };
            db.NoteOverlayItem.Add(item);
            await db.SaveChangesAsync();
            return item.Id;
        }
    }

    /// <summary>
    /// 直接寫 DB 種一個畫布與其下一個節點（供 node 搜尋回歸測試），回傳節點 Id。
    /// </summary>
    /// <param name="userId">擁有者使用者 Id。</param>
    /// <param name="nodeContent">節點內容（含搜尋 token）。</param>
    /// <returns>新節點的 Id。</returns>
    private async Task<Guid> SeedCanvasNodeAsync(Guid userId, string nodeContent)
    {
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            var canvas = new Canvas
            {
                UserId = userId,
                Title = "測試畫布",
                CreatedUser = userId.ToString(),
                UpdatedUser = userId.ToString(),
            };
            db.Canvas.Add(canvas);
            await db.SaveChangesAsync();

            var node = new Node
            {
                UserId = userId,
                CanvasId = canvas.Id,
                Title = "節點",
                Content = nodeContent,
                Origin = "user",
                CreatedUser = userId.ToString(),
                UpdatedUser = userId.ToString(),
            };
            db.Node.Add(node);
            await db.SaveChangesAsync();
            return node.Id;
        }
    }

    /// <summary>
    /// 讀出某筆記的擁有者 UserId（供跨使用者測試種浮層時使用）。
    /// </summary>
    /// <param name="noteId">筆記 Id。</param>
    /// <returns>該筆記擁有者的 UserId（與筆記 Id 一併回傳）。</returns>
    private async Task<(Guid OwnerUserId, Guid NoteId)> GetUserAndNoteOwner(Guid noteId)
    {
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            var note = await db.Note
                .IgnoreQueryFilters()
                .AsNoTracking()
                .FirstAsync(n => n.Id == noteId);
            return (note.UserId, noteId);
        }
    }

    /// <summary>
    /// 呼叫 <c>GET /api/search</c> 並解析結果為輕量元組清單。
    /// </summary>
    /// <param name="client">已帶 Bearer 權杖的用戶端。</param>
    /// <param name="q">搜尋關鍵字。</param>
    /// <param name="types">可選的 types CSV 篩選。</param>
    /// <returns>結果清單（Type / Id / Title / Url）。</returns>
    private static async Task<List<SearchHit>> SearchAsync(
        HttpClient client,
        string q,
        string? types = null)
    {
        var url = $"/api/search?q={Uri.EscapeDataString(q)}";
        if (types is not null)
        {
            url += $"&types={Uri.EscapeDataString(types)}";
        }

        var response = await client.GetAsync(url);
        response.EnsureSuccessStatusCode();
        var data = (await response.ReadJsonAsync())["data"]!.AsArray();

        return data
            .Select(node => new SearchHit(
                node!["type"]!.GetValue<string>(),
                node["id"]!.GetValue<string>(),
                node["title"]!.GetValue<string>(),
                node["url"]!.GetValue<string>()))
            .ToList();
    }

    /// <summary>
    /// 搜尋結果的輕量投影（僅取斷言需要的欄位）。
    /// </summary>
    /// <param name="Type">結果類型。</param>
    /// <param name="Id">結果識別碼。</param>
    /// <param name="Title">結果標題。</param>
    /// <param name="Url">結果導航 URL。</param>
    private sealed record SearchHit(string Type, string Id, string Title, string Url);
}
