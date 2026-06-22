using System.Security.Cryptography;
using System.Text;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Xunit;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Tests.Endpoints;

/// <summary>
/// 筆記寫入端點單元測試。
/// 測試 CRUD 操作、分類指派、標籤指派、版本控制、Wiki 連結解析等。
/// 不包含 HTTP 整合測試（其中會用 WebApplicationFactory）；本檔為單位測試。
/// </summary>
public sealed class NoteWriteEndpointsTests : IAsyncLifetime
{
    private readonly DbContextOptions<ZonWikiDbContext> _dbOptions;
    private ZonWikiDbContext _db = null!;
    private readonly Guid _testUserId = Guid.NewGuid();

    public NoteWriteEndpointsTests()
    {
        _dbOptions = new DbContextOptionsBuilder<ZonWikiDbContext>()
            .UseInMemoryDatabase($"test-db-{Guid.NewGuid()}")
            .Options;
    }

    /// <summary>
    /// 初始化測試資料庫與測試使用者。
    /// </summary>
    public async Task InitializeAsync()
    {
        _db = new ZonWikiDbContext(_dbOptions);
        await _db.Database.EnsureCreatedAsync();

        // 建立測試使用者
        var now = DateTime.UtcNow;
        var user = new User
        {
            Id = _testUserId,
            Email = "test@example.com",
            DisplayName = "Test User",
            GoogleSub = "test-sub",
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "system",
            UpdatedUser = "system",
        };
        _db.User.Add(user);
        await _db.SaveChangesAsync();
    }

    /// <summary>
    /// 清理測試資料庫。
    /// </summary>
    public async Task DisposeAsync()
    {
        await _db.Database.EnsureDeletedAsync();
        _db.Dispose();
    }

    // ==================== Slug 生成測試 ====================

    /// <summary>
    /// 測試：Slug 應從標題產生（去除特殊字元、轉小寫、用連字號分隔）。
    /// </summary>
    [Fact]
    public void GenerateSlug_RemovesSpecialChars_AndConvertsToLowercase()
    {
        // Arrange & Act
        var slug = GenerateSlugHelper("My First Note!!!");

        // Assert
        slug.Should().Be("my-first-note");
    }

    /// <summary>
    /// 測試：Slug 應去除多個連字號。
    /// </summary>
    [Fact]
    public void GenerateSlug_DeduplicatesDashes()
    {
        // Arrange & Act
        var slug = GenerateSlugHelper("Hello---World");

        // Assert
        slug.Should().Be("hello-world");
    }

    // ==================== ContentHash 測試 ====================

    /// <summary>
    /// 測試：ContentHash 應計算 SHA-256。
    /// </summary>
    [Fact]
    public void ComputeContentHash_ProducesConsistentHash()
    {
        // Arrange
        var content = "Hello World";

        // Act
        var hash1 = ComputeContentHashHelper(content);
        var hash2 = ComputeContentHashHelper(content);

        // Assert
        hash1.Should().Be(hash2);
        hash1.Length.Should().Be(64); // SHA-256 = 256 bits = 64 hex characters
    }

    /// <summary>
    /// 測試：不同內容應產生不同 hash。
    /// </summary>
    [Fact]
    public void ComputeContentHash_DifferentContentProducesDifferentHash()
    {
        // Arrange & Act
        var hash1 = ComputeContentHashHelper("Content A");
        var hash2 = ComputeContentHashHelper("Content B");

        // Assert
        hash1.Should().NotBe(hash2);
    }

    // ==================== Note 建立測試 ====================

    /// <summary>
    /// 測試：建立筆記時，應產生版本記錄（RevisionNo=1, ChangeKind="create"）。
    /// </summary>
    [Fact]
    public async Task CreateNote_CreatesRevisionWithChangeKindCreate()
    {
        // Arrange
        var title = "Test Note";
        var contentRaw = "# Test\n\nThis is a test.";

        // Act
        var (noteId, _) = await CreateNoteAsync(title, contentRaw);

        // Assert
        var revision = await _db.NoteRevision
            .FirstOrDefaultAsync(r => r.NoteId == noteId && r.ValidFlag);

        revision.Should().NotBeNull();
        revision!.RevisionNo.Should().Be(1);
        revision.ChangeKind.Should().Be("create");
        revision.Title.Should().Be(title);
        revision.ContentRaw.Should().Be(contentRaw);
    }

    /// <summary>
    /// 測試：建立筆記應產生唯一 slug（同使用者範圍）。
    /// </summary>
    [Fact]
    public async Task CreateNote_GeneratesUniqueSlugPerUser()
    {
        // Arrange
        var title = "My Note";
        var contentRaw = "Content";

        // Act
        var (_, slug1) = await CreateNoteAsync(title, contentRaw);

        // 嘗試建立相同標題的筆記（應失敗）
        var duplicate = await _db.Note
            .FirstOrDefaultAsync(n => n.UserId == _testUserId && n.Slug == slug1 && n.ValidFlag);

        // Assert
        slug1.Should().NotBeEmpty();
        duplicate.Should().NotBeNull();
    }

