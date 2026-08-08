using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;
using ZonWiki.Api.Notes;
using ZonWiki.Api.Services;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Api.Tests.Integration;

/// <summary>
/// 筆記「渲染版本＋自癒」整合測試（互動表格設計 v2 修訂第 3 條；對抗式復審 HIGH-1 後修訂）。
///
/// 背景：筆記的 ContentHtml 是「渲染快取」——渲染管線升級（表格行號、移除 GenericAttributes）後，
/// 存量筆記的快取仍是舊管線輸出、缺新屬性（data-md-table / data-md-line）。設計分兩層：
/// 1. 【讀取層・純記憶體自癒】GET 單篇筆記時 <c>RenderVersion &lt; CurrentRenderVersion</c> →
///    只在「回應中」用重算的 ContentHtml，**絕不寫 DB**。
///    為什麼不能回存（復審 HIGH-1 實測）：回存（不管 SaveChanges 或 ExecuteUpdate）都會推進該列的
///    xmin 樂觀鎖版本——另一個「在自癒前就載入筆記」的 session 手上的 baseVersion 立刻過期，
///    存檔就撞假 409（跨 session 版的「開啟即假衝突」）。讀取行為絕不能改變併發權杖。
/// 2. 【收斂層・啟動一次性遷移】<see cref="NoteRenderMigrationService"/> 於啟動（MigrateAsync 後）
///    背景掃描全部過時筆記重算回存，讓記憶體自癒只需撐「部署後的短暫窗口」。
///
/// 副作用鎖（本類的重點斷言）：
/// - 讀取層：GET 完全不落 DB（RenderVersion / ContentHtml / UpdatedDateTime / xmin 全不動）、
///   不產生 NoteRevision、不記 ActivityLog。
/// - 收斂層：遷移回存 ContentHtml＋RenderVersion，但不產生 NoteRevision、不記 ActivityLog、
///   不動 UpdatedDateTime（xmin 會動——部署時刻的一次性成本，與 schema migration 同級）。
/// </summary>
[Collection(ApiIntegrationCollection.Name)]
public sealed class NoteRenderVersionHttpTests
{
    private readonly ZonWikiApiFactory _factory;

    /// <summary>
    /// 注入共用的整合測試基座。
    /// </summary>
    /// <param name="factory">整合測試基座。</param>
    public NoteRenderVersionHttpTests(ZonWikiApiFactory factory)
    {
        _factory = factory;
    }

    /// <summary>
    /// 含表格的測試內容（重渲染後 ContentHtml 應帶 data-md-table / data-md-line）。
    /// </summary>
    private const string TableContentRaw = "| A | B |\n|---|---|\n| 1 | 2 |";

    /// <summary>
    /// 建立一則筆記並回傳其 Id（透過真實 POST /api/notes）。
    /// </summary>
    /// <param name="client">已帶 Bearer 權杖的用戶端。</param>
    /// <param name="contentRaw">筆記 Markdown 內容。</param>
    /// <returns>新筆記 Id。</returns>
    private static async Task<Guid> CreateNoteAsync(HttpClient client, string contentRaw)
    {
        var response = await client.PostAsJsonAsync("/api/notes",
            new { title = $"渲染版本測試-{Guid.NewGuid():N}", contentRaw });
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var json = await response.ReadJsonAsync();
        return Guid.Parse(json["data"]!["id"]!.GetValue<string>());
    }

