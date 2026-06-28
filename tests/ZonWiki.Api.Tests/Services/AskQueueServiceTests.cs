using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;
using ZonWiki.Api.Services;
using ZonWiki.Domain.Dtos;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Notes;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Tests.Services;

/// <summary>
/// 提問佇列服務單元測試。
/// 測試生命週期狀態轉換、讀取查詢、使用者隔離、以及 ask-selection 完整流程。
/// </summary>
public sealed class AskQueueServiceTests : IAsyncLifetime
{
    private readonly DbContextOptions<ZonWikiDbContext> _dbOptions;
    private ZonWikiDbContext _db = null!;
    private AskQueueService _service = null!;

    private readonly Guid _testUserId = Guid.NewGuid();
    private readonly Guid _otherUserId = Guid.NewGuid();

    public AskQueueServiceTests()
    {
        _dbOptions = new DbContextOptionsBuilder<ZonWikiDbContext>()
            .UseInMemoryDatabase($"test-db-{Guid.NewGuid()}")
            .Options;
    }

    /// <summary>
    /// 初始化測試資料庫、使用者、與服務。
    /// </summary>
    public async Task InitializeAsync()
    {
        _db = new ZonWikiDbContext(_dbOptions);
        await _db.Database.EnsureCreatedAsync();

        // 建立測試使用者。
        var now = DateTime.UtcNow;
        _db.User.AddRange(
            new User
            {
                Id = _testUserId,
                Email = "test@example.com",
                DisplayName = "Test User",
                GoogleSub = "test-sub",
                CreatedDateTime = now,
                UpdatedDateTime = now,
                CreatedUser = "system",
                UpdatedUser = "system",
            },
            new User
            {
                Id = _otherUserId,
                Email = "other@example.com",
                DisplayName = "Other User",
                GoogleSub = "other-sub",
                CreatedDateTime = now,
                UpdatedDateTime = now,
                CreatedUser = "system",
                UpdatedUser = "system",
            });
        await _db.SaveChangesAsync();

        _service = new AskQueueService(_db, NullLogger<AskQueueService>.Instance);
    }

    /// <summary>
    /// 清理測試資料庫。
    /// </summary>
    public async Task DisposeAsync()
    {
        await _db.Database.EnsureDeletedAsync();
        _db.Dispose();
    }

    // ==================== 生命週期純函式測試 ====================

    /// <summary>
    /// 測試：BuildRunningNoteSession 應建立 Running 狀態的 floatingnote 提問。
    /// </summary>
    [Fact]
    public void BuildRunningNoteSession_CreatesSessionWithRunningStatus()
    {
        // Arrange
        var noteId = Guid.NewGuid();
        var question = "What is this?";
        var anchor = "Some text";
        var prompt = "Full prompt";

        // Act
        var session = AskQueueService.BuildRunningNoteSession(_testUserId, noteId, question, anchor, prompt);

        // Assert
        session.UserId.Should().Be(_testUserId);
        session.NoteId.Should().Be(noteId);
        session.QuestionText.Should().Be(question);
        session.AnchorText.Should().Be(anchor);
        session.PromptText.Should().Be(prompt);
        session.Kind.Should().Be("floatingnote");
        session.Status.Should().Be("Running");
        session.AnswerNoteId.Should().BeNull();
        session.MarkId.Should().BeNull();
        session.CreatedUser.Should().Be(_testUserId.ToString());
        session.UpdatedUser.Should().Be(_testUserId.ToString());
    }

    /// <summary>
    /// 測試：QuestionText 與 AnchorText 超過 2000 字應截斷。
    /// </summary>
    [Fact]
    public void BuildRunningNoteSession_TruncatesLongQuestionAndAnchor()
    {
        // Arrange
        var longQuestion = new string('a', 2500);
        var longAnchor = new string('b', 2500);

        // Act
        var session = AskQueueService.BuildRunningNoteSession(
            _testUserId,
            Guid.NewGuid(),
            longQuestion,
            longAnchor,
            "prompt");

        // Assert
        session.QuestionText!.Length.Should().Be(2000);
        session.AnchorText!.Length.Should().Be(2000);
        session.QuestionText.Should().Be(longQuestion[..2000]);
        session.AnchorText.Should().Be(longAnchor[..2000]);
    }

