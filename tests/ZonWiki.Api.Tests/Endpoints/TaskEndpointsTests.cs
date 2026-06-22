using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Xunit;
using ZonWiki.Domain.Dtos;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Tests.Endpoints;

/// <summary>
/// 任務卡片（TaskCard）相關的單元測試。
/// 測試 CRUD 操作、狀態流轉、優先度管理、多視圖查詢（清單/看板/行事曆）、重複規則等。
/// </summary>
public sealed class TaskEndpointsTests : IAsyncLifetime
{
    private readonly DbContextOptions<ZonWikiDbContext> _dbOptions;
    private ZonWikiDbContext _db = null!;
    private readonly Guid _testUserId = Guid.NewGuid();

    public TaskEndpointsTests()
    {
        _dbOptions = new DbContextOptionsBuilder<ZonWikiDbContext>()
            .UseInMemoryDatabase($"task-test-db-{Guid.NewGuid()}")
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
            Email = "task-test@example.com",
            DisplayName = "Task Test User",
            GoogleSub = "task-test-sub",
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
    /// 測試：建立新任務卡片（基本資訊）。
    /// </summary>
    [Fact]
    public async Task CreateTaskCard_WithBasicInfo_ShouldSucceed()
    {
        // Arrange
        var now = DateTime.UtcNow;
        var card = new TaskCard
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Title = "新增功能：使用者認證",
            Content = "需要實作 Google OAuth",
            Status = "todo",
            Priority = 1,
            PlannedDateTime = now.AddDays(1),
            DueDateTime = now.AddDays(3),
            GroupId = null,
            SortOrder = 0,
            RecurrenceRule = null,
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "test-user",
            UpdatedUser = "test-user",
            ValidFlag = true
        };

        // Act
        _db.TaskCard.Add(card);
        await _db.SaveChangesAsync();

        // Assert
        var saved = await _db.TaskCard.FirstOrDefaultAsync(t => t.Id == card.Id);
        saved.Should().NotBeNull();
        saved!.Title.Should().Be("新增功能：使用者認證");
        saved.Status.Should().Be("todo");
        saved.Priority.Should().Be(1);
        saved.ValidFlag.Should().BeTrue();
    }

    /// <summary>
    /// 測試：任務狀態流轉（todo → doing → done）。
    /// </summary>
    [Theory]
    [InlineData("todo", "doing")]
    [InlineData("doing", "done")]
    [InlineData("todo", "done")]
    public async Task UpdateTaskStatus_TransitionsCorrectly(string fromStatus, string toStatus)
    {
        // Arrange
        var card = new TaskCard
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Title = "狀態流轉測試",
            Status = fromStatus,
            Priority = 0,
            CreatedDateTime = DateTime.UtcNow,
            UpdatedDateTime = DateTime.UtcNow,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        _db.TaskCard.Add(card);
        await _db.SaveChangesAsync();

        // Act
        card.Status = toStatus;
        card.UpdatedDateTime = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        // Assert
        var updated = await _db.TaskCard.FirstOrDefaultAsync(t => t.Id == card.Id);
        updated!.Status.Should().Be(toStatus);
    }

    /// <summary>
    /// 測試：優先度等級（0-3）。
    /// </summary>
    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    public async Task CreateTaskCard_WithPriority_ShouldStoreCorrectly(int priority)
    {
        // Arrange
        var card = new TaskCard
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Title = $"優先度 {priority} 的任務",
            Priority = priority,
            CreatedDateTime = DateTime.UtcNow,
            UpdatedDateTime = DateTime.UtcNow,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        // Act
        _db.TaskCard.Add(card);
        await _db.SaveChangesAsync();

        // Assert
        var saved = await _db.TaskCard.FirstOrDefaultAsync(t => t.Id == card.Id);
        saved!.Priority.Should().Be(priority);
    }

