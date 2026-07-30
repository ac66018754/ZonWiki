using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using Xunit;

namespace ZonWiki.Api.Tests.Integration;

/// <summary>
/// 「slug 連動標題＋NoteSlugAlias＋消歧異」的真 HTTP 整合測試（feature/slug-alias 包3）。
///
/// 使用者裁決（2026-07-31，詳 docs/DECISIONS.md）：
/// - slug 跟著「現在的標題」：改標題就以 GenerateSlug 重產 slug，舊 slug 永久保留為 alias；
/// - 解析順序：GUID 直達 → 活 slug → alias；候選（NoteId 去重）唯一→直達、多個→消歧異、零→404；
/// - 名字可重用：改名/建立撞「alias」不加序號（歧義交消歧異頁），撞「活 slug」才加 -2 序號；
/// - 回應形狀改為 { kind:"note", matchedByAlias, note } 或 { kind:"ambiguous", candidates }。
///
/// 三個 LINE 備忘錄驗收情境：①手打新標題 URL 能通；②舊存 URL 永遠能通且指向原篇；
/// ③名字被新篇取用後，兩邊都能經消歧異到達。
///
/// 全部走真 HTTP（不直接觸碰 NoteSlugAlias 實體——tuple 唯一性等內部性質以
/// 「反覆改名全程 200＋解析結果正確」的可觀察行為驗證），基座見 <see cref="ZonWikiApiFactory"/>。
/// </summary>
[Collection(ApiIntegrationCollection.Name)]
public sealed class NoteSlugAliasHttpTests
{
    private readonly ZonWikiApiFactory _factory;

    /// <summary>
    /// 注入共用的整合測試基座。
    /// </summary>
    /// <param name="factory">整合測試基座。</param>
    public NoteSlugAliasHttpTests(ZonWikiApiFactory factory)
    {
        _factory = factory;
    }

    // ── 測試 1（情境②RED 主證據）：改名後，舊 slug 以 alias 直達原篇 ──────────────────

    /// <summary>
    /// 建「筆記甲」→ 改標題「筆記乙」→ GET 舊 slug：kind=note、matchedByAlias=true、
    /// note.title=新標題（舊存連結永遠有效且指向原篇）。
    /// </summary>
    [Fact]
    public async Task Resolve_OldSlugAfterRename_HitsAliasAndReturnsNote()
    {
        var client = await NewUserClientAsync("alias-old");
        var tag = Tag();
        var (noteId, oldSlug) = await CreateNoteAsync(client, $"筆記甲{tag}", "內文");

        await RenameAsync(client, noteId, $"筆記乙{tag}");

        var resolution = await ResolveAsync(client, oldSlug);
        resolution.Kind.Should().Be("note");
        resolution.MatchedByAlias.Should().BeTrue();
        resolution.Note!["title"]!.GetValue<string>().Should().Be($"筆記乙{tag}");
        resolution.Note["id"]!.GetValue<string>().Should().Be(noteId.ToString());
    }

    // ── 測試 2（情境①）：改名後，新標題的 slug 直達 ─────────────────────────────────

    /// <summary>
    /// 改名後 GET「新標題產生的 slug」：kind=note、matchedByAlias=false
    /// （slug 已連動現在的標題——現行改名不動 slug，會 404）。
    /// </summary>
    [Fact]
    public async Task Resolve_NewSlugAfterRename_HitsLiveSlug()
    {
        var client = await NewUserClientAsync("alias-new");
        var tag = Tag();
        var (noteId, _) = await CreateNoteAsync(client, $"筆記甲{tag}", "內文");

        var saved = await RenameAsync(client, noteId, $"筆記乙{tag}");
        var newSlug = saved["slug"]!.GetValue<string>();
        newSlug.Should().Be($"筆記乙{tag}".ToLowerInvariant(), "slug 應以新標題重產（測試 17 的回應契約）");

        var resolution = await ResolveAsync(client, newSlug);
        resolution.Kind.Should().Be("note");
        resolution.MatchedByAlias.Should().BeFalse();
        resolution.Note!["id"]!.GetValue<string>().Should().Be(noteId.ToString());
    }