    /// <summary>
    /// 測試：ApplyCompleted 應更新 Status、AnswerNoteId、MarkId、UpdatedDateTime。
    /// </summary>
    [Fact]
    public void ApplyCompleted_UpdatesSessionToCompletedState()
    {
        // Arrange
        var session = AskQueueService.BuildRunningNoteSession(
            _testUserId,
            Guid.NewGuid(),
            "q",
            "a",
            "p");
        var originalCreatedDateTime = session.CreatedDateTime;
        System.Threading.Thread.Sleep(10); // 確保時間差異。

        var answerNoteId = Guid.NewGuid();
        var markId = Guid.NewGuid();

        // Act
        AskQueueService.ApplyCompleted(session, answerNoteId, markId);

        // Assert
        session.Status.Should().Be("Completed");
        session.AnswerNoteId.Should().Be(answerNoteId);
        session.MarkId.Should().Be(markId);
        session.UpdatedDateTime.Should().BeAfter(originalCreatedDateTime);
        session.UpdatedUser.Should().Be(_testUserId.ToString());
    }

    /// <summary>
    /// 測試：ApplyFailed 應設置 Status=Failed，ErrorText 只取第一行且限制 500 字元。
    /// </summary>
    [Fact]
    public void ApplyFailed_SetErrorTextWithSafeMessage()
    {
        // Arrange
        var session = AskQueueService.BuildRunningNoteSession(
            _testUserId,
            Guid.NewGuid(),
            "q",
            "a",
            "p");

        var errorMsg = "First line\nSecond line\nThird line";

        // Act
        AskQueueService.ApplyFailed(session, errorMsg);

        // Assert
        session.Status.Should().Be("Failed");
        session.ErrorText.Should().Be("First line");
        session.ErrorText.Should().NotContain("\n");
    }

    /// <summary>
    /// 測試：ApplyFailed 應截斷長於 500 字的訊息。
    /// </summary>
    [Fact]
    public void ApplyFailed_TruncatesErrorTextTo500Chars()
    {
        // Arrange
        var session = AskQueueService.BuildRunningNoteSession(
            _testUserId,
            Guid.NewGuid(),
            "q",
            "a",
            "p");

        var longError = new string('x', 600);

        // Act
        AskQueueService.ApplyFailed(session, longError);

        // Assert
        session.ErrorText!.Length.Should().Be(500);
        session.ErrorText.Should().Be(longError[..500]);
    }

    /// <summary>
    /// 測試：ApplyFailed 不應包含堆疊追蹤標記或檔案路徑。
    /// </summary>
    [Fact]
    public void ApplyFailed_DoesNotIncludeStackTrace()
    {
        // Arrange
        var session = AskQueueService.BuildRunningNoteSession(
            _testUserId,
            Guid.NewGuid(),
            "q",
            "a",
            "p");

        var exceptionWithStackTrace = "Error message\n   at SomeClass.SomeMethod() in C:\\path\\to\\file.cs:123";

        // Act
        AskQueueService.ApplyFailed(session, exceptionWithStackTrace);

        // Assert
        session.ErrorText.Should().Be("Error message");
        session.ErrorText.Should().NotContain("at ");
        session.ErrorText.Should().NotContain(":");
        session.ErrorText.Should().NotContain("\\");
    }

    // ==================== 讀取查詢測試 ====================

    /// <summary>
    /// 測試：GetQueueAsync 應在空資料時回傳空清單。
    /// </summary>
    [Fact]
    public async Task GetQueueAsync_ReturnsEmptyList_WhenNoSessions()
    {
        // Act
        var items = await _service.GetQueueAsync(_testUserId, ct: CancellationToken.None);

        // Assert
        items.Should().BeEmpty();
    }

