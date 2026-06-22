using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Xunit;
using ZonWiki.Domain.Dtos;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Tests.Endpoints;

/// <summary>
/// 快速捕捉項目（CaptureItem）相關的單元測試。
/// 測試 CRUD 操作、捕捉來源管理、狀態流轉（inbox → filed）、歸檔等。
/// </summary>
public sealed class CaptureItemEndpointsTests : IAsyncLifetime
{
    private readonly DbContextOptions<ZonWikiDbContext> _dbOptions;
    private ZonWikiDbContext _db = null!;
    private readonly Guid _testUserId = Guid.NewGuid();

    public CaptureItemEndpointsTests()
    {
        _dbOptions = new DbContextOptionsBuilder<ZonWikiDbContext>()
            .UseInMemoryDatabase($"capture-test-db-{Guid.NewGuid()}")
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
            Email = "capture-test@example.com",
            DisplayName = "Capture Test User",
            GoogleSub = "capture-test-sub",
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
    /// 測試：建立新捕捉項目（打字，source = web）。
    /// </summary>
    [Fact]
    public async Task CreateCaptureItem_WithWebSource_ShouldSucceed()
    {
        // Arrange
        var now = DateTime.UtcNow;
        var capture = new CaptureItem
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Source = "web",
            RawContent = "今天開會討論新功能",
            AudioPath = null,
            Status = "inbox",
            FiledTargetType = null,
            FiledTargetId = null,
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "test-user",
            UpdatedUser = "test-user",
            ValidFlag = true
        };

        // Act
        _db.CaptureItem.Add(capture);
        await _db.SaveChangesAsync();

        // Assert
        var saved = await _db.CaptureItem.FirstOrDefaultAsync(ci => ci.Id == capture.Id);
        saved.Should().NotBeNull();
        saved!.Source.Should().Be("web");
        saved.RawContent.Should().Be("今天開會討論新功能");
        saved.Status.Should().Be("inbox");
        saved.ValidFlag.Should().BeTrue();
    }

    /// <summary>
    /// 測試：建立捕捉項目（錄音，source = voice）。
    /// </summary>
    [Fact]
    public async Task CreateCaptureItem_WithVoiceSource_ShouldIncludeAudioPath()
    {
        // Arrange
        var now = DateTime.UtcNow;
        var capture = new CaptureItem
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Source = "voice",
            RawContent = "錄音轉出的文字內容",
            AudioPath = "/uploads/audio/capture-123.wav",
            Status = "inbox",
            FiledTargetType = null,
            FiledTargetId = null,
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        // Act
        _db.CaptureItem.Add(capture);
        await _db.SaveChangesAsync();

        // Assert
        var saved = await _db.CaptureItem.FirstOrDefaultAsync(ci => ci.Id == capture.Id);
        saved.Should().NotBeNull();
        saved!.Source.Should().Be("voice");
        saved.AudioPath.Should().Be("/uploads/audio/capture-123.wav");
    }

    /// <summary>
    /// 測試：捕捉項目狀態流轉（inbox → filed）。
    /// </summary>
    [Fact]
    public async Task ArchiveCaptureItem_TransitionToFiled_ShouldSucceed()
    {
        // Arrange
        var now = DateTime.UtcNow;
        var capture = new CaptureItem
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Source = "web",
            RawContent = "待分流的內容",
            Status = "inbox",
            FiledTargetType = null,
            FiledTargetId = null,
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        _db.CaptureItem.Add(capture);
        await _db.SaveChangesAsync();

        // Act
        capture.Status = "filed";
        capture.FiledTargetType = "note";
        capture.FiledTargetId = Guid.NewGuid();
        capture.UpdatedDateTime = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        // Assert
        var archived = await _db.CaptureItem.FirstOrDefaultAsync(ci => ci.Id == capture.Id);
        archived!.Status.Should().Be("filed");
        archived.FiledTargetType.Should().Be("note");
        archived.FiledTargetId.Should().NotBeEmpty();
    }

    /// <summary>
    /// 測試：歸檔為筆記與任務卡片。
    /// </summary>
    [Theory]
    [InlineData("note")]
    [InlineData("taskcard")]
    public async Task ArchiveCaptureItem_ToVariousTargetTypes_ShouldSucceed(string targetType)
    {
        // Arrange
        var now = DateTime.UtcNow;
        var capture = new CaptureItem
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Source = "web",
            RawContent = "待分流的內容",
            Status = "inbox",
            FiledTargetType = null,
            FiledTargetId = null,
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        _db.CaptureItem.Add(capture);
        await _db.SaveChangesAsync();

        // Act
        capture.Status = "filed";
        capture.FiledTargetType = targetType;
        capture.FiledTargetId = Guid.NewGuid();
        capture.UpdatedDateTime = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        // Assert
        var archived = await _db.CaptureItem.FirstOrDefaultAsync(ci => ci.Id == capture.Id);
        archived!.Status.Should().Be("filed");
        archived.FiledTargetType.Should().Be(targetType);
    }