    /// <summary>
    /// 把資料庫中的筆記「降級成舊管線快取」：ContentHtml 改成指定哨兵值、RenderVersion 歸零。
    /// 用 ExecuteUpdate（不經 SaveChanges 攔截器），模擬「升級前就存在的存量筆記」。
    /// </summary>
    /// <param name="noteId">筆記 Id。</param>
    /// <param name="legacyHtml">模擬的舊版 ContentHtml。</param>
    /// <param name="renderVersion">模擬的舊版渲染版本（預設 0）。</param>
    private async Task DowngradeNoteInDbAsync(Guid noteId, string legacyHtml, int renderVersion = 0)
    {
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            var affected = await db.Note
                .IgnoreQueryFilters()
                .Where(n => n.Id == noteId)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(n => n.ContentHtml, legacyHtml)
                    .SetProperty(n => n.RenderVersion, renderVersion));
            affected.Should().Be(1);
        }
    }

    /// <summary>
    /// 直接自資料庫讀取筆記實體（略過全域過濾；AsNoTracking）。
    /// </summary>
    /// <param name="noteId">筆記 Id。</param>
    /// <returns>筆記實體。</returns>
    private async Task<Note> GetNoteFromDbAsync(Guid noteId)
    {
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            var note = await db.Note.IgnoreQueryFilters().AsNoTracking()
                .FirstOrDefaultAsync(n => n.Id == noteId);
            note.Should().NotBeNull();
            return note!;
        }
    }

    /// <summary>
    /// 直接自資料庫讀取筆記目前的樂觀鎖版本（xmin，SELECT 不推進版本）。
    /// 模擬「另一個 session 早已載入筆記、手上握著當下的 baseVersion」。
    /// </summary>
    /// <param name="noteId">筆記 Id。</param>
    /// <returns>xmin 放大為 long（與 API 回傳的 version 同語意）。</returns>
    private async Task<long> GetNoteVersionFromDbAsync(Guid noteId)
    {
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            var row = await db.Note.IgnoreQueryFilters()
                .Where(n => n.Id == noteId)
                .Select(n => new { Xmin = EF.Property<uint>(n, "xmin") })
                .FirstAsync();
            return (long)row.Xmin;
        }
    }

    /// <summary>
    /// 統計該筆記目前的 NoteRevision 與 ActivityLog 筆數（副作用鎖用；略過全域過濾）。
    /// </summary>
    /// <param name="noteId">筆記 Id。</param>
    /// <returns>版本快照筆數與活動紀錄筆數。</returns>
    private async Task<(int RevisionCount, int ActivityCount)> CountSideEffectsAsync(Guid noteId)
    {
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            var revisions = await db.NoteRevision.IgnoreQueryFilters()
                .CountAsync(r => r.NoteId == noteId);
            var activities = await db.ActivityLog.IgnoreQueryFilters()
                .CountAsync(a => a.EntityId == noteId);
            return (revisions, activities);
        }
    }

    // ==================== 讀取層：純記憶體自癒 ====================

    /// <summary>
    /// 舊筆記（RenderVersion=0、快取無 data-md-table）被 GET：
    /// 回應是「現行管線重算後」的 HTML（含 data-md-table / data-md-line），
    /// 但**資料庫完全不被改寫**（快取、版本號、更新時間、xmin 全維持原狀）——
    /// 讀取行為不落 DB 是「跨 session 假 409」的根治前提。
    /// </summary>
    [Fact]
    public async Task StaleNote_GetById_RerendersInMemoryOnly_DbUntouched()
    {
        // Arrange：建立含表格的筆記，再降級成「舊管線快取」。
        var (_, token) = await _factory.SeedUserWithTokenAsync($"rv-stale-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);
        var noteId = await CreateNoteAsync(client, TableContentRaw);
        await DowngradeNoteInDbAsync(noteId, "<p>legacy-html-no-table-marker</p>");

        var before = await GetNoteFromDbAsync(noteId);
        var versionBefore = await GetNoteVersionFromDbAsync(noteId);
        var (revisionsBefore, activitiesBefore) = await CountSideEffectsAsync(noteId);

        // Act：GET 單篇（GUID 直達路徑）。
        var response = await client.GetAsync($"/api/notes/{noteId}");

        // Assert：200，回應已是重算後的 HTML（含新屬性、哨兵舊值消失）。
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var note = (await response.ReadJsonAsync())["data"]!["note"]!;
        var contentHtml = note["contentHtml"]!.GetValue<string>();
        contentHtml.Should().Contain("data-md-table=\"1\"");
        contentHtml.Should().Contain("data-md-line=\"1\"");
        contentHtml.Should().NotContain("legacy-html-no-table-marker");

        // Assert【核心】：DB 完全未被 GET 改寫（自癒只發生在回應記憶體中）。
        var after = await GetNoteFromDbAsync(noteId);
        after.RenderVersion.Should().Be(0);
        after.ContentHtml.Should().Be("<p>legacy-html-no-table-marker</p>");
        after.UpdatedDateTime.Should().Be(before.UpdatedDateTime);
        (await GetNoteVersionFromDbAsync(noteId)).Should().Be(versionBefore);

        // Assert【副作用鎖】：不產生版本、不記活動。
        var (revisionsAfter, activitiesAfter) = await CountSideEffectsAsync(noteId);
        revisionsAfter.Should().Be(revisionsBefore);
        activitiesAfter.Should().Be(activitiesBefore);
    }

    /// <summary>
    /// 【跨 session 假 409 根治鎖（復審 HIGH-1）】session A 早已載入筆記（握有當下 version）；
    /// 之後 session B GET 同一筆過時筆記（觸發自癒路徑）——A 再以手上的 version 存檔必須成功。
    /// 若自癒會寫 DB（推進 xmin），A 就會撞假 409：這正是改成純記憶體自癒的原因。
    /// </summary>
    [Fact]
    public async Task StaleNote_OtherSessionGet_DoesNotInvalidateEarlierLoadedVersion()
    {
        // Arrange：建立→降級；session A 在「任何 GET 之前」記下當下版本（模擬先載入的分頁）。
        var (_, token) = await _factory.SeedUserWithTokenAsync($"rv-cross-{Guid.NewGuid():N}@example.com");
        var clientA = _factory.CreateClientWithToken(token);
        var clientB = _factory.CreateClientWithToken(token);
        var noteId = await CreateNoteAsync(clientA, TableContentRaw);
        await DowngradeNoteInDbAsync(noteId, "<p>legacy-cross-session</p>");
        var versionHeldByA = await GetNoteVersionFromDbAsync(noteId);

        // Act：session B GET（走自癒路徑）→ session A 以先前握有的版本存檔。
        var getByB = await clientB.GetAsync($"/api/notes/{noteId}");
        getByB.StatusCode.Should().Be(HttpStatusCode.OK);

        var putByA = await clientA.PutAsJsonAsync($"/api/notes/{noteId}",
            new { contentRaw = "A 的更新", baseVersion = versionHeldByA });

        // Assert：不得因 B 的「讀取」而讓 A 的版本過期（讀取不可改變併發權杖）。
        putByA.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    /// <summary>
    /// RenderVersion 已是最新的筆記被 GET：不得進入重算分支——
    /// 以「DB 快取塞哨兵值、RenderVersion 維持 Current」驗證：回應原樣回傳哨兵。
    /// </summary>
    [Fact]
    public async Task CurrentNote_GetById_DoesNotRerender()
    {
        // Arrange：建立筆記後，把快取換成哨兵值但版本維持最新。
        var (_, token) = await _factory.SeedUserWithTokenAsync($"rv-current-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);
        var noteId = await CreateNoteAsync(client, TableContentRaw);
        await DowngradeNoteInDbAsync(
            noteId,
            "<p>sentinel-should-not-be-rerendered</p>",
            NoteContentHelpers.CurrentRenderVersion);

        // Act
        var response = await client.GetAsync($"/api/notes/{noteId}");

        // Assert：版本已最新 → 不重算，哨兵原樣回傳、DB 未被改寫。
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var note = (await response.ReadJsonAsync())["data"]!["note"]!;
        note["contentHtml"]!.GetValue<string>()
            .Should().Be("<p>sentinel-should-not-be-rerendered</p>");
        (await GetNoteFromDbAsync(noteId)).ContentHtml
            .Should().Be("<p>sentinel-should-not-be-rerendered</p>");
    }

    /// <summary>
    /// slug 解析路徑（非 GUID 直達）也會經過同一份載入函數 → 一樣記憶體自癒、一樣不落 DB。
    /// </summary>
    [Fact]
    public async Task StaleNote_GetBySlug_AlsoRerendersInMemory()
    {
        // Arrange。
        var (_, token) = await _factory.SeedUserWithTokenAsync($"rv-slug-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);
        var noteId = await CreateNoteAsync(client, TableContentRaw);
        var slug = (await GetNoteFromDbAsync(noteId)).Slug;
        await DowngradeNoteInDbAsync(noteId, "<p>legacy-by-slug</p>");

        // Act：以活 slug 命中。
        var response = await client.GetAsync($"/api/notes/{Uri.EscapeDataString(slug)}");

        // Assert：回應已重算；DB 維持原狀（收斂交給啟動遷移）。
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var note = (await response.ReadJsonAsync())["data"]!["note"]!;
        note["contentHtml"]!.GetValue<string>().Should().Contain("data-md-table=\"1\"");
        var after = await GetNoteFromDbAsync(noteId);
        after.RenderVersion.Should().Be(0);
        after.ContentHtml.Should().Be("<p>legacy-by-slug</p>");
    }

    /// <summary>
    /// 樂觀鎖交互作用：GET（含自癒路徑）回傳的 version 必須可直接當 baseVersion 存檔成功
    /// （純記憶體自癒不動 xmin，回傳的就是列上的現值，天然成立；此測試防未來回歸）。
    /// </summary>
    [Fact]
    public async Task StaleNote_GetThenPutWithReturnedVersion_Succeeds()
    {
        // Arrange。
        var (_, token) = await _factory.SeedUserWithTokenAsync($"rv-xmin-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);
        var noteId = await CreateNoteAsync(client, TableContentRaw);
        await DowngradeNoteInDbAsync(noteId, "<p>legacy-xmin</p>");

        // Act：GET（觸發記憶體自癒）→ 以回傳的 version 直接存檔。
        var getResponse = await client.GetAsync($"/api/notes/{noteId}");
        getResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var version = (await getResponse.ReadJsonAsync())["data"]!["note"]!["version"]!.GetValue<long>();

        var putResponse = await client.PutAsJsonAsync($"/api/notes/{noteId}",
            new { contentRaw = "帶 baseVersion 的更新", baseVersion = version });

        // Assert。
        putResponse.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    // ==================== 寫入路徑：版本同步 ====================

    /// <summary>
    /// 建立筆記（POST）：RenderVersion 應直接落地為 CurrentRenderVersion（新筆記不需自癒）。
    /// </summary>
    [Fact]
    public async Task CreateNote_PersistsCurrentRenderVersion()
    {
        // Arrange。
        var (_, token) = await _factory.SeedUserWithTokenAsync($"rv-create-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);

        // Act。
        var noteId = await CreateNoteAsync(client, TableContentRaw);

        // Assert。
        (await GetNoteFromDbAsync(noteId)).RenderVersion
            .Should().Be(NoteContentHelpers.CurrentRenderVersion);
    }

    /// <summary>
    /// 更新內容（PUT 帶 contentRaw）：重算 ContentHtml 的同時，RenderVersion 也應更新為最新
    /// （寫入路徑與快取版本必須同步，否則剛編輯完的存量筆記會被誤判成待自癒）。
    /// </summary>
    [Fact]
    public async Task UpdateNoteContent_RefreshesRenderVersion()
    {
        // Arrange：建立筆記後把版本降回 0（模擬存量筆記被使用者直接編輯）。
        var (_, token) = await _factory.SeedUserWithTokenAsync($"rv-update-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);
        var noteId = await CreateNoteAsync(client, TableContentRaw);
        await DowngradeNoteInDbAsync(noteId, "<p>stale</p>");

        // Act：PUT 更新內容。
        var response = await client.PutAsJsonAsync($"/api/notes/{noteId}",
            new { contentRaw = "更新後內容" });

        // Assert：200，且版本已同步為最新。
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await GetNoteFromDbAsync(noteId)).RenderVersion
            .Should().Be(NoteContentHelpers.CurrentRenderVersion);
    }

    // ==================== 收斂層：啟動一次性遷移 ====================

    /// <summary>
    /// 遷移服務把過時筆記重算回存：RenderVersion=Current、ContentHtml 含新屬性；
    /// 且不產生 NoteRevision、不記 ActivityLog、不動 UpdatedDateTime
    /// （xmin 會動——部署時刻一次性成本，明文接受）。
    /// </summary>
    [Fact]
    public async Task MigrationService_HealsStaleNote_WithoutSideEffects()
    {
        // Arrange：建立→降級成過時快取。
        var (_, token) = await _factory.SeedUserWithTokenAsync($"rv-migrate-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);
        var noteId = await CreateNoteAsync(client, TableContentRaw);
        await DowngradeNoteInDbAsync(noteId, "<p>legacy-for-migration</p>");

        var before = await GetNoteFromDbAsync(noteId);
        var (revisionsBefore, activitiesBefore) = await CountSideEffectsAsync(noteId);

        // Act：直接呼叫遷移服務的核心方法（啟動時由 HostedService 觸發同一份邏輯）。
        var migrationService = _factory.Services.GetRequiredService<NoteRenderMigrationService>();
        await migrationService.MigrateStaleNotesAsync(CancellationToken.None);

        // Assert：DB 已收斂（新快取＋新版本號）。
        var after = await GetNoteFromDbAsync(noteId);
        after.RenderVersion.Should().Be(NoteContentHelpers.CurrentRenderVersion);
        after.ContentHtml.Should().Contain("data-md-table=\"1\"");
        after.ContentHtml.Should().NotContain("legacy-for-migration");

        // Assert【副作用鎖】：遷移不是編輯——不產生版本、不記活動、不動更新時間。
        var (revisionsAfter, activitiesAfter) = await CountSideEffectsAsync(noteId);
        revisionsAfter.Should().Be(revisionsBefore);
        activitiesAfter.Should().Be(activitiesBefore);
        after.UpdatedDateTime.Should().Be(before.UpdatedDateTime);
    }

    /// <summary>
    /// 遷移服務對「版本已最新」的筆記不動任何一根毫毛（哨兵快取原樣保留、xmin 不變）。
    /// </summary>
    [Fact]
    public async Task MigrationService_SkipsCurrentNote()
    {
        // Arrange：版本已最新、快取為哨兵值。
        var (_, token) = await _factory.SeedUserWithTokenAsync($"rv-migskip-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);
        var noteId = await CreateNoteAsync(client, TableContentRaw);
        await DowngradeNoteInDbAsync(
            noteId, "<p>sentinel-migration-skip</p>", NoteContentHelpers.CurrentRenderVersion);
        var versionBefore = await GetNoteVersionFromDbAsync(noteId);

        // Act。
        var migrationService = _factory.Services.GetRequiredService<NoteRenderMigrationService>();
        await migrationService.MigrateStaleNotesAsync(CancellationToken.None);

        // Assert：完全未被觸碰。
        var after = await GetNoteFromDbAsync(noteId);
        after.ContentHtml.Should().Be("<p>sentinel-migration-skip</p>");
        (await GetNoteVersionFromDbAsync(noteId)).Should().Be(versionBefore);
    }
}