    /// <summary>
    /// 測試：GetQueueAsync 應依 CreatedDateTime 由新到舊排序。
    /// </summary>
    [Fact]
    public async Task GetQueueAsync_ReturnsSortedByCreatedDateTimeDescending()
    {
        // Arrange
        var now = DateTime.UtcNow;
        var sessions = new[]
        {
            new AiSession
            {
                UserId = _testUserId,
                Kind = "floatingnote",
                Status = "Running",
                PromptText = "p1",
                CreatedDateTime = now.AddHours(-2),
                CreatedUser = _testUserId.ToString(),
                UpdatedUser = _testUserId.ToString(),
            },
            new AiSession
            {
                UserId = _testUserId,
                Kind = "floatingnote",
                Status = "Running",
                PromptText = "p2",
                CreatedDateTime = now,
                CreatedUser = _testUserId.ToString(),
                UpdatedUser = _testUserId.ToString(),
            },
            new AiSession
            {
                UserId = _testUserId,
                Kind = "floatingnote",
                Status = "Running",
                PromptText = "p3",
                CreatedDateTime = now.AddHours(-1),
                CreatedUser = _testUserId.ToString(),
                UpdatedUser = _testUserId.ToString(),
            },
        };
        _db.AiSession.AddRange(sessions);
        await _db.SaveChangesAsync();

        // Act
        var items = await _service.GetQueueAsync(_testUserId, ct: CancellationToken.None);

        // Assert
        items.Should().HaveCount(3);
        items[0].CreatedDateTime.Should().Be(now);
        items[1].CreatedDateTime.Should().Be(now.AddHours(-1));
        items[2].CreatedDateTime.Should().Be(now.AddHours(-2));
    }

    /// <summary>
    /// 測試：GetQueueAsync 應只回傳本使用者的 session（使用者隔離）。
    /// </summary>
    [Fact]
    public async Task GetQueueAsync_ReturnsOnlyCurrentUserSessions()
    {
        // Arrange
        var now = DateTime.UtcNow;
        _db.AiSession.AddRange(
            new AiSession
            {
                UserId = _testUserId,
                Kind = "floatingnote",
                Status = "Running",
                PromptText = "p1",
                CreatedDateTime = now,
                CreatedUser = _testUserId.ToString(),
                UpdatedUser = _testUserId.ToString(),
            },
            new AiSession
            {
                UserId = _otherUserId,
                Kind = "floatingnote",
                Status = "Running",
                PromptText = "p2",
                CreatedDateTime = now,
                CreatedUser = _otherUserId.ToString(),
                UpdatedUser = _otherUserId.ToString(),
            });
        await _db.SaveChangesAsync();

        // Act
        var items = await _service.GetQueueAsync(_testUserId, ct: CancellationToken.None);

        // Assert
        items.Should().HaveCount(1);
        items[0].SessionId.Should().NotBe(Guid.Empty);
        // 確認只有測試使用者的 session。
        _db.AiSession.Where(s => s.UserId == _testUserId).Should().HaveCount(1);
    }

    /// <summary>
    /// 測試：GetQueueAsync status 篩選應只回傳指定狀態。
    /// </summary>
    [Fact]
    public async Task GetQueueAsync_FiltersByStatus()
    {
        // Arrange
        var now = DateTime.UtcNow;
        _db.AiSession.AddRange(
            new AiSession
            {
                UserId = _testUserId,
                Kind = "floatingnote",
                Status = "Running",
                PromptText = "p1",
                CreatedDateTime = now,
                CreatedUser = _testUserId.ToString(),
                UpdatedUser = _testUserId.ToString(),
            },
            new AiSession
            {
                UserId = _testUserId,
                Kind = "floatingnote",
                Status = "Completed",
                PromptText = "p2",
                CreatedDateTime = now,
                CreatedUser = _testUserId.ToString(),
                UpdatedUser = _testUserId.ToString(),
            },
            new AiSession
            {
                UserId = _testUserId,
                Kind = "floatingnote",
                Status = "Failed",
                PromptText = "p3",
                CreatedDateTime = now,
                CreatedUser = _testUserId.ToString(),
                UpdatedUser = _testUserId.ToString(),
            });
        await _db.SaveChangesAsync();

        // Act
        var runningItems = await _service.GetQueueAsync(
            _testUserId,
            status: "Running",
            ct: CancellationToken.None);
        var completedItems = await _service.GetQueueAsync(
            _testUserId,
            status: "Completed",
            ct: CancellationToken.None);
        var failedItems = await _service.GetQueueAsync(
            _testUserId,
            status: "Failed",
            ct: CancellationToken.None);

        // Assert
        runningItems.Should().HaveCount(1).And.AllSatisfy(i => i.Status.Should().Be("Running"));
        completedItems.Should().HaveCount(1).And.AllSatisfy(i => i.Status.Should().Be("Completed"));
        failedItems.Should().HaveCount(1).And.AllSatisfy(i => i.Status.Should().Be("Failed"));
    }

