using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using ZonWiki.Domain.Entities;
using Xunit;

namespace ZonWiki.Api.Tests.Integration;

/// <summary>
/// 「反向連結聯集三來源」的真 HTTP 整合測試（feature/backlinks-union 包2）。
///
/// 背景（prod 實證 2026-07-31）：ZonWiki 有三套互不相通的筆記連結系統——
/// NoteLink（內文 [[X]]）、NoteMark(Kind="link", TargetType="note")（框選段落關聯）、
/// EntityLink（「關聯」分頁的整篇關聯）——而 GET /api/notes/{id}/backlinks 只查 NoteLink，
/// 使用者框選段落建立的關聯在反向連結分頁完全看不見。
///
/// 本測試釘死的新契約：
/// - backlinks 聯集三來源，DTO 追加 kind（"wiki"｜"mark"｜"entity"）與 markId（僅 mark 有值）；
/// - EntityLink 為雙向關聯（哪端是 Source 只是建立當下開著哪頁的巧合），雙向都要命中、顯示另一端；
/// - 三來源一律排除自我參照；
/// - 排序＝Kind 權重（wiki=0、mark=1、entity=2）再依來源筆記標題；
/// - Detached 的 mark 照樣列出（關聯沒失效，只是內文定位失效；視覺標示屬包4）；
/// - highlight／annotation／targetType=url 的標註一律不入列；
/// - 跨使用者靠 IUserOwned 全域查詢過濾隔離（handler 不自濾——此為既有機制，測試實證）。
///
/// 全部走 WebApplicationFactory ＋ 真 PostgreSQL 容器（見 <see cref="ZonWikiApiFactory"/>）。
/// </summary>
[Collection(ApiIntegrationCollection.Name)]
public sealed class NoteBacklinksUnionHttpTests
{
    private readonly ZonWikiApiFactory _factory;

    /// <summary>
    /// 注入共用的整合測試基座。
    /// </summary>
    /// <param name="factory">整合測試基座。</param>
    public NoteBacklinksUnionHttpTests(ZonWikiApiFactory factory)
    {
        _factory = factory;
    }

    // ── 測試 1（RED 主證據｜使用者場景重現）：段落關聯要出現在反向連結 ─────────────────

    /// <summary>
    /// A 框選段落建立關聯指向 B（POST marks，kind=link/targetType=note）→
    /// B 的反向連結應含一筆 kind="mark"：來源=A、anchorText=框選段落文字、markId=該標註 id。
    /// （重現「上雲步驟→DB相關」：現行只查 NoteLink，回空陣列 → FAIL。）
    /// </summary>
    [Fact]
    public async Task Backlinks_MarkLink_AppearsWithAnchorTextAndMarkId()
    {
        var client = await NewUserClientAsync("bl-mark");
        var (noteA, _) = await CreateNoteAsync(client, "上雲步驟複製品", "內文A");
        var (noteB, _) = await CreateNoteAsync(client, "DB相關複製品", "內文B");

        var markId = await CreateLinkMarkAsync(client, noteA, noteB, "09 用 DBeaver 連 Prod 段落");

        var backlinks = await GetBacklinksAsync(client, noteB);

        var hit = backlinks.Should().ContainSingle(b => b.Kind == "mark").Subject;
        hit.SourceNoteId.Should().Be(noteA.ToString());
        hit.SourceNoteTitle.Should().Be("上雲步驟複製品");
        hit.AnchorText.Should().Be("09 用 DBeaver 連 Prod 段落");
        hit.MarkId.Should().Be(markId.ToString());
    }

    // ── 測試 2：整篇關聯（EntityLink）要出現在反向連結 ────────────────────────────────

    /// <summary>
    /// A 對 B 建立「關聯」（POST /api/links）→ B 的反向連結應含一筆 kind="entity"：
    /// 來源=A、anchorText 為空字串、markId 為 null。
    /// </summary>
    [Fact]
    public async Task Backlinks_EntityLink_AppearsAsEntityKind()
    {
        var client = await NewUserClientAsync("bl-entity");
        var (noteA, _) = await CreateNoteAsync(client, "關聯來源", "內文A");
        var (noteB, _) = await CreateNoteAsync(client, "關聯目標", "內文B");

        await CreateEntityLinkAsync(client, noteA, noteB);

        var backlinks = await GetBacklinksAsync(client, noteB);

        var hit = backlinks.Should().ContainSingle(b => b.Kind == "entity").Subject;
        hit.SourceNoteId.Should().Be(noteA.ToString());
        hit.AnchorText.Should().BeEmpty();
        hit.MarkId.Should().BeNull();
    }

