using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Xunit;
using ZonWiki.Api.Services;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Tests.Services;

/// <summary>
/// CanvasSystemPromptResolver（畫布生效 System Prompt 解析器）的單元測試。
/// 驗證三來源合併（全域 / 分類 / 自選）、去重、分類名稱、多租戶隔離與軟刪除排除。
/// 使用 InMemory DbContext（建構時不帶 ICurrentUser，故無全域過濾器；解析器以明確 userId 隔離）。
/// </summary>
public sealed class CanvasSystemPromptResolverTests : IAsyncLifetime
{
    private readonly DbContextOptions<ZonWikiDbContext> _dbOptions;
    private ZonWikiDbContext _db = null!;
    private readonly Guid _userId = Guid.NewGuid();
    private readonly Guid _otherUserId = Guid.NewGuid();
    private readonly Guid _canvasId = Guid.NewGuid();

    /// <summary>
    /// 建構測試：建立獨立的 InMemory 資料庫設定。
    /// </summary>
    public CanvasSystemPromptResolverTests()
    {
        _dbOptions = new DbContextOptionsBuilder<ZonWikiDbContext>()
            .UseInMemoryDatabase($"resolver-test-db-{Guid.NewGuid()}")
            .Options;
    }

    /// <summary>
    /// 初始化資料庫與基本測試資料（一個使用者、一張畫布）。
    /// </summary>
    public async Task InitializeAsync()
    {
        _db = new ZonWikiDbContext(_dbOptions);
        await _db.Database.EnsureCreatedAsync();

        _db.Canvas.Add(new Canvas
        {
            Id = _canvasId,
            UserId = _userId,
            Title = "測試畫布",
            Description = string.Empty,
            StateJson = "{}",
        });
        await _db.SaveChangesAsync();
    }

    /// <summary>
    /// 清理資料庫。
    /// </summary>
    public async Task DisposeAsync()
    {
        await _db.Database.EnsureDeletedAsync();
        _db.Dispose();
    }

    /// <summary>
    /// 建立一筆 System Prompt 並回傳其 Id。
    /// </summary>
    private async Task<Guid> AddPromptAsync(
        string title,
        string content,
        bool isGlobal,
        Guid? ownerId = null,
        bool valid = true)
    {
        var id = Guid.NewGuid();
        _db.SystemPrompt.Add(new SystemPrompt
        {
            Id = id,
            UserId = ownerId ?? _userId,
            Title = title,
            Content = content,
            IsGlobal = isGlobal,
            ValidFlag = valid,
        });
        await _db.SaveChangesAsync();
        return id;
    }

    /// <summary>
    /// 建立一個畫布分類並回傳其 Id。
    /// </summary>
    private async Task<Guid> AddCategoryAsync(string name, Guid? ownerId = null)
    {
        var id = Guid.NewGuid();
        _db.CanvasCat.Add(new CanvasCat
        {
            Id = id,
            UserId = ownerId ?? _userId,
            Name = name,
        });
        await _db.SaveChangesAsync();
        return id;
    }

    /// <summary>
    /// 測試：全域 System Prompt 會被解析為 global 來源。
    /// </summary>
    [Fact]
    public async Task ResolveAsync_IncludesGlobalPrompts_WithGlobalSource()
    {
        // Arrange
        await AddPromptAsync("全域提示", "全域內容", isGlobal: true);

        // Act
        var effective = await CanvasSystemPromptResolver.ResolveAsync(_db, _userId, _canvasId, default);

        // Assert
        effective.Should().ContainSingle();
        effective[0].Title.Should().Be("全域提示");
        effective[0].Source.Should().Be("global");
        effective[0].CategoryName.Should().BeNull();
    }

    /// <summary>
    /// 測試：分類掛載的 System Prompt 會被解析為 category 來源，並帶分類名稱。
    /// </summary>
    [Fact]
    public async Task ResolveAsync_IncludesCategoryPrompts_WithCategoryNameAndSource()
    {
        // Arrange
        var promptId = await AddPromptAsync("分類提示", "分類內容", isGlobal: false);
        var categoryId = await AddCategoryAsync("軟體工程");
        _db.CanvasCategory.Add(new CanvasCategory { Id = Guid.NewGuid(), CanvasId = _canvasId, CategoryId = categoryId });
        _db.CategorySystemPrompt.Add(new CategorySystemPrompt { Id = Guid.NewGuid(), CategoryId = categoryId, SystemPromptId = promptId });
        await _db.SaveChangesAsync();

        // Act
        var effective = await CanvasSystemPromptResolver.ResolveAsync(_db, _userId, _canvasId, default);

        // Assert
        effective.Should().ContainSingle();
        effective[0].Source.Should().Be("category");
        effective[0].Title.Should().Be("分類提示");
        effective[0].CategoryName.Should().Be("軟體工程");
    }

