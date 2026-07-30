using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using ZonWiki.Domain.Entities;
using Xunit;

namespace ZonWiki.Api.Tests.Integration;

/// <summary>
/// 「筆記 URL 逐段編碼」的真 HTTP 整合測試（fix/note-url-encoding 包1）。
///
/// 背景：舊檔案匯入時代的筆記 slug 可含「/」（層級）與「#」等 URL 特殊字元
/// （prod 實例：programming/c#/f）。後端在搜尋結果與關聯清單組 /notes/{slug} URL 時
/// 若裸串輸出，前端拿到的 href 內含未編碼「#」，瀏覽器會把其後整段當 fragment 丟棄，
/// 導頁變成「筆記不存在」。
///
/// 本測試釘死的新行為：所有後端組出的 /notes/... URL 都必須「逐段
/// Uri.EscapeDataString、以 / 接回」——「/」保留為路徑分隔、「#」等特殊字元百分號編碼。
///
/// 測資造法：現行 GenerateSlug 會濾掉「#」與「/」，新建筆記不可能產生此類 slug，
/// 故一律先走真 HTTP 建立筆記，再經 DbContext 直接改寫 Slug 欄位模擬舊資料
/// （與 SearchEnrichmentHttpTests.SeedOverlayAsync 的直寫手法同一原理）。
///
/// 全部走 WebApplicationFactory ＋ 真 PostgreSQL 容器（見 <see cref="ZonWikiApiFactory"/>）。
/// 容器跨測試共用，故可搜尋文字皆嵌入每測試唯一的 GUID token 以隔離資料。
/// </summary>
[Collection(ApiIntegrationCollection.Name)]
public sealed class NoteUrlEncodingHttpTests
{
    private readonly ZonWikiApiFactory _factory;

    /// <summary>
    /// 注入共用的整合測試基座。
    /// </summary>
    /// <param name="factory">整合測試基座。</param>
    public NoteUrlEncodingHttpTests(ZonWikiApiFactory factory)
    {
        _factory = factory;
    }

    // ── 測試 1（RED 主證據）：搜尋結果的筆記 URL 必須逐段編碼 ─────────────────────────

    /// <summary>
    /// slug 含「#」與「/」的筆記，搜尋結果 url 應為「/notes/encx/c%23/y」：
    /// 「/」保留為路徑分隔、「#」編碼為 %23（現行裸串輸出「/notes/encx/c#/y」→ 應 FAIL）。
    /// </summary>
    [Fact]
    public async Task Search_NoteWithHashSlug_ReturnsPerSegmentEncodedUrl()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync(UniqueEmail("urlenc-search"));
        var client = _factory.CreateClientWithToken(token);

        var needle = Token();
        var (noteId, _) = await CreateNoteAsync(client, $"舊匯入筆記 {needle}", "內文");
        await OverwriteSlugAsync(noteId, "encx/c#/y");

        var url = await SearchUrlOfAsync(client, needle, "note", noteId.ToString());

