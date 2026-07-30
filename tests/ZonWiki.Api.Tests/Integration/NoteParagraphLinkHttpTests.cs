using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using Xunit;

namespace ZonWiki.Api.Tests.Integration;

/// <summary>
/// 「段落級關聯（TargetMarkId）＋錨點保護後端面」的真 HTTP 整合測試（feature/paragraph-links 包4）。
///
/// 架構裁決（v2，詳 docs/DECISIONS.md）：瀏覽器為唯一座標系——後端不做 reAnchor/Detached 判定，
/// 只提供：kind="anchor" 純錨點標註、link 標註的 TargetMarkId（段落級目標）、
/// PATCH detached 回寫（帶 contentHash 防過期）、referencedBy（anchor 被誰引用）、
/// POST /api/notes/render 純轉換 dry-run。
/// </summary>
[Collection(ApiIntegrationCollection.Name)]
public sealed class NoteParagraphLinkHttpTests
{
    private readonly ZonWikiApiFactory _factory;

    /// <summary>
    /// 注入共用的整合測試基座。
    /// </summary>
    /// <param name="factory">整合測試基座。</param>
    public NoteParagraphLinkHttpTests(ZonWikiApiFactory factory)
    {
        _factory = factory;
    }

    // ── 測試 1（RED 主證據）：anchor 標註＋帶 TargetMarkId 的關聯 ─────────────────────

    /// <summary>
    /// 在目標筆記 B 建 kind="anchor" 純錨點（現行 kind 白名單會 400 → FAIL）；
    /// 來源筆記 A 建 kind="link" 且 targetMarkId=該錨點 → GET marks(A) 回 targetMarkId；
    /// GET backlinks(B) 的 mark 來源列帶 targetMarkId（前端跳段落用）。
    /// </summary>
    [Fact]
    public async Task Marks_AnchorAndTargetMarkId_RoundTrip()
    {
        var client = await NewUserClientAsync("plink-basic");
        var (noteA, _) = await CreateNoteAsync(client, "段落來源", "A 內文");
        var (noteB, _) = await CreateNoteAsync(client, "段落目標", "B 內文：重要段落在此。");

        var anchorId = await CreateAnchorAsync(client, noteB, "重要段落在此");
        await CreateParagraphLinkAsync(client, noteA, noteB, anchorId, "來源框選文字");

        var marksA = await GetMarksAsync(client, noteA);
        var link = marksA.Single(m => m!["kind"]!.GetValue<string>() == "link");
        link!["targetMarkId"]!.GetValue<string>().Should().Be(anchorId.ToString());

        var backlinksB = await GetJsonArrayAsync(client, $"/api/notes/{noteB}/backlinks");
        var markRow = backlinksB.Single(b => b!["kind"]!.GetValue<string>() == "mark");
        markRow!["targetMarkId"]!.GetValue<string>().Should().Be(anchorId.ToString());
    }

    // ── 測試 2：TargetMarkId 必須屬於目標筆記 ────────────────────────────────────────