    /// <summary>
    /// 測試：GetQueueAsync 應忽略無效的 status 值。
    /// </summary>
    [Fact]
    public async Task GetQueueAsync_IgnoresInvalidStatus()
    {
        // Arrange
        var now = DateTime.UtcNow;
        _db.AiSession.Add(new AiSession
        {
            UserId = _testUserId,
            Kind = "floatingnote",
            Status = "Running",
            PromptText = "p1",
            CreatedDateTime = now,
            CreatedUser = _testUserId.ToString(),
            UpdatedUser = _testUserId.ToString(),
        });
        await _db.SaveChangesAsync();

        // Act
        var items = await _service.GetQueueAsync(
            _testUserId,
            status: "InvalidStatus",
            ct: CancellationToken.None);

        // Assert
        items.Should().HaveCount(1); // 應無視無效 status，回傳所有 session。
    }

    /// <summary>
    /// 測試：GetQueueAsync kind 篩選應只回傳指定種類。
    /// </summary>
    [Fact]
    public async Task GetQueueAsync_FiltersByKind()
    {
        // Arrange
        var now = DateTime.UtcNow;
        _db.AiSession.AddRange(
            new AiSession
            {
                UserId = _testUserId,
                Kind = "floatingnote",
                Status = "Running",
                PromptText = "p1",
                CreatedDateTime = now,
                CreatedUser = _testUserId.ToString(),
                UpdatedUser = _testUserId.ToString(),
            },
            new AiSession
            {
                UserId = _testUserId,
                Kind = "node",
                Status = "Running",
                PromptText = "p2",
                CreatedDateTime = now,
                CreatedUser = _testUserId.ToString(),
                UpdatedUser = _testUserId.ToString(),
            });
        await _db.SaveChangesAsync();

        // Act
        var floatingnoteItems = await _service.GetQueueAsync(
            _testUserId,
            kind: "floatingnote",
            ct: CancellationToken.None);
        var nodeItems = await _service.GetQueueAsync(
            _testUserId,
            kind: "node",
            ct: CancellationToken.None);

        // Assert
        floatingnoteItems.Should().HaveCount(1).And.AllSatisfy(i => i.Kind.Should().Be("floatingnote"));
        nodeItems.Should().HaveCount(1).And.AllSatisfy(i => i.Kind.Should().Be("node"));
    }

    /// <summary>
    /// 測試：GetQueueAsync limit 應夾住在 [1, 200] 範圍，預設 50。
    /// </summary>
    [Fact]
    public async Task GetQueueAsync_RespectLimitBoundaries()
    {
        // Arrange
        var now = DateTime.UtcNow;
        for (int i = 0; i < 100; i++)
        {
            _db.AiSession.Add(new AiSession
            {
                UserId = _testUserId,
                Kind = "floatingnote",
                Status = "Running",
                PromptText = $"p{i}",
                CreatedDateTime = now.AddHours(-i),
                CreatedUser = _testUserId.ToString(),
                UpdatedUser = _testUserId.ToString(),
            });
        }
        await _db.SaveChangesAsync();

        // Act
        var defaultItems = await _service.GetQueueAsync(_testUserId, ct: CancellationToken.None);
        var limitOneItems = await _service.GetQueueAsync(_testUserId, limit: 1, ct: CancellationToken.None);
        var limitTwoHundredItems = await _service.GetQueueAsync(_testUserId, limit: 200, ct: CancellationToken.None);
        var limitTooHigh = await _service.GetQueueAsync(_testUserId, limit: 500, ct: CancellationToken.None);

        // Assert
        defaultItems.Should().HaveCount(50); // 預設 50。
        limitOneItems.Should().HaveCount(1);
        limitTwoHundredItems.Should().HaveCount(100); // 實際只有 100。
        limitTooHigh.Should().HaveCount(100); // 夾住到 200，但實際只有 100。
    }