        url.Should().Be("/notes/encx/c%23/y",
            "「/」須保留為路徑分隔，「#」必須百分號編碼，否則瀏覽器會把 #後段當 fragment 丟棄");
    }

    // ── 測試 2：浮層搜尋結果的 URL 同樣必須逐段編碼（另一條組 URL 路徑）───────────────

    /// <summary>
    /// 掛在「#」slug 筆記上的浮層（T 文字框），其搜尋結果 url 應為
    /// 「/notes/encx/c%23/y?overlay={id}」（SearchEndpoints 的浮層分支是獨立的組 URL 處）。
    /// </summary>
    [Fact]
    public async Task Search_OverlayOnHashSlugNote_ReturnsPerSegmentEncodedUrl()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync(UniqueEmail("urlenc-overlay"));
        var client = _factory.CreateClientWithToken(token);

        var (noteId, _) = await CreateNoteAsync(client, "浮層宿主", "內文");
        await OverwriteSlugAsync(noteId, "encx/c#/y");
        var needle = Token();
        var overlayId = await SeedOverlayTextAsync(userId, noteId, $"文字框 {needle}");

        var url = await SearchUrlOfAsync(client, needle, "overlay-text", overlayId.ToString());

        url.Should().Be($"/notes/encx/c%23/y?overlay={overlayId}");
    }

    // ── 測試 3：關聯清單解析出的筆記 URL——「/」保留、「#」編碼（行為變更）──────────────

    /// <summary>
    /// 關聯到「#」slug 筆記時，GET /api/links 解析出的 url 應為「/notes/encx/c%23/y」。
    /// 現行整串 Uri.EscapeDataString 會把「/」也編成 %2F（encx%2Fc%23%2Fy），
    /// 與其他入口組出的路徑形狀不一致——新行為統一為逐段編碼。
    /// </summary>
    [Fact]
    public async Task Links_LinkedNoteWithHashSlug_UrlKeepsSlashSeparatorsAndEncodesHash()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync(UniqueEmail("urlenc-links"));
        var client = _factory.CreateClientWithToken(token);

        var (sourceId, _) = await CreateNoteAsync(client, "關聯來源筆記", "內文");
        var (targetId, _) = await CreateNoteAsync(client, "關聯目標筆記", "內文");
        await OverwriteSlugAsync(targetId, "encx/c#/y");

        var createLink = await client.PostAsJsonAsync("/api/links", new
        {
            sourceType = "note",
            sourceId,
            targetType = "note",
            targetId,
        });
        createLink.EnsureSuccessStatusCode();

        var response = await client.GetAsync($"/api/links?type=note&id={sourceId}");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var data = (await response.ReadJsonAsync())["data"]!.AsArray();

        var linked = data.Single(n => n!["id"]!.GetValue<string>() == targetId.ToString());
        linked!["url"]!.GetValue<string>().Should().Be("/notes/encx/c%23/y");
    }

    // ── 測試 4（回歸）：一般多段中文 slug 的搜尋 URL 為逐段編碼、「/」保留 ───────────────

    /// <summary>
    /// 多段中文 slug（同為舊匯入形態）：url 應為各段 Uri.EscapeDataString 後以「/」接回
    /// （期望值動態計算，不手抄百分號編碼，避免謄寫錯誤造成偽陽/偽陰）。
    /// </summary>
    [Fact]
    public async Task Search_MultiSegmentChineseSlug_UrlIsPerSegmentEncoded()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync(UniqueEmail("urlenc-cjk"));
        var client = _factory.CreateClientWithToken(token);

        var needle = Token();
        var (noteId, _) = await CreateNoteAsync(client, $"中文層級筆記 {needle}", "內文");
        await OverwriteSlugAsync(noteId, "快捷鍵/vs-code");

        var url = await SearchUrlOfAsync(client, needle, "note", noteId.ToString());

        var expected = "/notes/" + string.Join(
            "/",
            "快捷鍵/vs-code".Split('/').Select(Uri.EscapeDataString));
        url.Should().Be(expected);
    }

    // ═══════════════════════════ 測試輔助方法 ═══════════════════════════

    /// <summary>產生每次唯一、可全文搜尋到的 token。</summary>
    /// <returns>唯一 token 字串。</returns>
    private static string Token() => "zwurl" + Guid.NewGuid().ToString("N");

    /// <summary>產生每次唯一的測試用 Email。</summary>
    /// <param name="prefix">辨識用前綴。</param>
    /// <returns>唯一 Email。</returns>
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
    /// 經 DbContext 直接改寫筆記 slug，模擬「舊檔案匯入時代」含特殊字元的 slug
    /// （現行 GenerateSlug 會濾掉 # 與 /，走 API 造不出此類測資）。
    /// </summary>
    /// <param name="noteId">筆記 Id。</param>
    /// <param name="slug">要覆寫的 slug（可含 # 與 /）。</param>
    private async Task OverwriteSlugAsync(Guid noteId, string slug)
    {
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            var note = await db.Note.IgnoreQueryFilters().FirstAsync(n => n.Id == noteId);
            note.Slug = slug;
            await db.SaveChangesAsync();
        }
    }

    /// <summary>
    /// 直接寫 DB 種一個 T 文字框浮層（比照 SearchEnrichmentHttpTests 的直寫手法）。
    /// </summary>
    /// <param name="userId">擁有者使用者 Id。</param>
    /// <param name="noteId">所屬筆記 Id。</param>
    /// <param name="text">浮層文字內容。</param>
    /// <returns>新浮層元件 Id。</returns>
    private async Task<Guid> SeedOverlayTextAsync(Guid userId, Guid noteId, string text)
    {
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            var item = new NoteOverlayItem
            {
                UserId = userId,
                NoteId = noteId,
                Kind = "text",
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
    /// 打 GET /api/search 並取出指定型別＋Id 那筆結果的 url 欄位。
    /// </summary>
    /// <param name="client">已帶 Bearer 權杖的用戶端。</param>
    /// <param name="needle">搜尋關鍵字（每測試唯一 token）。</param>
    /// <param name="type">預期結果型別（note / overlay-text …）。</param>
    /// <param name="id">預期結果 Id。</param>
    /// <returns>該筆結果的 url。</returns>
    private static async Task<string> SearchUrlOfAsync(
        HttpClient client,
        string needle,
        string type,
        string id)
    {
        var response = await client.GetAsync($"/api/search?q={Uri.EscapeDataString(needle)}");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var data = (await response.ReadJsonAsync())["data"]!.AsArray();

        var hit = data.Single(n =>
            n!["type"]!.GetValue<string>() == type &&
            n["id"]!.GetValue<string>() == id);
        return hit!["url"]!.GetValue<string>();
    }
}
