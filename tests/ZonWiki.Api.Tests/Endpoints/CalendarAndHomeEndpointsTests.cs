using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Xunit;
using ZonWiki.Domain.Dtos;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Tests.Endpoints;

/// <summary>
/// 行事曆（Calendar）與首頁聚合（HomePage）相關的單元測試。
/// 測試時間範圍查詢、當週資料聚合、今日待辦篩選等。
/// </summary>
public sealed class CalendarAndHomeEndpointsTests : IAsyncLifetime
{
    private readonly DbContextOptions<ZonWikiDbContext> _dbOptions;
    private ZonWikiDbContext _db = null!;
    private readonly Guid _testUserId = Guid.NewGuid();

    public CalendarAndHomeEndpointsTests()
    {
        _dbOptions = new DbContextOptionsBuilder<ZonWikiDbContext>()
            .UseInMemoryDatabase($"calendar-home-test-db-{Guid.NewGuid()}")
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
            Email = "calendar-test@example.com",
            DisplayName = "Calendar Test User",
            GoogleSub = "calendar-test-sub",
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
    /// 測試：查詢時間範圍內的任務卡片（依計劃時間）。
    /// </summary>
    [Fact]
    public async Task QueryCalendar_WithTasksByPlannedDate_ShouldReturnInRange()
    {
        // Arrange
        var now = DateTime.UtcNow;
        var startDate = now.AddDays(1);
        var endDate = now.AddDays(7);

        var taskInRange = new TaskCard
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Title = "範圍內的任務",
            Content = "",
            Status = "todo",
            Priority = 0,
            PlannedDateTime = now.AddDays(3),
            DueDateTime = null,
            SortOrder = 0,
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        var taskOutOfRange = new TaskCard
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Title = "範圍外的任務",
            Content = "",
            Status = "todo",
            Priority = 0,
            PlannedDateTime = now.AddDays(20),
            DueDateTime = null,
            SortOrder = 0,
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        _db.TaskCard.AddRange(taskInRange, taskOutOfRange);
        await _db.SaveChangesAsync();

        // Act
        var tasksInRange = await _db.TaskCard
            .Where(t =>
                t.UserId == _testUserId &&
                t.ValidFlag &&
                ((t.PlannedDateTime.HasValue && t.PlannedDateTime >= startDate && t.PlannedDateTime < endDate) ||
                 (t.DueDateTime.HasValue && t.DueDateTime >= startDate && t.DueDateTime < endDate)))
            .ToListAsync();

        // Assert
        tasksInRange.Should().HaveCount(1);
        tasksInRange[0].Id.Should().Be(taskInRange.Id);
    }

    /// <summary>
    /// 測試：查詢時間範圍內的日記（Kind = journal）。
    /// </summary>
    [Fact]
    public async Task QueryCalendar_WithJournalNotes_ShouldReturnInDateRange()
    {
        // Arrange
        var now = DateTime.UtcNow;
        var startDate = now.AddDays(1).Date;
        var endDate = now.AddDays(7).Date;

        var journalInRange = new Note
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Title = "範圍內的日記",
            Slug = "journal-in-range",
            ContentRaw = "",
            ContentHtml = "",
            ContentHash = "",
            SourceFilePath = null,
            IsDraft = false,
            Kind = "journal",
            JournalDate = now.AddDays(3).Date,
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        var journalOutOfRange = new Note
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Title = "範圍外的日記",
            Slug = "journal-out-of-range",
            ContentRaw = "",
            ContentHtml = "",
            ContentHash = "",
            SourceFilePath = null,
            IsDraft = false,
            Kind = "journal",
            JournalDate = now.AddDays(20).Date,
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        _db.Note.AddRange(journalInRange, journalOutOfRange);
        await _db.SaveChangesAsync();

        // Act
        var journalsInRange = await _db.Note
            .Where(n =>
                n.UserId == _testUserId &&
                n.ValidFlag &&
                n.Kind == "journal" &&
                n.JournalDate.HasValue &&
                n.JournalDate >= startDate &&
                n.JournalDate <= endDate)
            .ToListAsync();

        // Assert
        journalsInRange.Should().HaveCount(1);
        journalsInRange[0].Id.Should().Be(journalInRange.Id);
    }

    /// <summary>
    /// 測試：首頁聚合 - 當週任務與日記。
    /// </summary>
    [Fact]
    public async Task HomePageAggregate_ShouldIncludeWeeklyData()
    {
        // Arrange
        var now = DateTime.UtcNow;
        var weekStart = GetWeekStart(now);
        var weekEnd = weekStart.AddDays(7);

        var weeklyTask = new TaskCard
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Title = "本週任務",
            Content = "",
            Status = "todo",
            Priority = 1,
            PlannedDateTime = now.AddDays(2),
            DueDateTime = null,
            SortOrder = 0,
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        var weeklyJournal = new Note
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Title = "本週日記",
            Slug = "weekly-journal",
            ContentRaw = "",
            ContentHtml = "",
            ContentHash = "",
            SourceFilePath = null,
            IsDraft = false,
            Kind = "journal",
            JournalDate = now.AddDays(1).Date,
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        _db.TaskCard.Add(weeklyTask);
        _db.Note.Add(weeklyJournal);
        await _db.SaveChangesAsync();

        // Act
        var weeklyTasks = await _db.TaskCard
            .Where(t =>
                t.UserId == _testUserId &&
                t.ValidFlag &&
                ((t.PlannedDateTime.HasValue && t.PlannedDateTime >= weekStart && t.PlannedDateTime < weekEnd) ||
                 (t.DueDateTime.HasValue && t.DueDateTime >= weekStart && t.DueDateTime < weekEnd)))
            .ToListAsync();

        var weeklyJournals = await _db.Note
            .Where(n =>
                n.UserId == _testUserId &&
                n.ValidFlag &&
                n.Kind == "journal" &&
                n.JournalDate.HasValue &&
                n.JournalDate >= weekStart.Date &&
                n.JournalDate <= weekEnd.Date)
            .ToListAsync();

        // Assert
        weeklyTasks.Should().HaveCount(1);
        weeklyJournals.Should().HaveCount(1);
    }

    /// <summary>
    /// 測試：首頁聚合 - 今日待辦（status = todo|doing）。
    /// </summary>
    [Fact]
    public async Task HomePageAggregate_TodayTodos_ShouldOnlyReturnTodoAndDoingStatus()
    {
        // Arrange
        var now = DateTime.UtcNow;
        var todayDate = now.Date;

        var todoTask = new TaskCard
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Title = "今日待辦 (todo)",
            Content = "",
            Status = "todo",
            Priority = 1,
            PlannedDateTime = now,
            DueDateTime = null,
            SortOrder = 0,
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        var doingTask = new TaskCard
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Title = "進行中 (doing)",
            Content = "",
            Status = "doing",
            Priority = 0,
            PlannedDateTime = now,
            DueDateTime = null,
            SortOrder = 0,
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        var doneTask = new TaskCard
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Title = "已完成 (done)",
            Content = "",
            Status = "done",
            Priority = 0,
            PlannedDateTime = now,
            DueDateTime = null,
            SortOrder = 0,
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        _db.TaskCard.AddRange(todoTask, doingTask, doneTask);
        await _db.SaveChangesAsync();

        // Act
        var todayTodos = await _db.TaskCard
            .Where(t =>
                t.UserId == _testUserId &&
                t.ValidFlag &&
                (t.Status == "todo" || t.Status == "doing") &&
                ((t.PlannedDateTime.HasValue && t.PlannedDateTime.Value.Date == todayDate) ||
                 (t.DueDateTime.HasValue && t.DueDateTime.Value.Date == todayDate)))
            .ToListAsync();

        // Assert
        todayTodos.Should().HaveCount(2);
        todayTodos.Should().Contain(t => t.Status == "todo");
        todayTodos.Should().Contain(t => t.Status == "doing");
        todayTodos.Should().NotContain(t => t.Status == "done");
    }

    /// <summary>
    /// 測試：首頁聚合 - 常用連結卡（依排序序號）。
    /// </summary>
    [Fact]
    public async Task HomePageAggregate_QuickLinks_ShouldBeOrderedBySortOrder()
    {
        // Arrange
        var now = DateTime.UtcNow;

        var link1 = new QuickLink
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Title = "第一個連結",
            Url = "https://example.com/1",
            SortOrder = 0,
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        var link2 = new QuickLink
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Title = "第二個連結",
            Url = "https://example.com/2",
            SortOrder = 1,
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        _db.QuickLink.AddRange(link1, link2);
        await _db.SaveChangesAsync();

        // Act
        var quickLinks = await _db.QuickLink
            .Where(ql => ql.UserId == _testUserId && ql.ValidFlag)
            .OrderBy(ql => ql.SortOrder)
            .ToListAsync();

        // Assert
        quickLinks.Should().HaveCount(2);
        quickLinks[0].Id.Should().Be(link1.Id);
        quickLinks[1].Id.Should().Be(link2.Id);
    }

    /// <summary>
    /// 測試：首頁聚合 - 最近 5 個捕捉項目。
    /// </summary>
    [Fact]
    public async Task HomePageAggregate_RecentCaptures_ShouldReturnLatestFive()
    {
        // Arrange
        var now = DateTime.UtcNow;

        var captures = new List<CaptureItem>();
        for (int i = 0; i < 7; i++)
        {
            captures.Add(new CaptureItem
            {
                Id = Guid.NewGuid(),
                UserId = _testUserId,
                Source = "web",
                RawContent = $"捕捉項目 {i + 1}",
                Status = "inbox",
                CreatedDateTime = now.AddHours(-i),
                UpdatedDateTime = now.AddHours(-i),
                CreatedUser = "system",
                UpdatedUser = "system",
                ValidFlag = true
            });
        }

        _db.CaptureItem.AddRange(captures);
        await _db.SaveChangesAsync();

        // Act
        var recentCaptures = await _db.CaptureItem
            .Where(ci => ci.UserId == _testUserId && ci.ValidFlag)
            .OrderByDescending(ci => ci.CreatedDateTime)
            .Take(5)
            .ToListAsync();

        // Assert
        recentCaptures.Should().HaveCount(5);
        // 應該是最新的 5 個（i = 0-4）
        recentCaptures.All(c => c.RawContent.Contains("捕捉項目")).Should().BeTrue();
    }

    /// <summary>
    /// 測試：不同使用者的資料不會混淆。
    /// </summary>
    [Fact]
    public async Task AggregateData_ShouldIsolateByUser()
    {
        // Arrange
        var otherUserId = Guid.NewGuid();
        var now = DateTime.UtcNow;

        var myTask = new TaskCard
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Title = "我的任務",
            Content = "",
            Status = "todo",
            Priority = 0,
            PlannedDateTime = now,
            DueDateTime = null,
            SortOrder = 0,
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        var otherTask = new TaskCard
        {
            Id = Guid.NewGuid(),
            UserId = otherUserId,
            Title = "別人的任務",
            Content = "",
            Status = "todo",
            Priority = 0,
            PlannedDateTime = now,
            DueDateTime = null,
            SortOrder = 0,
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true
        };

        _db.TaskCard.AddRange(myTask, otherTask);
        await _db.SaveChangesAsync();

        // Act
        var myTasks = await _db.TaskCard
            .Where(t => t.UserId == _testUserId && t.ValidFlag)
            .ToListAsync();

        // Assert
        myTasks.Should().HaveCount(1);
        myTasks[0].Id.Should().Be(myTask.Id);
    }

    /// <summary>
    /// 計算給定日期所在週的開始日期（週一）。
    /// </summary>
    /// <param name="date">給定日期。</param>
    /// <returns>該週的週一（UTC）。</returns>
    private static DateTime GetWeekStart(DateTime date)
    {
        int daysFromMonday = (int)date.DayOfWeek - 1;
        if (daysFromMonday < 0)
        {
            daysFromMonday = 6; // Sunday 算前一週週一
        }

        return date.AddDays(-daysFromMonday).Date;
    }
}