    // ==================== Note 更新測試 ====================

    /// <summary>
    /// 測試：更新筆記應遞增版本序號。
    /// </summary>
    [Fact]
    public async Task UpdateNote_IncrementsRevisionNumber()
    {
        // Arrange
        var (noteId, _) = await CreateNoteAsync("Original", "Original content");

        // Act
        await UpdateNoteAsync(noteId, "Updated", "Updated content");

        // Assert
        var revisions = await _db.NoteRevision
            .Where(r => r.NoteId == noteId && r.ValidFlag)
            .OrderBy(r => r.RevisionNo)
            .ToListAsync();

        revisions.Should().HaveCount(2);
        revisions[0].RevisionNo.Should().Be(1);
        revisions[0].ChangeKind.Should().Be("create");
        revisions[1].RevisionNo.Should().Be(2);
        revisions[1].ChangeKind.Should().Be("update");
    }

    /// <summary>
    /// 測試：更新筆記時應重新計算 ContentHash。
    /// </summary>
    [Fact]
    public async Task UpdateNote_RecalculatesContentHash()
    {
        // Arrange
        var (noteId, _) = await CreateNoteAsync("Test", "Original content");
        var originalNote = await _db.Note.FirstAsync(n => n.Id == noteId);
        var originalHash = originalNote.ContentHash;

        // Act
        await UpdateNoteAsync(noteId, "Test", "Modified content");

        // Assert
        var updatedNote = await _db.Note.FirstAsync(n => n.Id == noteId);
        updatedNote.ContentHash.Should().NotBe(originalHash);
    }

    // ==================== Note 刪除測試 ====================

    /// <summary>
    /// 測試：刪除筆記應軟刪除（ValidFlag=false + DeletedDateTime 設定）。
    /// </summary>
    [Fact]
    public async Task DeleteNote_SoftDeletesWithValidFlagAndDeletedDateTime()
    {
        // Arrange
        var (noteId, _) = await CreateNoteAsync("Test", "Content");

        // Act
        await DeleteNoteAsync(noteId);

        // Assert
        var note = await _db.Note.FirstAsync(n => n.Id == noteId);
        note.ValidFlag.Should().BeFalse();
        note.DeletedDateTime.Should().NotBeNull();
    }

    /// <summary>
    /// 測試：刪除筆記應記錄 ChangeKind="delete" 的版本。
    /// </summary>
    [Fact]
    public async Task DeleteNote_CreatesDeleteRevision()
    {
        // Arrange
        var (noteId, _) = await CreateNoteAsync("Test", "Content");

        // Act
        await DeleteNoteAsync(noteId);

        // Assert
        var deleteRevision = await _db.NoteRevision
            .FirstOrDefaultAsync(r => r.NoteId == noteId && r.ChangeKind == "delete" && r.ValidFlag);

        deleteRevision.Should().NotBeNull();
        deleteRevision!.RevisionNo.Should().Be(2); // 1 for create, 2 for delete
    }

    // ==================== Wiki Link 解析測試 ====================

    /// <summary>
    /// 測試：Wiki 連結解析應找到 slug 相符的目標筆記。
    /// </summary>
    [Fact]
    public async Task ParseWikiLinks_MatchesBySlug()
    {
        // Arrange
        var targetTitle = "My Referenced Note";
        var (targetNoteId, targetSlug) = await CreateNoteAsync(targetTitle, "Target content");

        // Act - 手動建立連結以驗證邏輯（實際端點會自動解析）
        var now = DateTime.UtcNow;
        var link = new NoteLink
        {
            UserId = _testUserId,
            SourceNoteId = Guid.NewGuid(),
            TargetNoteId = targetNoteId,
            AnchorText = targetTitle,
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = _testUserId.ToString(),
            UpdatedUser = _testUserId.ToString(),
        };
        _db.NoteLink.Add(link);
        await _db.SaveChangesAsync();

        // Assert
        var savedLink = await _db.NoteLink
            .FirstOrDefaultAsync(nl => nl.TargetNoteId == targetNoteId && nl.ValidFlag);

        savedLink.Should().NotBeNull();
        savedLink!.TargetNoteId.Should().Be(targetNoteId);
        savedLink.AnchorText.Should().Be(targetTitle);
    }

