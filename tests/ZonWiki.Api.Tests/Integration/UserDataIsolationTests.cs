using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Testcontainers.PostgreSql;
using Xunit;
using ZonWiki.Api.Services;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Tests.Integration;

/// <summary>
/// 使用者資料隔離整合測試。
/// 驗證不同使用者無法透過 EF Core 全域查詢過濾看到彼此的資料。
/// 使用 Testcontainers 跑真實 PostgreSQL（非 InMemory），確保 migration 與關聯型設定皆正常。
/// </summary>
public sealed class UserDataIsolationTests : IAsyncLifetime
{
    private PostgreSqlContainer? _container;
    private DbContextOptions<ZonWikiDbContext>? _dbOptions;
    private string? _connectionString;

    private readonly Guid _userAId = Guid.NewGuid();
    private readonly Guid _userBId = Guid.NewGuid();

    /// <summary>
    /// 初始化容器、建立資料庫、套用 migrations。
    /// </summary>
    public async Task InitializeAsync()
    {
        _container = new PostgreSqlBuilder()
            .WithImage("postgres:16-alpine")
            .Build();

        await _container.StartAsync();

        _connectionString = _container.GetConnectionString();

        _dbOptions = new DbContextOptionsBuilder<ZonWikiDbContext>()
            .UseNpgsql(_connectionString)
            // 與正式環境（DependencyInjection.AddZonWikiInfrastructure）一致：
            // 使用者隔離過濾會把 UserId 以常數烤進模型，故模型快取必須「依使用者」區分。
            // 若不註冊此工廠，預設快取只以 Context 型別為鍵 → 同一行程內「先建立的（無過濾）模型」
            // 會被後續不同使用者的 DbContext 重用，使隔離測試互相污染、得到假陰性
            // （正式環境有註冊此工廠、隔離正常；測試漏掉才會誤判）。
            .ReplaceService<Microsoft.EntityFrameworkCore.Infrastructure.IModelCacheKeyFactory,
                ZonWiki.Infrastructure.Persistence.UserModelCacheKeyFactory>()
            // 同正式環境：掛上「使用者隔離最終防線」攔截器，讓測試也驗證 fail-closed 行為。
            .AddInterceptors(new ZonWiki.Infrastructure.Persistence.UserIsolationMaterializationInterceptor())
            .Options;

        // 建立資料庫結構（apply migrations）
        using (var context = new ZonWikiDbContext(_dbOptions, null))
        {
            await context.Database.MigrateAsync();
        }
    }

    /// <summary>
    /// 清理容器。
    /// </summary>
    public async Task DisposeAsync()
    {
        if (_container != null)
        {
            await _container.StopAsync();
            await _container.DisposeAsync();
        }
    }

    // ==================== 筆記隔離測試 ====================