    /// <summary>
    /// 測試：畫布自選的 System Prompt 會被解析為 own 來源。
    /// </summary>
    [Fact]
    public async Task ResolveAsync_IncludesOwnPrompts_WithOwnSource()
    {
        // Arrange
        var promptId = await AddPromptAsync("自選提示", "自選內容", isGlobal: false);
        _db.CanvasSystemPrompt.Add(new CanvasSystemPrompt { Id = Guid.NewGuid(), CanvasId = _canvasId, SystemPromptId = promptId });
        await _db.SaveChangesAsync();

        // Act
        var effective = await CanvasSystemPromptResolver.ResolveAsync(_db, _userId, _canvasId, default);

        // Assert
        effective.Should().ContainSingle();
        effective[0].Source.Should().Be("own");
        effective[0].Title.Should().Be("自選提示");
    }

    /// <summary>
    /// 測試：三來源合併且依 global → category → own 排序。
    /// </summary>
    [Fact]
    public async Task ResolveAsync_MergesAllThreeSources_InOrder()
    {
        // Arrange
        await AddPromptAsync("G", "g", isGlobal: true);
        var catPromptId = await AddPromptAsync("C", "c", isGlobal: false);
        var ownPromptId = await AddPromptAsync("O", "o", isGlobal: false);
        var categoryId = await AddCategoryAsync("分類X");
        _db.CanvasCategory.Add(new CanvasCategory { Id = Guid.NewGuid(), CanvasId = _canvasId, CategoryId = categoryId });
        _db.CategorySystemPrompt.Add(new CategorySystemPrompt { Id = Guid.NewGuid(), CategoryId = categoryId, SystemPromptId = catPromptId });
        _db.CanvasSystemPrompt.Add(new CanvasSystemPrompt { Id = Guid.NewGuid(), CanvasId = _canvasId, SystemPromptId = ownPromptId });
        await _db.SaveChangesAsync();

        // Act
        var effective = await CanvasSystemPromptResolver.ResolveAsync(_db, _userId, _canvasId, default);

        // Assert
        effective.Select(e => e.Source).Should().Equal("global", "category", "own");
    }

    /// <summary>
    /// 測試：同一個 System Prompt 同時為全域與自選時，只算一次（以先出現的 global 為準）。
    /// </summary>
    [Fact]
    public async Task ResolveAsync_DeduplicatesAcrossSources_KeepsFirstOccurrence()
    {
        // Arrange：一個全域 prompt 同時被畫布自選
        var promptId = await AddPromptAsync("重複提示", "內容", isGlobal: true);
        _db.CanvasSystemPrompt.Add(new CanvasSystemPrompt { Id = Guid.NewGuid(), CanvasId = _canvasId, SystemPromptId = promptId });
        await _db.SaveChangesAsync();

        // Act
        var effective = await CanvasSystemPromptResolver.ResolveAsync(_db, _userId, _canvasId, default);

        // Assert
        effective.Should().ContainSingle();
        effective[0].Source.Should().Be("global");
    }

    /// <summary>
    /// 測試：他人的全域 System Prompt 不會被納入（多租戶隔離）。
    /// </summary>
    [Fact]
    public async Task ResolveAsync_ExcludesOtherUsersGlobalPrompts()
    {
        // Arrange
        await AddPromptAsync("我的全域", "mine", isGlobal: true);
        await AddPromptAsync("他人全域", "theirs", isGlobal: true, ownerId: _otherUserId);

        // Act
        var effective = await CanvasSystemPromptResolver.ResolveAsync(_db, _userId, _canvasId, default);

        // Assert
        effective.Should().ContainSingle();
        effective[0].Title.Should().Be("我的全域");
    }

    /// <summary>
    /// 測試：已軟刪除（ValidFlag=false）的 System Prompt 不會被納入。
    /// </summary>
    [Fact]
    public async Task ResolveAsync_ExcludesSoftDeletedPrompts()
    {
        // Arrange
        await AddPromptAsync("已刪除全域", "x", isGlobal: true, valid: false);

        // Act
        var effective = await CanvasSystemPromptResolver.ResolveAsync(_db, _userId, _canvasId, default);

        // Assert
        effective.Should().BeEmpty();
    }

    /// <summary>
    /// 測試：Combine 會以兩個換行串接內容；全空白時回 null。
    /// </summary>
    [Fact]
    public void Combine_JoinsNonEmptyContents_AndReturnsNullWhenAllEmpty()
    {
        // Arrange
        var items = new List<Domain.Dtos.EffectiveSystemPromptDto>
        {
            new("1", "A", "第一段", "global", null),
            new("2", "B", "   ", "own", null),
            new("3", "C", "第二段", "own", null),
        };

        // Act
        var combined = CanvasSystemPromptResolver.Combine(items);
        var empty = CanvasSystemPromptResolver.Combine(new List<Domain.Dtos.EffectiveSystemPromptDto>());

        // Assert
        combined.Should().Be("第一段\n\n第二段");
        empty.Should().BeNull();
    }
}