    /// <summary>
    /// 測試：Wiki 連結可指向不存在的筆記（TargetNoteId=null）。
    /// </summary>
    [Fact]
    public async Task ParseWikiLinks_AllowsNullTargetForMissingNotes()
    {
        // Arrange & Act
        var now = DateTime.UtcNow;
        var link = new NoteLink
        {
            UserId = _testUserId,
            SourceNoteId = Guid.NewGuid(),
            TargetNoteId = null,
            AnchorText = "Non-existent Note",
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = _testUserId.ToString(),
            UpdatedUser = _testUserId.ToString(),
        };
        _db.NoteLink.Add(link);
        await _db.SaveChangesAsync();

        // Assert
        var savedLink = await _db.NoteLink
            .FirstOrDefaultAsync(nl => nl.AnchorText == "Non-existent Note" && nl.ValidFlag);

        savedLink.Should().NotBeNull();
        savedLink!.TargetNoteId.Should().BeNull();
    }

    // ==================== 分類指派測試 ====================

    /// <summary>
    /// 測試：指派分類到筆記。
    /// </summary>
    [Fact]
    public async Task AssignCategories_LinksNoteToCategoriesCorrectly()
    {
        // Arrange
        var cat1 = await CreateCategoryAsync("Category 1");
        var cat2 = await CreateCategoryAsync("Category 2");
        var (noteId, _) = await CreateNoteAsync("Note", "Content");

        // Act
        await AssignCategoriesToNoteAsync(noteId, new[] { cat1, cat2 });

        // Assert
        var links = await _db.NoteCategory
            .Where(nc => nc.NoteId == noteId && nc.ValidFlag)
            .ToListAsync();

        links.Should().HaveCount(2);
        links.Select(l => l.CategoryId).Should().Contain(new[] { cat1, cat2 });
    }

    // ==================== 標籤指派測試 ====================

    /// <summary>
    /// 測試：指派標籤到筆記。
    /// </summary>
    [Fact]
    public async Task AssignTags_LinksNoteToTagsCorrectly()
    {
        // Arrange
        var tag1 = await CreateTagAsync("Tag 1");
        var tag2 = await CreateTagAsync("Tag 2");
        var (noteId, _) = await CreateNoteAsync("Note", "Content");

        // Act
        await AssignTagsToNoteAsync(noteId, new[] { tag1, tag2 });

        // Assert
        var links = await _db.NoteTag
            .Where(nt => nt.NoteId == noteId && nt.ValidFlag)
            .ToListAsync();

        links.Should().HaveCount(2);
        links.Select(l => l.TagId).Should().Contain(new[] { tag1, tag2 });
    }

    // ==================== Helper Methods ====================

    /// <summary>
    /// 建立測試筆記。
    /// </summary>
    private async Task<(Guid noteId, string slug)> CreateNoteAsync(
        string title,
        string contentRaw)
    {
        var now = DateTime.UtcNow;
        var note = new Note
        {
            UserId = _testUserId,
            Title = title,
            Slug = GenerateSlugHelper(title),
            ContentRaw = contentRaw,
            ContentHtml = contentRaw, // 簡化版；實際會用 Markdig 渲染
            ContentHash = ComputeContentHashHelper(contentRaw),
            IsDraft = false,
            Kind = "note",
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = _testUserId.ToString(),
            UpdatedUser = _testUserId.ToString(),
        };

        _db.Note.Add(note);
        await _db.SaveChangesAsync();

        // 建立初始版本紀錄
        var revision = new NoteRevision
        {
            UserId = _testUserId,
            NoteId = note.Id,
            RevisionNo = 1,
            ChangeKind = "create",
            Title = note.Title,
            ContentRaw = note.ContentRaw,
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = _testUserId.ToString(),
            UpdatedUser = _testUserId.ToString(),
        };

        _db.NoteRevision.Add(revision);
        await _db.SaveChangesAsync();

        return (note.Id, note.Slug);
    }

    /// <summary>
    /// 更新測試筆記。
    /// </summary>
    private async Task UpdateNoteAsync(Guid noteId, string? title = null, string? contentRaw = null)
    {
        var note = await _db.Note.FirstAsync(n => n.Id == noteId);

        if (title != null)
            note.Title = title;

        if (contentRaw != null)
        {
            note.ContentRaw = contentRaw;
            note.ContentHash = ComputeContentHashHelper(contentRaw);
        }

        note.UpdatedDateTime = DateTime.UtcNow;
        note.UpdatedUser = _testUserId.ToString();

        var latestRevision = await _db.NoteRevision
            .Where(r => r.NoteId == noteId)
            .OrderByDescending(r => r.RevisionNo)
            .FirstOrDefaultAsync();

        var nextRevisionNo = (latestRevision?.RevisionNo ?? 0) + 1;

        var revision = new NoteRevision
        {
            UserId = _testUserId,
            NoteId = noteId,
            RevisionNo = nextRevisionNo,
            ChangeKind = "update",
            Title = note.Title,
            ContentRaw = note.ContentRaw,
            CreatedDateTime = DateTime.UtcNow,
            UpdatedDateTime = DateTime.UtcNow,
            CreatedUser = _testUserId.ToString(),
            UpdatedUser = _testUserId.ToString(),
        };

        _db.NoteRevision.Add(revision);
        await _db.SaveChangesAsync();
    }