    /// <summary>
    /// 測試：使用者 A 看不到使用者 B 的筆記。
    /// </summary>
    [Fact]
    public async Task Note_UserACannotSeeUserBNotes_WhenQueryFiltersApplied()
    {
        // Arrange：以使用者 A 的身分建立兩個使用者和各自的筆記
        using (var db = new ZonWikiDbContext(_dbOptions!, null))
        {
            var now = DateTime.UtcNow;

            // 建立兩個使用者
            var userA = new User
            {
                Id = _userAId,
                Email = "usera@example.com",
                DisplayName = "User A",
                GoogleSub = "sub-a",
                CreatedDateTime = now,
                UpdatedDateTime = now
            };
            var userB = new User
            {
                Id = _userBId,
                Email = "userb@example.com",
                DisplayName = "User B",
                GoogleSub = "sub-b",
                CreatedDateTime = now,
                UpdatedDateTime = now
            };

            db.User.Add(userA);
            db.User.Add(userB);
            await db.SaveChangesAsync();

            // 使用者 A 的筆記
            var noteA = new Note
            {
                Id = Guid.NewGuid(),
                Title = "User A's Note",
                Slug = "user-a-note",
                ContentRaw = "Content A",
                ContentHtml = "<p>Content A</p>",
                ContentHash = "hash-a",
                UserId = _userAId,
                IsDraft = false,
                Kind = "note",
                CreatedDateTime = now,
                UpdatedDateTime = now,
                CreatedUser = "system",
                UpdatedUser = "system",
                ValidFlag = true
            };

            // 使用者 B 的筆記
            var noteB = new Note
            {
                Id = Guid.NewGuid(),
                Title = "User B's Note",
                Slug = "user-b-note",
                ContentRaw = "Content B",
                ContentHtml = "<p>Content B</p>",
                ContentHash = "hash-b",
                UserId = _userBId,
                IsDraft = false,
                Kind = "note",
                CreatedDateTime = now,
                UpdatedDateTime = now,
                CreatedUser = "system",
                UpdatedUser = "system",
                ValidFlag = true
            };

            db.Note.Add(noteA);
            db.Note.Add(noteB);
            await db.SaveChangesAsync();
        }

        // Act：以使用者 A 的身分查詢筆記
        var currentUserA = new FakeCurrentUser(_userAId, "usera@example.com");
        using (var db = new ZonWikiDbContext(_dbOptions!, currentUserA))
        {
            var notes = await db.Note.ToListAsync();

            // Assert：使用者 A 應該只看到自己的筆記
            notes.Should().HaveCount(1);
            notes.First().Title.Should().Be("User A's Note");
            notes.First().UserId.Should().Be(_userAId);
        }

        // Act：以使用者 B 的身分查詢筆記
        var currentUserB = new FakeCurrentUser(_userBId, "userb@example.com");
        using (var db = new ZonWikiDbContext(_dbOptions!, currentUserB))
        {
            var notes = await db.Note.ToListAsync();

            // Assert：使用者 B 應該只看到自己的筆記
            notes.Should().HaveCount(1);
            notes.First().Title.Should().Be("User B's Note");
            notes.First().UserId.Should().Be(_userBId);
        }
    }

    // ==================== 任務隔離測試 ====================

    /// <summary>
    /// 測試：使用者 A 看不到使用者 B 的任務卡片。
    /// </summary>
    [Fact]
    public async Task TaskCard_UserACannotSeeUserBTaskCards_WhenQueryFiltersApplied()
    {
        // Arrange：建立兩個使用者及各自的任務
        using (var db = new ZonWikiDbContext(_dbOptions!, null))
        {
            var now = DateTime.UtcNow;

            var userA = new User
            {
                Id = _userAId,
                Email = "usera@example.com",
                DisplayName = "User A",
                GoogleSub = "sub-a",
                CreatedDateTime = now,
                UpdatedDateTime = now
            };
            var userB = new User
            {
                Id = _userBId,
                Email = "userb@example.com",
                DisplayName = "User B",
                GoogleSub = "sub-b",
                CreatedDateTime = now,
                UpdatedDateTime = now
            };

            db.User.Add(userA);
            db.User.Add(userB);
            await db.SaveChangesAsync();

            // 使用者 A 的任務
            var taskA = new TaskCard
            {
                Id = Guid.NewGuid(),
                Title = "User A's Task",
                UserId = _userAId,
                Status = "todo",
                Priority = 1,
                SortOrder = 0,
                CreatedDateTime = now,
                UpdatedDateTime = now,
                CreatedUser = "system",
                UpdatedUser = "system",
                ValidFlag = true
            };

            // 使用者 B 的任務
            var taskB = new TaskCard
            {
                Id = Guid.NewGuid(),
                Title = "User B's Task",
                UserId = _userBId,
                Status = "todo",
                Priority = 1,
                SortOrder = 0,
                CreatedDateTime = now,
                UpdatedDateTime = now,
                CreatedUser = "system",
                UpdatedUser = "system",
                ValidFlag = true
            };

            db.TaskCard.Add(taskA);
            db.TaskCard.Add(taskB);
            await db.SaveChangesAsync();
        }

        // Act：以使用者 A 的身分查詢任務
        var currentUserA = new FakeCurrentUser(_userAId, "usera@example.com");
        using (var db = new ZonWikiDbContext(_dbOptions!, currentUserA))
        {
            var tasks = await db.TaskCard.ToListAsync();

            // Assert：使用者 A 應該只看到自己的任務
            tasks.Should().HaveCount(1);
            tasks.First().Title.Should().Be("User A's Task");
            tasks.First().UserId.Should().Be(_userAId);
        }

        // Act：以使用者 B 的身分查詢任務
        var currentUserB = new FakeCurrentUser(_userBId, "userb@example.com");
        using (var db = new ZonWikiDbContext(_dbOptions!, currentUserB))
        {
            var tasks = await db.TaskCard.ToListAsync();

            // Assert：使用者 B 應該只看到自己的任務
            tasks.Should().HaveCount(1);
            tasks.First().Title.Should().Be("User B's Task");
            tasks.First().UserId.Should().Be(_userBId);
        }
    }

