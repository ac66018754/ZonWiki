using System.Reflection;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Xunit;
using ZonWiki.Api.Endpoints;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Tests.Endpoints;

/// <summary>
/// <see cref="KaiWenCanvasEndpoints"/> 的 UpdateNodeLayout 處理函式單元測試
/// （對應審查 finding #38：改用強型別 <see cref="UpdateNodeLayoutRequest"/> 綁定、部分更新語意）。
///
/// 直接以反射叫用私有靜態處理函式（未經 HTTP 管線），聚焦驗證處理邏輯：
/// 只更新有帶值（非 null）的欄位、空請求體不變更任何欄位、身分與節點歸屬檢查等。
/// JSON 反序列化 / 格式錯誤回 400 屬框架綁定層行為，不在本單元測試範圍。
/// </summary>
public sealed class UpdateNodeLayoutEndpointTests : IAsyncLifetime
{
    private readonly DbContextOptions<ZonWikiDbContext> _dbOptions;
    private ZonWikiDbContext _db = null!;
    private readonly Guid _userId = Guid.NewGuid();
    private readonly Guid _otherUserId = Guid.NewGuid();
    private Guid _canvasId;

    /// <summary>反射取得的私有處理函式；InitializeAsync 中解析。</summary>
    private static readonly MethodInfo UpdateNodeLayoutMethod =
        typeof(KaiWenCanvasEndpoints).GetMethod(
            "UpdateNodeLayout",
            BindingFlags.NonPublic | BindingFlags.Static)
        ?? throw new InvalidOperationException("找不到 KaiWenCanvasEndpoints.UpdateNodeLayout 私有方法。");

    /// <summary>建構測試：每個實例使用獨立 InMemory 資料庫。</summary>
    public UpdateNodeLayoutEndpointTests()
    {
        _dbOptions = new DbContextOptionsBuilder<ZonWikiDbContext>()
            .UseInMemoryDatabase($"nodelayout-test-{Guid.NewGuid()}")
            .Options;
    }

    /// <summary>初始化 DbContext 與一張本使用者的畫布。</summary>
    public async Task InitializeAsync()
    {
        // 單參數建構子 → 不套用全域使用者過濾，讓處理函式自身的歸屬過濾成為受測邏輯。
        _db = new ZonWikiDbContext(_dbOptions);
        await _db.Database.EnsureCreatedAsync();

        var canvas = MakeCanvas(_userId);
        _canvasId = canvas.Id;
        _db.Canvas.Add(canvas);
        await _db.SaveChangesAsync();
    }

    /// <summary>清理 DbContext。</summary>
    public async Task DisposeAsync()
    {
        await _db.Database.EnsureDeletedAsync();
        _db.Dispose();
    }

    /// <summary>
    /// 測試（部分更新核心語意）：只更新請求中「有帶值」的欄位，其餘欄位維持原值不動。
    /// </summary>
    [Fact]
    public async Task UpdateNodeLayout_AppliesOnlyProvidedFields_LeavesOthersUnchanged()
    {
        // Arrange：節點初始佈局。
        var nodeId = await SeedNodeAsync(
            x: 1,
            y: 2,
            width: 100,
            height: 200,
            zIndex: 0,
            color: "#ffffff",
            title: "原始標題");

        // 只帶 X 與 Title；其餘欄位為 null（= 不更新）。
        var request = new UpdateNodeLayoutRequest(X: 42, Title: "新標題");

        // Act
        var result = await InvokeAsync(nodeId.ToString(), request, MakeUser(_userId));

        // Assert：回應 200，且只有 X 與 Title 被更新。
        StatusCodeOf(result).Should().Be(StatusCodes.Status200OK);

        var node = await _db.Node.AsNoTracking().FirstAsync(n => n.Id == nodeId);
        node.X.Should().Be(42);          // 已更新
        node.Title.Should().Be("新標題"); // 已更新
        node.Y.Should().Be(2);           // 未帶值 → 不變
        node.Width.Should().Be(100);     // 未帶值 → 不變
        node.Height.Should().Be(200);    // 未帶值 → 不變
        node.ZIndex.Should().Be(0);      // 未帶值 → 不變
        node.Color.Should().Be("#ffffff"); // 未帶值 → 不變
    }