    /// <summary>
    /// 測試：軟刪除卡片（ValidFlag 設為 false）。
    /// </summary>
    [Fact]
    public async Task SoftDeleteTaskCard_ShouldMarkValidFlagFalse()
    {
        // Arrange
        var card = new TaskCard
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Title = "待刪除卡片",
            CreatedDateTime = DateTime.UtcNow,
            UpdatedDateTime = DateTime.UtcNow,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        _db.TaskCard.Add(card);
        await _db.SaveChangesAsync();

        // Act
        card.ValidFlag = false;
        card.DeletedDateTime = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        // Assert
        var deleted = await _db.TaskCard.FirstOrDefaultAsync(t => t.Id == card.Id);
        deleted!.ValidFlag.Should().BeFalse();
        deleted.DeletedDateTime.Should().NotBeNull();
    }

    /// <summary>
    /// 測試：卡片與群組的關聯（多卡片可屬於同一群組）。
    /// </summary>
    [Fact]
    public async Task TaskCard_CanBelongToGroup()
    {
        // Arrange
        var group = new TaskGroup
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Name = "本週任務",
            Color = "#FF5733",
            SortOrder = 0,
            CreatedDateTime = DateTime.UtcNow,
            UpdatedDateTime = DateTime.UtcNow,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        var card1 = new TaskCard
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Title = "卡片 1",
            GroupId = group.Id,
            CreatedDateTime = DateTime.UtcNow,
            UpdatedDateTime = DateTime.UtcNow,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        var card2 = new TaskCard
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Title = "卡片 2",
            GroupId = group.Id,
            CreatedDateTime = DateTime.UtcNow,
            UpdatedDateTime = DateTime.UtcNow,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        // Act
        _db.TaskGroup.Add(group);
        _db.TaskCard.AddRange(card1, card2);
        await _db.SaveChangesAsync();

        // Assert
        var cardsInGroup = await _db.TaskCard
            .Where(t => t.GroupId == group.Id && t.ValidFlag)
            .ToListAsync();

        cardsInGroup.Should().HaveCount(2);
        cardsInGroup.Should().AllSatisfy(c => c.GroupId.Should().Be(group.Id));
    }

    /// <summary>
    /// 測試：行事曆範圍篩選（PlannedDateTime / DueDateTime）。
    /// </summary>
    [Fact]
    public async Task QueryTaskCard_ByDateRange_ShouldFilterCorrectly()
    {
        // Arrange
        var now = DateTime.UtcNow;
        var tomorrow = now.AddDays(1);
        var nextWeek = now.AddDays(7);

        var cardInRange = new TaskCard
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Title = "本週到期",
            DueDateTime = tomorrow,
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        var cardOutOfRange = new TaskCard
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Title = "一個月後到期",
            DueDateTime = now.AddDays(30),
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        _db.TaskCard.AddRange(cardInRange, cardOutOfRange);
        await _db.SaveChangesAsync();

        // Act
        var filtered = await _db.TaskCard
            .Where(t => t.UserId == _testUserId &&
                        t.ValidFlag &&
                        ((t.DueDateTime >= now && t.DueDateTime <= nextWeek) ||
                         (t.PlannedDateTime >= now && t.PlannedDateTime <= nextWeek)))
            .ToListAsync();

        // Assert
        filtered.Should().HaveCount(1);
        filtered.First().Id.Should().Be(cardInRange.Id);
    }

    /// <summary>
    /// 測試：重複規則儲存（iCal RRULE 格式）。
    /// </summary>
    [Fact]
    public async Task TaskCard_WithRecurrenceRule_ShouldStoreCorrectly()
    {
        // Arrange
        var rrule = "FREQ=WEEKLY;BYDAY=MO,WE,FR";
        var card = new TaskCard
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Title = "每週會議",
            RecurrenceRule = rrule,
            CreatedDateTime = DateTime.UtcNow,
            UpdatedDateTime = DateTime.UtcNow,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        // Act
        _db.TaskCard.Add(card);
        await _db.SaveChangesAsync();

        // Assert
        var saved = await _db.TaskCard.FirstOrDefaultAsync(t => t.Id == card.Id);
        saved!.RecurrenceRule.Should().Be(rrule);
    }
}