    /// <summary>
    /// 測試：GetQueueAsync 應 LEFT-JOIN 來源筆記與答案筆記，補充 slug/title（可空若筆記已刪）。
    /// </summary>
    [Fact]
    public async Task GetQueueAsync_JoinsSourceAndAnswerNotes()
    {
        // Arrange
        var sourceNote = new Note
        {
            UserId = _testUserId,
            Title = "Source Note",
            Slug = "source-note",
            ContentRaw = "Content",
            ContentHtml = "<p>Content</p>",
            ContentHash = "hash",
            Kind = "note",
            CreatedUser = _testUserId.ToString(),
            UpdatedUser = _testUserId.ToString(),
        };
        var answerNote = new Note
        {
            UserId = _testUserId,
            Title = "Answer Note",
            Slug = "answer-note",
            ContentRaw = "Answer",
            ContentHtml = "<p>Answer</p>",
            ContentHash = "hash2",
            Kind = "note",
            CreatedUser = _testUserId.ToString(),
            UpdatedUser = _testUserId.ToString(),
        };
        _db.Note.AddRange(sourceNote, answerNote);
        await _db.SaveChangesAsync();

        var now = DateTime.UtcNow;
        _db.AiSession.Add(new AiSession
        {
            UserId = _testUserId,
            NoteId = sourceNote.Id,
            AnswerNoteId = answerNote.Id,
            Kind = "floatingnote",
            Status = "Completed",
            PromptText = "p",
            CreatedDateTime = now,
            CreatedUser = _testUserId.ToString(),
            UpdatedUser = _testUserId.ToString(),
        });
        await _db.SaveChangesAsync();

        // Act
        var items = await _service.GetQueueAsync(_testUserId, ct: CancellationToken.None);

        // Assert
        items.Should().HaveCount(1);
        var item = items[0];
        item.NoteId.Should().Be(sourceNote.Id);
        item.NoteSlug.Should().Be("source-note");
        item.NoteTitle.Should().Be("Source Note");
        item.AnswerNoteId.Should().Be(answerNote.Id);
        item.AnswerNoteSlug.Should().Be("answer-note");
    }

    /// <summary>
    /// 測試：GetQueueAsync 應處理已刪除的筆記（回傳 null slug/title）。
    /// </summary>
    [Fact]
    public async Task GetQueueAsync_HandlesDeletedNotes()
    {
        // Arrange
        var now = DateTime.UtcNow;
        _db.AiSession.Add(new AiSession
        {
            UserId = _testUserId,
            NoteId = Guid.NewGuid(), // 不存在的筆記。
            AnswerNoteId = Guid.NewGuid(), // 不存在的筆記。
            Kind = "floatingnote",
            Status = "Running",
            PromptText = "p",
            CreatedDateTime = now,
            CreatedUser = _testUserId.ToString(),
            UpdatedUser = _testUserId.ToString(),
        });
        await _db.SaveChangesAsync();

        // Act
        var items = await _service.GetQueueAsync(_testUserId, ct: CancellationToken.None);

        // Assert
        items.Should().HaveCount(1);
        var item = items[0];
        item.NoteSlug.Should().BeNull();
        item.NoteTitle.Should().BeNull();
        item.AnswerNoteSlug.Should().BeNull();
    }

    /// <summary>
    /// 測試：GetQueueAsync ValidFlag=false 的 session 應不出現。
    /// </summary>
    [Fact]
    public async Task GetQueueAsync_ExcludesSoftDeletedSessions()
    {
        // Arrange
        var now = DateTime.UtcNow;
        _db.AiSession.AddRange(
            new AiSession
            {
                UserId = _testUserId,
                Kind = "floatingnote",
                Status = "Running",
                PromptText = "p1",
                CreatedDateTime = now,
                ValidFlag = true,
                CreatedUser = _testUserId.ToString(),
                UpdatedUser = _testUserId.ToString(),
            },
            new AiSession
            {
                UserId = _testUserId,
                Kind = "floatingnote",
                Status = "Running",
                PromptText = "p2",
                CreatedDateTime = now,
                ValidFlag = false, // 軟刪除。
                CreatedUser = _testUserId.ToString(),
                UpdatedUser = _testUserId.ToString(),
            });
        await _db.SaveChangesAsync();

        // Act
        var items = await _service.GetQueueAsync(_testUserId, ct: CancellationToken.None);

        // Assert
        items.Should().HaveCount(1);
        items[0].Status.Should().Be("Running");
    }