    // ── 測試 3：wiki 來源回歸＋新欄位 ────────────────────────────────────────────────

    /// <summary>
    /// A 內文寫 [[B標題]] → B 的反向連結該筆 kind="wiki"、markId=null、
    /// anchorText=連結文字（既有行為不破壞、新欄位補齊）。
    /// </summary>
    [Fact]
    public async Task Backlinks_WikiLink_KeepsExistingBehaviourWithKindField()
    {
        var client = await NewUserClientAsync("bl-wiki");
        var targetTitle = "維基目標" + Guid.NewGuid().ToString("N")[..8];
        var (noteB, _) = await CreateNoteAsync(client, targetTitle, "內文B");
        var (noteA, _) = await CreateNoteAsync(client, "維基來源", $"參見 [[{targetTitle}]] 一節");

        var backlinks = await GetBacklinksAsync(client, noteB);

        var hit = backlinks.Should().ContainSingle(b => b.Kind == "wiki").Subject;
        hit.SourceNoteId.Should().Be(noteA.ToString());
        hit.AnchorText.Should().Be(targetTitle);
        hit.MarkId.Should().BeNull();
    }

    // ── 測試 4：三來源並存＋排序（wiki=0 → mark=1 → entity=2，再依來源標題）───────────

    /// <summary>
    /// 同時存在 wiki／mark／entity 三種指向 B 的連結 → 恰為 3 筆，
    /// 順序固定為 wiki → mark → entity（Kind 權重表），同 Kind 內依來源筆記標題。
    /// </summary>
    [Fact]
    public async Task Backlinks_ThreeSources_OrderedByKindWeightThenTitle()
    {
        var client = await NewUserClientAsync("bl-order");
        var targetTitle = "排序目標" + Guid.NewGuid().ToString("N")[..8];
        var (noteB, _) = await CreateNoteAsync(client, targetTitle, "內文B");
        var (noteWiki, _) = await CreateNoteAsync(client, "甲-wiki來源", $"見 [[{targetTitle}]]");
        var (noteMark, _) = await CreateNoteAsync(client, "乙-mark來源", "內文");
        var (noteEntity, _) = await CreateNoteAsync(client, "丙-entity來源", "內文");

        await CreateLinkMarkAsync(client, noteMark, noteB, "框選段落");
        await CreateEntityLinkAsync(client, noteEntity, noteB);

        var backlinks = await GetBacklinksAsync(client, noteB);

        backlinks.Should().HaveCount(3);
        backlinks.Select(b => b.Kind).Should().ContainInOrder("wiki", "mark", "entity");
        backlinks[0].SourceNoteId.Should().Be(noteWiki.ToString());
        backlinks[1].SourceNoteId.Should().Be(noteMark.ToString());
        backlinks[2].SourceNoteId.Should().Be(noteEntity.ToString());
    }

    // ── 測試 5：entity 雙向——從 B 頁建立 B→X 也要出現在 backlinks(B) ─────────────────

    /// <summary>
    /// EntityLink 是雙向關聯：從 B 頁建立（Source=B、Target=X）的關聯，
    /// backlinks(B) 也應出現另一端 X（哪端是 Source 只是建立當下開著哪頁的巧合，
    /// 僅取單向會重演「建了看不見」的原始 bug）。
    /// </summary>
    [Fact]
    public async Task Backlinks_EntityLink_IsBidirectional()
    {
        var client = await NewUserClientAsync("bl-bidir");
        var (noteB, _) = await CreateNoteAsync(client, "雙向本體", "內文B");
        var (noteX, _) = await CreateNoteAsync(client, "雙向另一端", "內文X");

        await CreateEntityLinkAsync(client, noteB, noteX); // Source=B、Target=X

        var backlinks = await GetBacklinksAsync(client, noteB);

        var hit = backlinks.Should().ContainSingle(b => b.Kind == "entity").Subject;
        hit.SourceNoteId.Should().Be(noteX.ToString(), "顯示的是「另一端」");
    }

    // ── 測試 6：方向性負向——B 發出的 mark 不得出現在 backlinks(B) ────────────────────

    /// <summary>
    /// B 自己框選段落關聯指向 C（mark 方向 B→C）→ backlinks(B) 不得出現 C
    /// （mark 是有方向的「引用」；反向連結只認「指向 B」的 mark）。
    /// </summary>
    [Fact]
    public async Task Backlinks_OutgoingMark_DoesNotAppear()
    {
        var client = await NewUserClientAsync("bl-outgoing");
        var (noteB, _) = await CreateNoteAsync(client, "發出者", "內文B");
        var (noteC, _) = await CreateNoteAsync(client, "被指向者", "內文C");

        await CreateLinkMarkAsync(client, noteB, noteC, "B 指向 C 的段落");

        var backlinks = await GetBacklinksAsync(client, noteB);

        backlinks.Should().NotContain(b => b.SourceNoteId == noteC.ToString());
    }

