using System.Net;
using System.Net.Http.Json;
using System.Text;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Xunit;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Tests.Integration;

/// <summary>
/// 筆記版本快照（NoteRevision）完整性整合測試（真 HTTP + 真 PostgreSQL）。
///
/// 需求背景（使用者原話）：「任何方式改變了筆記的內容，都要被保存成一個版本，
/// 不論是建立還是修改皆是」——因為系統仍在測試階段，可能有未知的覆寫問題，
/// 完整版本紀錄是防止重要筆記遺失的最後防線。
///
/// 對應實作：<c>NoteRevisionInterceptor</c>（EF SaveChanges 攔截器、唯一寫入點）。
/// 本檔逐一鎖住所有「會改變筆記標題/內容」的真實路徑都寫快照，並鎖住
/// 「不該寫快照的情境」（純中繼資料變更、同值重送、還原）不產生噪音版本。
///
/// 2026-08-13 契約演進（使用者裁示「時間窗合併」）：同一使用者、有 HTTP 脈絡、
/// 距最新 update 版的 CreatedDateTime 10 分鐘內的連續 update 併成一筆（就地覆寫）；
/// create/delete 快照與背景服務寫入永不合併——「任何變更都留版本」修正為
/// 「每 10 分鐘至少留一個救援點；窗內連續小改動視為同一次編輯」。
///
/// 斷言原則（測試計畫審查結論）：
/// - 一律斷言「恰好 N 筆」而非「包含某筆」——才能同時抓到「漏寫」與「雙寫」。
/// - 一律驗證快照列的稽核欄位（CreatedDateTime 非 0001-01-01）——攔截器產生的列
///   不會被稽核攔截器補章（它先跑），必須自行蓋章，此欄位是該陷阱的哨兵。
/// </summary>
[Collection(ApiIntegrationCollection.Name)]
public sealed class NoteRevisionHttpTests
{
    private readonly ZonWikiApiFactory _factory;

    public NoteRevisionHttpTests(ZonWikiApiFactory factory)
    {
        _factory = factory;
    }

    // ==================== 建立路徑 ====================