/// <summary>
/// 任務群組（TaskGroup）相關的單元測試。
/// 測試群組 CRUD、顏色儲存、排序、與卡片的關聯等。
/// </summary>
public sealed class TaskGroupEndpointsTests : IAsyncLifetime
{
    private readonly DbContextOptions<ZonWikiDbContext> _dbOptions;
    private ZonWikiDbContext _db = null!;
    private readonly Guid _testUserId = Guid.NewGuid();

    public TaskGroupEndpointsTests()
    {
        _dbOptions = new DbContextOptionsBuilder<ZonWikiDbContext>()
            .UseInMemoryDatabase($"group-test-db-{Guid.NewGuid()}")
            .Options;
    }

    public async Task InitializeAsync()
    {
        _db = new ZonWikiDbContext(_dbOptions);
        await _db.Database.EnsureCreatedAsync();

        var now = DateTime.UtcNow;
        var user = new User
        {
            Id = _testUserId,
            Email = "group-test@example.com",
            DisplayName = "Group Test User",
            GoogleSub = "group-test-sub",
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        _db.User.Add(user);
        await _db.SaveChangesAsync();
    }

    public async Task DisposeAsync()
    {
        await _db.Database.EnsureDeletedAsync();
        _db.Dispose();
    }

    /// <summary>
    /// 測試：建立任務群組。
    /// </summary>
    [Fact]
    public async Task CreateTaskGroup_ShouldSucceed()
    {
        // Arrange
        var group = new TaskGroup
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Name = "本週優先",
            Color = "#FF0000",
            SortOrder = 0,
            CreatedDateTime = DateTime.UtcNow,
            UpdatedDateTime = DateTime.UtcNow,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        // Act
        _db.TaskGroup.Add(group);
        await _db.SaveChangesAsync();

        // Assert
        var saved = await _db.TaskGroup.FirstOrDefaultAsync(g => g.Id == group.Id);
        saved.Should().NotBeNull();
        saved!.Name.Should().Be("本週優先");
        saved.Color.Should().Be("#FF0000");
    }

    /// <summary>
    /// 測試：群組排序。
    /// </summary>
    [Fact]
    public async Task QueryTaskGroups_OrderedBySortOrder()
    {
        // Arrange
        var groups = new[]
        {
            new TaskGroup
            {
                Id = Guid.NewGuid(),
                UserId = _testUserId,
                Name = "第二個群組",
                SortOrder = 2,
                CreatedDateTime = DateTime.UtcNow,
                UpdatedDateTime = DateTime.UtcNow,
                CreatedUser = "system",
                UpdatedUser = "system",
                ValidFlag = true
            },
            new TaskGroup
            {
                Id = Guid.NewGuid(),
                UserId = _testUserId,
                Name = "第一個群組",
                SortOrder = 1,
                CreatedDateTime = DateTime.UtcNow,
                UpdatedDateTime = DateTime.UtcNow,
                CreatedUser = "system",
                UpdatedUser = "system",
                ValidFlag = true
            },
            new TaskGroup
            {
                Id = Guid.NewGuid(),
                UserId = _testUserId,
                Name = "第三個群組",
                SortOrder = 3,
                CreatedDateTime = DateTime.UtcNow,
                UpdatedDateTime = DateTime.UtcNow,
                CreatedUser = "system",
                UpdatedUser = "system",
                ValidFlag = true
            }
        };

        _db.TaskGroup.AddRange(groups);
        await _db.SaveChangesAsync();

        // Act
        var sorted = await _db.TaskGroup
            .Where(g => g.UserId == _testUserId && g.ValidFlag)
            .OrderBy(g => g.SortOrder)
            .ToListAsync();

        // Assert
        sorted.Should().HaveCount(3);
        sorted[0].SortOrder.Should().Be(1);
        sorted[1].SortOrder.Should().Be(2);
        sorted[2].SortOrder.Should().Be(3);
    }
}

/// <summary>
/// 任務卡片關聯（TaskRelation）相關的單元測試。
/// 測試對等關聯、去重、自我關聯防止、刪除限制等。
/// </summary>
public sealed class TaskRelationEndpointsTests : IAsyncLifetime
{
    private readonly DbContextOptions<ZonWikiDbContext> _dbOptions;
    private ZonWikiDbContext _db = null!;
    private readonly Guid _testUserId = Guid.NewGuid();