    // ==================== 分類隔離測試 ====================

    /// <summary>
    /// 測試：使用者 A 看不到使用者 B 的筆記分類。
    /// </summary>
    [Fact]
    public async Task Category_UserACannotSeeUserBCategories_WhenQueryFiltersApplied()
    {
        // Arrange：建立兩個使用者及各自的分類
        using (var db = new ZonWikiDbContext(_dbOptions!, null))
        {
            var now = DateTime.UtcNow;

            var userA = new User
            {
                Id = _userAId,
                Email = "usera@example.com",
                DisplayName = "User A",
                GoogleSub = "sub-a",
                CreatedDateTime = now,
                UpdatedDateTime = now
            };
            var userB = new User
            {
                Id = _userBId,
                Email = "userb@example.com",
                DisplayName = "User B",
                GoogleSub = "sub-b",
                CreatedDateTime = now,
                UpdatedDateTime = now
            };

            db.User.Add(userA);
            db.User.Add(userB);
            await db.SaveChangesAsync();

            // 使用者 A 的分類
            var categoryA = new Category
            {
                Id = Guid.NewGuid(),
                Name = "Category A",
                UserId = _userAId,
                CreatedDateTime = now,
                UpdatedDateTime = now,
                CreatedUser = "system",
                UpdatedUser = "system",
                ValidFlag = true
            };

            // 使用者 B 的分類
            var categoryB = new Category
            {
                Id = Guid.NewGuid(),
                Name = "Category B",
                UserId = _userBId,
                CreatedDateTime = now,
                UpdatedDateTime = now,
                CreatedUser = "system",
                UpdatedUser = "system",
                ValidFlag = true
            };

            db.Category.Add(categoryA);
            db.Category.Add(categoryB);
            await db.SaveChangesAsync();
        }

        // Act：以使用者 A 的身分查詢分類
        var currentUserA = new FakeCurrentUser(_userAId, "usera@example.com");
        using (var db = new ZonWikiDbContext(_dbOptions!, currentUserA))
        {
            var categories = await db.Category.ToListAsync();

            // Assert：使用者 A 應該只看到自己的分類
            categories.Should().HaveCount(1);
            categories.First().Name.Should().Be("Category A");
            categories.First().UserId.Should().Be(_userAId);
        }

        // Act：以使用者 B 的身分查詢分類
        var currentUserB = new FakeCurrentUser(_userBId, "userb@example.com");
        using (var db = new ZonWikiDbContext(_dbOptions!, currentUserB))
        {
            var categories = await db.Category.ToListAsync();

            // Assert：使用者 B 應該只看到自己的分類
            categories.Should().HaveCount(1);
            categories.First().Name.Should().Be("Category B");
            categories.First().UserId.Should().Be(_userBId);
        }
    }

    // ==================== 快速連結隔離測試 ====================

