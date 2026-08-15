using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using ZonWiki.Domain.Entities;
using Xunit;

namespace ZonWiki.Api.Tests.Integration;

/// <summary>
/// 「問題功能」後端端點的真 HTTP 整合測試：
/// - <c>PUT /api/notes/overlay/{itemId}</c> 的 IsQuestion / QuestionAnswer patch 與清空語意；
/// - <c>GET /api/questions</c>（全部 / 依分類含子孫 / 去重 / 使用者隔離 / 外站分類 404 / 軟刪排除 / 標題推導 / 環狀不卡死）；
/// - <c>POST /api/notes/{id}/ask-question</c>（擁有權、空值與長度驗證、202＋sessionId＋DB session）。
///
/// 全部走 <see cref="ZonWikiApiFactory"/>（WebApplicationFactory ＋ 真 PostgreSQL 容器）發真實 HTTP 請求，
/// 驗證「外部可觀察行為」。整合測試集合共用同一顆容器（資料跨測試殘留），故種子資料一律以
/// 「每測試唯一 GUID」隔離，避免相互污染。
/// </summary>
[Collection(ApiIntegrationCollection.Name)]
public sealed class QuestionEndpointsTests
{
    private readonly ZonWikiApiFactory _factory;

    /// <summary>
    /// 注入共用的整合測試基座。
    /// </summary>
    /// <param name="factory">整合測試基座。</param>
    public QuestionEndpointsTests(ZonWikiApiFactory factory)
    {
        _factory = factory;
    }

    // ── 測試 1：設為問題 / 取消問題（PUT isQuestion）──────────────────────────────────

    /// <summary>
    /// PUT isQuestion=true → GET overlay 反映 true；再 PUT false → 反映 false。
    /// </summary>
    [Fact]
    public async Task UpdateOverlay_SetAndUnsetQuestion()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync(UniqueEmail("set-unset-q"));
        var client = _factory.CreateClientWithToken(token);
        var (noteId, _) = await CreateNoteAsync(client, "問題筆記", "內文");
        var itemId = await SeedOverlayAsync(userId, noteId, "sticky", text: "一個便利貼");

        (await UpdateOverlayAsync(client, itemId, new { isQuestion = true })).Should().Be(HttpStatusCode.OK);
        (await GetOverlayItemAsync(client, noteId, itemId))!["isQuestion"]!.GetValue<bool>().Should().BeTrue();

