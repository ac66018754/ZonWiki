using System.Reflection;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Testcontainers.PostgreSql;
using Xunit;
using ZonWiki.Api.Common;
using ZonWiki.Api.Endpoints;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Tests.Integration;

/// <summary>
/// 樂觀鎖（PostgreSQL xmin 併發權杖，#4/#34）整合測試。
///
/// xmin 是 PostgreSQL 特有的系統欄，InMemory 提供者無法模擬其「更新即改變、可比對」的語意，
/// 因此本測試以 Testcontainers 跑真實 PostgreSQL，實證：
/// <list type="number">
///   <item>建立／更新後回傳的 <c>Version</c> 為非 0，且等於資料庫實際 xmin。</item>
///   <item>SetNodeModel 也會回傳正確版本（守住「版本永遠為 0」這類回歸）。</item>
///   <item>帶「過期 baseVersion」更新 → SaveChanges 丟 DbUpdateConcurrencyException → 端點回 409。</item>
///   <item>帶「相符 baseVersion」更新 → 成功，並回傳更新後的新版本。</item>
///   <item>Note／TaskCard 實體層的 xmin 併發權杖確實生效（端點 409 所依賴的底層機制）。</item>
/// </list>
/// </summary>
public sealed class OptimisticConcurrencyTests : IAsyncLifetime
{
    private PostgreSqlContainer? _container;
    private DbContextOptions<ZonWikiDbContext>? _dbOptions;

    private readonly Guid _userId = Guid.NewGuid();
    private readonly FakeCurrentUser _currentUser;
    private Guid _canvasId;

    /// <summary>建構測試：預先備妥目前使用者身分。</summary>
    public OptimisticConcurrencyTests()
    {
        _currentUser = new FakeCurrentUser(_userId, "concurrency@example.com");
    }

    // ==================== 反射取得 KaiWen 私有處理函式 ====================

    /// <summary>以名稱反射取得 <see cref="KaiWenCanvasEndpoints"/> 的私有靜態處理函式。</summary>
    /// <param name="name">處理函式名稱。</param>
    /// <returns>方法資訊。</returns>
    private static MethodInfo GetHandler(string name) =>
        typeof(KaiWenCanvasEndpoints).GetMethod(name, BindingFlags.NonPublic | BindingFlags.Static)
        ?? throw new InvalidOperationException($"找不到 KaiWenCanvasEndpoints.{name} 私有方法。");

    private static readonly MethodInfo CreateNodeMethod = GetHandler("CreateNode");
    private static readonly MethodInfo UpdateNodeContentMethod = GetHandler("UpdateNodeContent");
    private static readonly MethodInfo SetNodeModelMethod = GetHandler("SetNodeModel");
    private static readonly MethodInfo UpdateNodeLayoutMethod = GetHandler("UpdateNodeLayout");

    // ==================== 容器與結構初始化 ====================