    // ── 測試 3：連續改名兩次，兩個舊 slug 都能 alias 直達 ────────────────────────────

    /// <summary>
    /// S1→S2→S3：GET S1 與 S2 都 alias 直達、GET S3 活 slug 直達（alias 累積不失效）。
    /// </summary>
    [Fact]
    public async Task Resolve_AfterTwoRenames_AllOldSlugsStillWork()
    {
        var client = await NewUserClientAsync("alias-twice");
        var tag = Tag();
        var (noteId, slug1) = await CreateNoteAsync(client, $"一代目{tag}", "內文");
        var slug2 = (await RenameAsync(client, noteId, $"二代目{tag}"))["slug"]!.GetValue<string>();
        var slug3 = (await RenameAsync(client, noteId, $"三代目{tag}"))["slug"]!.GetValue<string>();

        (await ResolveAsync(client, slug1)).Should().Match<Resolution>(r =>
            r.Kind == "note" && r.MatchedByAlias == true);
        (await ResolveAsync(client, slug2)).Should().Match<Resolution>(r =>
            r.Kind == "note" && r.MatchedByAlias == true);
        (await ResolveAsync(client, slug3)).Should().Match<Resolution>(r =>
            r.Kind == "note" && r.MatchedByAlias == false);
    }

    // ── 測試 4（情境③）：名字被新篇取用 → 消歧異 ────────────────────────────────────

    /// <summary>
    /// A 讓出 S（改名走人）→ B 改標題取用 S → GET S：kind=ambiguous、候選恰 2 筆、
    /// isCurrentHolder 標在 B、A 的候選帶 originalTitle（當年的標題）；
    /// 兩篇各自的「現行 slug」仍直達。
    /// </summary>
    [Fact]
    public async Task Resolve_NameReused_ReturnsAmbiguousWithBothCandidates()
    {
        var client = await NewUserClientAsync("alias-ambig");
        var tag = Tag();
        var sharedTitle = $"共名{tag}";
        var (noteA, slugS) = await CreateNoteAsync(client, sharedTitle, "A 內文");
        var aNewSlug = (await RenameAsync(client, noteA, $"甲讓位後{tag}"))["slug"]!.GetValue<string>();
        var (noteB, _) = await CreateNoteAsync(client, $"乙原名{tag}", "B 內文");
        await RenameAsync(client, noteB, sharedTitle); // B 取用 S

        var resolution = await ResolveAsync(client, slugS);
        resolution.Kind.Should().Be("ambiguous");
        var candidates = resolution.Candidates!;
        candidates.Count.Should().Be(2);

        var current = candidates.Single(c => c!["isCurrentHolder"]!.GetValue<bool>());
        current!["id"]!.GetValue<string>().Should().Be(noteB.ToString());
        var former = candidates.Single(c => !c!["isCurrentHolder"]!.GetValue<bool>());
        former!["id"]!.GetValue<string>().Should().Be(noteA.ToString());
        former["originalTitle"]!.GetValue<string>().Should().Be(sharedTitle);

        // 兩篇各自的現行 slug 仍直達
        (await ResolveAsync(client, aNewSlug)).Kind.Should().Be("note");
    }

    // ── 測試 5：改名撞「活 slug」→ 加序號、不歧義 ───────────────────────────────────

    /// <summary>
    /// B 改成與「現存活著的 A」相同標題 → B 拿 -2 序號 slug；兩篇都直達、無 ambiguous
    /// （撞活 slug 加序號、撞 alias 不加——名字重用只對「歷史名」成立）。
    /// </summary>
    [Fact]
    public async Task Rename_CollidingWithLiveSlug_GetsSuffixNotAmbiguity()
    {
        var client = await NewUserClientAsync("alias-suffix");
        var tag = Tag();
        var (noteA, slugA) = await CreateNoteAsync(client, $"活著的{tag}", "A 內文");
        var (noteB, _) = await CreateNoteAsync(client, $"換名者{tag}", "B 內文");

        var saved = await RenameAsync(client, noteB, $"活著的{tag}");
        var slugB = saved["slug"]!.GetValue<string>();
        slugB.Should().Be($"{slugA}-2");

        var a = await ResolveAsync(client, slugA);
        a.Kind.Should().Be("note");
        a.Note!["id"]!.GetValue<string>().Should().Be(noteA.ToString());
        var b = await ResolveAsync(client, slugB);
        b.Kind.Should().Be("note");
        b.Note!["id"]!.GetValue<string>().Should().Be(noteB.ToString());
    }

