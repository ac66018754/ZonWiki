using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Xunit;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;
using ZonWiki.Infrastructure.Services;

namespace ZonWiki.Api.Tests;

/// <summary>
/// 垃圾桶相關的單元測試。
/// 測試垃圾桶項目的收集、還原、永久刪除，以及多實體型別的彙整。
/// </summary>
public sealed class TrashEndpointsTests : IAsyncLifetime
{
    private readonly DbContextOptions<ZonWikiDbContext> _dbOptions;
    private ZonWikiDbContext _db = null!;
    private readonly Guid _testUserId = Guid.NewGuid();
    private readonly Guid _otherUserId = Guid.NewGuid();

    public TrashEndpointsTests()
    {
        _dbOptions = new DbContextOptionsBuilder<ZonWikiDbContext>()
            .UseInMemoryDatabase($"trash-test-{Guid.NewGuid()}")
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

        // 主測試使用者
        var user = new User
        {
            Id = _testUserId,
            Email = "trash-test@example.com",
            DisplayName = "Trash Test User",
            GoogleSub = "trash-test-sub",
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        // 其他使用者（用於權限測試）
        var otherUser = new User
        {
            Id = _otherUserId,
            Email = "other-user@example.com",
            DisplayName = "Other User",
            GoogleSub = "other-user-sub",
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        _db.User.Add(user);
        _db.User.Add(otherUser);
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
    /// 測試：垃圾桶型別登錄表包含 Note 型別。
    /// </summary>
    [Fact]
    public void TrashTypeRegistry_ShouldContainNoteType()
    {
        // Act
        var noteType = TrashTypeRegistry.GetEntityType("Note");

        // Assert
        noteType.Should().NotBeNull();
        noteType.Should().Be(typeof(Note));
    }

    /// <summary>
    /// 測試：垃圾桶型別登錄表包含 TaskCard 型別。
    /// </summary>
    [Fact]
    public void TrashTypeRegistry_ShouldContainTaskCardType()
    {
        // Act
        var taskCardType = TrashTypeRegistry.GetEntityType("TaskCard");

        // Assert
        taskCardType.Should().NotBeNull();
        taskCardType.Should().Be(typeof(TaskCard));
    }

    /// <summary>
    /// 測試：垃圾桶型別登錄表不包含無效型別。
    /// </summary>
    [Fact]
    public void TrashTypeRegistry_InvalidType_ReturnsNull()
    {
        // Act
        var invalidType = TrashTypeRegistry.GetEntityType("InvalidType");

        // Assert
        invalidType.Should().BeNull();
    }

    /// <summary>
    /// 測試：TrashTypeRegistry 可取得 Note 的標題。
    /// </summary>
    [Fact]
    public void TrashTypeRegistry_GetTitle_ForNote_ReturnsTitle()
    {
        // Arrange
        var note = new Note { Title = "測試筆記" };

        // Act
        var title = TrashTypeRegistry.GetTitle(note);

        // Assert
        title.Should().Be("測試筆記");
    }

    /// <summary>
    /// 測試：TrashTypeRegistry 可取得 TaskCard 的標題。
    /// </summary>
    [Fact]
    public void TrashTypeRegistry_GetTitle_ForTaskCard_ReturnsTitle()
    {
        // Arrange
        var taskCard = new TaskCard { Title = "測試任務" };

        // Act
        var title = TrashTypeRegistry.GetTitle(taskCard);

        // Assert
        title.Should().Be("測試任務");
    }

    /// <summary>
    /// 測試：TrashTypeRegistry 可取得 Category 的標題。
    /// </summary>
    [Fact]
    public void TrashTypeRegistry_GetTitle_ForCategory_ReturnsName()
    {
        // Arrange
        var category = new Category { Name = "測試分類" };

        // Act
        var title = TrashTypeRegistry.GetTitle(category);

        // Assert
        title.Should().Be("測試分類");
    }

    /// <summary>
    /// 測試：建立並軟刪除筆記。
    /// </summary>
    [Fact]
    public async Task DeleteNote_SoftDelete_ValidFlagFalse()
    {
        // Arrange
        var note = new Note
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Title = "待刪除筆記",
            Slug = "to-delete",
            ContentRaw = "內容",
            ContentHtml = "<p>內容</p>",
            ContentHash = "hash",
            IsDraft = false,
            Kind = "note",
            CreatedDateTime = DateTime.UtcNow,
            UpdatedDateTime = DateTime.UtcNow,
            CreatedUser = _testUserId.ToString(),
            UpdatedUser = _testUserId.ToString(),
            ValidFlag = true
        };
        _db.Note.Add(note);
        await _db.SaveChangesAsync();

        // Act
        note.ValidFlag = false;
        note.DeletedDateTime = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        // Assert
        var deletedNote = await _db.Note.FirstOrDefaultAsync(n => n.Id == note.Id);
        deletedNote.Should().NotBeNull();
        deletedNote!.ValidFlag.Should().BeFalse();
        deletedNote.DeletedDateTime.Should().NotBeNull();
    }

    /// <summary>
    /// 測試：還原已軟刪除的筆記。
    /// </summary>
    [Fact]
    public async Task RestoreNote_SoftDeleted_ValidFlagTrue()
    {
        // Arrange
        var note = new Note
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Title = "待還原筆記",
            Slug = "to-restore",
            ContentRaw = "內容",
            ContentHtml = "<p>內容</p>",
            ContentHash = "hash",
            IsDraft = false,
            Kind = "note",
            CreatedDateTime = DateTime.UtcNow,
            UpdatedDateTime = DateTime.UtcNow,
            CreatedUser = _testUserId.ToString(),
            UpdatedUser = _testUserId.ToString(),
            ValidFlag = false,
            DeletedDateTime = DateTime.UtcNow
        };
        _db.Note.Add(note);
        await _db.SaveChangesAsync();

        // Act
        note.ValidFlag = true;
        note.DeletedDateTime = null;
        await _db.SaveChangesAsync();

        // Assert
        var restoredNote = await _db.Note.FirstOrDefaultAsync(n => n.Id == note.Id);
        restoredNote.Should().NotBeNull();
        restoredNote!.ValidFlag.Should().BeTrue();
        restoredNote.DeletedDateTime.Should().BeNull();
    }

    /// <summary>
    /// 測試：多個不同實體型別都可軟刪除。
    /// </summary>
    [Fact]
    public async Task MultipleEntityTypes_SoftDelete_Succeeds()
    {
        // Arrange
        var now = DateTime.UtcNow;

        var note = new Note
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Title = "筆記",
            Slug = "note-slug",
            ContentRaw = "內容",
            ContentHtml = "<p>內容</p>",
            ContentHash = "hash",
            IsDraft = false,
            Kind = "note",
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = _testUserId.ToString(),
            UpdatedUser = _testUserId.ToString(),
            ValidFlag = true
        };

        var taskCard = new TaskCard
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Title = "任務",
            Content = "內容",
            Status = "todo",
            Priority = 0,
            SortOrder = 0,
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = _testUserId.ToString(),
            UpdatedUser = _testUserId.ToString(),
            ValidFlag = true
        };