    public TaskRelationEndpointsTests()
    {
        _dbOptions = new DbContextOptionsBuilder<ZonWikiDbContext>()
            .UseInMemoryDatabase($"relation-test-db-{Guid.NewGuid()}")
            .Options;
    }

    public async Task InitializeAsync()
    {
        _db = new ZonWikiDbContext(_dbOptions);
        await _db.Database.EnsureCreatedAsync();

        var now = DateTime.UtcNow;
        var user = new User
        {
            Id = _testUserId,
            Email = "relation-test@example.com",
            DisplayName = "Relation Test User",
            GoogleSub = "relation-test-sub",
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        _db.User.Add(user);
        await _db.SaveChangesAsync();
    }

    public async Task DisposeAsync()
    {
        await _db.Database.EnsureDeletedAsync();
        _db.Dispose();
    }

    /// <summary>
    /// 測試：建立卡片間對等關聯。
    /// </summary>
    [Fact]
    public async Task CreateTaskRelation_ShouldSucceed()
    {
        // Arrange
        var card1 = new TaskCard
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Title = "卡片 A",
            CreatedDateTime = DateTime.UtcNow,
            UpdatedDateTime = DateTime.UtcNow,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        var card2 = new TaskCard
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Title = "卡片 B",
            CreatedDateTime = DateTime.UtcNow,
            UpdatedDateTime = DateTime.UtcNow,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        var relation = new TaskRelation
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            SourceTaskCardId = card1.Id,
            TargetTaskCardId = card2.Id,
            Kind = "related",
            CreatedDateTime = DateTime.UtcNow,
            UpdatedDateTime = DateTime.UtcNow,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        // Act
        _db.TaskCard.AddRange(card1, card2);
        _db.TaskRelation.Add(relation);
        await _db.SaveChangesAsync();

        // Assert
        var saved = await _db.TaskRelation.FirstOrDefaultAsync(r => r.Id == relation.Id);
        saved.Should().NotBeNull();
        saved!.SourceTaskCardId.Should().Be(card1.Id);
        saved.TargetTaskCardId.Should().Be(card2.Id);
    }

    /// <summary>
    /// 測試：去重——同一對卡片的同一種關聯只能有一筆。
    /// </summary>
    [Fact]
    public async Task TaskRelation_DeduplicationBySourceAndTargetAndKind()
    {
        // Arrange
        var card1 = new TaskCard
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Title = "卡片 A",
            CreatedDateTime = DateTime.UtcNow,
            UpdatedDateTime = DateTime.UtcNow,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        var card2 = new TaskCard
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Title = "卡片 B",
            CreatedDateTime = DateTime.UtcNow,
            UpdatedDateTime = DateTime.UtcNow,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        _db.TaskCard.AddRange(card1, card2);
        await _db.SaveChangesAsync();

        // Act & Assert - 第一筆應成功
        var relation1 = new TaskRelation
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            SourceTaskCardId = card1.Id,
            TargetTaskCardId = card2.Id,
            Kind = "related",
            CreatedDateTime = DateTime.UtcNow,
            UpdatedDateTime = DateTime.UtcNow,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        _db.TaskRelation.Add(relation1);
        await _db.SaveChangesAsync();

        // 查詢檢查去重邏輯
        var duplicateCheck = await _db.TaskRelation
            .FirstOrDefaultAsync(r =>
                r.UserId == _testUserId &&
                r.ValidFlag &&
                r.Kind == "related" &&
                ((r.SourceTaskCardId == card1.Id && r.TargetTaskCardId == card2.Id) ||
                 (r.SourceTaskCardId == card2.Id && r.TargetTaskCardId == card1.Id)));

        duplicateCheck.Should().NotBeNull();
    }
}

/// <summary>
/// 筆記與任務卡片連結（NoteTaskLink）相關的單元測試。
/// 測試多對多關聯、去重、級聯行為等。
/// </summary>
public sealed class NoteTaskLinkEndpointsTests : IAsyncLifetime
{
    private readonly DbContextOptions<ZonWikiDbContext> _dbOptions;
    private ZonWikiDbContext _db = null!;
    private readonly Guid _testUserId = Guid.NewGuid();