    /// <summary>啟動 PostgreSQL 容器、套用 migrations、建立本使用者與一張畫布。</summary>
    public async Task InitializeAsync()
    {
        _container = new PostgreSqlBuilder()
            .WithImage("postgres:16-alpine")
            .Build();

        await _container.StartAsync();

        _dbOptions = new DbContextOptionsBuilder<ZonWikiDbContext>()
            .UseNpgsql(_container.GetConnectionString())
            // 與正式環境一致：使用者隔離會把 UserId 烤進模型，模型快取需依使用者區分，
            // 否則「migrate 時建立的無過濾模型」會被後續使用者 context 重用，導致查詢查無資料（假 404）。
            .ReplaceService<IModelCacheKeyFactory, UserModelCacheKeyFactory>()
            // 與正式環境一致：稽核攔截器負責在建立 IUserOwned 實體（如 Node）時自動帶入
            // 目前使用者的 UserId，否則節點的 UserId 會是 Guid.Empty，被使用者隔離全域過濾濾掉。
            .AddInterceptors(
                new AuditingSaveChangesInterceptor(),
                new UserIsolationMaterializationInterceptor())
            .Options;

        // migrate 使用無使用者 context（匯入/遷移情境）。
        await using (var context = new ZonWikiDbContext(_dbOptions, null))
        {
            await context.Database.MigrateAsync();
        }

        // 建立本使用者與一張畫布（後續節點都掛在其下）。
        await using (var db = NewDb())
        {
            db.User.Add(new User
            {
                Id = _userId,
                Email = "concurrency@example.com",
                DisplayName = "Concurrency Tester",
                GoogleSub = "sub-concurrency",
                CreatedDateTime = DateTime.UtcNow,
                UpdatedDateTime = DateTime.UtcNow,
            });

            var canvas = new Canvas
            {
                Id = Guid.NewGuid(),
                UserId = _userId,
                Title = "併發測試畫布",
                Description = string.Empty,
                StateJson = "{}",
                CreatedDateTime = DateTime.UtcNow,
                UpdatedDateTime = DateTime.UtcNow,
                CreatedUser = _userId.ToString(),
                UpdatedUser = _userId.ToString(),
                ValidFlag = true,
            };
            _canvasId = canvas.Id;
            db.Canvas.Add(canvas);
            await db.SaveChangesAsync();
        }
    }

    /// <summary>停止並釋放容器。</summary>
    public async Task DisposeAsync()
    {
        if (_container != null)
        {
            await _container.StopAsync();
            await _container.DisposeAsync();
        }
    }

    // ==================== 節點端點：版本回傳 ====================

    /// <summary>
    /// 測試：CreateNode 建立後回傳非 0 版本，且等於資料庫的實際 xmin。
    /// </summary>
    [Fact]
    public async Task CreateNode_ReturnsNonZeroVersion_MatchingDbXmin()
    {
        var (nodeId, version) = await CreateNodeAsync("初始內容");

        version.Should().BeGreaterThan(0L, "建立後應回傳資料庫產生的 xmin 版本");
        version.Should().Be(await ReadDbXminAsync(nodeId));
    }

    /// <summary>
    /// 測試（守住「SetNodeModel 版本永遠為 0」回歸）：設定節點模型後，
    /// 回傳的 Version 必須為非 0，且等於資料庫的實際 xmin。
    /// </summary>
    [Fact]
    public async Task SetNodeModel_ReturnsNonZeroVersion_MatchingDbXmin()
    {
        var (nodeId, _) = await CreateNodeAsync("內容");

        NodeDto dto;
        await using (var db = NewDb())
        {
            var result = await InvokeAsync(
                SetNodeModelMethod,
                new object?[] { nodeId.ToString(), _currentUser, db, new SetNodeModelRequest("opus"), CancellationToken.None });

            StatusOf(result).Should().Be(StatusCodes.Status200OK);
            dto = NodeOf(result);
        }

        dto.Node_Version.Should().BeGreaterThan(0L, "設定模型後應回傳更新後的 xmin，而非 0");
        dto.Node_Version.Should().Be(await ReadDbXminAsync(nodeId));
    }

    /// <summary>
    /// 測試：更新節點內容後，回傳的版本改變（xmin 隨每次更新遞增），且等於資料庫實際 xmin。
    /// </summary>
    [Fact]
    public async Task UpdateNodeContent_ReturnsRefreshedVersion_AfterUpdate()
    {
        var (nodeId, versionBefore) = await CreateNodeAsync("原始內容");

        NodeDto dto;
        await using (var db = NewDb())
        {
            var result = await InvokeAsync(
                UpdateNodeContentMethod,
                new object?[] { nodeId.ToString(), _currentUser, db, new UpdateNodeContentRequest("更新後內容"), CancellationToken.None });

            StatusOf(result).Should().Be(StatusCodes.Status200OK);
            dto = NodeOf(result);
        }

        dto.Node_Version.Should().BeGreaterThan(0L);
        dto.Node_Version.Should().NotBe(versionBefore, "更新後 xmin 應改變");
        dto.Node_Version.Should().Be(await ReadDbXminAsync(nodeId));
    }