    /// <summary>
    /// 測試（空請求體語意）：請求體為 null 時不變更任何欄位，仍回 200。
    /// </summary>
    [Fact]
    public async Task UpdateNodeLayout_NullRequest_LeavesNodeUnchanged()
    {
        // Arrange
        var nodeId = await SeedNodeAsync(
            x: 5,
            y: 6,
            width: 50,
            height: 60,
            zIndex: 3,
            color: "#000000",
            title: "不變");

        // Act：request = null（模擬空請求體）。
        var result = await InvokeAsync(nodeId.ToString(), request: null, MakeUser(_userId));

        // Assert
        StatusCodeOf(result).Should().Be(StatusCodes.Status200OK);

        var node = await _db.Node.AsNoTracking().FirstAsync(n => n.Id == nodeId);
        node.X.Should().Be(5);
        node.Y.Should().Be(6);
        node.Width.Should().Be(50);
        node.Height.Should().Be(60);
        node.ZIndex.Should().Be(3);
        node.Color.Should().Be("#000000");
        node.Title.Should().Be("不變");
    }

    /// <summary>
    /// 測試：未登入（UserId 為 Guid.Empty）時回 401。
    /// </summary>
    [Fact]
    public async Task UpdateNodeLayout_ReturnsUnauthorized_WhenNotAuthenticated()
    {
        // Arrange
        var nodeId = await SeedNodeAsync();

        // Act：以「未登入」使用者叫用。
        var result = await InvokeAsync(
            nodeId.ToString(),
            new UpdateNodeLayoutRequest(X: 1),
            MakeUser(Guid.Empty, isAuthenticated: false));

        // Assert
        StatusCodeOf(result).Should().Be(StatusCodes.Status401Unauthorized);
    }

    /// <summary>
    /// 測試：節點 Id 非合法 GUID 時回 400。
    /// </summary>
    [Fact]
    public async Task UpdateNodeLayout_ReturnsBadRequest_ForInvalidNodeId()
    {
        // Act
        var result = await InvokeAsync(
            "not-a-valid-guid",
            new UpdateNodeLayoutRequest(X: 1),
            MakeUser(_userId));

        // Assert
        StatusCodeOf(result).Should().Be(StatusCodes.Status400BadRequest);
    }

    /// <summary>
    /// 測試：查無此節點時回 404。
    /// </summary>
    [Fact]
    public async Task UpdateNodeLayout_ReturnsNotFound_ForUnknownNode()
    {
        // Act：一個不存在於資料庫的合法 GUID。
        var result = await InvokeAsync(
            Guid.NewGuid().ToString(),
            new UpdateNodeLayoutRequest(X: 1),
            MakeUser(_userId));

        // Assert
        StatusCodeOf(result).Should().Be(StatusCodes.Status404NotFound);
    }

    /// <summary>
    /// 測試（歸屬隔離）：節點屬於他人畫布時，本使用者更新應回 404（過濾後查無），且原節點不被異動。
    /// </summary>
    [Fact]
    public async Task UpdateNodeLayout_ReturnsNotFound_WhenNodeBelongsToAnotherUser()
    {
        // Arrange：建立他人的畫布與其下節點。
        var otherCanvas = MakeCanvas(_otherUserId);
        _db.Canvas.Add(otherCanvas);
        await _db.SaveChangesAsync();
        var foreignNodeId = await SeedNodeAsync(canvasId: otherCanvas.Id, ownerId: _otherUserId, x: 7);

        // Act：以本使用者身分嘗試更新他人節點。
        var result = await InvokeAsync(
            foreignNodeId.ToString(),
            new UpdateNodeLayoutRequest(X: 999),
            MakeUser(_userId));

        // Assert：查無 → 404，且他人節點的 X 未被改動。
        StatusCodeOf(result).Should().Be(StatusCodes.Status404NotFound);
        var untouched = await _db.Node.AsNoTracking().FirstAsync(n => n.Id == foreignNodeId);
        untouched.X.Should().Be(7);
    }