    /// <summary>
    /// 測試：ExecuteAskSelectionAsync 成功時應建立 Completed AiSession + 答案筆記 + NoteMark。
    /// </summary>
    [Fact]
    public async Task ExecuteAskSelectionAsync_SuccessfullySavesAiSessionAndAnswerNote()
    {
        // Arrange
        var sourceNote = new Note
        {
            UserId = _testUserId,
            Title = "Original Note",
            Slug = "original-note",
            ContentRaw = "This is the original content with important information.",
            ContentHtml = "<p>This is the original content with important information.</p>",
            ContentHash = "hash",
            Kind = "note",
            CreatedUser = _testUserId.ToString(),
            UpdatedUser = _testUserId.ToString(),
        };
        _db.Note.Add(sourceNote);
        await _db.SaveChangesAsync();

        var request = new AskSelectionRequest(
            AnchorText: "important information",
            AnchorStart: 35,
            AnchorEnd: 54,
            AnchorPrefix: "with ",
            AnchorSuffix: ".",
            Question: "What is important?");

        var aiService = new FakeNoteAiService(answer: "This is the answer.");

        // Act
        var result = await _service.ExecuteAskSelectionAsync(
            _testUserId,
            sourceNote.Id,
            request,
            aiService,
            CancellationToken.None);

        // Assert
        result.AnswerNoteId.Should().NotBe(Guid.Empty);
        result.AnswerSlug.Should().NotBeNullOrEmpty();
        result.MarkId.Should().NotBe(Guid.Empty);

        // 驗證 AiSession 已建立且為 Completed。
        var session = await _db.AiSession.FirstOrDefaultAsync(s => s.UserId == _testUserId);
        session.Should().NotBeNull();
        session!.Status.Should().Be("Completed");
        session.NoteId.Should().Be(sourceNote.Id);
        session.AnswerNoteId.Should().Be(result.AnswerNoteId);
        session.MarkId.Should().Be(result.MarkId);
        session.QuestionText.Should().Be("What is important?");
        session.AnchorText.Should().Be("important information");

        // 驗證答案筆記已建立。
        var answerNote = await _db.Note.FirstOrDefaultAsync(n => n.Id == result.AnswerNoteId);
        answerNote.Should().NotBeNull();
        answerNote!.Title.Should().Contain("What is important?");
        answerNote.ContentRaw.Should().Contain("Original Note");
        answerNote.ContentRaw.Should().Contain("important information");
        answerNote.ContentRaw.Should().Contain("This is the answer.");

        // 驗證 NoteMark 已建立。
        var mark = await _db.NoteMark.FirstOrDefaultAsync(m => m.Id == result.MarkId);
        mark.Should().NotBeNull();
        mark!.NoteId.Should().Be(sourceNote.Id);
        mark.Kind.Should().Be("link");
        mark.TargetType.Should().Be("note");
        mark.TargetId.Should().Be(result.AnswerNoteId);
    }

    /// <summary>
    /// 測試：ExecuteAskSelectionAsync 失敗時應留下 Failed AiSession 且不建答案筆記。
    /// </summary>
    [Fact]
    public async Task ExecuteAskSelectionAsync_CreatesFailedSessionOnAiFailure()
    {
        // Arrange
        var sourceNote = new Note
        {
            UserId = _testUserId,
            Title = "Original Note",
            Slug = "original-note",
            ContentRaw = "Content",
            ContentHtml = "<p>Content</p>",
            ContentHash = "hash",
            Kind = "note",
            CreatedUser = _testUserId.ToString(),
            UpdatedUser = _testUserId.ToString(),
        };
        _db.Note.Add(sourceNote);
        await _db.SaveChangesAsync();

        var request = new AskSelectionRequest(
            AnchorText: "test",
            AnchorStart: 0,
            AnchorEnd: 4,
            AnchorPrefix: "",
            AnchorSuffix: "",
            Question: "Question?");

        var aiService = new FakeNoteAiService(throwOnAsk: new InvalidOperationException("AI service error"));

        // Act
        var exception = await Assert.ThrowsAsync<InvalidOperationException>(
            () => _service.ExecuteAskSelectionAsync(
                _testUserId,
                sourceNote.Id,
                request,
                aiService,
                CancellationToken.None));

        // Assert
        exception.Message.Should().Be("AI service error");

        // 驗證 AiSession 仍已建立且為 Failed。
        var session = await _db.AiSession.FirstOrDefaultAsync(s => s.UserId == _testUserId);
        session.Should().NotBeNull();
        session!.Status.Should().Be("Failed");
        session.ErrorText.Should().Contain("AI service error");
        session.AnswerNoteId.Should().BeNull();
        session.MarkId.Should().BeNull();

        // 驗證沒有建立答案筆記。
        var answerNotes = await _db.Note
            .Where(n => n.UserId == _testUserId && n.Id != sourceNote.Id)
            .ToListAsync();
        answerNotes.Should().BeEmpty();
    }

