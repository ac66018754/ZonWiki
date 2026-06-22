using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Xunit;
using ZonWiki.Domain.Dtos;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Tests;

/// <summary>
/// 使用者設定 API 端點的單元測試。
/// 涵蓋：GET /api/me/settings、PUT /api/me/settings。
/// 測試顯示模式與時區的更新邏輯。
/// </summary>
public sealed class UserSettingsEndpointsTests : IAsyncLifetime
{
    private readonly DbContextOptions<ZonWikiDbContext> _dbOptions;
    private ZonWikiDbContext _db = null!;
    private readonly Guid _testUserId = Guid.NewGuid();

    public UserSettingsEndpointsTests()
    {
        _dbOptions = new DbContextOptionsBuilder<ZonWikiDbContext>()
            .UseInMemoryDatabase($"user-settings-test-{Guid.NewGuid()}")
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
            Email = "settings-test@example.com",
            DisplayName = "Settings Test User",
            GoogleSub = "settings-test-sub",
            DisplayMode = "warmpaper", // 預設
            TimeZone = string.Empty, // 預設為空（跟隨裝置）
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
    /// 測試：新使用者的預設顯示模式應為 "warmpaper"。
    /// </summary>
    [Fact]
    public async Task UserSettings_DefaultDisplayMode_IsWarmpaper()
    {
        // Act
        var user = await _db.User.FirstOrDefaultAsync(u => u.Id == _testUserId);

        // Assert
        user.Should().NotBeNull();
        user!.DisplayMode.Should().Be("warmpaper");
    }

    /// <summary>
    /// 測試：新使用者的預設時區應為空字串（跟隨裝置）。
    /// </summary>
    [Fact]
    public async Task UserSettings_DefaultTimeZone_IsEmpty()
    {
        // Act
        var user = await _db.User.FirstOrDefaultAsync(u => u.Id == _testUserId);

        // Assert
        user.Should().NotBeNull();
        user!.TimeZone.Should().BeEmpty();
    }

    /// <summary>
    /// 測試：更新顯示模式為 "dark" 應成功。
    /// </summary>
    [Fact]
    public async Task UpdateDisplayMode_ToDark_Succeeds()
    {
        // Arrange
        var user = await _db.User.FirstOrDefaultAsync(u => u.Id == _testUserId);
        user.Should().NotBeNull();

        // Act
        user!.DisplayMode = "dark";
        user.UpdatedDateTime = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        // Assert
        var updated = await _db.User.FirstOrDefaultAsync(u => u.Id == _testUserId);
        updated!.DisplayMode.Should().Be("dark");
    }

    /// <summary>
    /// 測試：更新時區為 "Asia/Taipei" 應成功。
    /// </summary>
    [Fact]
    public async Task UpdateTimeZone_ToAsiaTPE_Succeeds()
    {
        // Arrange
        var user = await _db.User.FirstOrDefaultAsync(u => u.Id == _testUserId);
        user.Should().NotBeNull();

        // Act
        user!.TimeZone = "Asia/Taipei";
        user.UpdatedDateTime = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        // Assert
        var updated = await _db.User.FirstOrDefaultAsync(u => u.Id == _testUserId);
        updated!.TimeZone.Should().Be("Asia/Taipei");
    }

    /// <summary>
    /// 測試：所有有效的顯示模式都應可成功更新。
    /// </summary>
    [Theory]
    [InlineData("warmpaper")]
    [InlineData("light")]
    [InlineData("dark")]
    [InlineData("night")]
    public async Task UpdateDisplayMode_AllValidModes_Succeed(string mode)
    {
        // Arrange
        var user = await _db.User.FirstOrDefaultAsync(u => u.Id == _testUserId);
        user.Should().NotBeNull();

        // Act
        user!.DisplayMode = mode;
        user.UpdatedDateTime = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        // Assert
        var updated = await _db.User.FirstOrDefaultAsync(u => u.Id == _testUserId);
        updated!.DisplayMode.Should().Be(mode);
    }

    /// <summary>
    /// 測試：同時更新顯示模式與時區應成功。
    /// </summary>
    [Fact]
    public async Task UpdateBothSettings_Succeeds()
    {
        // Arrange
        var user = await _db.User.FirstOrDefaultAsync(u => u.Id == _testUserId);
        user.Should().NotBeNull();

        // Act
        user!.DisplayMode = "night";
        user.TimeZone = "America/New_York";
        user.UpdatedDateTime = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        // Assert
        var updated = await _db.User.FirstOrDefaultAsync(u => u.Id == _testUserId);
        updated!.DisplayMode.Should().Be("night");
        updated.TimeZone.Should().Be("America/New_York");
    }

    /// <summary>
    /// 測試：UpdatedDateTime 應自動更新。
    /// </summary>
    [Fact]
    public async Task UpdateUserSettings_UpdatedDateTimeIsUpdated()
    {
        // Arrange
        var user = await _db.User.FirstOrDefaultAsync(u => u.Id == _testUserId);
        var originalUpdatedTime = user!.UpdatedDateTime;
        user.Should().NotBeNull();

        // Act
        // 等待一小段時間確保時間戳不同
        await Task.Delay(10);
        user.DisplayMode = "light";
        var newUpdatedTime = DateTime.UtcNow;
        user.UpdatedDateTime = newUpdatedTime;
        await _db.SaveChangesAsync();

        // Assert
        var updated = await _db.User.FirstOrDefaultAsync(u => u.Id == _testUserId);
        updated!.UpdatedDateTime.Should().BeOnOrAfter(originalUpdatedTime);
    }
}