    // ==================== 節點端點：併發衝突 ====================

    /// <summary>
    /// 測試（核心）：帶「過期 baseVersion」更新節點內容 → 端點回 409。
    /// 模擬：載入時記下版本 V → 期間被其他來源改過（xmin 變成 V'）→ 以 V 保存 → 衝突。
    /// </summary>
    [Fact]
    public async Task UpdateNodeContent_WithStaleBaseVersion_Returns409()
    {
        var (nodeId, staleVersion) = await CreateNodeAsync("原始內容");

        // 其他來源先改一次（xmin 遞進，staleVersion 因此過期）。
        await CompetingContentUpdateAsync(nodeId, "被別人改過的內容");

        await using var db = NewDb();
        var result = await InvokeAsync(
            UpdateNodeContentMethod,
            new object?[] { nodeId.ToString(), _currentUser, db, new UpdateNodeContentRequest("我的內容", staleVersion), CancellationToken.None });

        StatusOf(result).Should().Be(StatusCodes.Status409Conflict);
    }

    /// <summary>
    /// 測試：帶「相符 baseVersion」更新節點內容 → 成功（200），並回傳更新後的新版本。
    /// </summary>
    [Fact]
    public async Task UpdateNodeContent_WithMatchingBaseVersion_Succeeds()
    {
        var (nodeId, currentVersion) = await CreateNodeAsync("原始內容");

        NodeDto dto;
        await using (var db = NewDb())
        {
            var result = await InvokeAsync(
                UpdateNodeContentMethod,
                new object?[] { nodeId.ToString(), _currentUser, db, new UpdateNodeContentRequest("正確版本的更新", currentVersion), CancellationToken.None });

            StatusOf(result).Should().Be(StatusCodes.Status200OK);
            dto = NodeOf(result);
        }

        dto.Node_Version.Should().NotBe(currentVersion, "成功更新後版本應前進");
        dto.Node_Version.Should().Be(await ReadDbXminAsync(nodeId));
    }

    /// <summary>
    /// 測試（拖曳佈局維持 last-write-wins）：UpdateNodeLayout 不帶 baseVersion 時，
    /// 即使期間被其他來源改過也不回 409，而是照常更新（高頻拖曳不做併發檢查）。
    /// </summary>
    [Fact]
    public async Task UpdateNodeLayout_WithoutBaseVersion_DoesNotConflict()
    {
        var (nodeId, _) = await CreateNodeAsync("內容");

        // 其他來源先改一次。
        await CompetingContentUpdateAsync(nodeId, "他人改動");

        await using var db = NewDb();
        var result = await InvokeAsync(
            UpdateNodeLayoutMethod,
            new object?[] { nodeId.ToString(), new UpdateNodeLayoutRequest(X: 123), _currentUser, db, CancellationToken.None });

        // 不帶 baseVersion → 不做併發檢查 → 200（last-write-wins）。
        StatusOf(result).Should().Be(StatusCodes.Status200OK);
    }

    // ==================== Note／TaskCard 實體層 xmin 機制 ====================