    /// <summary>
    /// 測試：使用者 A 看不到使用者 B 的快速連結。
    /// </summary>
    [Fact]
    public async Task QuickLink_UserACannotSeeUserBQuickLinks_WhenQueryFiltersApplied()
    {
        // Arrange：建立兩個使用者及各自的快速連結
        using (var db = new ZonWikiDbContext(_dbOptions!, null))
        {
            var now = DateTime.UtcNow;

            var userA = new User
            {
                Id = _userAId,
                Email = "usera@example.com",
                DisplayName = "User A",
                GoogleSub = "sub-a",
                CreatedDateTime = now,
                UpdatedDateTime = now
            };
            var userB = new User
            {
                Id = _userBId,
                Email = "userb@example.com",
                DisplayName = "User B",
                GoogleSub = "sub-b",
                CreatedDateTime = now,
                UpdatedDateTime = now
            };

            db.User.Add(userA);
            db.User.Add(userB);
            await db.SaveChangesAsync();

            // 使用者 A 的快速連結
            var quickLinkA = new QuickLink
            {
                Id = Guid.NewGuid(),
                Title = "Quick Link A",
                Url = "https://example.com/a",
                UserId = _userAId,
                SortOrder = 0,
                CreatedDateTime = now,
                UpdatedDateTime = now,
                CreatedUser = "system",
                UpdatedUser = "system",
                ValidFlag = true
            };

            // 使用者 B 的快速連結
            var quickLinkB = new QuickLink
            {
                Id = Guid.NewGuid(),
                Title = "Quick Link B",
                Url = "https://example.com/b",
                UserId = _userBId,
                SortOrder = 0,
                CreatedDateTime = now,
                UpdatedDateTime = now,
                CreatedUser = "system",
                UpdatedUser = "system",
                ValidFlag = true
            };

            db.QuickLink.Add(quickLinkA);
            db.QuickLink.Add(quickLinkB);
            await db.SaveChangesAsync();
        }

        // Act：以使用者 A 的身分查詢快速連結
        var currentUserA = new FakeCurrentUser(_userAId, "usera@example.com");
        using (var db = new ZonWikiDbContext(_dbOptions!, currentUserA))
        {
            var quickLinks = await db.QuickLink.ToListAsync();

            // Assert：使用者 A 應該只看到自己的快速連結
            quickLinks.Should().HaveCount(1);
            quickLinks.First().Title.Should().Be("Quick Link A");
            quickLinks.First().UserId.Should().Be(_userAId);
        }

        // Act：以使用者 B 的身分查詢快速連結
        var currentUserB = new FakeCurrentUser(_userBId, "userb@example.com");
        using (var db = new ZonWikiDbContext(_dbOptions!, currentUserB))
        {
            var quickLinks = await db.QuickLink.ToListAsync();

            // Assert：使用者 B 應該只看到自己的快速連結
            quickLinks.Should().HaveCount(1);
            quickLinks.First().Title.Should().Be("Quick Link B");
            quickLinks.First().UserId.Should().Be(_userBId);
        }
    }

    // ==================== 開問啦節點（Node）跨帳號隔離測試 ====================
    //
    // 背景：Node（開問啦節點）**不是** IUserOwned，沒有任何 EF 全域查詢過濾；它的擁有權來自所屬 Canvas。
    // 任何直接查詢 db.Node 而未以 Canvas.UserId 過濾的程式碼，都會把所有使用者的節點撈出來（跨帳號外洩）。
    // 曾實際發生：以 "." 進行全站搜尋時，A 帳號看得到 B 帳號的節點內容。以下測試鎖死此不變式。

    /// <summary>
    /// 測試（節點已納入無腦隔離）：Node 現為 IUserOwned，**直接** db.Node 查詢即自動以 UserId 過濾——
    /// 即使某查詢忘了 Join Canvas，也只會看到自己的節點。這把「子實體無全域過濾」的整類破口從源頭消除。
    /// </summary>
    [Fact]
    public async Task Node_DbSetQuery_NowAutoFilteredByUser_ReturnsOnlyOwnNodes()
    {
        // Arrange：A、B 各自一張畫布、各自一個節點
        await SeedTwoUsersWithCanvasNodeAsync("A's secret node", "B's secret node");

        // Act：以使用者 A 身分，直接查 db.Node（沒有任何手動過濾）
        var currentUserA = new FakeCurrentUser(_userAId, "usera@example.com");
        using (var db = new ZonWikiDbContext(_dbOptions!, currentUserA))
        {
            var nodes = await db.Node.AsNoTracking().ToListAsync();

            // Assert：只看到自己的節點（全域過濾自動生效）
            nodes.Should().ContainSingle();
            nodes.Single().Content.Should().Be("A's secret node");
            nodes.Single().UserId.Should().Be(_userAId);
        }

        // Act：以 B 身分同樣只看到 B 的節點
        var currentUserB = new FakeCurrentUser(_userBId, "userb@example.com");
        using (var db = new ZonWikiDbContext(_dbOptions!, currentUserB))
        {
            var nodes = await db.Node.AsNoTracking().ToListAsync();
            nodes.Should().ContainSingle();
            nodes.Single().Content.Should().Be("B's secret node");
        }
    }