        var category = new Category
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Name = "分類",
            FolderPath = string.Empty,
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = _testUserId.ToString(),
            UpdatedUser = _testUserId.ToString(),
            ValidFlag = true
        };

        _db.Note.Add(note);
        _db.TaskCard.Add(taskCard);
        _db.Category.Add(category);
        await _db.SaveChangesAsync();

        // Act
        note.ValidFlag = false;
        note.DeletedDateTime = now;
        taskCard.ValidFlag = false;
        taskCard.DeletedDateTime = now;
        category.ValidFlag = false;
        category.DeletedDateTime = now;
        await _db.SaveChangesAsync();

        // Assert
        var deletedNotes = await _db.Note
            .Where(n => n.UserId == _testUserId && !n.ValidFlag)
            .CountAsync();
        var deletedTasks = await _db.TaskCard
            .Where(t => t.UserId == _testUserId && !t.ValidFlag)
            .CountAsync();
        var deletedCategories = await _db.Category
            .Where(c => c.UserId == _testUserId && !c.ValidFlag)
            .CountAsync();

        deletedNotes.Should().Be(1);
        deletedTasks.Should().Be(1);
        deletedCategories.Should().Be(1);
    }

    /// <summary>
    /// 測試：使用者只能看到自己的已刪除項目。
    /// </summary>
    [Fact]
    public async Task DeletedItems_UserIsolation_EachUserOnlySeesOwn()
    {
        // Arrange
        var now = DateTime.UtcNow;

        var testUserNote = new Note
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Title = "測試使用者筆記",
            Slug = "test-user-note",
            ContentRaw = "內容",
            ContentHtml = "<p>內容</p>",
            ContentHash = "hash",
            IsDraft = false,
            Kind = "note",
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = _testUserId.ToString(),
            UpdatedUser = _testUserId.ToString(),
            ValidFlag = false,
            DeletedDateTime = now
        };

        var otherUserNote = new Note
        {
            Id = Guid.NewGuid(),
            UserId = _otherUserId,
            Title = "其他使用者筆記",
            Slug = "other-user-note",
            ContentRaw = "內容",
            ContentHtml = "<p>內容</p>",
            ContentHash = "hash",
            IsDraft = false,
            Kind = "note",
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = _otherUserId.ToString(),
            UpdatedUser = _otherUserId.ToString(),
            ValidFlag = false,
            DeletedDateTime = now
        };

        _db.Note.Add(testUserNote);
        _db.Note.Add(otherUserNote);
        await _db.SaveChangesAsync();

        // Act
        var testUserDeletedNotes = await _db.Note
            .Where(n => n.UserId == _testUserId && !n.ValidFlag && n.DeletedDateTime.HasValue)
            .CountAsync();

        var otherUserDeletedNotes = await _db.Note
            .Where(n => n.UserId == _otherUserId && !n.ValidFlag && n.DeletedDateTime.HasValue)
            .CountAsync();

        // Assert
        testUserDeletedNotes.Should().Be(1);
        otherUserDeletedNotes.Should().Be(1);
    }

    /// <summary>
    /// 測試：永久刪除項目從資料庫移除。
    /// </summary>
    [Fact]
    public async Task PermanentlyDeleteItem_RemovesFromDatabase()
    {
        // Arrange
        var note = new Note
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Title = "待永久刪除",
            Slug = "permanent-delete",
            ContentRaw = "內容",
            ContentHtml = "<p>內容</p>",
            ContentHash = "hash",
            IsDraft = false,
            Kind = "note",
            CreatedDateTime = DateTime.UtcNow,
            UpdatedDateTime = DateTime.UtcNow,
            CreatedUser = _testUserId.ToString(),
            UpdatedUser = _testUserId.ToString(),
            ValidFlag = false,
            DeletedDateTime = DateTime.UtcNow
        };
        _db.Note.Add(note);
        await _db.SaveChangesAsync();
        var noteId = note.Id;

        // Act
        _db.Note.Remove(note);
        await _db.SaveChangesAsync();

        // Assert
        var deletedNote = await _db.Note.FirstOrDefaultAsync(n => n.Id == noteId);
        deletedNote.Should().BeNull();
    }
}