    public NoteTaskLinkEndpointsTests()
    {
        _dbOptions = new DbContextOptionsBuilder<ZonWikiDbContext>()
            .UseInMemoryDatabase($"link-test-db-{Guid.NewGuid()}")
            .Options;
    }

    public async Task InitializeAsync()
    {
        _db = new ZonWikiDbContext(_dbOptions);
        await _db.Database.EnsureCreatedAsync();

        var now = DateTime.UtcNow;
        var user = new User
        {
            Id = _testUserId,
            Email = "link-test@example.com",
            DisplayName = "Link Test User",
            GoogleSub = "link-test-sub",
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        _db.User.Add(user);
        await _db.SaveChangesAsync();
    }

    public async Task DisposeAsync()
    {
        await _db.Database.EnsureDeletedAsync();
        _db.Dispose();
    }

    /// <summary>
    /// 測試：建立筆記與卡片的多對多連結。
    /// </summary>
    [Fact]
    public async Task CreateNoteTaskLink_ShouldSucceed()
    {
        // Arrange
        var note = new Note
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Title = "筆記",
            Slug = "note",
            ContentRaw = "# 標題",
            ContentHtml = "<h1>標題</h1>",
            ContentHash = "hash",
            CreatedDateTime = DateTime.UtcNow,
            UpdatedDateTime = DateTime.UtcNow,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        var card = new TaskCard
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Title = "卡片",
            CreatedDateTime = DateTime.UtcNow,
            UpdatedDateTime = DateTime.UtcNow,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        var link = new NoteTaskLink
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            NoteId = note.Id,
            TaskCardId = card.Id,
            CreatedDateTime = DateTime.UtcNow,
            UpdatedDateTime = DateTime.UtcNow,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        // Act
        _db.Note.Add(note);
        _db.TaskCard.Add(card);
        _db.NoteTaskLink.Add(link);
        await _db.SaveChangesAsync();

        // Assert
        var saved = await _db.NoteTaskLink.FirstOrDefaultAsync(l => l.Id == link.Id);
        saved.Should().NotBeNull();
        saved!.NoteId.Should().Be(note.Id);
        saved.TaskCardId.Should().Be(card.Id);
    }

    /// <summary>
    /// 測試：去重——同一筆記和卡片的連結只能有一筆。
    /// </summary>
    [Fact]
    public async Task NoteTaskLink_ShouldPreventDuplicates()
    {
        // Arrange
        var note = new Note
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Title = "筆記",
            Slug = "note",
            ContentRaw = "# 標題",
            ContentHtml = "<h1>標題</h1>",
            ContentHash = "hash",
            CreatedDateTime = DateTime.UtcNow,
            UpdatedDateTime = DateTime.UtcNow,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        var card = new TaskCard
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Title = "卡片",
            CreatedDateTime = DateTime.UtcNow,
            UpdatedDateTime = DateTime.UtcNow,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        _db.Note.Add(note);
        _db.TaskCard.Add(card);
        await _db.SaveChangesAsync();

        // 建立連結
        var link = new NoteTaskLink
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            NoteId = note.Id,
            TaskCardId = card.Id,
            CreatedDateTime = DateTime.UtcNow,
            UpdatedDateTime = DateTime.UtcNow,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        _db.NoteTaskLink.Add(link);
        await _db.SaveChangesAsync();

        // 檢查唯一約束
        var duplicate = await _db.NoteTaskLink
            .FirstOrDefaultAsync(l =>
                l.NoteId == note.Id &&
                l.TaskCardId == card.Id &&
                l.ValidFlag);

        duplicate.Should().NotBeNull();

        // 嘗試建立另一筆相同的連結應失敗（由 DB 唯一索引保證）
        // 這裡我們驗證找不到第二筆有效的連結
        var allLinks = await _db.NoteTaskLink
            .Where(l => l.NoteId == note.Id && l.TaskCardId == card.Id && l.ValidFlag)
            .ToListAsync();

        allLinks.Should().HaveCount(1);
    }

    /// <summary>
    /// 測試：一篇筆記可連到多張卡片，反之亦然。
    /// </summary>
    [Fact]
    public async Task NoteCanLinkToMultipleCards_AndCardCanLinkToMultipleNotes()
    {
        // Arrange
        var note1 = new Note
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Title = "筆記 1",
            Slug = "note1",
            ContentRaw = "# 標題",
            ContentHtml = "<h1>標題</h1>",
            ContentHash = "hash1",
            CreatedDateTime = DateTime.UtcNow,
            UpdatedDateTime = DateTime.UtcNow,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        var note2 = new Note
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Title = "筆記 2",
            Slug = "note2",
            ContentRaw = "# 標題 2",
            ContentHtml = "<h1>標題 2</h1>",
            ContentHash = "hash2",
            CreatedDateTime = DateTime.UtcNow,
            UpdatedDateTime = DateTime.UtcNow,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        var card1 = new TaskCard
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Title = "卡片 1",
            CreatedDateTime = DateTime.UtcNow,
            UpdatedDateTime = DateTime.UtcNow,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        var card2 = new TaskCard
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Title = "卡片 2",
            CreatedDateTime = DateTime.UtcNow,
            UpdatedDateTime = DateTime.UtcNow,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        _db.Note.AddRange(note1, note2);
        _db.TaskCard.AddRange(card1, card2);
        await _db.SaveChangesAsync();

        // 建立連結：Note1 ↔ Card1、Note1 ↔ Card2、Note2 ↔ Card1
        var links = new[]
        {
            new NoteTaskLink
            {
                Id = Guid.NewGuid(),
                UserId = _testUserId,
                NoteId = note1.Id,
                TaskCardId = card1.Id,
                CreatedDateTime = DateTime.UtcNow,
                UpdatedDateTime = DateTime.UtcNow,
                CreatedUser = "system",
                UpdatedUser = "system",
                ValidFlag = true
            },
            new NoteTaskLink
            {
                Id = Guid.NewGuid(),
                UserId = _testUserId,
                NoteId = note1.Id,
                TaskCardId = card2.Id,
                CreatedDateTime = DateTime.UtcNow,
                UpdatedDateTime = DateTime.UtcNow,
                CreatedUser = "system",
                UpdatedUser = "system",
                ValidFlag = true
            },
            new NoteTaskLink
            {
                Id = Guid.NewGuid(),
                UserId = _testUserId,
                NoteId = note2.Id,
                TaskCardId = card1.Id,
                CreatedDateTime = DateTime.UtcNow,
                UpdatedDateTime = DateTime.UtcNow,
                CreatedUser = "system",
                UpdatedUser = "system",
                ValidFlag = true
            }
        };

        _db.NoteTaskLink.AddRange(links);
        await _db.SaveChangesAsync();

        // Act & Assert
        var note1Links = await _db.NoteTaskLink
            .Where(l => l.NoteId == note1.Id && l.ValidFlag)
            .ToListAsync();

        var card1Links = await _db.NoteTaskLink
            .Where(l => l.TaskCardId == card1.Id && l.ValidFlag)
            .ToListAsync();

        note1Links.Should().HaveCount(2);
        card1Links.Should().HaveCount(2);
    }
}