    /// <summary>
    /// 測試：Note 的 xmin 併發權杖生效——以過期的 OriginalValue 保存會丟 DbUpdateConcurrencyException。
    /// 這正是 NoteWriteEndpoints 更新端點回 409 所依賴的底層機制。
    /// </summary>
    [Fact]
    public async Task Note_StaleXminOriginalValue_ThrowsDbUpdateConcurrencyException()
    {
        var noteId = Guid.NewGuid();
        await using (var db = NewDb())
        {
            db.Note.Add(new Note
            {
                Id = noteId,
                UserId = _userId,
                Title = "併發筆記",
                Slug = $"concurrency-note-{noteId:N}",
                ContentRaw = "v1",
                ContentHtml = "<p>v1</p>",
                ContentHash = "hash-v1",
                Kind = "note",
                IsDraft = false,
                CreatedDateTime = DateTime.UtcNow,
                UpdatedDateTime = DateTime.UtcNow,
                CreatedUser = "system",
                UpdatedUser = "system",
                ValidFlag = true,
            });
            await db.SaveChangesAsync();
        }

        // 記下當下版本，然後由其他來源改一次（版本過期）。
        long staleVersion;
        await using (var db = NewDb())
        {
            var note = await db.Note.FirstAsync(n => n.Id == noteId);
            staleVersion = db.Entry(note).GetConcurrencyVersion();
        }

        await using (var db = NewDb())
        {
            var note = await db.Note.FirstAsync(n => n.Id == noteId);
            note.ContentRaw = "v2-by-other";
            await db.SaveChangesAsync();
        }

        // 以過期版本嘗試保存 → 應丟併發例外。
        await using (var db = NewDb())
        {
            var note = await db.Note.FirstAsync(n => n.Id == noteId);
            note.ContentRaw = "v2-by-me";
            db.Entry(note).ApplyBaseVersion(staleVersion);

            var act = async () => await db.SaveChangesAsync();
            await act.Should().ThrowAsync<DbUpdateConcurrencyException>();
        }
    }

    /// <summary>
    /// 測試：TaskCard 的 xmin 併發權杖生效——以過期的 OriginalValue 保存會丟 DbUpdateConcurrencyException。
    /// 這正是 TaskEndpoints 更新端點回 409 所依賴的底層機制。
    /// </summary>
    [Fact]
    public async Task TaskCard_StaleXminOriginalValue_ThrowsDbUpdateConcurrencyException()
    {
        var cardId = Guid.NewGuid();
        await using (var db = NewDb())
        {
            db.TaskCard.Add(new TaskCard
            {
                Id = cardId,
                UserId = _userId,
                Title = "併發任務",
                Status = "todo",
                Priority = 1,
                SortOrder = 0,
                CreatedDateTime = DateTime.UtcNow,
                UpdatedDateTime = DateTime.UtcNow,
                CreatedUser = "system",
                UpdatedUser = "system",
                ValidFlag = true,
            });
            await db.SaveChangesAsync();
        }

        long staleVersion;
        await using (var db = NewDb())
        {
            var card = await db.TaskCard.FirstAsync(t => t.Id == cardId);
            staleVersion = db.Entry(card).GetConcurrencyVersion();
        }

        await using (var db = NewDb())
        {
            var card = await db.TaskCard.FirstAsync(t => t.Id == cardId);
            card.Title = "他人改過的標題";
            await db.SaveChangesAsync();
        }

        await using (var db = NewDb())
        {
            var card = await db.TaskCard.FirstAsync(t => t.Id == cardId);
            card.Title = "我的標題";
            db.Entry(card).ApplyBaseVersion(staleVersion);

            var act = async () => await db.SaveChangesAsync();
            await act.Should().ThrowAsync<DbUpdateConcurrencyException>();
        }
    }

    // ==================== 列表／載入投影：xmin 不可下推 SQL CAST ====================