    // ── 測試 7：自我參照排除（mark 與 entity 都要）────────────────────────────────────

    /// <summary>
    /// DB 可實際造出「A 指向 A 自己」的 mark 與 EntityLink（建立端點皆未阻擋自我參照）
    /// → backlinks(A) 不得出現 A 自己（三來源查詢一律排除另一端==本篇）。
    /// </summary>
    [Fact]
    public async Task Backlinks_SelfReference_IsExcluded()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync(UniqueEmail("bl-self"));
        var client = _factory.CreateClientWithToken(token);
        var (noteA, _) = await CreateNoteAsync(client, "自我參照", "內文A");

        await CreateLinkMarkAsync(client, noteA, noteA, "自己指自己");
        await SeedEntityLinkAsync(userId, noteA, noteA);

        var backlinks = await GetBacklinksAsync(client, noteA);

        backlinks.Should().BeEmpty();
    }

    // ── 測試 8：噪音負向——highlight／annotation／url 型 link 不入列 ───────────────────

    /// <summary>
    /// A 對 B... 不對：highlight／annotation 沒有目標；kind=link 但 targetType=url 也與筆記無關。
    /// 三種噪音標註存在時，backlinks(B) 仍不得出現任何 mark 來源
    /// （實作漏寫任一 Where 子句都會被本測試抓到）。
    /// </summary>
    [Fact]
    public async Task Backlinks_NoiseMarks_AreExcluded()
    {
        var client = await NewUserClientAsync("bl-noise");
        var (noteA, _) = await CreateNoteAsync(client, "噪音來源", "內文A");
        var (noteB, _) = await CreateNoteAsync(client, "噪音目標", "內文B");

        // highlight／annotation：無目標概念；url 型 link：目標是外部網址非筆記。
        await PostMarkAsync(client, noteA, new
        {
            kind = "highlight",
            anchorText = "重點文字",
            anchorStart = 0,
            anchorEnd = 4,
            anchorPrefix = "",
            anchorSuffix = "",
            color = "yellow",
        });
        await PostMarkAsync(client, noteA, new
        {
            kind = "annotation",
            anchorText = "備註文字",
            anchorStart = 0,
            anchorEnd = 4,
            anchorPrefix = "",
            anchorSuffix = "",
            text = "一則備註",
        });
        await PostMarkAsync(client, noteA, new
        {
            kind = "link",
            anchorText = "外部連結",
            anchorStart = 0,
            anchorEnd = 4,
            anchorPrefix = "",
            anchorSuffix = "",
            targetType = "url",
            targetUrl = "https://example.com",
        });

        var backlinks = await GetBacklinksAsync(client, noteB);

        backlinks.Should().BeEmpty();
    }

    // ── 測試 9：多則 mark 不去重 ─────────────────────────────────────────────────────

    /// <summary>
    /// A 對 B 建兩則不同段落的關聯 → backlinks(B) 應為兩筆獨立條目（各帶自己的段落文字）。
    /// </summary>
    [Fact]
    public async Task Backlinks_MultipleMarksFromSameNote_AreNotDeduplicated()
    {
        var client = await NewUserClientAsync("bl-multi");
        var (noteA, _) = await CreateNoteAsync(client, "多段來源", "內文A");
        var (noteB, _) = await CreateNoteAsync(client, "多段目標", "內文B");

        await CreateLinkMarkAsync(client, noteA, noteB, "第一段");
        await CreateLinkMarkAsync(client, noteA, noteB, "第二段");

        var backlinks = await GetBacklinksAsync(client, noteB);

        backlinks.Where(b => b.Kind == "mark").Should().HaveCount(2);
        backlinks.Select(b => b.AnchorText).Should().Contain(new[] { "第一段", "第二段" });
    }

    // ── 測試 10：Detached 的 mark 照樣列出（包2 裁決；視覺標示屬包4）─────────────────

    /// <summary>
    /// 內文編輯後失去錨點（Detached=true）的關聯：關聯本身沒失效，backlinks(B) 仍應列出
    /// （「失去定位」的降級顯示屬包4 範圍，此處先釘住「不消失」）。
    /// </summary>
    [Fact]
    public async Task Backlinks_DetachedMark_StillAppears()
    {
        var client = await NewUserClientAsync("bl-detached");
        var (noteA, _) = await CreateNoteAsync(client, "斷錨來源", "內文A");
        var (noteB, _) = await CreateNoteAsync(client, "斷錨目標", "內文B");
        var markId = await CreateLinkMarkAsync(client, noteA, noteB, "已被改掉的段落");

        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            var mark = await db.NoteMark.IgnoreQueryFilters().FirstAsync(m => m.Id == markId);
            mark.Detached = true;
            await db.SaveChangesAsync();
        }

        var backlinks = await GetBacklinksAsync(client, noteB);

        backlinks.Should().ContainSingle(b => b.Kind == "mark" && b.MarkId == markId.ToString());
    }

    // ── 測試 11：軟刪除連動——來源筆記刪除、mark 撤銷後消失 ──────────────────────────

    /// <summary>
    /// (a) 撤銷 mark（DELETE marks，軟刪）→ backlinks(B) 該筆消失；
    /// (b) 軟刪除來源筆記 A → backlinks(B) 不再出現 A 的任何來源。
    /// </summary>
    [Fact]
    public async Task Backlinks_SoftDeletedSources_Disappear()
    {
        var client = await NewUserClientAsync("bl-softdel");
        var (noteA, _) = await CreateNoteAsync(client, "軟刪來源", "內文A");
        var (noteB, _) = await CreateNoteAsync(client, "軟刪目標", "內文B");
        var markId = await CreateLinkMarkAsync(client, noteA, noteB, "會被撤銷的段落");
        await CreateEntityLinkAsync(client, noteA, noteB);

        // (a) 撤銷 mark → mark 來源消失、entity 來源仍在
        (await client.DeleteAsync($"/api/notes/marks/{markId}")).EnsureSuccessStatusCode();
        var afterMarkDelete = await GetBacklinksAsync(client, noteB);
        afterMarkDelete.Should().NotContain(b => b.Kind == "mark");
        afterMarkDelete.Should().ContainSingle(b => b.Kind == "entity");

        // (b) 軟刪除來源筆記 → 全部消失
        (await client.DeleteAsync($"/api/notes/{noteA}")).EnsureSuccessStatusCode();
        var afterNoteDelete = await GetBacklinksAsync(client, noteB);
        afterNoteDelete.Should().BeEmpty();
    }

    // ── 測試 12：跨使用者隔離（mark 走真實 HTTP、entity 走 DbContext 直寫）─────────────

    /// <summary>
    /// user2 以真實 HTTP 建 mark-link 指向 user1 的筆記（建立端點對 targetType=note
    /// 不驗目標擁有權，確實打得進 DB）；另 DbContext 直寫 user2 的 EntityLink 指向 user1 筆記
    /// （API 層 OwnsEntityAsync 擋雙端）→ user1 查 backlinks 兩者都不得看到。
    /// 防線＝IUserOwned 全域查詢過濾（handler 不自濾），本測試即其實證。
    /// </summary>
    [Fact]
    public async Task Backlinks_CrossUserSources_AreInvisible()
    {
        var (_, token1) = await _factory.SeedUserWithTokenAsync(UniqueEmail("bl-iso-u1"));
        var user1Client = _factory.CreateClientWithToken(token1);
        var (user2Id, token2) = await _factory.SeedUserWithTokenAsync(UniqueEmail("bl-iso-u2"));
        var user2Client = _factory.CreateClientWithToken(token2);

        var (user1Note, _) = await CreateNoteAsync(user1Client, "受害者筆記", "內文");
        var (user2Note, _) = await CreateNoteAsync(user2Client, "攻擊者筆記", "內文");

        // user2 真實 HTTP：以自己的筆記為來源、targetId 填 user1 的筆記
        await CreateLinkMarkAsync(user2Client, user2Note, user1Note, "跨使用者段落");
        // user2 EntityLink：API 擋雙端擁有權，直寫模擬髒資料
        await SeedEntityLinkAsync(user2Id, user2Note, user1Note);

        var backlinks = await GetBacklinksAsync(user1Client, user1Note);

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

    /// <summary>POST 一則標註（任意 payload 形狀）並回傳其 Id。</summary>
    /// <param name="client">已帶 Bearer 權杖的用戶端。</param>
    /// <param name="noteId">來源筆記 Id。</param>
    /// <param name="payload">標註建立請求內容。</param>
    /// <returns>新標註 Id。</returns>
    private static async Task<Guid> PostMarkAsync(HttpClient client, Guid noteId, object payload)
    {
        var response = await client.PostAsJsonAsync($"/api/notes/{noteId}/marks", payload);
        response.EnsureSuccessStatusCode();
        var data = (await response.ReadJsonAsync())["data"]!;
        return Guid.Parse(data["id"]!.GetValue<string>());
    }

    /// <summary>
    /// 建立「框選段落關聯到某筆記」的 link 標註（kind=link、targetType=note）。
    /// </summary>
    /// <param name="client">已帶 Bearer 權杖的用戶端。</param>
    /// <param name="sourceNoteId">來源筆記（框選發生的那篇）。</param>
    /// <param name="targetNoteId">目標筆記。</param>
    /// <param name="anchorText">框選的段落文字。</param>
    /// <returns>新標註 Id。</returns>
    private static Task<Guid> CreateLinkMarkAsync(
        HttpClient client,
        Guid sourceNoteId,
        Guid targetNoteId,
        string anchorText)
    {
        return PostMarkAsync(client, sourceNoteId, new
        {
            kind = "link",
            anchorText,
            anchorStart = 0,
            anchorEnd = anchorText.Length,
            anchorPrefix = "",
            anchorSuffix = "",
            targetType = "note",
            targetId = targetNoteId,
        });
    }

    /// <summary>透過真實 HTTP 建立 EntityLink（note↔note）。</summary>
    /// <param name="client">已帶 Bearer 權杖的用戶端。</param>
    /// <param name="sourceNoteId">來源端筆記。</param>
    /// <param name="targetNoteId">目標端筆記。</param>
    private static async Task CreateEntityLinkAsync(
        HttpClient client,
        Guid sourceNoteId,
        Guid targetNoteId)
    {
        var response = await client.PostAsJsonAsync("/api/links", new
        {
            sourceType = "note",
            sourceId = sourceNoteId,
            targetType = "note",
            targetId = targetNoteId,
        });
        response.EnsureSuccessStatusCode();
    }

    /// <summary>
    /// 經 DbContext 直寫一筆 EntityLink（模擬 API 層擋不到的髒資料：自我參照、跨使用者）。
    /// </summary>
    /// <param name="userId">擁有者使用者 Id。</param>
    /// <param name="sourceNoteId">來源端筆記。</param>
    /// <param name="targetNoteId">目標端筆記。</param>
    private async Task SeedEntityLinkAsync(Guid userId, Guid sourceNoteId, Guid targetNoteId)
    {
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            db.EntityLink.Add(new EntityLink
            {
                UserId = userId,
                SourceType = "note",
                SourceId = sourceNoteId,
                TargetType = "note",
                TargetId = targetNoteId,
                Kind = "link",
                CreatedUser = userId.ToString(),
                UpdatedUser = userId.ToString(),
                ValidFlag = true,
            });
            await db.SaveChangesAsync();
        }
    }

    /// <summary>
    /// 打 GET /api/notes/{id}/backlinks 並解析為輕量投影（含新欄位 kind／markId）。
    /// </summary>
    /// <param name="client">已帶 Bearer 權杖的用戶端。</param>
    /// <param name="noteId">目標筆記 Id。</param>
    /// <returns>反向連結清單（保持回傳順序）。</returns>
    private static async Task<List<BacklinkRow>> GetBacklinksAsync(HttpClient client, Guid noteId)
    {
        var response = await client.GetAsync($"/api/notes/{noteId}/backlinks");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var data = (await response.ReadJsonAsync())["data"]!.AsArray();

        return data
            .Select(node => new BacklinkRow(
                node!["id"]!.GetValue<string>(),
                node["sourceNoteId"]!.GetValue<string>(),
                node["sourceNoteTitle"]!.GetValue<string>(),
                node["sourceNoteSlug"]!.GetValue<string>(),
                node["anchorText"]!.GetValue<string>(),
                node["kind"]?.GetValue<string>(),
                node["markId"]?.GetValue<string>()))
            .ToList();
    }

    /// <summary>
    /// 反向連結結果的輕量投影。
    /// </summary>
    /// <param name="Id">連結識別碼。</param>
    /// <param name="SourceNoteId">來源筆記識別碼。</param>
    /// <param name="SourceNoteTitle">來源筆記標題。</param>
    /// <param name="SourceNoteSlug">來源筆記 slug。</param>
    /// <param name="AnchorText">錨點文字（wiki=[[X]] 的 X；mark=框選段落；entity=空字串）。</param>
    /// <param name="Kind">來源型別（wiki｜mark｜entity；未實作前為 null → 斷言失敗即 RED）。</param>
    /// <param name="MarkId">mark 來源的標註 Id（其餘為 null）。</param>
    private sealed record BacklinkRow(
        string Id,
        string SourceNoteId,
        string SourceNoteTitle,
        string SourceNoteSlug,
        string AnchorText,
        string? Kind,
        string? MarkId);
}