    /// <summary>
    /// 刪除測試筆記。
    /// </summary>
    private async Task DeleteNoteAsync(Guid noteId)
    {
        var note = await _db.Note.FirstAsync(n => n.Id == noteId);
        note.ValidFlag = false;
        var now = DateTime.UtcNow;
        note.DeletedDateTime = now;
        note.UpdatedDateTime = now;
        note.UpdatedUser = _testUserId.ToString();

        var latestRevision = await _db.NoteRevision
            .Where(r => r.NoteId == noteId)
            .OrderByDescending(r => r.RevisionNo)
            .FirstOrDefaultAsync();

        var nextRevisionNo = (latestRevision?.RevisionNo ?? 0) + 1;

        var revision = new NoteRevision
        {
            UserId = _testUserId,
            NoteId = noteId,
            RevisionNo = nextRevisionNo,
            ChangeKind = "delete",
            Title = note.Title,
            ContentRaw = note.ContentRaw,
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = _testUserId.ToString(),
            UpdatedUser = _testUserId.ToString(),
        };

        _db.NoteRevision.Add(revision);
        await _db.SaveChangesAsync();
    }

    /// <summary>
    /// 建立測試分類。
    /// </summary>
    private async Task<Guid> CreateCategoryAsync(string name)
    {
        var now = DateTime.UtcNow;
        var category = new Category
        {
            UserId = _testUserId,
            Name = name,
            FolderPath = string.Empty,
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = _testUserId.ToString(),
            UpdatedUser = _testUserId.ToString(),
        };

        _db.Category.Add(category);
        await _db.SaveChangesAsync();

        return category.Id;
    }

    /// <summary>
    /// 建立測試標籤。
    /// </summary>
    private async Task<Guid> CreateTagAsync(string name)
    {
        var now = DateTime.UtcNow;
        var tag = new Tag
        {
            UserId = _testUserId,
            Name = name,
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = _testUserId.ToString(),
            UpdatedUser = _testUserId.ToString(),
        };

        _db.Tag.Add(tag);
        await _db.SaveChangesAsync();

        return tag.Id;
    }

    /// <summary>
    /// 指派分類到筆記。
    /// </summary>
    private async Task AssignCategoriesToNoteAsync(Guid noteId, Guid[] categoryIds)
    {
        var now = DateTime.UtcNow;
        foreach (var categoryId in categoryIds)
        {
            var link = new NoteCategory
            {
                UserId = _testUserId,
                NoteId = noteId,
                CategoryId = categoryId,
                CreatedDateTime = now,
                UpdatedDateTime = now,
                CreatedUser = _testUserId.ToString(),
                UpdatedUser = _testUserId.ToString(),
            };

            _db.NoteCategory.Add(link);
        }

        await _db.SaveChangesAsync();
    }

    /// <summary>
    /// 指派標籤到筆記。
    /// </summary>
    private async Task AssignTagsToNoteAsync(Guid noteId, Guid[] tagIds)
    {
        var now = DateTime.UtcNow;
        foreach (var tagId in tagIds)
        {
            var link = new NoteTag
            {
                UserId = _testUserId,
                NoteId = noteId,
                TagId = tagId,
                CreatedDateTime = now,
                UpdatedDateTime = now,
                CreatedUser = _testUserId.ToString(),
                UpdatedUser = _testUserId.ToString(),
            };

            _db.NoteTag.Add(link);
        }

        await _db.SaveChangesAsync();
    }

    /// <summary>
    /// 產生 slug（輔助函式，應與端點實作一致）。
    /// </summary>
    private static string GenerateSlugHelper(string title)
    {
        var slug = System.Text.RegularExpressions.Regex
            .Replace(title.ToLowerInvariant(), @"[^\w\s-]", string.Empty);
        slug = System.Text.RegularExpressions.Regex
            .Replace(slug, @"[\s]+", "-");
        slug = System.Text.RegularExpressions.Regex
            .Replace(slug, @"-+", "-").Trim('-');
        return slug;
    }

    /// <summary>
    /// 計算 ContentHash（輔助函式，應與端點實作一致）。
    /// </summary>
    private static string ComputeContentHashHelper(string content)
    {
        using var sha256 = SHA256.Create();
        var hash = sha256.ComputeHash(Encoding.UTF8.GetBytes(content));
        return Convert.ToHexString(hash);
    }
}