    /// <summary>
    /// targetMarkId 指向「別篇筆記」的錨點 → 400（防呆：段落目標必須在 targetId 那篇裡）。
    /// </summary>
    [Fact]
    public async Task Marks_TargetMarkIdOnDifferentNote_IsRejected()
    {
        var client = await NewUserClientAsync("plink-wrongnote");
        var (noteA, _) = await CreateNoteAsync(client, "來源", "內文");
        var (noteB, _) = await CreateNoteAsync(client, "目標", "內文B");
        var (noteC, _) = await CreateNoteAsync(client, "無關", "內文C 有一段。");
        var anchorOnC = await CreateAnchorAsync(client, noteC, "內文C 有一段");

        var response = await client.PostAsJsonAsync($"/api/notes/{noteA}/marks", new
        {
            kind = "link",
            anchorText = "來源框選",
            anchorStart = 0,
            anchorEnd = 4,
            anchorPrefix = "",
            anchorSuffix = "",
            targetType = "note",
            targetId = noteB,
            targetMarkId = anchorOnC,
        });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    // ── 測試 3：TargetMarkId 跨使用者拒絕 ────────────────────────────────────────────

    /// <summary>
    /// targetMarkId 指向他人筆記的錨點 → 400/404（不可跨帳號引用段落）。
    /// </summary>
    [Fact]
    public async Task Marks_TargetMarkIdOfOtherUser_IsRejected()
    {
        var user1 = await NewUserClientAsync("plink-iso1");
        var user2 = await NewUserClientAsync("plink-iso2");
        var (u2Note, _) = await CreateNoteAsync(user2, "他人筆記", "他人段落文字。");
        var u2Anchor = await CreateAnchorAsync(user2, u2Note, "他人段落文字");
        var (u1Note, _) = await CreateNoteAsync(user1, "我的來源", "內文");
        var (u1Target, _) = await CreateNoteAsync(user1, "我的目標", "內文T");

        var response = await user1.PostAsJsonAsync($"/api/notes/{u1Note}/marks", new
        {
            kind = "link",
            anchorText = "框選",
            anchorStart = 0,
            anchorEnd = 2,
            anchorPrefix = "",
            anchorSuffix = "",
            targetType = "note",
            targetId = u1Target,
            targetMarkId = u2Anchor,
        });

        ((int)response.StatusCode).Should().BeOneOf(400, 404);
    }

    // ── 測試 4：PATCH detached——最新 hash 生效、過期 hash 忽略 ───────────────────────

    /// <summary>
    /// PATCH /api/notes/marks/{id}/detached 帶「當次渲染的 contentHash」：
    /// hash 為最新 → 寫入生效；內容更新後帶「舊 hash」再 PATCH → 忽略（防兩分頁競態：
    /// 停在舊內容的分頁不得用過期計算覆蓋新分頁剛寫對的值）。
    /// </summary>
    [Fact]
    public async Task Marks_PatchDetached_FreshHashApplies_StaleHashIgnored()
    {
        var client = await NewUserClientAsync("plink-hash");
        var (noteId, _) = await CreateNoteAsync(client, "防過期", "第一版內容段落。");
        var anchorId = await CreateAnchorAsync(client, noteId, "第一版內容段落");
        var hash1 = await GetContentHashAsync(client, noteId);

        // 最新 hash → 生效
        var patch1 = await client.PatchAsJsonAsync(
            $"/api/notes/marks/{anchorId}/detached",
            new { detached = true, contentHash = hash1 });
        patch1.EnsureSuccessStatusCode();
        (await GetMarkDetachedAsync(client, noteId, anchorId)).Should().BeTrue();

        // 內容前進（hash 改變）
        (await client.PutAsJsonAsync($"/api/notes/{noteId}", new { contentRaw = "第二版內容段落。" }))
            .EnsureSuccessStatusCode();

        // 過期 hash → 忽略（Detached 維持 true）
        var patchStale = await client.PatchAsJsonAsync(
            $"/api/notes/marks/{anchorId}/detached",
            new { detached = false, contentHash = hash1 });
        patchStale.EnsureSuccessStatusCode(); // no-op 也回成功（fire-and-forget 客端不需分辨）
        (await GetMarkDetachedAsync(client, noteId, anchorId)).Should().BeTrue("過期 hash 不得覆蓋");

        // 新 hash → 生效
        var hash2 = await GetContentHashAsync(client, noteId);
        var patchFresh = await client.PatchAsJsonAsync(
            $"/api/notes/marks/{anchorId}/detached",
            new { detached = false, contentHash = hash2 });
        patchFresh.EnsureSuccessStatusCode();
        (await GetMarkDetachedAsync(client, noteId, anchorId)).Should().BeFalse();
    }

    // ── 測試 5：PATCH detached 權限（他人 mark 不可動）─────────────────────────────

    /// <summary>
    /// user2 PATCH user1 的 mark → 404（IUserOwned；信任模型僅及於自己的資料）。
    /// </summary>
    [Fact]
    public async Task Marks_PatchDetached_OthersMark_NotFound()
    {
        var user1 = await NewUserClientAsync("plink-patch1");
        var user2 = await NewUserClientAsync("plink-patch2");
        var (noteId, _) = await CreateNoteAsync(user1, "受害", "段落文字。");
        var anchorId = await CreateAnchorAsync(user1, noteId, "段落文字");
        var hash = await GetContentHashAsync(user1, noteId);

        var response = await user2.PatchAsJsonAsync(
            $"/api/notes/marks/{anchorId}/detached",
            new { detached = true, contentHash = hash });

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    // ── 測試 6：render dry-run 端點 ─────────────────────────────────────────────────

    /// <summary>
    /// POST /api/notes/render {contentRaw} → 回傳與正式儲存管線（RenderToHtml）完全相同的 HTML
    /// （存檔攔截的舊/新文字都以此為源；不落地）。
    /// </summary>
    [Fact]
    public async Task Render_DryRun_MatchesPersistedRendering()
    {
        var client = await NewUserClientAsync("plink-render");
        const string raw = "# 標題\n\n**粗體**與*斜體*，以及一個清單：\n\n- 甲\n- 乙";
        var (noteId, _) = await CreateNoteAsync(client, "渲染對照", raw);
        var persistedHtml = (await GetJsonAsync(client, $"/api/notes/{noteId}"))
            ["note"]!["contentHtml"]!.GetValue<string>();

        var response = await client.PostAsJsonAsync("/api/notes/render", new { contentRaw = raw });
        response.EnsureSuccessStatusCode();
        var dryRunHtml = (await response.ReadJsonAsync())["data"]!["contentHtml"]!.GetValue<string>();

        dryRunHtml.Should().Be(persistedHtml);
    }

    // ── 測試 7：referencedBy——多來源去重排序 ───────────────────────────────────────

    /// <summary>
    /// 兩篇來源筆記（其一建兩則 link）都指向 B 的同一錨點 → GET marks(B) 的 anchor 列
    /// referencedBy = 依標題排序、去重後的來源標題清單（確認框顯示「被《X》引用」用）。
    /// </summary>
    [Fact]
    public async Task Marks_ReferencedBy_ListsDedupedSortedSourceTitles()
    {
        var client = await NewUserClientAsync("plink-refby");
        var tag = Guid.NewGuid().ToString("N")[..6];
        var (noteB, _) = await CreateNoteAsync(client, $"被引用{tag}", "共用段落文字。");
        var (srcA, _) = await CreateNoteAsync(client, $"A來源{tag}", "內文A");
        var (srcB, _) = await CreateNoteAsync(client, $"B來源{tag}", "內文B");
        var anchorId = await CreateAnchorAsync(client, noteB, "共用段落文字");

        await CreateParagraphLinkAsync(client, srcA, noteB, anchorId, "框選一");
        await CreateParagraphLinkAsync(client, srcA, noteB, anchorId, "框選二"); // 同來源第二則
        await CreateParagraphLinkAsync(client, srcB, noteB, anchorId, "框選三");

        var marksB = await GetMarksAsync(client, noteB);
        var anchor = marksB.Single(m => m!["id"]!.GetValue<string>() == anchorId.ToString());
        var referencedBy = anchor!["referencedBy"]!.AsArray()
            .Select(n => n!.GetValue<string>()).ToList();

        referencedBy.Should().Equal(
            new[] { $"A來源{tag}", $"B來源{tag}" },
            "同來源多則去重、依標題排序");
    }

    // ── 測試 8：刪 link 連動軟刪「無主」anchor；仍被引用者不動 ───────────────────────

    /// <summary>
    /// link1、link2 指向同一錨點：刪 link1 → 錨點仍在（負向：不可誤刪共用錨點）；
    /// 刪 link2 → 錨點成孤兒，一併軟刪（GET marks 不再出現）。
    /// </summary>
    [Fact]
    public async Task Marks_DeleteLink_RemovesOrphanAnchorKeepsSharedAnchor()
    {
        var client = await NewUserClientAsync("plink-orphan");
        var (noteB, _) = await CreateNoteAsync(client, "錨點宿主", "孤兒測試段落。");
        var (srcA, _) = await CreateNoteAsync(client, "來源甲", "內文");
        var (srcB, _) = await CreateNoteAsync(client, "來源乙", "內文");
        var anchorId = await CreateAnchorAsync(client, noteB, "孤兒測試段落");
        var link1 = await CreateParagraphLinkAsync(client, srcA, noteB, anchorId, "框選甲");
        var link2 = await CreateParagraphLinkAsync(client, srcB, noteB, anchorId, "框選乙");

        (await client.DeleteAsync($"/api/notes/marks/{link1}")).EnsureSuccessStatusCode();
        (await GetMarksAsync(client, noteB))
            .Should().Contain(m => m!["id"]!.GetValue<string>() == anchorId.ToString(),
                "仍被 link2 引用，不可誤刪");

        (await client.DeleteAsync($"/api/notes/marks/{link2}")).EnsureSuccessStatusCode();
        (await GetMarksAsync(client, noteB))
            .Should().NotContain(m => m!["id"]!.GetValue<string>() == anchorId.ToString(),
                "無主錨點應連動軟刪");
    }

    // ── 測試 9（回歸鎖）：anchor 不入 backlinks ─────────────────────────────────────

    /// <summary>
    /// kind="anchor" 純錨點不得出現在反向連結（現行 mark 來源過濾 Kind=="link" 已天然排除，
    /// 此測試鎖住該行為避免日後重構誤放）。
    /// </summary>
    [Fact]
    public async Task Backlinks_AnchorMarks_AreNotListed()
    {
        var client = await NewUserClientAsync("plink-noise");
        var (noteB, _) = await CreateNoteAsync(client, "純錨點宿主", "只有錨點的段落。");
        await CreateAnchorAsync(client, noteB, "只有錨點的段落");

        var backlinks = await GetJsonArrayAsync(client, $"/api/notes/{noteB}/backlinks");

        backlinks.Should().BeEmpty();
    }

    // ═══════════════════════════ 測試輔助方法 ═══════════════════════════

    /// <summary>產生每次唯一的測試用 Email。</summary>
    /// <param name="prefix">辨識用前綴。</param>
    /// <returns>唯一 Email。</returns>
    private static string UniqueEmail(string prefix) => $"{prefix}-{Guid.NewGuid():N}@example.com";

    /// <summary>建立一個新使用者並回傳已帶權杖的用戶端。</summary>
    /// <param name="prefix">Email 前綴。</param>
    /// <returns>已帶 Bearer 權杖的用戶端。</returns>
    private async Task<HttpClient> NewUserClientAsync(string prefix)
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync(UniqueEmail(prefix));
        return _factory.CreateClientWithToken(token);
    }

    /// <summary>透過真實 HTTP 建立一則筆記。</summary>
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

    /// <summary>建立 kind="anchor" 純錨點標註（段落級目標的錨定）。</summary>
    /// <param name="client">已帶 Bearer 權杖的用戶端。</param>
    /// <param name="noteId">錨點所在筆記。</param>
    /// <param name="anchorText">錨定的段落文字。</param>
    /// <returns>新錨點 Id。</returns>
    private static async Task<Guid> CreateAnchorAsync(HttpClient client, Guid noteId, string anchorText)
    {
        var response = await client.PostAsJsonAsync($"/api/notes/{noteId}/marks", new
        {
            kind = "anchor",
            anchorText,
            anchorStart = 0,
            anchorEnd = anchorText.Length,
            anchorPrefix = "",
            anchorSuffix = "",
        });
        response.EnsureSuccessStatusCode();
        return Guid.Parse((await response.ReadJsonAsync())["data"]!["id"]!.GetValue<string>());
    }

    /// <summary>建立帶 targetMarkId 的段落級關聯（kind=link）。</summary>
    /// <param name="client">已帶 Bearer 權杖的用戶端。</param>
    /// <param name="sourceNoteId">來源筆記。</param>
    /// <param name="targetNoteId">目標筆記。</param>
    /// <param name="targetMarkId">目標段落錨點。</param>
    /// <param name="anchorText">來源框選文字。</param>
    /// <returns>新關聯標註 Id。</returns>
    private static async Task<Guid> CreateParagraphLinkAsync(
        HttpClient client,
        Guid sourceNoteId,
        Guid targetNoteId,
        Guid targetMarkId,
        string anchorText)
    {
        var response = await client.PostAsJsonAsync($"/api/notes/{sourceNoteId}/marks", new
        {
            kind = "link",
            anchorText,
            anchorStart = 0,
            anchorEnd = anchorText.Length,
            anchorPrefix = "",
            anchorSuffix = "",
            targetType = "note",
            targetId = targetNoteId,
            targetMarkId,
        });
        response.EnsureSuccessStatusCode();
        return Guid.Parse((await response.ReadJsonAsync())["data"]!["id"]!.GetValue<string>());
    }

    /// <summary>GET 筆記的全部標註（data 陣列）。</summary>
    /// <param name="client">已帶 Bearer 權杖的用戶端。</param>
    /// <param name="noteId">筆記 Id。</param>
    /// <returns>標註 JSON 陣列。</returns>
    private static Task<JsonArray> GetMarksAsync(HttpClient client, Guid noteId) =>
        GetJsonArrayAsync(client, $"/api/notes/{noteId}/marks");

    /// <summary>GET 任意端點的 data JSON 陣列。</summary>
    /// <param name="client">已帶 Bearer 權杖的用戶端。</param>
    /// <param name="path">端點路徑。</param>
    /// <returns>data 陣列。</returns>
    private static async Task<JsonArray> GetJsonArrayAsync(HttpClient client, string path)
    {
        var response = await client.GetAsync(path);
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        return (await response.ReadJsonAsync())["data"]!.AsArray();
    }

    /// <summary>GET 任意端點的 data JSON 物件。</summary>
    /// <param name="client">已帶 Bearer 權杖的用戶端。</param>
    /// <param name="path">端點路徑。</param>
    /// <returns>data 物件。</returns>
    private static async Task<JsonNode> GetJsonAsync(HttpClient client, string path)
    {
        var response = await client.GetAsync(path);
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        return (await response.ReadJsonAsync())["data"]!;
    }

    /// <summary>取得筆記目前的 contentHash（GET /api/notes/{id} 走 GUID 直達，讀 note.contentHash）。</summary>
    /// <param name="client">已帶 Bearer 權杖的用戶端。</param>
    /// <param name="noteId">筆記 Id。</param>
    /// <returns>contentHash 字串。</returns>
    private static async Task<string> GetContentHashAsync(HttpClient client, Guid noteId) =>
        (await GetJsonAsync(client, $"/api/notes/{noteId}"))["note"]!["contentHash"]!.GetValue<string>();

    /// <summary>取得指定標註目前的 detached 值。</summary>
    /// <param name="client">已帶 Bearer 權杖的用戶端。</param>
    /// <param name="noteId">筆記 Id。</param>
    /// <param name="markId">標註 Id。</param>
    /// <returns>detached 布林值。</returns>
    private static async Task<bool> GetMarkDetachedAsync(HttpClient client, Guid noteId, Guid markId)
    {
        var marks = await GetMarksAsync(client, noteId);
        return marks.Single(m => m!["id"]!.GetValue<string>() == markId.ToString())!
            ["detached"]!.GetValue<bool>();
    }
}