        (await UpdateOverlayAsync(client, itemId, new { isQuestion = false })).Should().Be(HttpStatusCode.OK);
        (await GetOverlayItemAsync(client, noteId, itemId))!["isQuestion"]!.GetValue<bool>().Should().BeFalse();
    }

    // ── 測試 2：儲存回答（含清空語意）─────────────────────────────────────────────────

    /// <summary>
    /// PUT questionAnswer="..." → GET overlay 反映；清空（questionAnswer=""）→ GET 回空字串、
    /// 且 <c>/api/questions</c> 的 HasAnswer 為 false。
    /// </summary>
    [Fact]
    public async Task UpdateOverlay_SaveAnswer()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync(UniqueEmail("save-answer"));
        var client = _factory.CreateClientWithToken(token);
        var (noteId, _) = await CreateNoteAsync(client, "作答筆記", "內文");
        var itemId = await SeedOverlayAsync(userId, noteId, "text", text: "T 文字問題", isQuestion: true);

        // 存入回答 → 反映，HasAnswer=true。
        (await UpdateOverlayAsync(client, itemId, new { questionAnswer = "這是我的回答" })).Should().Be(HttpStatusCode.OK);
        (await GetOverlayItemAsync(client, noteId, itemId))!["questionAnswer"]!.GetValue<string>().Should().Be("這是我的回答");
        var afterSave = await FindQuestionAsync(client, itemId, categoryId: null);
        afterSave!["hasAnswer"]!.GetValue<bool>().Should().BeTrue();

        // 清空（空字串）→ 回空字串、HasAnswer=false。
        (await UpdateOverlayAsync(client, itemId, new { questionAnswer = "" })).Should().Be(HttpStatusCode.OK);
        (await GetOverlayItemAsync(client, noteId, itemId))!["questionAnswer"]!.GetValue<string>().Should().Be("");
        var afterClear = await FindQuestionAsync(client, itemId, categoryId: null);
        afterClear!["hasAnswer"]!.GetValue<bool>().Should().BeFalse();
    }

    // ── 測試 2b：問題屬性寫入守門（Kind 限制與回答長度上限）─────────────────────────

    /// <summary>
    /// 「問題」屬性僅適用於 sticky / text：對 drawing 設 isQuestion 或 questionAnswer → 400
    /// （寫入端守門，與讀取端的 Kind 過濾構成多層防線）；
    /// 回答超過應用層長度上限（100,000 字元）→ 400；上限內正常 200。
    /// </summary>
    [Fact]
    public async Task UpdateOverlay_QuestionFieldGuards()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync(UniqueEmail("question-guards"));
        var client = _factory.CreateClientWithToken(token);
        var (noteId, _) = await CreateNoteAsync(client, "守門筆記", "內文");

        // drawing 不可設問題屬性。
        var drawingId = await SeedOverlayAsync(userId, noteId, "drawing", text: "塗鴉");
        (await UpdateOverlayAsync(client, drawingId, new { isQuestion = true })).Should().Be(HttpStatusCode.BadRequest);
        (await UpdateOverlayAsync(client, drawingId, new { questionAnswer = "答" })).Should().Be(HttpStatusCode.BadRequest);

        // 回答長度：超過上限 → 400；上限內 → 200。
        var stickyId = await SeedOverlayAsync(userId, noteId, "sticky", text: "問題", isQuestion: true);
        var tooLongAnswer = new string('答', 100_001);
        (await UpdateOverlayAsync(client, stickyId, new { questionAnswer = tooLongAnswer })).Should().Be(HttpStatusCode.BadRequest);
        (await UpdateOverlayAsync(client, stickyId, new { questionAnswer = "正常回答" })).Should().Be(HttpStatusCode.OK);
    }

    // ── 測試 3：GET /api/questions（全部）只回問題項目 ────────────────────────────────

    /// <summary>
    /// 「全部」查詢只回 IsQuestion=true 且 kind ∈ {sticky, text} 的項目；
    /// 非問題的 sticky/text、以及 drawing（即使被標記）皆不回。
    /// </summary>
    [Fact]
    public async Task GetQuestions_All_ReturnsOnlyQuestionItems()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync(UniqueEmail("all-questions"));
        var client = _factory.CreateClientWithToken(token);
        var (noteId, _) = await CreateNoteAsync(client, "混合筆記", "內文");

        var qSticky = await SeedOverlayAsync(userId, noteId, "sticky", text: "問題便利貼", isQuestion: true);
        var qText = await SeedOverlayAsync(userId, noteId, "text", text: "問題文字框", isQuestion: true);
        var notQuestion = await SeedOverlayAsync(userId, noteId, "sticky", text: "普通便利貼", isQuestion: false);
        var drawingQ = await SeedOverlayAsync(userId, noteId, "drawing", text: "塗鴉", isQuestion: true);

        var ids = (await GetQuestionsAsync(client, categoryId: null)).Select(ItemId).ToList();

        ids.Should().Contain(qSticky.ToString());
        ids.Should().Contain(qText.ToString());
        ids.Should().NotContain(notQuestion.ToString());
        ids.Should().NotContain(drawingQ.ToString());
    }

    // ── 測試 4：依分類（含子孫）──────────────────────────────────────────────────────

    /// <summary>
    /// 分類樹 A→B→C：筆記分屬 A/B/C/無分類。query A 回 A+B+C 的問題、不回無分類的；query B 回 B+C。
    /// </summary>
    [Fact]
    public async Task GetQuestions_ByCategory_IncludesDescendants()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync(UniqueEmail("by-category"));
        var client = _factory.CreateClientWithToken(token);

        var catA = await SeedCategoryAsync(userId, "A", null);
        var catB = await SeedCategoryAsync(userId, "B", catA);
        var catC = await SeedCategoryAsync(userId, "C", catB);

        var (noteA, _) = await CreateNoteAsync(client, "筆記A", "內文");
        var (noteB, _) = await CreateNoteAsync(client, "筆記B", "內文");
        var (noteC, _) = await CreateNoteAsync(client, "筆記C", "內文");
        var (noteNone, _) = await CreateNoteAsync(client, "筆記None", "內文");
        await LinkNoteCategoryAsync(userId, noteA, catA);
        await LinkNoteCategoryAsync(userId, noteB, catB);
        await LinkNoteCategoryAsync(userId, noteC, catC);

        var qA = await SeedOverlayAsync(userId, noteA, "sticky", text: "問題A", isQuestion: true);
        var qB = await SeedOverlayAsync(userId, noteB, "sticky", text: "問題B", isQuestion: true);
        var qC = await SeedOverlayAsync(userId, noteC, "sticky", text: "問題C", isQuestion: true);
        var qNone = await SeedOverlayAsync(userId, noteNone, "sticky", text: "問題None", isQuestion: true);

        var fromA = (await GetQuestionsAsync(client, catA)).Select(ItemId).ToList();
        fromA.Should().Contain(new[] { qA.ToString(), qB.ToString(), qC.ToString() });
        fromA.Should().NotContain(qNone.ToString());

        var fromB = (await GetQuestionsAsync(client, catB)).Select(ItemId).ToList();
        fromB.Should().Contain(new[] { qB.ToString(), qC.ToString() });
        fromB.Should().NotContain(qA.ToString());
        fromB.Should().NotContain(qNone.ToString());
    }

    // ── 測試 5：筆記多分類 → 去重 ────────────────────────────────────────────────────

    /// <summary>
    /// 筆記同屬 X 與 Y（Y 是 X 的子孫）→ query X 時該問題項目只回一次。
    /// </summary>
    [Fact]
    public async Task GetQuestions_NoteInMultipleCategories_Deduplicated()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync(UniqueEmail("dedup"));
        var client = _factory.CreateClientWithToken(token);

        var catX = await SeedCategoryAsync(userId, "X", null);
        var catY = await SeedCategoryAsync(userId, "Y", catX);
        var (noteId, _) = await CreateNoteAsync(client, "多分類筆記", "內文");
        await LinkNoteCategoryAsync(userId, noteId, catX);
        await LinkNoteCategoryAsync(userId, noteId, catY);
        var itemId = await SeedOverlayAsync(userId, noteId, "sticky", text: "重複風險問題", isQuestion: true);

        var ids = (await GetQuestionsAsync(client, catX)).Select(ItemId).ToList();

        ids.Count(id => id == itemId.ToString()).Should().Be(1);
    }

    // ── 測試 6a：使用者隔離（全部查詢）──────────────────────────────────────────────

    /// <summary>
    /// 使用者 B 的問題，A 用「全部」查詢查不到（跨帳號隔離）。
    /// </summary>
    [Fact]
    public async Task GetQuestions_IsolatedByUser()
    {
        var (_, tokenA) = await _factory.SeedUserWithTokenAsync(UniqueEmail("iso-a"));
        var clientA = _factory.CreateClientWithToken(tokenA);
        var (userBId, tokenB) = await _factory.SeedUserWithTokenAsync(UniqueEmail("iso-b"));
        var clientB = _factory.CreateClientWithToken(tokenB);

        var (noteBId, _) = await CreateNoteAsync(clientB, "B 筆記", "內文");
        var qB = await SeedOverlayAsync(userBId, noteBId, "sticky", text: "B 的問題", isQuestion: true);

        var idsA = (await GetQuestionsAsync(clientA, categoryId: null)).Select(ItemId).ToList();

        idsA.Should().NotContain(qB.ToString());
    }

    // ── 測試 6b：拿別人的 categoryId → 404 ──────────────────────────────────────────

    /// <summary>
    /// A 用 B 的 categoryId 查詢 → 404（分類不屬於本人視同不存在，比照 CategoryEndpoints 慣例）。
    /// </summary>
    [Fact]
    public async Task GetQuestions_ForeignCategoryId_Returns404()
    {
        var (_, tokenA) = await _factory.SeedUserWithTokenAsync(UniqueEmail("foreign-a"));
        var clientA = _factory.CreateClientWithToken(tokenA);
        var (userBId, _) = await _factory.SeedUserWithTokenAsync(UniqueEmail("foreign-b"));
        var catB = await SeedCategoryAsync(userBId, "B 的分類", null);

        var response = await clientA.GetAsync($"/api/questions?categoryId={catB}");

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    // ── 測試 7：軟刪除排除（item 軟刪、note 軟刪）──────────────────────────────────

    /// <summary>
    /// 軟刪的 item、以及「item 未刪但所屬筆記被軟刪」兩種情況，皆不出現在問題清單。
    /// （後者是真實漏網風險：DeleteNoteHandler 不會級聯軟刪 overlay items。）
    /// </summary>
    [Fact]
    public async Task GetQuestions_SoftDeleted_Excluded()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync(UniqueEmail("softdel"));
        var client = _factory.CreateClientWithToken(token);

        // (a) item 本身軟刪。
        var (noteA, _) = await CreateNoteAsync(client, "軟刪item筆記", "內文");
        var deletedItem = await SeedOverlayAsync(userId, noteA, "sticky", text: "已刪問題", isQuestion: true, validFlag: false);

        // (b) item 未刪、但所屬筆記軟刪。
        var (noteB, _) = await CreateNoteAsync(client, "軟刪note筆記", "內文");
        var orphanItem = await SeedOverlayAsync(userId, noteB, "sticky", text: "孤兒問題", isQuestion: true);
        await SoftDeleteNoteAsync(noteB);

        var ids = (await GetQuestionsAsync(client, categoryId: null)).Select(ItemId).ToList();

        ids.Should().NotContain(deletedItem.ToString());
        ids.Should().NotContain(orphanItem.ToString());
    }

    // ── 測試 8：標題推導 ─────────────────────────────────────────────────────────────

    /// <summary>
    /// QuestionTitle 推導：sticky 有 DataJson.title→用之；sticky 無 title→Text 前段；text kind→Text 前段。
    /// </summary>
    [Fact]
    public async Task GetQuestions_TitleDerivation()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync(UniqueEmail("title-deriv"));
        var client = _factory.CreateClientWithToken(token);
        var (noteId, _) = await CreateNoteAsync(client, "標題推導筆記", "內文");

        var stickyWithTitle = await SeedOverlayAsync(
            userId, noteId, "sticky", text: "便利貼內文",
            dataJson: new JsonObject { ["title"] = "自訂標題" }.ToJsonString(), isQuestion: true);
        var stickyNoTitle = await SeedOverlayAsync(userId, noteId, "sticky", text: "沒有標題只有內文", isQuestion: true);
        var textItem = await SeedOverlayAsync(userId, noteId, "text", text: "文字框問題內容", isQuestion: true);

        var all = await GetQuestionsAsync(client, categoryId: null);

        Title(all, stickyWithTitle).Should().Be("自訂標題");
        Title(all, stickyNoTitle).Should().Be("沒有標題只有內文");
        Title(all, textItem).Should().Be("文字框問題內容");
    }

    // ── 測試 9：ask-question 驗證與啟動 session ──────────────────────────────────────

    /// <summary>
    /// POST ask-question：非本人筆記 404；空 question 400；超過 4000 字 400；
    /// 正常 → 202、回 sessionId、DB 有該 session 且 UserId/NoteId 正確、Status ∈ {Running, Completed}。
    /// （Fake AI 幾乎瞬間完成，背景 Task.Run 何時 flip 狀態不受控，故不可斷言恰為 Running。）
    /// </summary>
    [Fact]
    public async Task AskQuestion_ValidatesOwnershipAndStartsSession()
    {
        var (userAId, tokenA) = await _factory.SeedUserWithTokenAsync(UniqueEmail("ask-a"));
        var clientA = _factory.CreateClientWithToken(tokenA);
        var (_, tokenB) = await _factory.SeedUserWithTokenAsync(UniqueEmail("ask-b"));
        var clientB = _factory.CreateClientWithToken(tokenB);

        var (noteAId, _) = await CreateNoteAsync(clientA, "提問筆記", "整篇內容");

        // 非本人筆記 → 404。
        (await clientB.PostAsJsonAsync($"/api/notes/{noteAId}/ask-question", new { question = "在嗎" }))
            .StatusCode.Should().Be(HttpStatusCode.NotFound);

        // 空 question → 400。
        (await clientA.PostAsJsonAsync($"/api/notes/{noteAId}/ask-question", new { question = "   " }))
            .StatusCode.Should().Be(HttpStatusCode.BadRequest);

        // 超過 4000 字 → 400。
        (await clientA.PostAsJsonAsync($"/api/notes/{noteAId}/ask-question", new { question = new string('問', 4001) }))
            .StatusCode.Should().Be(HttpStatusCode.BadRequest);

        // 正常 → 202 ＋ sessionId。
        var okResponse = await clientA.PostAsJsonAsync($"/api/notes/{noteAId}/ask-question", new { question = "這篇在講什麼" });
        okResponse.StatusCode.Should().Be(HttpStatusCode.Accepted);
        var sessionId = Guid.Parse((await okResponse.ReadJsonAsync())["data"]!["sessionId"]!.GetValue<string>());

        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            var session = await db.AiSession.IgnoreQueryFilters().AsNoTracking()
                .FirstOrDefaultAsync(s => s.Id == sessionId);
            session.Should().NotBeNull();
            session!.UserId.Should().Be(userAId);
            session.NoteId.Should().Be(noteAId);
            session.Status.Should().BeOneOf("Running", "Completed");
        }
    }

    // ── 測試 10：未認證 → 401 ─────────────────────────────────────────────────────────

    /// <summary>
    /// 未帶認證打 <c>GET /api/questions</c> → 401。
    /// </summary>
    [Fact]
    public async Task GetQuestions_Unauthenticated_Returns401()
    {
        var client = _factory.CreateClient();

        (await client.GetAsync("/api/questions")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    /// <summary>
    /// 未帶認證打 <c>POST /api/notes/{id}/ask-question</c> → 401。
    /// </summary>
    [Fact]
    public async Task AskQuestion_Unauthenticated_Returns401()
    {
        var client = _factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            $"/api/notes/{Guid.NewGuid()}/ask-question", new { question = "匿名不可提問" });

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    // ── 測試 11：分類環狀不卡死（防禦性）──────────────────────────────────────────────

    /// <summary>
    /// 手寫環狀 ParentId（A→B→A）→ 端點以 visited set 防環、正常回傳，不逾時。
    /// </summary>
    [Fact]
    public async Task GetQuestions_CategoryCycle_DoesNotHang()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync(UniqueEmail("cycle"));
        var client = _factory.CreateClientWithToken(token);

        // 先建 A、B（ParentId 合法），再手動改成環狀 A.Parent=B、B.Parent=A。
        var catA = await SeedCategoryAsync(userId, "環A", null);
        var catB = await SeedCategoryAsync(userId, "環B", catA);
        await SetCategoryParentAsync(catA, catB); // 造環：A.Parent=B、B.Parent=A

        var (noteId, _) = await CreateNoteAsync(client, "環狀筆記", "內文");
        await LinkNoteCategoryAsync(userId, noteId, catA);
        var itemId = await SeedOverlayAsync(userId, noteId, "sticky", text: "環狀問題", isQuestion: true);

        // 應在合理時間內回 200（visited set 防止無限遞迴）。
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        var response = await client.GetAsync($"/api/questions?categoryId={catA}", cts.Token);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var ids = (await response.ReadJsonAsync())["data"]!.AsArray().Select(ItemId).ToList();
        ids.Should().Contain(itemId.ToString());
    }

    // ══════════════════════════════ 測試輔助 ══════════════════════════════

    /// <summary>產生每次唯一的測試用 Email。</summary>
    private static string UniqueEmail(string prefix) => $"{prefix}-{Guid.NewGuid():N}@example.com";

    /// <summary>從問題清單 JSON 節點取 itemId 字串。</summary>
    private static string ItemId(JsonNode? node) => node!["itemId"]!.GetValue<string>();

    /// <summary>從問題清單找到指定 item 的 questionTitle。</summary>
    private static string Title(IReadOnlyList<JsonNode> list, Guid itemId) =>
        list.Single(n => ItemId(n) == itemId.ToString())["questionTitle"]!.GetValue<string>();

    /// <summary>透過真實 HTTP 建立一則筆記，回傳其 Id 與 slug。</summary>
    private static async Task<(Guid NoteId, string Slug)> CreateNoteAsync(HttpClient client, string title, string content)
    {
        var response = await client.PostAsJsonAsync("/api/notes", new { title, contentRaw = content });
        response.EnsureSuccessStatusCode();
        var data = (await response.ReadJsonAsync())["data"]!;
        return (Guid.Parse(data["id"]!.GetValue<string>()), data["slug"]!.GetValue<string>());
    }

    /// <summary>直接寫 DB 種一個浮層元件（支援 kind / isQuestion / questionAnswer / 軟刪除等邊界）。</summary>
    private async Task<Guid> SeedOverlayAsync(
        Guid userId,
        Guid noteId,
        string kind,
        string? text = null,
        string? dataJson = null,
        bool isQuestion = false,
        string? questionAnswer = null,
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
                IsQuestion = isQuestion,
                QuestionAnswer = questionAnswer,
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

    /// <summary>直接寫 DB 種一個分類，回傳其 Id。</summary>
    private async Task<Guid> SeedCategoryAsync(Guid userId, string name, Guid? parentId)
    {
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            var category = new Category
            {
                UserId = userId,
                Name = name,
                ParentId = parentId,
                CreatedUser = userId.ToString(),
                UpdatedUser = userId.ToString(),
            };
            db.Category.Add(category);
            await db.SaveChangesAsync();
            return category.Id;
        }
    }

    /// <summary>直接寫 DB 建立筆記↔分類關聯。</summary>
    private async Task LinkNoteCategoryAsync(Guid userId, Guid noteId, Guid categoryId)
    {
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            db.NoteCategory.Add(new NoteCategory
            {
                UserId = userId,
                NoteId = noteId,
                CategoryId = categoryId,
                CreatedUser = userId.ToString(),
                UpdatedUser = userId.ToString(),
            });
            await db.SaveChangesAsync();
        }
    }

    /// <summary>直接改分類的 ParentId（測試造環用）。</summary>
    private async Task SetCategoryParentAsync(Guid categoryId, Guid parentId)
    {
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            var category = await db.Category.IgnoreQueryFilters().FirstAsync(c => c.Id == categoryId);
            category.ParentId = parentId;
            await db.SaveChangesAsync();
        }
    }

    /// <summary>直接把筆記軟刪除（測試「item 未刪但筆記被刪」用）。</summary>
    private async Task SoftDeleteNoteAsync(Guid noteId)
    {
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            var note = await db.Note.IgnoreQueryFilters().FirstAsync(n => n.Id == noteId);
            note.ValidFlag = false;
            note.DeletedDateTime = DateTime.UtcNow;
            await db.SaveChangesAsync();
        }
    }

    /// <summary>PUT 更新浮層元件，回傳 HTTP 狀態碼。</summary>
    private static async Task<HttpStatusCode> UpdateOverlayAsync(HttpClient client, Guid itemId, object patch)
    {
        var response = await client.PutAsJsonAsync($"/api/notes/overlay/{itemId}", patch);
        return response.StatusCode;
    }

    /// <summary>GET 某筆記的浮層清單，找出指定 item 的 JSON 節點。</summary>
    private static async Task<JsonNode?> GetOverlayItemAsync(HttpClient client, Guid noteId, Guid itemId)
    {
        var response = await client.GetAsync($"/api/notes/{noteId}/overlay");
        response.EnsureSuccessStatusCode();
        var data = (await response.ReadJsonAsync())["data"]!.AsArray();
        return data.FirstOrDefault(n => n!["id"]!.GetValue<string>() == itemId.ToString());
    }

    /// <summary>GET /api/questions（可選 categoryId），回傳結果 JSON 節點清單。</summary>
    private static async Task<IReadOnlyList<JsonNode>> GetQuestionsAsync(HttpClient client, Guid? categoryId)
    {
        var url = categoryId is null ? "/api/questions" : $"/api/questions?categoryId={categoryId}";
        var response = await client.GetAsync(url);
        response.EnsureSuccessStatusCode();
        return (await response.ReadJsonAsync())["data"]!.AsArray().Select(n => n!).ToList();
    }

    /// <summary>GET /api/questions 後找出指定 item 的 JSON 節點（找不到回 null）。</summary>
    private static async Task<JsonNode?> FindQuestionAsync(HttpClient client, Guid itemId, Guid? categoryId)
    {
        var list = await GetQuestionsAsync(client, categoryId);
        return list.FirstOrDefault(n => ItemId(n) == itemId.ToString());
    }
}