    /// <summary>
    /// 測試：ExecuteAskSelectionAsync 應拒絕不存在或不屬於使用者的筆記。
    /// </summary>
    [Fact]
    public async Task ExecuteAskSelectionAsync_RejectsNonexistentNote()
    {
        // Arrange
        var request = new AskSelectionRequest(
            AnchorText: "test",
            AnchorStart: 0,
            AnchorEnd: 4,
            AnchorPrefix: "",
            AnchorSuffix: "",
            Question: "Question?");

        var aiService = new FakeNoteAiService();

        // Act & Assert
        var exception = await Assert.ThrowsAsync<KeyNotFoundException>(
            () => _service.ExecuteAskSelectionAsync(
                _testUserId,
                Guid.NewGuid(), // 不存在。
                request,
                aiService,
                CancellationToken.None));

        exception.Message.Should().Be("Note not found");
    }

    /// <summary>
    /// 測試：ExecuteAskSelectionAsync 應拒絕空白提問。
    /// </summary>
    [Fact]
    public async Task ExecuteAskSelectionAsync_RejectsEmptyQuestion()
    {
        // Arrange
        var sourceNote = new Note
        {
            UserId = _testUserId,
            Title = "Note",
            Slug = "note",
            ContentRaw = "Content",
            ContentHtml = "<p>Content</p>",
            ContentHash = "hash",
            Kind = "note",
            CreatedUser = _testUserId.ToString(),
            UpdatedUser = _testUserId.ToString(),
        };
        _db.Note.Add(sourceNote);
        await _db.SaveChangesAsync();

        var request = new AskSelectionRequest(
            AnchorText: "test",
            AnchorStart: 0,
            AnchorEnd: 4,
            AnchorPrefix: "",
            AnchorSuffix: "",
            Question: "   "); // 空白。

        var aiService = new FakeNoteAiService();

        // Act & Assert
        var exception = await Assert.ThrowsAsync<ArgumentException>(
            () => _service.ExecuteAskSelectionAsync(
                _testUserId,
                sourceNote.Id,
                request,
                aiService,
                CancellationToken.None));

        exception.Message.Should().Contain("Question");
    }

    // ==================== TrackAiAsync（便利貼／美化／排版共用追蹤）測試 ====================

    /// <summary>
    /// 測試：TrackAiAsync 成功時建立 Completed AiSession，並回傳 AI 結果。
    /// </summary>
    [Fact]
    public async Task TrackAiAsync_Success_CreatesCompletedSession()
    {
        // Act
        var result = await _service.TrackAiAsync(
            _testUserId,
            Guid.NewGuid(),
            "beautify",
            "美化筆記",
            null,
            _ => Task.FromResult("beautified content"),
            CancellationToken.None);

        // Assert
        result.Should().Be("beautified content");
        var session = await _db.AiSession.FirstOrDefaultAsync(s => s.UserId == _testUserId);
        session.Should().NotBeNull();
        session!.Status.Should().Be("Completed");
        session.Kind.Should().Be("beautify");
        session.QuestionText.Should().Be("美化筆記");
        session.AnswerNoteId.Should().BeNull();
        session.MarkId.Should().BeNull();
    }

    /// <summary>
    /// 測試：TrackAiAsync 失敗時留下 Failed AiSession（含 ErrorText）並向上拋出原例外。
    /// </summary>
    [Fact]
    public async Task TrackAiAsync_Failure_CreatesFailedSessionAndRethrows()
    {
        // Act & Assert
        var exception = await Assert.ThrowsAsync<InvalidOperationException>(
            () => _service.TrackAiAsync<string>(
                _testUserId,
                Guid.NewGuid(),
                "floatingnote",
                "這段是什麼意思?",
                "框選文字",
                _ => Task.FromException<string>(new InvalidOperationException("AI down")),
                CancellationToken.None));
        exception.Message.Should().Be("AI down");

        var session = await _db.AiSession.FirstOrDefaultAsync(s => s.UserId == _testUserId);
        session.Should().NotBeNull();
        session!.Status.Should().Be("Failed");
        session.Kind.Should().Be("floatingnote");
        session.ErrorText.Should().Contain("AI down");
    }