    /// <summary>
    /// 測試：軟刪除捕捉項目。
    /// </summary>
    [Fact]
    public async Task DeleteCaptureItem_ShouldSoftDelete()
    {
        // Arrange
        var now = DateTime.UtcNow;
        var capture = new CaptureItem
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Source = "web",
            RawContent = "待刪除的內容",
            Status = "inbox",
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        _db.CaptureItem.Add(capture);
        await _db.SaveChangesAsync();

        // Act
        capture.ValidFlag = false;
        capture.UpdatedDateTime = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        // Assert
        var deleted = await _db.CaptureItem
            .Where(ci => ci.Id == capture.Id && ci.ValidFlag)
            .FirstOrDefaultAsync();

        deleted.Should().BeNull();

        var stillExists = await _db.CaptureItem
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(ci => ci.Id == capture.Id);

        stillExists.Should().NotBeNull();
        stillExists!.ValidFlag.Should().BeFalse();
    }

    /// <summary>
    /// 測試：查詢待分流的捕捉項目（status = inbox）。
    /// </summary>
    [Fact]
    public async Task QueryInboxCaptures_ShouldOnlyReturnUnfiledItems()
    {
        // Arrange
        var now = DateTime.UtcNow;

        var inboxItem = new CaptureItem
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Source = "web",
            RawContent = "待分流",
            Status = "inbox",
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        var filedItem = new CaptureItem
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Source = "web",
            RawContent = "已歸檔",
            Status = "filed",
            FiledTargetType = "note",
            FiledTargetId = Guid.NewGuid(),
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        _db.CaptureItem.AddRange(inboxItem, filedItem);
        await _db.SaveChangesAsync();

        // Act
        var inboxItems = await _db.CaptureItem
            .Where(ci => ci.UserId == _testUserId && ci.ValidFlag && ci.Status == "inbox")
            .ToListAsync();

        // Assert
        inboxItems.Should().HaveCount(1);
        inboxItems[0].Id.Should().Be(inboxItem.Id);
    }

    /// <summary>
    /// 測試：查詢已歸檔的捕捉項目（status = filed）。
    /// </summary>
    [Fact]
    public async Task QueryFiledCaptures_ShouldOnlyReturnFiledItems()
    {
        // Arrange
        var now = DateTime.UtcNow;

        var inboxItem = new CaptureItem
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Source = "web",
            RawContent = "待分流",
            Status = "inbox",
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        var filedItem = new CaptureItem
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Source = "web",
            RawContent = "已歸檔",
            Status = "filed",
            FiledTargetType = "note",
            FiledTargetId = Guid.NewGuid(),
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        _db.CaptureItem.AddRange(inboxItem, filedItem);
        await _db.SaveChangesAsync();

        // Act
        var filedItems = await _db.CaptureItem
            .Where(ci => ci.UserId == _testUserId && ci.ValidFlag && ci.Status == "filed")
            .ToListAsync();

        // Assert
        filedItems.Should().HaveCount(1);
        filedItems[0].Id.Should().Be(filedItem.Id);
    }

    /// <summary>
    /// 測試：查詢只返回當前使用者的捕捉項目。
    /// </summary>
    [Fact]
    public async Task QueryCaptures_ShouldOnlyReturnCurrentUserCaptures()
    {
        // Arrange
        var otherUserId = Guid.NewGuid();
        var now = DateTime.UtcNow;

        var myCapture = new CaptureItem
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Source = "web",
            RawContent = "我的捕捉",
            Status = "inbox",
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        var otherCapture = new CaptureItem
        {
            Id = Guid.NewGuid(),
            UserId = otherUserId,
            Source = "web",
            RawContent = "別人的捕捉",
            Status = "inbox",
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        _db.CaptureItem.AddRange(myCapture, otherCapture);
        await _db.SaveChangesAsync();

        // Act
        var myCaptures = await _db.CaptureItem
            .Where(ci => ci.UserId == _testUserId && ci.ValidFlag)
            .ToListAsync();

        // Assert
        myCaptures.Should().HaveCount(1);
        myCaptures[0].Id.Should().Be(myCapture.Id);
    }
}