    /// <summary>
    /// 測試（回歸守衛）：GetCanvasGraph 是畫布載入主端點，其節點投影把 xmin 併入 NodeDto。
    /// 必須能在真實 PostgreSQL 翻譯執行，且每個節點回傳的版本等於資料庫實際 xmin——
    /// 守住曾造成「整張畫布載入 500（42846: cannot cast type xid to bigint）」的缺陷。
    /// </summary>
    [Fact]
    public async Task GetCanvasGraph_TranslatesNodeProjection_AndReturnsDbXmin()
    {
        var (nodeId, _) = await CreateNodeAsync("畫布載入投影測試");

        NodeDto nodeDto;
        await using (var db = NewDb())
        {
            var result = await InvokeAsync(
                GetHandler("GetCanvasGraph"),
                new object?[] { _canvasId.ToString(), _currentUser, db, CancellationToken.None });

            StatusOf(result).Should().Be(StatusCodes.Status200OK);
            var graph = (ApiResponse<CanvasGraphDto>)((IValueHttpResult)result).Value!;
            graph.Data.Should().NotBeNull();
            nodeDto = graph.Data!.Nodes.Should().ContainSingle(n => n.Node_Id == nodeId.ToString()).Subject;
        }

        nodeDto.Node_Version.Should().BeGreaterThan(0L, "畫布投影應回傳非 0 的 xmin 版本");
        nodeDto.Node_Version.Should().Be(await ReadDbXminAsync(nodeId));
    }


    /// <summary>
    /// 測試（回歸守衛）：GetNoteBySlug 的投影形狀（把 xmin 併入 DTO）必須能在真實 PostgreSQL
    /// 翻譯與執行，且回傳的 Version 等於資料庫實際 xmin。
    ///
    /// 這鎖死曾造成筆記檢視 500 的「(long)EF.Property&lt;uint&gt;(n,\"xmin\") 被下推成
    /// CAST(xmin AS bigint) → 42846」缺陷。因該端點是行內 lambda（無法反射叫用），
    /// 這裡以「與正式端點相同的投影表達式」對真實資料庫執行，實證其可翻譯。
    /// </summary>
    [Fact]
    public async Task NoteBySlugProjectionShape_TranslatesOnPostgres_AndReturnsDbXmin()
    {
        var slug = $"projection-note-{Guid.NewGuid():N}";
        var noteId = Guid.NewGuid();
        await using (var db = NewDb())
        {
            db.Note.Add(new Note
            {
                Id = noteId,
                UserId = _userId,
                Title = "投影測試筆記",
                Slug = slug,
                ContentRaw = "raw",
                ContentHtml = "<p>raw</p>",
                ContentHash = "hash-projection",
                Kind = "note",
                IsDraft = false,
                CreatedDateTime = DateTime.UtcNow,
                UpdatedDateTime = DateTime.UtcNow,
                CreatedUser = "system",
                UpdatedUser = "system",
                ValidFlag = true,
            });
            await db.SaveChangesAsync();
        }

        await using (var db = NewDb())
        {
            // 與 NoteEndpoints.GetNoteBySlug 相同的投影形狀（含巢狀集合子查詢 + 原生 xmin uint 讀取）。
            var noteRow = await db.Note
                .Where(n => n.ValidFlag && n.Slug == slug)
                .Select(n => new
                {
                    Dto = new NoteDetailDto(
                        n.Id,
                        n.Title,
                        n.Slug,
                        n.ContentHtml,
                        n.ContentRaw,
                        n.Kind,
                        n.IsDraft,
                        n.CreatedDateTime,
                        n.UpdatedDateTime,
                        n.Comments.Count(c => c.ValidFlag),
                        n.NoteCategories
                            .Where(nc => nc.ValidFlag && nc.Category != null && nc.Category.ValidFlag)
                            .Select(nc => new TagRefDto(nc.Category!.Id, nc.Category.Name))
                            .ToList(),
                        n.NoteTags
                            .Where(nt => nt.ValidFlag && nt.Tag != null && nt.Tag.ValidFlag)
                            .Select(nt => new TagRefDto(nt.Tag!.Id, nt.Tag.Name))
                            .ToList(),
                        0L),
                    Version = EF.Property<uint>(n, "xmin"),
                })
                .FirstOrDefaultAsync();

            noteRow.Should().NotBeNull("投影必須能在 PostgreSQL 翻譯執行，而非丟 42846");
            var note = noteRow!.Dto with { Version = (long)noteRow.Version };
            note.Version.Should().BeGreaterThan(0L);
        }
    }

    // ==================== 小工具 ====================