    /// <summary>
    /// 測試（子實體也進最終防線）：以 A 身分、用 IgnoreQueryFilters 故意撈 B 的「節點」（子實體），
    /// 最終防線攔截器應在具現化 B 的節點時 fail-closed 拋例外——證明 throw 式最終防線已涵蓋子實體。
    /// </summary>
    [Fact]
    public async Task IsolationGuard_ThrowsWhenForeignChildEntity_NodeIsMaterialized()
    {
        // Arrange：A、B 各自一張畫布、各自一個節點
        await SeedTwoUsersWithCanvasNodeAsync("A node", "B private node");

        // Act：以 A 身分用 IgnoreQueryFilters 撈 B 的節點（模擬忘了過濾的子實體查詢）
        var currentUserA = new FakeCurrentUser(_userAId, "usera@example.com");
        using (var db = new ZonWikiDbContext(_dbOptions!, currentUserA))
        {
            var act = async () => await db.Node
                .IgnoreQueryFilters()
                .Where(n => n.UserId == _userBId)
                .ToListAsync();

            await act.Should().ThrowAsync<UnauthorizedAccessException>();
        }
    }

    /// <summary>
    /// 測試（搜尋修補回歸）：以「Canvas.UserId == 目前使用者」過濾的節點搜尋，只回傳本人節點。
    /// 這正是 SearchEndpoints 修補後對 db.Node 採用的查詢；確保 A 搜尋不到 B 的節點內容。
    /// </summary>
    [Fact]
    public async Task Node_SearchQueryFilteredByCanvasOwner_IsolatesByUser()
    {
        // Arrange：A、B 各自一個含關鍵字的節點
        await SeedTwoUsersWithCanvasNodeAsync("alpha secret from A", "alpha secret from B");
        const string queryLower = "alpha"; // 兩者皆含此關鍵字

        // Act：以 A 身分，跑「修補後」的節點搜尋查詢（明確以 Canvas.UserId 過濾）
        var currentUserA = new FakeCurrentUser(_userAId, "usera@example.com");
        using (var db = new ZonWikiDbContext(_dbOptions!, currentUserA))
        {
            var nodeResults = await db.Node
                .Where(n => n.ValidFlag &&
                    n.Canvas != null &&
                    n.Canvas.UserId == currentUserA.UserId &&
                    n.Canvas.ValidFlag &&
                    (n.Title.ToLower().Contains(queryLower) || n.Content.ToLower().Contains(queryLower)))
                .AsNoTracking()
                .ToListAsync();

            // Assert：只看到自己的節點
            nodeResults.Should().HaveCount(1);
            nodeResults.Single().Content.Should().Be("alpha secret from A");
        }

        // Act：以 B 身分，同樣的查詢只回傳 B 自己的節點
        var currentUserB = new FakeCurrentUser(_userBId, "userb@example.com");
        using (var db = new ZonWikiDbContext(_dbOptions!, currentUserB))
        {
            var nodeResults = await db.Node
                .Where(n => n.ValidFlag &&
                    n.Canvas != null &&
                    n.Canvas.UserId == currentUserB.UserId &&
                    n.Canvas.ValidFlag &&
                    (n.Title.ToLower().Contains(queryLower) || n.Content.ToLower().Contains(queryLower)))
                .AsNoTracking()
                .ToListAsync();

            nodeResults.Should().HaveCount(1);
            nodeResults.Single().Content.Should().Be("alpha secret from B");
        }
    }