    // ── 測試 6：改回舊名的自我收斂 ──────────────────────────────────────────────────

    /// <summary>
    /// S→S2→改回 S：GET S 直達（自我 alias 不造成歧義）、GET S2 alias 直達。
    /// </summary>
    [Fact]
    public async Task Rename_BackToOldName_SelfAliasCollapses()
    {
        var client = await NewUserClientAsync("alias-selfheal");
        var tag = Tag();
        var (noteId, slugS) = await CreateNoteAsync(client, $"回鍋{tag}", "內文");
        var slugS2 = (await RenameAsync(client, noteId, $"外出{tag}"))["slug"]!.GetValue<string>();
        await RenameAsync(client, noteId, $"回鍋{tag}");

        var s = await ResolveAsync(client, slugS);
        s.Kind.Should().Be("note", "自我 alias 與活 slug 屬同一篇，去重後唯一");
        s.MatchedByAlias.Should().BeFalse();
        (await ResolveAsync(client, slugS2)).Should().Match<Resolution>(r =>
            r.Kind == "note" && r.MatchedByAlias == true);
    }

    // ── 測試 7：標題變但 slug 不變 → 不產生 alias ────────────────────────────────────

    /// <summary>
    /// 標題僅變更「會被 GenerateSlug 濾掉」的部分（加驚嘆號）→ slug 不變、
    /// matchedByAlias 維持 false（沒有無意義的 alias 噪音）。
    /// </summary>
    [Fact]
    public async Task Rename_TitleChangeWithSameSlug_ProducesNoAlias()
    {
        var client = await NewUserClientAsync("alias-noop");
        var tag = Tag();
        var (noteId, slug) = await CreateNoteAsync(client, $"不動如山{tag}", "內文");

        var saved = await RenameAsync(client, noteId, $"不動如山{tag}！！");
        saved["slug"]!.GetValue<string>().Should().Be(slug);

        var resolution = await ResolveAsync(client, slug);
        resolution.Kind.Should().Be("note");
        resolution.MatchedByAlias.Should().BeFalse();
    }

    // ── 測試 8：兩任前屋主、無活 slug → 消歧異 ──────────────────────────────────────

    /// <summary>
    /// X 用過 S 後讓出、A 取用 S 後也讓出 → 現無活 S、兩筆 alias →
    /// GET S：ambiguous、2 候選、皆非 isCurrentHolder。
    /// </summary>
    [Fact]
    public async Task Resolve_TwoFormerHolders_ReturnsAmbiguousWithoutCurrentHolder()
    {
        var client = await NewUserClientAsync("alias-two-former");
        var tag = Tag();
        var sharedTitle = $"雙前任{tag}";
        var (noteX, slugS) = await CreateNoteAsync(client, sharedTitle, "X 內文");
        await RenameAsync(client, noteX, $"X新家{tag}");
        var (noteA, _) = await CreateNoteAsync(client, $"A原名{tag}", "A 內文");
        await RenameAsync(client, noteA, sharedTitle);   // A 取用 S（活）
        await RenameAsync(client, noteA, $"A新家{tag}"); // A 又讓出 → S 無活主

        var resolution = await ResolveAsync(client, slugS);
        resolution.Kind.Should().Be("ambiguous");
        resolution.Candidates!.Count.Should().Be(2);
        resolution.Candidates.Should().OnlyContain(c => !c!["isCurrentHolder"]!.GetValue<bool>());
    }

    // ── 測試 9：alias 指向的筆記軟刪 → 候選消失 ─────────────────────────────────────