    /// <summary>以本使用者身分建立一個新的 DbContext（每次呼叫獨立，模擬每請求一個 scope）。</summary>
    private ZonWikiDbContext NewDb() => new(_dbOptions!, _currentUser);

    /// <summary>透過 CreateNode 端點建立節點，回傳其 Id 與回傳版本。</summary>
    /// <param name="content">節點內容。</param>
    /// <returns>節點 Id 與建立後的版本。</returns>
    private async Task<(Guid NodeId, long Version)> CreateNodeAsync(string content)
    {
        await using var db = NewDb();
        var result = await InvokeAsync(
            CreateNodeMethod,
            new object?[] { _canvasId.ToString(), _currentUser, db, new CreateNodeRequest(Content: content), CancellationToken.None });

        StatusOf(result).Should().Be(StatusCodes.Status201Created);
        var dto = NodeOf(result);
        return (Guid.Parse(dto.Node_Id), dto.Node_Version);
    }

    /// <summary>模擬「其他來源」更新節點內容一次，使既有版本過期（xmin 遞進）。</summary>
    /// <param name="nodeId">節點 Id。</param>
    /// <param name="content">新內容。</param>
    private async Task CompetingContentUpdateAsync(Guid nodeId, string content)
    {
        await using var db = NewDb();
        var node = await db.Node.FirstAsync(n => n.Id == nodeId);
        node.Content = content;
        await db.SaveChangesAsync();
    }

    /// <summary>直接從資料庫讀取節點的實際 xmin（投影系統欄），供比對回傳版本是否一致。</summary>
    /// <param name="nodeId">節點 Id。</param>
    /// <returns>資料庫中的 xmin（以 long 表示）。</returns>
    private async Task<long> ReadDbXminAsync(Guid nodeId)
    {
        await using var db = NewDb();
        // 以原生 xid→uint 讀出（不下推 SQL CAST），再於記憶體放大為 long。
        var xmin = await db.Node
            .Where(n => n.Id == nodeId)
            .Select(n => EF.Property<uint>(n, "xmin"))
            .SingleAsync();
        return xmin;
    }

    /// <summary>以反射叫用私有處理函式並取得其 <see cref="IResult"/>。</summary>
    /// <param name="method">處理函式。</param>
    /// <param name="args">依序排列的參數。</param>
    /// <returns>處理函式回傳的結果。</returns>
    private static async Task<IResult> InvokeAsync(MethodInfo method, object?[] args)
    {
        var task = (Task<IResult>)method.Invoke(null, args)!;
        return await task;
    }

    /// <summary>從 <see cref="IResult"/> 取出 HTTP 狀態碼（找不到時視為 200）。</summary>
    /// <param name="result">處理函式回傳的結果。</param>
    /// <returns>狀態碼。</returns>
    private static int StatusOf(IResult result)
    {
        result.Should().BeAssignableTo<IStatusCodeHttpResult>();
        return ((IStatusCodeHttpResult)result).StatusCode ?? StatusCodes.Status200OK;
    }

    /// <summary>從成功的 <see cref="IResult"/> 取出 <see cref="NodeDto"/> 承載。</summary>
    /// <param name="result">處理函式回傳的結果。</param>
    /// <returns>節點 DTO。</returns>
    private static NodeDto NodeOf(IResult result)
    {
        result.Should().BeAssignableTo<IValueHttpResult>();
        var response = (ApiResponse<NodeDto>)((IValueHttpResult)result).Value!;
        response.Data.Should().NotBeNull();
        return response.Data!;
    }

    /// <summary>測試用虛擬目前使用者。</summary>
    private sealed class FakeCurrentUser : ICurrentUser
    {
        private readonly Guid _userId;
        private readonly string _email;

        public FakeCurrentUser(Guid userId, string email)
        {
            _userId = userId;
            _email = email;
        }

        public Guid UserId => _userId;
        public string? Email => _email;
        public bool IsAuthenticated => true;
        public string Source => "web";
    }
}