    // ==================== 逾時保護（孤兒 Running）測試 ====================

    /// <summary>
    /// 測試：Running 但已超過逾時門檻的孤兒，GetQueueAsync 應顯示為 Failed（逾時），不再計入進行中。
    /// </summary>
    [Fact]
    public async Task GetQueueAsync_StaleRunningSession_ShownAsTimedOutFailed()
    {
        // Arrange：10 分鐘前建立、仍 Running 的孤兒（同步 AI 工作不該卡這麼久）。
        var now = DateTime.UtcNow;
        _db.AiSession.Add(new AiSession
        {
            UserId = _testUserId,
            Kind = "floatingnote",
            Status = "Running",
            PromptText = "p",
            QuestionText = "卡住的提問",
            CreatedDateTime = now.AddMinutes(-10),
            CreatedUser = _testUserId.ToString(),
            UpdatedUser = _testUserId.ToString(),
        });
        await _db.SaveChangesAsync();

        // Act
        var items = await _service.GetQueueAsync(_testUserId, ct: CancellationToken.None);

        // Assert：顯示為 Failed（逾時），而非 Running。
        items.Should().HaveCount(1);
        items[0].Status.Should().Be("Failed");
        items[0].ErrorText.Should().Contain("逾時");
    }

    /// <summary>
    /// 測試：Running 且在門檻內（剛建立）的 session，GetQueueAsync 應維持 Running。
    /// </summary>
    [Fact]
    public async Task GetQueueAsync_RecentRunningSession_StaysRunning()
    {
        // Arrange
        var now = DateTime.UtcNow;
        _db.AiSession.Add(new AiSession
        {
            UserId = _testUserId,
            Kind = "floatingnote",
            Status = "Running",
            PromptText = "p",
            QuestionText = "剛問的",
            CreatedDateTime = now,
            CreatedUser = _testUserId.ToString(),
            UpdatedUser = _testUserId.ToString(),
        });
        await _db.SaveChangesAsync();

        // Act
        var items = await _service.GetQueueAsync(_testUserId, ct: CancellationToken.None);

        // Assert
        items.Should().HaveCount(1);
        items[0].Status.Should().Be("Running");
    }

    /// <summary>
    /// 測試替身：可設定的假 AI 服務。
    /// 依建構參數回傳固定答案，或在被呼叫時丟出指定例外（不引入 Moq 等 mock 套件）。
    /// </summary>
    private sealed class FakeNoteAiService : INoteAiService
    {
        private readonly string _answer;
        private readonly Exception? _throwOnAsk;

        /// <summary>
        /// 建立假 AI 服務。
        /// </summary>
        /// <param name="answer">AskAboutAsync 要回傳的固定答案。</param>
        /// <param name="throwOnAsk">若非 null，AskAboutAsync 會丟出此例外。</param>
        public FakeNoteAiService(string answer = "answer", Exception? throwOnAsk = null)
        {
            _answer = answer;
            _throwOnAsk = throwOnAsk;
        }

        /// <summary>重新格式化（測試用，原樣回傳）。</summary>
        public Task<string> ReformatAsync(string contentRaw, CancellationToken cancellationToken)
            => Task.FromResult(contentRaw);

        /// <summary>美化（測試用，原樣回傳）。</summary>
        public Task<string> BeautifyAsync(string contentRaw, CancellationToken cancellationToken)
            => Task.FromResult(contentRaw);

        /// <summary>框選提問（測試用，回傳固定答案或丟出指定例外）。</summary>
        public Task<string> AskAboutAsync(string selectedText, string question, CancellationToken cancellationToken)
            => _throwOnAsk is not null
                ? Task.FromException<string>(_throwOnAsk)
                : Task.FromResult(_answer);

        public Task<string> GenerateAsync(string systemPrompt, string userContent, CancellationToken cancellationToken)
            => Task.FromResult(_answer);
    }
}