    /// <summary>
    /// 測試（祖先脈絡修補回歸）：AncestryService 限定在「同一張畫布」內追溯，
    /// 不會因 ParentId 越界而把他人畫布的節點帶進祖先鏈（避免間接把他人內容塞進 AI 提問脈絡）。
    /// </summary>
    [Fact]
    public async Task Ancestry_StaysWithinCanvas_DoesNotCrossIntoAnotherUsersNode()
    {
        // Arrange：B 的畫布有一個節點 victimNode；A 的畫布有一個 attackerNode，
        // 其 ParentId「越界」指向 B 的 victimNode（模擬惡意/錯誤的跨畫布父子關係）。
        Guid canvasAId, attackerNodeId, victimNodeId;
        using (var db = new ZonWikiDbContext(_dbOptions!, null))
        {
            var now = DateTime.UtcNow;
            db.User.Add(MakeUser(_userAId, "usera@example.com", "sub-a"));
            db.User.Add(MakeUser(_userBId, "userb@example.com", "sub-b"));
            await db.SaveChangesAsync();

            var canvasB = MakeCanvas(_userBId, "B's canvas");
            var victimNode = MakeNode(canvasB.Id, _userBId, "B's private ancestor content", parentId: null);
            canvasAId = Guid.NewGuid();
            var canvasA = MakeCanvas(_userAId, "A's canvas", canvasAId);
            // attackerNode 的 ParentId 越界指向 B 的 victimNode
            var attackerNode = MakeNode(canvasA.Id, _userAId, "A's node", parentId: victimNode.Id);

            db.Canvas.AddRange(canvasB, canvasA);
            db.Node.AddRange(victimNode, attackerNode);
            await db.SaveChangesAsync();

            attackerNodeId = attackerNode.Id;
            victimNodeId = victimNode.Id;
        }

        // Act：以 A 身分，限定在 A 的畫布內追溯 attackerNode 的祖先鏈
        var currentUserA = new FakeCurrentUser(_userAId, "usera@example.com");
        using (var db = new ZonWikiDbContext(_dbOptions!, currentUserA))
        {
            var ancestry = new AncestryService(db);
            var chain = await ancestry.GetAncestryAsync(attackerNodeId, canvasAId);

            // Assert：祖先鏈只含 attackerNode 自己，不會跨進 B 的 victimNode。
            chain.Should().ContainSingle();
            chain.Single().Id.Should().Be(attackerNodeId);
            chain.Should().NotContain(n => n.Id == victimNodeId);
            chain.Should().NotContain(n => n.Content == "B's private ancestor content");
        }
    }

    // ==================== 使用者隔離「最終防線」攔截器測試 ====================
    //
    // UserIsolationMaterializationInterceptor 是縱深防禦：即使某查詢忘了過濾、或誤用 IgnoreQueryFilters，
    // 只要具現化出「非目前使用者」的 IUserOwned 實體，就 fail-closed 中止請求，絕不讓他人資料進入回應。

    /// <summary>
    /// 測試（fail-closed）：以使用者 A 的身分，刻意繞過全域過濾去撈 B 的筆記，
    /// 最終防線攔截器應在具現化 B 的筆記時拋 <see cref="UnauthorizedAccessException"/>、中止請求。
    /// 這模擬「某個端點查詢忘了過濾」時，系統仍不會把他人資料吐出去。
    /// </summary>
    [Fact]
    public async Task IsolationGuard_ThrowsWhenForeignUserOwnedEntityIsMaterialized()
    {
        // Arrange：A、B 各一筆筆記
        using (var db = new ZonWikiDbContext(_dbOptions!, null))
        {
            var now = DateTime.UtcNow;
            db.User.Add(MakeUser(_userAId, "usera@example.com", "sub-a"));
            db.User.Add(MakeUser(_userBId, "userb@example.com", "sub-b"));
            await db.SaveChangesAsync();

            db.Note.Add(MakeNote(_userAId, "A note", "a-note"));
            db.Note.Add(MakeNote(_userBId, "B private note", "b-note"));
            await db.SaveChangesAsync();
        }

        // Act：以 A 身分、用 IgnoreQueryFilters 故意去撈 B 的筆記（模擬忘了過濾的查詢）
        var currentUserA = new FakeCurrentUser(_userAId, "usera@example.com");
        using (var db = new ZonWikiDbContext(_dbOptions!, currentUserA))
        {
            var act = async () => await db.Note
                .IgnoreQueryFilters()
                .Where(n => n.UserId == _userBId)
                .ToListAsync();

            // Assert：最終防線在具現化 B 的筆記時 fail-closed，B 的資料絕不會被回傳
            await act.Should().ThrowAsync<UnauthorizedAccessException>();
        }
    }