    /// <summary>
    /// 情境③成立後把「曾用者」軟刪 → GET S 只剩現用者、直達；再軟刪現用者 → 404。
    /// </summary>
    [Fact]
    public async Task Resolve_SoftDeletedCandidates_AreExcluded()
    {
        var client = await NewUserClientAsync("alias-softdel");
        var tag = Tag();
        var sharedTitle = $"刪除場{tag}";
        var (noteA, slugS) = await CreateNoteAsync(client, sharedTitle, "A 內文");
        await RenameAsync(client, noteA, $"A讓位{tag}");
        var (noteB, _) = await CreateNoteAsync(client, $"B原名{tag}", "B 內文");
        await RenameAsync(client, noteB, sharedTitle);

        (await client.DeleteAsync($"/api/notes/{noteA}")).EnsureSuccessStatusCode();
        var afterOne = await ResolveAsync(client, slugS);
        afterOne.Kind.Should().Be("note");
        afterOne.Note!["id"]!.GetValue<string>().Should().Be(noteB.ToString());

        (await client.DeleteAsync($"/api/notes/{noteB}")).EnsureSuccessStatusCode();
        var afterBoth = await client.GetAsync($"/api/notes/{Uri.EscapeDataString(slugS)}");
        afterBoth.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    // ── 測試 10：跨使用者隔離 ───────────────────────────────────────────────────────

    /// <summary>
    /// user2 有同名 slug 與 alias → user1 解析同字串時完全看不到（不歧義、不外洩）。
    /// </summary>
    [Fact]
    public async Task Resolve_CrossUserSlugsAndAliases_AreInvisible()
    {
        var tag = Tag();
        var user1 = await NewUserClientAsync("alias-iso1");
        var user2 = await NewUserClientAsync("alias-iso2");

        // user2：建同名、改名留 alias
        var (u2note, _) = await CreateNoteAsync(user2, $"隔離{tag}", "u2 內文");
        await RenameAsync(user2, u2note, $"隔離後{tag}");
        // user1：建同名（活）
        var (u1note, slugS) = await CreateNoteAsync(user1, $"隔離{tag}", "u1 內文");

        var resolution = await ResolveAsync(user1, slugS);
        resolution.Kind.Should().Be("note", "user2 的 alias 不得混入 user1 的候選");
        resolution.Note!["id"]!.GetValue<string>().Should().Be(u1note.ToString());
    }

    // ── 測試 11：純內容更新不動 slug（PATCH 語意回歸）──────────────────────────────

    /// <summary>
    /// 只傳 contentRaw（Title 未傳）→ slug 不變、無 alias 產生。
    /// </summary>
    [Fact]
    public async Task Update_ContentOnly_DoesNotTouchSlug()
    {
        var client = await NewUserClientAsync("alias-content");
        var tag = Tag();
        var (noteId, slug) = await CreateNoteAsync(client, $"只改內容{tag}", "舊內文");

        var response = await client.PutAsJsonAsync($"/api/notes/{noteId}", new { contentRaw = "新內文" });
        response.EnsureSuccessStatusCode();
        var saved = (await response.ReadJsonAsync())["data"]!;
        saved["slug"]!.GetValue<string>().Should().Be(slug);

        (await ResolveAsync(client, slug)).MatchedByAlias.Should().BeFalse();
    }

    // ── 測試 12：建立筆記撞 alias → 允許、活 slug 照拿、之後歧義 ────────────────────

    /// <summary>
    /// 舊筆記讓出 S 後，「建立」同標題新筆記 → 新筆記活 slug 直接拿 S（不加序號）、
    /// 之後 GET S → ambiguous（「建立」與「改名」的名字重用規則一致）。
    /// </summary>
    [Fact]
    public async Task Create_CollidingWithAlias_TakesLiveSlugThenAmbiguous()
    {
        var client = await NewUserClientAsync("alias-create");
        var tag = Tag();
        var sharedTitle = $"重生{tag}";
        var (noteOld, slugS) = await CreateNoteAsync(client, sharedTitle, "舊內文");
        await RenameAsync(client, noteOld, $"舊人{tag}");

        var (noteNew, newSlug) = await CreateNoteAsync(client, sharedTitle, "新內文");
        newSlug.Should().Be(slugS, "撞 alias 不加序號——名字可重用");

        var resolution = await ResolveAsync(client, slugS);
        resolution.Kind.Should().Be("ambiguous");
        resolution.Candidates!
            .Single(c => c!["isCurrentHolder"]!.GetValue<bool>())!["id"]!.GetValue<string>()
            .Should().Be(noteNew.ToString());
    }

    // ── 測試 13：GUID 直達 ─────────────────────────────────────────────────────────

    /// <summary>
    /// GET /api/notes/{noteId}（GUID 當 slug）→ 直達（永不歧義的錨點）；
    /// 他人筆記 id 與不存在的 GUID → 404。
    /// </summary>
    [Fact]
    public async Task Resolve_ByGuid_AlwaysDirectAndUserScoped()
    {
        var client = await NewUserClientAsync("alias-guid");
        var stranger = await NewUserClientAsync("alias-guid-stranger");
        var (noteId, _) = await CreateNoteAsync(client, $"以身分證相認{Tag()}", "內文");

        var resolution = await ResolveAsync(client, noteId.ToString());
        resolution.Kind.Should().Be("note");
        resolution.MatchedByAlias.Should().BeFalse();
        resolution.Note!["id"]!.GetValue<string>().Should().Be(noteId.ToString());

        (await stranger.GetAsync($"/api/notes/{noteId}"))
            .StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await client.GetAsync($"/api/notes/{Guid.NewGuid()}"))
            .StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    // ── 測試 14：改名 fallback "note" ───────────────────────────────────────────────

    /// <summary>
    /// 標題改成會被 GenerateSlug 濾光的字串（純標點）→ slug fallback "note"（撞名照加序號），
    /// 不得存出空 slug（比照建立端的既有防呆）。
    /// </summary>
    [Fact]
    public async Task Rename_TitleFilteredToEmpty_FallsBackToNoteSlug()
    {
        var client = await NewUserClientAsync("alias-fallback");
        var (noteId, _) = await CreateNoteAsync(client, $"正常標題{Tag()}", "內文");

        var saved = await RenameAsync(client, noteId, "！？＃");
        var newSlug = saved["slug"]!.GetValue<string>();
        newSlug.Should().NotBeNullOrEmpty();
        newSlug.Should().StartWith("note");

        (await ResolveAsync(client, newSlug)).Kind.Should().Be("note");
    }

    // ── 測試 15：反覆改名不出錯（tuple 復活邏輯的可觀察驗證）────────────────────────

    /// <summary>
    /// S→S2→S→S2→S 共四次改名全程 200（(User,Slug,NoteId) 唯一索引下的軟刪復活若寫錯，
    /// 第二輪就會 500），最終 GET S 直達、GET S2 alias 直達。
    /// </summary>
    [Fact]
    public async Task Rename_RepeatedFlipFlop_StaysHealthy()
    {
        var client = await NewUserClientAsync("alias-flipflop");
        var tag = Tag();
        var titleS = $"甲面{tag}";
        var titleS2 = $"乙面{tag}";
        var (noteId, slugS) = await CreateNoteAsync(client, titleS, "內文");

        var slugS2 = (await RenameAsync(client, noteId, titleS2))["slug"]!.GetValue<string>();
        await RenameAsync(client, noteId, titleS);
        await RenameAsync(client, noteId, titleS2);
        await RenameAsync(client, noteId, titleS);

        var s = await ResolveAsync(client, slugS);
        s.Kind.Should().Be("note");
        s.MatchedByAlias.Should().BeFalse();
        (await ResolveAsync(client, slugS2)).Should().Match<Resolution>(r =>
            r.Kind == "note" && r.MatchedByAlias == true);
    }

    // ── 測試 16：消歧異候選欄位完整性 ───────────────────────────────────────────────

    /// <summary>
    /// ambiguous 回應的每個候選都帶 id／title／slug／isCurrentHolder／originalTitle／updatedAt
    /// （前端消歧異頁的渲染契約；欄位定案不含 categories）。
    /// </summary>
    [Fact]
    public async Task Resolve_AmbiguousCandidates_CarryAllContractFields()
    {
        var client = await NewUserClientAsync("alias-fields");
        var tag = Tag();
        var sharedTitle = $"欄位檢{tag}";
        var (noteA, slugS) = await CreateNoteAsync(client, sharedTitle, "A 內文");
        await RenameAsync(client, noteA, $"讓位{tag}");
        var (noteB, _) = await CreateNoteAsync(client, sharedTitle, "B 內文");
        noteB.Should().NotBeEmpty();

        var resolution = await ResolveAsync(client, slugS);
        resolution.Kind.Should().Be("ambiguous");
        foreach (var candidate in resolution.Candidates!)
        {
            candidate!["id"]!.GetValue<string>().Should().NotBeNullOrEmpty();
            candidate["title"]!.GetValue<string>().Should().NotBeNullOrEmpty();
            candidate["slug"]!.GetValue<string>().Should().NotBeNullOrEmpty();
            candidate["isCurrentHolder"].Should().NotBeNull();
            (candidate["updatedAt"]?.GetValue<DateTime?>()).Should().NotBeNull();
            // originalTitle：曾用者必有（當年標題）；現用者可為 null
            if (!candidate["isCurrentHolder"]!.GetValue<bool>())
            {
                candidate["originalTitle"]!.GetValue<string>().Should().Be(sharedTitle);
            }
        }
    }

    // ═══════════════════════════ 測試輔助方法 ═══════════════════════════

    /// <summary>產生每次唯一的小寫標記（嵌進標題，讓 slug 可預測且互不相撞）。</summary>
    /// <returns>唯一小寫標記。</returns>
    private static string Tag() => "z" + Guid.NewGuid().ToString("N")[..10];

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
    /// 改名（PUT 標題）並回傳存檔後的 NoteDetail JSON（含最新 slug——回應契約測試 2/17）。
    /// </summary>
    /// <param name="client">已帶 Bearer 權杖的用戶端。</param>
    /// <param name="noteId">筆記 Id。</param>
    /// <param name="newTitle">新標題。</param>
    /// <returns>存檔後的 data 節點。</returns>
    private static async Task<JsonNode> RenameAsync(HttpClient client, Guid noteId, string newTitle)
    {
        var response = await client.PutAsJsonAsync($"/api/notes/{noteId}", new { title = newTitle });
        response.EnsureSuccessStatusCode();
        return (await response.ReadJsonAsync())["data"]!;
    }

    /// <summary>
    /// GET /api/notes/{slug} 並解析為統一的 Resolution 投影（新回應形狀）。
    /// </summary>
    /// <param name="client">已帶 Bearer 權杖的用戶端。</param>
    /// <param name="slug">要解析的 slug（可含多段；會逐段編碼）。</param>
    /// <returns>解析結果投影。</returns>
    private static async Task<Resolution> ResolveAsync(HttpClient client, string slug)
    {
        var encoded = string.Join('/', slug.Split('/').Select(Uri.EscapeDataString));
        var response = await client.GetAsync($"/api/notes/{encoded}");
        response.StatusCode.Should().Be(HttpStatusCode.OK, $"slug「{slug}」應可解析");
        var data = (await response.ReadJsonAsync())["data"]!;

        return new Resolution(
            data["kind"]?.GetValue<string>(),
            data["matchedByAlias"]?.GetValue<bool?>(),
            data["note"] as JsonObject,
            data["candidates"] as JsonArray);
    }

    /// <summary>
    /// 解析回應的輕量投影。
    /// </summary>
    /// <param name="Kind">note｜ambiguous（未實作前為 null → 斷言失敗即 RED）。</param>
    /// <param name="MatchedByAlias">是否經 alias 命中（僅 kind=note 有意義）。</param>
    /// <param name="Note">筆記本體（kind=note）。</param>
    /// <param name="Candidates">候選清單（kind=ambiguous）。</param>
    private sealed record Resolution(
        string? Kind,
        bool? MatchedByAlias,
        JsonObject? Note,
        JsonArray? Candidates);
}