    /// <summary>
    /// 測試：POST /api/notes 建立筆記 → 恰好一筆 create 快照（RevisionNo=1、內容快照正確、稽核欄位有蓋章）。
    /// </summary>
    [Fact]
    public async Task CreateNote_WritesExactlyOneCreateRevision()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"rev-create-{Guid.NewGuid():N}@test.local");
        using var client = _factory.CreateClientWithToken(token);

        var noteId = await CreateNoteViaApiAsync(client, "版本測試-建立", "# 初始內容");

        var rows = await GetRevisionRowsAsync(noteId);
        rows.Should().HaveCount(1);
        rows[0].RevisionNo.Should().Be(1);
        rows[0].ChangeKind.Should().Be("create");
        rows[0].Title.Should().Be("版本測試-建立");
        rows[0].ContentRaw.Should().Be("# 初始內容");
        AssertAuditStamped(rows[0], userId);
    }

    /// <summary>
    /// 測試：POST /api/links/note-from（從任務「建立並連結」筆記——先前唯一漏寫版本的路徑）
    /// → 恰好一筆 create 快照（空內容草稿、標題帶入）。
    /// </summary>
    [Fact]
    public async Task NoteFrom_WritesExactlyOneCreateRevision()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"rev-notefrom-{Guid.NewGuid():N}@test.local");
        using var client = _factory.CreateClientWithToken(token);

        var taskId = await client.CreateTaskAsync("來源任務");
        var response = await client.PostAsJsonAsync(
            "/api/links/note-from",
            new { sourceType = "taskcard", sourceId = taskId, title = "從任務建立的筆記" });
        response.EnsureSuccessStatusCode();
        var json = await response.ReadJsonAsync();
        var noteId = Guid.Parse(json["data"]!["noteId"]!.GetValue<string>());

        var rows = await GetRevisionRowsAsync(noteId);
        rows.Should().HaveCount(1);
        rows[0].RevisionNo.Should().Be(1);
        rows[0].ChangeKind.Should().Be("create");
        rows[0].Title.Should().Be("從任務建立的筆記");
        rows[0].ContentRaw.Should().BeEmpty();
        AssertAuditStamped(rows[0], userId);
    }

    /// <summary>
    /// 測試：POST /api/ai/notes 建立分支（一個請求內兩段 SaveChanges 的模式）
    /// → 恰好一筆 create 快照——第二段 SaveChanges 不得重複寫。
    /// </summary>
    [Fact]
    public async Task AiNotes_CreateBranch_WritesExactlyOneCreateRevision()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"rev-ai-create-{Guid.NewGuid():N}@test.local");
        using var client = _factory.CreateClientWithToken(token);

        var response = await client.PostAsJsonAsync(
            "/api/ai/notes",
            new { title = "AI建立的筆記", contentRaw = "AI 內容", categoryPath = new[] { "測試分類" } });
        response.EnsureSuccessStatusCode();
        var json = await response.ReadJsonAsync();
        var noteId = Guid.Parse(json["data"]!["id"]!.GetValue<string>());

        var rows = await GetRevisionRowsAsync(noteId);
        rows.Should().HaveCount(1);
        rows[0].ChangeKind.Should().Be("create");
        rows[0].RevisionNo.Should().Be(1);
        rows[0].ContentRaw.Should().Be("AI 內容");
        AssertAuditStamped(rows[0], userId);
    }

    /// <summary>
    /// 測試：POST /api/ai/notes 的 upsert 更新分支（覆寫既有筆記內容）
    /// → 追加恰好一筆 update 快照（RevisionNo=2、快照=覆寫後內容）。
    /// </summary>
    [Fact]
    public async Task AiNotes_UpsertBranch_AppendsExactlyOneUpdateRevision()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"rev-ai-upsert-{Guid.NewGuid():N}@test.local");
        using var client = _factory.CreateClientWithToken(token);

        var create = await client.PostAsJsonAsync(
            "/api/ai/notes",
            new { title = "AI覆寫測試", contentRaw = "第一版", categoryPath = new[] { "覆寫分類" } });
        create.EnsureSuccessStatusCode();
        var noteId = Guid.Parse((await create.ReadJsonAsync())["data"]!["id"]!.GetValue<string>());

        var upsert = await client.PostAsJsonAsync(
            "/api/ai/notes",
            new { title = "AI覆寫測試", contentRaw = "第二版", categoryPath = new[] { "覆寫分類" }, upsert = true });
        upsert.EnsureSuccessStatusCode();
        var upsertNoteId = Guid.Parse((await upsert.ReadJsonAsync())["data"]!["id"]!.GetValue<string>());
        upsertNoteId.Should().Be(noteId, "upsert 應命中同一篇筆記而非另建新篇");

        var rows = await GetRevisionRowsAsync(noteId);
        rows.Should().HaveCount(2);
        rows[1].RevisionNo.Should().Be(2);
        rows[1].ChangeKind.Should().Be("update");
        rows[1].ContentRaw.Should().Be("第二版");
        AssertAuditStamped(rows[1], userId);
    }

    /// <summary>
    /// 測試：背景服務情境（無 HTTP 脈絡、CurrentUserId 為空——AI 精煉／框選提問建立筆記
    /// 走的就是這種 DI 解析的 DbContext）→ 仍寫 create 快照，且 UserId 歸屬筆記擁有者。
    /// 必須用 DI 解析的 DbContext（掛好完整攔截器鏈），不可手刻 new DbContext。
    /// </summary>
    [Fact]
    public async Task BackgroundSave_NoCurrentUser_StillWritesCreateRevisionOwnedByNoteOwner()
    {
        var (userId, _) = await _factory.SeedUserWithTokenAsync($"rev-bg-{Guid.NewGuid():N}@test.local");

        Guid noteId;
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            var note = new Note
            {
                UserId = userId,
                Title = "背景建立的筆記",
                Slug = $"bg-note-{Guid.NewGuid():N}",
                ContentRaw = "背景內容",
                ContentHtml = "<p>背景內容</p>",
                ContentHash = "hash",
                Kind = "note",
                CreatedUser = userId.ToString(),
                UpdatedUser = userId.ToString(),
            };
            db.Note.Add(note);
            await db.SaveChangesAsync();
            noteId = note.Id;
        }

        var rows = await GetRevisionRowsAsync(noteId);
        rows.Should().HaveCount(1);
        rows[0].ChangeKind.Should().Be("create");
        rows[0].UserId.Should().Be(userId, "無登入脈絡時快照仍須歸屬筆記擁有者，否則查詢過濾器會讓歷史隱形");
        AssertAuditStamped(rows[0], userId);
    }

    // ==================== 更新路徑 ====================

    /// <summary>
    /// 測試：PUT 改內容 → 追加恰好一筆 update 快照（RevisionNo=2、快照=改後內容）。
    /// </summary>
    [Fact]
    public async Task UpdateContent_AppendsExactlyOneUpdateRevision()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"rev-upd-{Guid.NewGuid():N}@test.local");
        using var client = _factory.CreateClientWithToken(token);
        var noteId = await CreateNoteViaApiAsync(client, "更新測試", "原始內容");

        var response = await client.PutAsJsonAsync($"/api/notes/{noteId}", new { contentRaw = "更新後內容" });
        response.EnsureSuccessStatusCode();

        var rows = await GetRevisionRowsAsync(noteId);
        rows.Should().HaveCount(2);
        rows[1].RevisionNo.Should().Be(2);
        rows[1].ChangeKind.Should().Be("update");
        rows[1].ContentRaw.Should().Be("更新後內容");
        AssertAuditStamped(rows[1], userId);
    }

    /// <summary>
    /// 測試：PUT 只改標題（內容不動）→ 也算內容變更，追加 update 快照。
    /// </summary>
    [Fact]
    public async Task UpdateTitleOnly_AppendsExactlyOneUpdateRevision()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"rev-title-{Guid.NewGuid():N}@test.local");
        using var client = _factory.CreateClientWithToken(token);
        var noteId = await CreateNoteViaApiAsync(client, "改名前", "內容不變");

        var response = await client.PutAsJsonAsync($"/api/notes/{noteId}", new { title = "改名後" });
        response.EnsureSuccessStatusCode();

        var rows = await GetRevisionRowsAsync(noteId);
        rows.Should().HaveCount(2);
        rows[1].ChangeKind.Should().Be("update");
        rows[1].Title.Should().Be("改名後");
        rows[1].ContentRaw.Should().Be("內容不變");
    }

    /// <summary>
    /// 測試：PUT 只改分類（JSON 完全不含 title/contentRaw 鍵）→ 不追加快照。
    /// 內容沒變就不該產生與上一版一模一樣的噪音版本（歷史噪音會淹沒真正的救援點）。
    /// 注意：必須手刻部分 JSON——序列化完整 DTO 會把未指定欄位帶成 null 以外的值而失真。
    /// </summary>
    [Fact]
    public async Task CategoryOnlyUpdate_DoesNotAddRevision()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"rev-cat-{Guid.NewGuid():N}@test.local");
        using var client = _factory.CreateClientWithToken(token);
        var noteId = await CreateNoteViaApiAsync(client, "分類測試", "內容");
        var categoryId = await CreateCategoryAsync(userId, "測試用分類");

        using var body = new StringContent(
            $"{{\"categoryIds\":[\"{categoryId}\"]}}",
            Encoding.UTF8,
            "application/json");
        var response = await client.PutAsync($"/api/notes/{noteId}", body);
        response.EnsureSuccessStatusCode();

        var rows = await GetRevisionRowsAsync(noteId);
        rows.Should().HaveCount(1, "純分類變更不改內容，不該產生新版本");
    }

    /// <summary>
    /// 測試：PUT 帶「與現況完全相同」的標題與內容（有帶欄位、值相同）→ 不追加快照。
    /// 這與「不帶欄位」是兩條不同程式路徑（賦值有執行、EF 值比較偵測無變更）。
    /// </summary>
    [Fact]
    public async Task SameValueUpdate_DoesNotAddRevision()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"rev-same-{Guid.NewGuid():N}@test.local");
        using var client = _factory.CreateClientWithToken(token);
        var noteId = await CreateNoteViaApiAsync(client, "同值重送", "一樣的內容");

        var response = await client.PutAsJsonAsync(
            $"/api/notes/{noteId}",
            new { title = "同值重送", contentRaw = "一樣的內容" });
        response.EnsureSuccessStatusCode();

        var rows = await GetRevisionRowsAsync(noteId);
        rows.Should().HaveCount(1, "同值重送沒有實質內容變更，不該產生新版本");
    }

    // ==================== 刪除／還原路徑 ====================

    /// <summary>
    /// 測試：DELETE（軟刪除）→ 追加 delete 快照，內容＝刪除當下全文（誤刪救援的關鍵快照）；
    /// 之後還原（trash restore）→ 不追加快照（內容未變）。
    /// </summary>
    [Fact]
    public async Task SoftDeleteThenRestore_AppendsOnlyDeleteRevision()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"rev-del-{Guid.NewGuid():N}@test.local");
        using var client = _factory.CreateClientWithToken(token);
        var noteId = await CreateNoteViaApiAsync(client, "刪除測試", "重要內容勿失");

        var deleteResponse = await client.DeleteAsync($"/api/notes/{noteId}");
        deleteResponse.EnsureSuccessStatusCode();

        var afterDelete = await GetRevisionRowsAsync(noteId);
        afterDelete.Should().HaveCount(2);
        afterDelete[1].RevisionNo.Should().Be(2);
        afterDelete[1].ChangeKind.Should().Be("delete");
        afterDelete[1].ContentRaw.Should().Be("重要內容勿失");
        AssertAuditStamped(afterDelete[1], userId);

        var restoreResponse = await client.PostAsync($"/api/trash/Note/{noteId}/restore", null);
        restoreResponse.EnsureSuccessStatusCode();

        var afterRestore = await GetRevisionRowsAsync(noteId);
        afterRestore.Should().HaveCount(2, "還原不改內容，不該產生新版本");
    }

    // ==================== 版本序號與並發 ====================

    /// <summary>
    /// 測試：版本列被軟刪除（進垃圾桶）後，新版本序號必須「跳過」被軟刪的序號——
    /// (NoteId, RevisionNo) 唯一索引不分 ValidFlag，若取號只看有效列會撞索引、整批存檔 500。
    /// </summary>
    [Fact]
    public async Task SoftDeletedRevisionRow_DoesNotBreakNumbering()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"rev-numbering-{Guid.NewGuid():N}@test.local");
        using var client = _factory.CreateClientWithToken(token);
        var noteId = await CreateNoteViaApiAsync(client, "序號測試", "v1");

        var update = await client.PutAsJsonAsync($"/api/notes/{noteId}", new { contentRaw = "v2" });
        update.EnsureSuccessStatusCode();

        // 直接把最新一版（RevisionNo=2）軟刪掉，模擬「版本被使用者丟進垃圾桶」。
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            var latest = await db.NoteRevision
                .IgnoreQueryFilters()
                .Where(r => r.NoteId == noteId)
                .OrderByDescending(r => r.RevisionNo)
                .FirstAsync();
            latest.ValidFlag = false;
            latest.DeletedDateTime = DateTime.UtcNow;
            await db.SaveChangesAsync();
        }

        var afterSoftDelete = await client.PutAsJsonAsync($"/api/notes/{noteId}", new { contentRaw = "v3" });
        afterSoftDelete.StatusCode.Should().Be(HttpStatusCode.OK, "取號必須無視 ValidFlag 看全部列，否則撞唯一索引");

        var rows = await GetRevisionRowsAsync(noteId);
        rows.Should().HaveCount(3);
        rows[2].RevisionNo.Should().Be(3, "序號必須接在被軟刪的 2 之後，不可重用 2");
        rows[2].ContentRaw.Should().Be("v3");
    }

    /// <summary>
    /// 測試：兩個帶「同一個 baseVersion」的 PUT 真併發打同一篇筆記 → 恰一方成功、
    /// 另一方 409；版本列恰好 2 筆（create + 成功那方的 update），失敗方不留孤兒列；
    /// 之後再成功更新一次，序號正確銜接為 3（無斷號、無撞索引）。
    /// </summary>
    [Fact]
    public async Task ConcurrentPuts_SameBaseVersion_ExactlyOneRevisionNoOrphans()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"rev-conc-{Guid.NewGuid():N}@test.local");
        using var client = _factory.CreateClientWithToken(token);
        var noteId = await CreateNoteViaApiAsync(client, "併發測試", "base");

        // 取目前版本（xmin）當兩個請求共同的 baseVersion。
        var baseVersion = await GetNoteVersionAsync(noteId);

        var putA = client.PutAsJsonAsync(
            $"/api/notes/{noteId}", new { contentRaw = "來自A", baseVersion });
        var putB = client.PutAsJsonAsync(
            $"/api/notes/{noteId}", new { contentRaw = "來自B", baseVersion });
        var responses = await Task.WhenAll(putA, putB);

        var statuses = responses.Select(r => r.StatusCode).OrderBy(s => s).ToList();
        statuses.Should().BeEquivalentTo(
            new[] { HttpStatusCode.OK, HttpStatusCode.Conflict },
            "同一 baseVersion 的兩個併發更新恰好一勝一敗");

        var rows = await GetRevisionRowsAsync(noteId);
        rows.Should().HaveCount(2, "409 那方的交易整體 rollback，不得留下孤兒版本列");
        rows[1].RevisionNo.Should().Be(2);

        // 失敗方重新取版本再更新 → 距勝方 update 僅數秒、同 actor、窗內
        // → 依「時間窗合併」語意併入最新版（就地覆寫），不新增列。
        var retryVersion = await GetNoteVersionAsync(noteId);
        var retry = await client.PutAsJsonAsync(
            $"/api/notes/{noteId}", new { contentRaw = "重試成功", baseVersion = retryVersion });
        retry.EnsureSuccessStatusCode();

        var finalRows = await GetRevisionRowsAsync(noteId);
        finalRows.Should().HaveCount(2, "重試發生在合併窗內，應併入最新 update 版而非新增列");
        finalRows[1].RevisionNo.Should().Be(2);
        finalRows[1].ContentRaw.Should().Be("重試成功");
    }

    /// <summary>
    /// 測試：兩個 DELETE 真併發打同一篇筆記 → 恰一方 200，另一方 409（併發競賽）或
    /// 404（先後抵達、後到者已看不到筆記）——絕不可外洩裸 500；且 delete 快照恰好一筆。
    /// （對抗復審發現：DeleteNoteHandler 原本沒接 DbUpdateConcurrencyException，
    /// 敗方會 500，「統一 409」對刪除端點不成立——此測試鎖住修正。）
    /// </summary>
    [Fact]
    public async Task ConcurrentDeletes_NoBareServerError_ExactlyOneDeleteRevision()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"rev-cdel-{Guid.NewGuid():N}@test.local");
        using var client = _factory.CreateClientWithToken(token);
        var noteId = await CreateNoteViaApiAsync(client, "併發刪除測試", "內容");

        var deleteA = client.DeleteAsync($"/api/notes/{noteId}");
        var deleteB = client.DeleteAsync($"/api/notes/{noteId}");
        var responses = await Task.WhenAll(deleteA, deleteB);

        var statuses = responses.Select(r => r.StatusCode).OrderBy(s => s).ToList();
        statuses.Should().Contain(HttpStatusCode.OK, "至少一方刪除成功");
        statuses.Should().NotContain(HttpStatusCode.InternalServerError, "併發競賽不得外洩裸 500");
        statuses.Where(s => s != HttpStatusCode.OK).Should().OnlyContain(
            s => s == HttpStatusCode.Conflict || s == HttpStatusCode.NotFound,
            "敗方只能是 409（併發競賽）或 404（後到、筆記已刪）");

        var rows = await GetRevisionRowsAsync(noteId);
        rows.Should().HaveCount(2, "create + 恰好一筆 delete，敗方不得留孤兒快照");
        rows[1].ChangeKind.Should().Be("delete");
    }

    // ==================== 時間窗合併（coalescing，2026-08-13） ====================
    // 規則：本次為 update、且「現存最新一版」同時滿足
    //   (a) ChangeKind=update (b) ValidFlag=true (c) UpdatedUser=本次 actor
    //   (d) now − 最新版 CreatedDateTime < 10 分鐘（錨定 Created＝鏈最長 10 分鐘必斷）
    //   (e) 本次有 HTTP 脈絡（CurrentUserId 非空；背景服務寫入永不合併）
    // → 就地覆寫最新版（Title/ContentRaw/UpdatedDateTime/UpdatedUser），不新增列。
    // create / delete 永不合併、也永不被 update 併入（首版與刪除快照是誤刪救援的底）。

    /// <summary>
    /// 測試：同一使用者窗內連續兩次 PUT 內容 → 併成一筆 update（內容=最後一次、
    /// RevisionNo 不變、UpdatedDateTime 前進、CreatedDateTime 維持鏈首時間）。
    /// </summary>
    [Fact]
    public async Task QuickSuccessiveUpdates_CoalesceIntoLatestUpdateRevision()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"rev-coal-{Guid.NewGuid():N}@test.local");
        using var client = _factory.CreateClientWithToken(token);
        var noteId = await CreateNoteViaApiAsync(client, "合併測試", "v1");

        (await client.PutAsJsonAsync($"/api/notes/{noteId}", new { contentRaw = "v2" }))
            .EnsureSuccessStatusCode();
        (await client.PutAsJsonAsync($"/api/notes/{noteId}", new { contentRaw = "v3" }))
            .EnsureSuccessStatusCode();

        var rows = await GetRevisionRowsAsync(noteId);
        rows.Should().HaveCount(2, "窗內第二次 update 應併入第一次，不新增列");
        rows[1].RevisionNo.Should().Be(2);
        rows[1].ChangeKind.Should().Be("update");
        rows[1].ContentRaw.Should().Be("v3", "合併後內容＝鏈上最後一次的內容");
        rows[1].UpdatedDateTime.Should().BeOnOrAfter(rows[1].CreatedDateTime,
            "合併只前進 UpdatedDateTime，CreatedDateTime 維持鏈首時間");
    }

    /// <summary>
    /// 測試：最新版 CreatedDateTime 被回溯到窗外（11 分鐘前）→ 不合併、新增列且序號銜接。
    /// 回溯必須用 raw SQL：稽核攔截器會把 EF 路徑的 Modified 蓋回 now（復審 C1）。
    /// </summary>
    [Fact]
    public async Task UpdateOutsideCoalesceWindow_AppendsNewRevision()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"rev-coalwin-{Guid.NewGuid():N}@test.local");
        using var client = _factory.CreateClientWithToken(token);
        var noteId = await CreateNoteViaApiAsync(client, "窗外測試", "v1");

        (await client.PutAsJsonAsync($"/api/notes/{noteId}", new { contentRaw = "v2" }))
            .EnsureSuccessStatusCode();
        await BackdateRevisionAsync(noteId, revisionNo: 2, age: TimeSpan.FromMinutes(11));

        (await client.PutAsJsonAsync($"/api/notes/{noteId}", new { contentRaw = "v3" }))
            .EnsureSuccessStatusCode();

        var rows = await GetRevisionRowsAsync(noteId);
        rows.Should().HaveCount(3, "窗（錨定最新版 CreatedDateTime）已過期，必須留新列");
        rows[1].ContentRaw.Should().Be("v2", "窗外合併不可回頭覆寫舊列");
        rows[2].RevisionNo.Should().Be(3);
        rows[2].ContentRaw.Should().Be("v3");
    }

    /// <summary>
    /// 測試：窗內連續兩次「只改標題」→ 同樣併成一筆（標題=最後一次）。
    /// </summary>
    [Fact]
    public async Task TitleOnlyQuickUpdates_CoalesceIntoLatestUpdateRevision()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"rev-coaltitle-{Guid.NewGuid():N}@test.local");
        using var client = _factory.CreateClientWithToken(token);
        var noteId = await CreateNoteViaApiAsync(client, "標題A", "內容");

        (await client.PutAsJsonAsync($"/api/notes/{noteId}", new { title = "標題B" }))
            .EnsureSuccessStatusCode();
        (await client.PutAsJsonAsync($"/api/notes/{noteId}", new { title = "標題C" }))
            .EnsureSuccessStatusCode();

        var rows = await GetRevisionRowsAsync(noteId);
        rows.Should().HaveCount(2);
        rows[1].Title.Should().Be("標題C");
        rows[1].ContentRaw.Should().Be("內容");
    }

    /// <summary>
    /// 測試：軟刪除→還原→窗內 PUT → 不併入 delete 快照（最新版是 delete，不滿足條件 (a)），
    /// 新增獨立 update 列。刪除快照是誤刪救援的關鍵，永不被覆寫。
    /// </summary>
    [Fact]
    public async Task RestoreThenUpdate_NotMergedIntoDeleteRevision()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"rev-coaldel-{Guid.NewGuid():N}@test.local");
        using var client = _factory.CreateClientWithToken(token);
        var noteId = await CreateNoteViaApiAsync(client, "刪後更新", "原文");

        (await client.DeleteAsync($"/api/notes/{noteId}")).EnsureSuccessStatusCode();
        (await client.PostAsync($"/api/trash/Note/{noteId}/restore", null)).EnsureSuccessStatusCode();
        (await client.PutAsJsonAsync($"/api/notes/{noteId}", new { contentRaw = "還原後改" }))
            .EnsureSuccessStatusCode();

        var rows = await GetRevisionRowsAsync(noteId);
        rows.Should().HaveCount(3, "create + delete + 還原後的獨立 update");
        rows[1].ChangeKind.Should().Be("delete");
        rows[1].ContentRaw.Should().Be("原文", "delete 快照不可被後續 update 覆寫");
        rows[2].ChangeKind.Should().Be("update");
        rows[2].ContentRaw.Should().Be("還原後改");
    }

    /// <summary>
    /// 測試：背景服務寫入（無 HTTP 脈絡、CurrentUserId 為空——AI 精煉/框選提問同款路徑）
    /// 接在手動 update 的窗內 → 不合併（條件 (e)）。
    /// 否則 AI 覆寫會吃掉使用者手動版本的救援點（復審 C2——版本系統存在的理由）。
    /// </summary>
    [Fact]
    public async Task BackgroundWriteWithinWindow_DoesNotCoalesce()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"rev-coalbg-{Guid.NewGuid():N}@test.local");
        using var client = _factory.CreateClientWithToken(token);
        var noteId = await CreateNoteViaApiAsync(client, "背景不合併", "v1");

        (await client.PutAsJsonAsync($"/api/notes/{noteId}", new { contentRaw = "手動v2" }))
            .EnsureSuccessStatusCode();

        // 背景寫入：DI 解析的 DbContext（完整攔截器鏈）、無 HTTP 脈絡。
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            var note = await db.Note.IgnoreQueryFilters().FirstAsync(n => n.Id == noteId);
            note.ContentRaw = "背景覆寫v3";
            await db.SaveChangesAsync();
        }

        var rows = await GetRevisionRowsAsync(noteId);
        rows.Should().HaveCount(3, "背景寫入永不合併——手動 v2 的救援點必須保留");
        rows[1].ContentRaw.Should().Be("手動v2");
        rows[2].ContentRaw.Should().Be("背景覆寫v3");
    }

    /// <summary>
    /// 測試：背景流程照「真實慣例」冒用使用者（SetCurrentUserId——所有背景 AI 流程
    /// 動筆記前都會呼叫，否則過不了隔離過濾）再於窗內覆寫內容 → 仍不合併。
    /// 二輪對抗復審 HIGH：CurrentUserId 非空判不出背景冒用，必須另以覆寫旗標排除；
    /// 上一個測試的「裸 DbContext」情境現實中不存在，本測試才是真實背景路徑的守門。
    /// </summary>
    [Fact]
    public async Task BackgroundWriteWithImpersonation_DoesNotCoalesce()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"rev-coalimp-{Guid.NewGuid():N}@test.local");
        using var client = _factory.CreateClientWithToken(token);
        var noteId = await CreateNoteViaApiAsync(client, "冒用不合併", "v1");

        (await client.PutAsJsonAsync($"/api/notes/{noteId}", new { contentRaw = "手動v2" }))
            .EnsureSuccessStatusCode();

        // 背景寫入：DI 解析 DbContext ＋ SetCurrentUserId 冒用（RefineService/AskQueueService 同款慣例）。
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            db.SetCurrentUserId(userId);
            var note = await db.Note.FirstAsync(n => n.Id == noteId);
            note.ContentRaw = "背景冒用覆寫v3";
            await db.SaveChangesAsync();
        }

        var rows = await GetRevisionRowsAsync(noteId);
        rows.Should().HaveCount(3, "背景冒用（SetCurrentUserId）仍屬背景脈絡，不得併掉手動版本");
        rows[1].ContentRaw.Should().Be("手動v2", "手動 v2 的救援點必須完整保留");
        rows[2].ContentRaw.Should().Be("背景冒用覆寫v3");
    }

    /// <summary>
    /// 測試：同一使用者用「另一把 PAT」窗內接續 PUT → 仍合併。
    /// actor＝使用者 GUID（與 token 無關），此測試鎖住該語意，防止未來誤以 token 區分。
    /// </summary>
    [Fact]
    public async Task SameUserDifferentPat_StillCoalesces()
    {
        var (userId, token1) = await _factory.SeedUserWithTokenAsync($"rev-coalpat-{Guid.NewGuid():N}@test.local");
        using var client1 = _factory.CreateClientWithToken(token1);
        var noteId = await CreateNoteViaApiAsync(client1, "雙PAT", "v1");
        (await client1.PutAsJsonAsync($"/api/notes/{noteId}", new { contentRaw = "v2" }))
            .EnsureSuccessStatusCode();

        var token2 = await SeedSecondTokenAsync(userId);
        using var client2 = _factory.CreateClientWithToken(token2);
        (await client2.PutAsJsonAsync($"/api/notes/{noteId}", new { contentRaw = "v3" }))
            .EnsureSuccessStatusCode();

        var rows = await GetRevisionRowsAsync(noteId);
        rows.Should().HaveCount(2, "同一使用者不同 PAT 仍是同一 actor，窗內合併");
        rows[1].ContentRaw.Should().Be("v3");
    }

    // ==================== 查詢端點回歸 ====================

    /// <summary>
    /// 測試：GET /api/notes/{id}/revisions 回傳遞增排序、欄位齊全（回歸保護——
    /// 改為攔截器寫入後，讀取端點的行為不得改變）。
    /// </summary>
    [Fact]
    public async Task RevisionsEndpoint_ReturnsAscendingWithExpectedFields()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"rev-endpoint-{Guid.NewGuid():N}@test.local");
        using var client = _factory.CreateClientWithToken(token);
        var noteId = await CreateNoteViaApiAsync(client, "端點回歸", "第一版");
        (await client.PutAsJsonAsync($"/api/notes/{noteId}", new { contentRaw = "第二版" }))
            .EnsureSuccessStatusCode();

        var response = await client.GetAsync($"/api/notes/{noteId}/revisions");
        response.EnsureSuccessStatusCode();
        var json = await response.ReadJsonAsync();

        var data = json["data"]!.AsArray();
        data.Should().HaveCount(2);
        data[0]!["revisionNo"]!.GetValue<int>().Should().Be(1);
        data[0]!["changeKind"]!.GetValue<string>().Should().Be("create");
        data[1]!["revisionNo"]!.GetValue<int>().Should().Be(2);
        data[1]!["changeKind"]!.GetValue<string>().Should().Be("update");
        data[1]!["contentRaw"]!.GetValue<string>().Should().Be("第二版");
        data[1]!["createdDateTime"].Should().NotBeNull();
        // 合併上線後（2026-08-13）：前端時間軸的排序/分組鍵改用 updatedDateTime
        //（合併會讓 createdDateTime 停在鏈首、內容卻是鏈尾——復審 H4），DTO 必須帶出此欄。
        data[1]!["updatedDateTime"].Should().NotBeNull();
    }

    // ==================== 共用輔助 ====================

    /// <summary>
    /// 以 API 建立筆記並回傳其 Id。
    /// </summary>
    /// <param name="client">已帶權杖的用戶端。</param>
    /// <param name="title">筆記標題。</param>
    /// <param name="contentRaw">筆記內容（Markdown）。</param>
    /// <returns>新筆記 Id。</returns>
    private static async Task<Guid> CreateNoteViaApiAsync(HttpClient client, string title, string contentRaw)
    {
        var response = await client.PostAsJsonAsync("/api/notes", new { title, contentRaw });
        response.EnsureSuccessStatusCode();
        var json = await response.ReadJsonAsync();
        return Guid.Parse(json["data"]!["id"]!.GetValue<string>());
    }

    /// <summary>
    /// 取得筆記目前的併發版本（xmin 影子屬性）——直接從資料庫讀取，供 PUT 的 baseVersion 使用。
    /// </summary>
    /// <param name="noteId">筆記 Id。</param>
    /// <returns>目前版本值。</returns>
    private async Task<long> GetNoteVersionAsync(Guid noteId)
    {
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            var xmin = await db.Note
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(n => n.Id == noteId)
                .Select(n => EF.Property<uint>(n, "xmin"))
                .FirstAsync();
            return xmin;
        }
    }

    /// <summary>
    /// 直接從資料庫讀取某筆記的全部版本列（無視查詢過濾器、依序號排序）。
    /// </summary>
    /// <param name="noteId">筆記 Id。</param>
    /// <returns>版本列清單。</returns>
    private async Task<List<NoteRevision>> GetRevisionRowsAsync(Guid noteId)
    {
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            return await db.NoteRevision
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(r => r.NoteId == noteId)
                .OrderBy(r => r.RevisionNo)
                .ToListAsync();
        }
    }

    /// <summary>
    /// 用 raw SQL 把某版本列的 Created/UpdatedDateTime 回溯到 <paramref name="age"/> 之前。
    /// 必須繞過 SaveChanges：稽核攔截器會把 EF 路徑的 Modified 蓋回 now、且強制
    /// CreatedDateTime IsModified=false（復審 C1）。僅為測試的時間操縱，不動 Title/ContentRaw。
    /// </summary>
    /// <param name="noteId">筆記 Id。</param>
    /// <param name="revisionNo">目標版本序號。</param>
    /// <param name="age">要回溯的時距。</param>
    private async Task BackdateRevisionAsync(Guid noteId, int revisionNo, TimeSpan age)
    {
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            var t = DateTime.UtcNow - age;
            await db.Database.ExecuteSqlInterpolatedAsync(
                $"""
                UPDATE "NoteRevision"
                SET "NoteRevision_CreatedDateTime" = {t}, "NoteRevision_UpdatedDateTime" = {t}
                WHERE "NoteRevision_NoteId" = {noteId} AND "NoteRevision_RevisionNo" = {revisionNo}
                """);
        }
    }

    /// <summary>
    /// 為既有使用者再種一把 PAT（供「同使用者不同 token」的合併語意測試）。
    /// </summary>
    /// <param name="userId">既有使用者 Id。</param>
    /// <returns>新權杖的明碼字串。</returns>
    private async Task<string> SeedSecondTokenAsync(Guid userId)
    {
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            var now = DateTime.UtcNow;
            var (token, hash, prefix) = ZonWiki.Infrastructure.Auth.ApiTokenGenerator.Generate();
            db.ApiToken.Add(new ApiToken
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                Name = "integration-test-token-2",
                TokenHash = hash,
                TokenPrefix = prefix,
                CreatedDateTime = now,
                UpdatedDateTime = now,
                CreatedUser = "test",
                UpdatedUser = "test",
                ValidFlag = true,
            });
            await db.SaveChangesAsync();
            return token;
        }
    }

    /// <summary>
    /// 直接在資料庫種一個分類（回傳 Id），供「純分類變更」測試使用。
    /// </summary>
    /// <param name="userId">擁有者。</param>
    /// <param name="name">分類名稱。</param>
    /// <returns>分類 Id。</returns>
    private async Task<Guid> CreateCategoryAsync(Guid userId, string name)
    {
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            var now = DateTime.UtcNow;
            var category = new Category
            {
                UserId = userId,
                Name = name,
                FolderPath = string.Empty,
                CreatedDateTime = now,
                UpdatedDateTime = now,
                CreatedUser = userId.ToString(),
                UpdatedUser = userId.ToString(),
            };
            db.Category.Add(category);
            await db.SaveChangesAsync();
            return category.Id;
        }
    }

    /// <summary>
    /// 驗證快照列的稽核欄位確實被攔截器蓋章：
    /// 稽核攔截器先於本攔截器執行、不會回頭補章，時間欄位若是 0001-01-01 即為漏蓋。
    /// </summary>
    /// <param name="revision">要驗證的版本列。</param>
    /// <param name="expectedUserId">預期歸屬的使用者。</param>
    private static void AssertAuditStamped(NoteRevision revision, Guid expectedUserId)
    {
        revision.UserId.Should().Be(expectedUserId);
        revision.ValidFlag.Should().BeTrue();
        revision.Id.Should().NotBe(Guid.Empty);
        revision.CreatedDateTime.Should().BeAfter(DateTime.UtcNow.AddMinutes(-10),
            "攔截器必須自行蓋時間章（稽核攔截器先跑、不會回頭補章）");
        revision.UpdatedDateTime.Should().BeAfter(DateTime.UtcNow.AddMinutes(-10));
        revision.CreatedUser.Should().NotBeNullOrEmpty();
    }
}