    /// <summary>
    /// 測試（不誤殺）：最終防線放行「全站共用 AI 模型」（系統擁有、刻意跨使用者共用）。
    /// 以使用者 A 身分讀取共用模型不應拋例外——否則所有人的模型下拉與 AI 提問都會壞掉。
    /// </summary>
    [Fact]
    public async Task IsolationGuard_AllowsSharedAiModel_ForAnyUser()
    {
        var sharedUserId = ZonWiki.Infrastructure.Ai.AiProviderFactory.SharedModelUserId;

        // Arrange：建立 A、B 及一筆「系統共用」AI 模型
        using (var db = new ZonWikiDbContext(_dbOptions!, null))
        {
            var now = DateTime.UtcNow;
            db.User.Add(MakeUser(_userAId, "usera@example.com", "sub-a"));
            db.User.Add(MakeUser(_userBId, "userb@example.com", "sub-b"));
            await db.SaveChangesAsync();

            db.AiModel.Add(new AiModel
            {
                Id = Guid.NewGuid(),
                UserId = sharedUserId, // 系統共用：刻意非任一使用者所有
                Key = "banana-gemini-lite",
                Label = "Shared Default",
                Provider = "OpenAiCompatible",
                Kind = "chat",
                Enabled = true,
                ModelId = "gemini-flash-lite",
                CreatedDateTime = now,
                UpdatedDateTime = now,
                CreatedUser = "system",
                UpdatedUser = "system",
                ValidFlag = true,
            });
            await db.SaveChangesAsync();
        }

        // Act + Assert：以 A 身分讀共用模型（模擬 ListModels）不應被攔截
        var currentUserA = new FakeCurrentUser(_userAId, "usera@example.com");
        using (var db = new ZonWikiDbContext(_dbOptions!, currentUserA))
        {
            var act = async () => await db.AiModel
                .IgnoreQueryFilters()
                .Where(m => m.UserId == sharedUserId && m.Enabled)
                .ToListAsync();

            await act.Should().NotThrowAsync();
            var shared = await db.AiModel.IgnoreQueryFilters()
                .Where(m => m.UserId == sharedUserId)
                .ToListAsync();
            shared.Should().ContainSingle().Which.Key.Should().Be("banana-gemini-lite");
        }
    }

    // ==================== 測試資料建構小工具 ====================

    /// <summary>建立 Note 實體（測試用）。</summary>
    private static Note MakeNote(Guid userId, string title, string slug)
    {
        var now = DateTime.UtcNow;
        return new Note
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Title = title,
            Slug = slug,
            ContentRaw = title,
            ContentHtml = $"<p>{title}</p>",
            ContentHash = slug,
            Kind = "note",
            IsDraft = false,
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true,
        };
    }

    /// <summary>建立 User 實體（測試用）。</summary>
    private static User MakeUser(Guid id, string email, string googleSub)
    {
        var now = DateTime.UtcNow;
        return new User
        {
            Id = id,
            Email = email,
            DisplayName = email,
            GoogleSub = googleSub,
            CreatedDateTime = now,
            UpdatedDateTime = now,
        };
    }

    /// <summary>建立 Canvas 實體（測試用）。</summary>
    private static Canvas MakeCanvas(Guid userId, string title, Guid? id = null)
    {
        var now = DateTime.UtcNow;
        return new Canvas
        {
            Id = id ?? Guid.NewGuid(),
            UserId = userId,
            Title = title,
            Description = string.Empty,
            StateJson = "{}",
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true,
        };
    }

    /// <summary>建立 Node 實體（測試用）。Node 現為 IUserOwned，需明確指定 UserId（種子用 null 情境不會自動帶入）。</summary>
    private static Node MakeNode(Guid canvasId, Guid userId, string content, Guid? parentId)
    {
        var now = DateTime.UtcNow;
        return new Node
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            CanvasId = canvasId,
            Title = string.Empty,
            Content = content,
            ParentId = parentId,
            X = 0,
            Y = 0,
            ZIndex = 0,
            Origin = "user",
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true,
        };
    }

    /// <summary>
    /// 種子：建立使用者 A、B，各自一張畫布、各自一個節點（內容由參數指定）。
    /// </summary>
    private async Task SeedTwoUsersWithCanvasNodeAsync(string contentA, string contentB)
    {
        using var db = new ZonWikiDbContext(_dbOptions!, null);
        db.User.Add(MakeUser(_userAId, "usera@example.com", "sub-a"));
        db.User.Add(MakeUser(_userBId, "userb@example.com", "sub-b"));
        await db.SaveChangesAsync();

        var canvasA = MakeCanvas(_userAId, "A's canvas");
        var canvasB = MakeCanvas(_userBId, "B's canvas");
        db.Canvas.AddRange(canvasA, canvasB);
        db.Node.Add(MakeNode(canvasA.Id, _userAId, contentA, parentId: null));
        db.Node.Add(MakeNode(canvasB.Id, _userBId, contentB, parentId: null));
        await db.SaveChangesAsync();
    }

    // ==================== 虛擬 ICurrentUser 實作 ====================

    /// <summary>
    /// 測試用虛擬實作，代表登入的使用者身分。
    /// </summary>
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
    }
}