    // ==================== 反射叫用與斷言小工具 ====================

    /// <summary>以反射叫用私有處理函式並取得 <see cref="IResult"/>。</summary>
    /// <param name="nodeId">節點 Id（路由參數）。</param>
    /// <param name="request">佈局更新請求（可為 null）。</param>
    /// <param name="currentUser">目前使用者。</param>
    /// <returns>處理函式回傳的結果。</returns>
    private async Task<IResult> InvokeAsync(
        string nodeId,
        UpdateNodeLayoutRequest? request,
        ICurrentUser currentUser)
    {
        var task = (Task<IResult>)UpdateNodeLayoutMethod.Invoke(
            null,
            new object?[] { nodeId, request, currentUser, _db, CancellationToken.None })!;
        return await task;
    }

    /// <summary>從 <see cref="IResult"/> 取出 HTTP 狀態碼。</summary>
    /// <param name="result">處理函式回傳的結果。</param>
    /// <returns>狀態碼（找不到時回 200，對齊框架預設）。</returns>
    private static int StatusCodeOf(IResult result)
    {
        result.Should().BeAssignableTo<IStatusCodeHttpResult>();
        return ((IStatusCodeHttpResult)result).StatusCode ?? StatusCodes.Status200OK;
    }

    // ==================== 測試資料建構小工具 ====================

    /// <summary>建立測試用畫布實體。</summary>
    private static Canvas MakeCanvas(Guid userId)
    {
        var now = DateTime.UtcNow;
        return new Canvas
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Title = "測試畫布",
            Description = string.Empty,
            StateJson = "{}",
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = userId.ToString(),
            UpdatedUser = userId.ToString(),
            ValidFlag = true,
        };
    }

    /// <summary>建立測試節點並存回資料庫，回傳其 Id。</summary>
    private async Task<Guid> SeedNodeAsync(
        Guid? canvasId = null,
        Guid? ownerId = null,
        double x = 0,
        double y = 0,
        double? width = null,
        double? height = null,
        int zIndex = 0,
        string? color = null,
        string title = "")
    {
        var now = DateTime.UtcNow;
        var owner = ownerId ?? _userId;
        var node = new Node
        {
            Id = Guid.NewGuid(),
            UserId = owner,
            CanvasId = canvasId ?? _canvasId,
            Title = title,
            Content = "內容",
            X = x,
            Y = y,
            Width = width,
            Height = height,
            ZIndex = zIndex,
            Color = color,
            Origin = "user",
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = owner.ToString(),
            UpdatedUser = owner.ToString(),
            ValidFlag = true,
        };

        _db.Node.Add(node);
        await _db.SaveChangesAsync();
        return node.Id;
    }

    /// <summary>建立測試用 <see cref="ICurrentUser"/>。</summary>
    private static ICurrentUser MakeUser(Guid userId, bool isAuthenticated = true) =>
        new FakeCurrentUser(userId, isAuthenticated);

    /// <summary>測試用虛擬目前使用者。</summary>
    private sealed class FakeCurrentUser : ICurrentUser
    {
        private readonly Guid _userId;
        private readonly bool _isAuthenticated;

        public FakeCurrentUser(Guid userId, bool isAuthenticated)
        {
            _userId = userId;
            _isAuthenticated = isAuthenticated;
        }

        public Guid UserId => _userId;
        public string? Email => "test@example.com";
        public bool IsAuthenticated => _isAuthenticated;
        public string Source => "web";
    }
}
