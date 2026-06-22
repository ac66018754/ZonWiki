using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Xunit;
using ZonWiki.Domain.Dtos;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Tests.Endpoints;

/// <summary>
/// 常用連結卡（QuickLink）相關的單元測試。
/// 測試 CRUD 操作、排序管理、圖示設定等。
/// </summary>
public sealed class QuickLinkEndpointsTests : IAsyncLifetime
{
    private readonly DbContextOptions<ZonWikiDbContext> _dbOptions;
    private ZonWikiDbContext _db = null!;
    private readonly Guid _testUserId = Guid.NewGuid();

    public QuickLinkEndpointsTests()
    {
        _dbOptions = new DbContextOptionsBuilder<ZonWikiDbContext>()
            .UseInMemoryDatabase($"quicklink-test-db-{Guid.NewGuid()}")
            .Options;
    }

    /// <summary>
    /// 初始化測試資料庫與測試使用者。
    /// </summary>
    public async Task InitializeAsync()
    {
        _db = new ZonWikiDbContext(_dbOptions);
        await _db.Database.EnsureCreatedAsync();

        var now = DateTime.UtcNow;
        var user = new User
        {
            Id = _testUserId,
            Email = "quicklink-test@example.com",
            DisplayName = "QuickLink Test User",
            GoogleSub = "quicklink-test-sub",
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        _db.User.Add(user);
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
    /// 測試：建立新常用連結卡（基本資訊）。
    /// </summary>
    [Fact]
    public async Task CreateQuickLink_WithBasicInfo_ShouldSucceed()
    {
        // Arrange
        var now = DateTime.UtcNow;
        var quickLink = new QuickLink
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Title = "GitHub",
            Url = "https://github.com",
            IconKey = "github",
            SortOrder = 0,
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "test-user",
            UpdatedUser = "test-user",
            ValidFlag = true
        };

        // Act
        _db.QuickLink.Add(quickLink);
        await _db.SaveChangesAsync();

        // Assert
        var saved = await _db.QuickLink.FirstOrDefaultAsync(ql => ql.Id == quickLink.Id);
        saved.Should().NotBeNull();
        saved!.Title.Should().Be("GitHub");
        saved.Url.Should().Be("https://github.com");
        saved.IconKey.Should().Be("github");
        saved.ValidFlag.Should().BeTrue();
    }

    /// <summary>
    /// 測試：建立多個常用連結卡並驗證排序。
    /// </summary>
    [Fact]
    public async Task CreateMultipleQuickLinks_ShouldMaintainSortOrder()
    {
        // Arrange
        var now = DateTime.UtcNow;
        var links = new[]
        {
            new QuickLink
            {
                Id = Guid.NewGuid(),
                UserId = _testUserId,
                Title = "Google",
                Url = "https://google.com",
                SortOrder = 0,
                CreatedDateTime = now,
                UpdatedDateTime = now,
                CreatedUser = "system",
                UpdatedUser = "system",
                ValidFlag = true
            },
            new QuickLink
            {
                Id = Guid.NewGuid(),
                UserId = _testUserId,
                Title = "GitHub",
                Url = "https://github.com",
                SortOrder = 1,
                CreatedDateTime = now,
                UpdatedDateTime = now,
                CreatedUser = "system",
                UpdatedUser = "system",
                ValidFlag = true
            }
        };

        // Act
        _db.QuickLink.AddRange(links);
        await _db.SaveChangesAsync();

        // Assert
        var saved = await _db.QuickLink
            .Where(ql => ql.UserId == _testUserId && ql.ValidFlag)
            .OrderBy(ql => ql.SortOrder)
            .ToListAsync();

        saved.Should().HaveCount(2);
        saved[0].Title.Should().Be("Google");
        saved[1].Title.Should().Be("GitHub");
    }

    /// <summary>
    /// 測試：更新常用連結卡。
    /// </summary>
    [Fact]
    public async Task UpdateQuickLink_ShouldUpdateProperties()
    {
        // Arrange
        var now = DateTime.UtcNow;
        var quickLink = new QuickLink
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Title = "GitHub",
            Url = "https://github.com",
            IconKey = "github",
            SortOrder = 0,
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        _db.QuickLink.Add(quickLink);
        await _db.SaveChangesAsync();

        // Act
        quickLink.Title = "GitHub - Updated";
        quickLink.Url = "https://github.com/updated";
        quickLink.UpdatedDateTime = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        // Assert
        var updated = await _db.QuickLink.FirstOrDefaultAsync(ql => ql.Id == quickLink.Id);
        updated!.Title.Should().Be("GitHub - Updated");
        updated.Url.Should().Be("https://github.com/updated");
    }

    /// <summary>
    /// 測試：軟刪除常用連結卡。
    /// </summary>
    [Fact]
    public async Task DeleteQuickLink_ShouldSoftDelete()
    {
        // Arrange
        var now = DateTime.UtcNow;
        var quickLink = new QuickLink
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Title = "GitHub",
            Url = "https://github.com",
            SortOrder = 0,
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        _db.QuickLink.Add(quickLink);
        await _db.SaveChangesAsync();

        // Act
        quickLink.ValidFlag = false;
        quickLink.UpdatedDateTime = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        // Assert
        var deleted = await _db.QuickLink
            .Where(ql => ql.Id == quickLink.Id && ql.ValidFlag)
            .FirstOrDefaultAsync();

        deleted.Should().BeNull();

        var stillExists = await _db.QuickLink
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(ql => ql.Id == quickLink.Id);

        stillExists.Should().NotBeNull();
        stillExists!.ValidFlag.Should().BeFalse();
    }

    /// <summary>
    /// 測試：常用連結卡沒有圖示時為空。
    /// </summary>
    [Fact]
    public async Task CreateQuickLink_WithoutIcon_ShouldAllowNull()
    {
        // Arrange
        var now = DateTime.UtcNow;
        var quickLink = new QuickLink
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Title = "GitHub",
            Url = "https://github.com",
            IconKey = null,
            SortOrder = 0,
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        // Act
        _db.QuickLink.Add(quickLink);
        await _db.SaveChangesAsync();

        // Assert
        var saved = await _db.QuickLink.FirstOrDefaultAsync(ql => ql.Id == quickLink.Id);
        saved.Should().NotBeNull();
        saved!.IconKey.Should().BeNull();
    }

    /// <summary>
    /// 測試：查詢只返回當前使用者的連結卡。
    /// </summary>
    [Fact]
    public async Task QueryQuickLinks_ShouldOnlyReturnCurrentUserLinks()
    {
        // Arrange
        var otherUserId = Guid.NewGuid();
        var now = DateTime.UtcNow;

        var myLink = new QuickLink
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Title = "My GitHub",
            Url = "https://github.com",
            SortOrder = 0,
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        var otherLink = new QuickLink
        {
            Id = Guid.NewGuid(),
            UserId = otherUserId,
            Title = "Other GitHub",
            Url = "https://github.com",
            SortOrder = 0,
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        _db.QuickLink.AddRange(myLink, otherLink);
        await _db.SaveChangesAsync();

        // Act
        var myLinks = await _db.QuickLink
            .Where(ql => ql.UserId == _testUserId && ql.ValidFlag)
            .ToListAsync();

        // Assert
        myLinks.Should().HaveCount(1);
        myLinks[0].Id.Should().Be(myLink.Id);
    }
}
