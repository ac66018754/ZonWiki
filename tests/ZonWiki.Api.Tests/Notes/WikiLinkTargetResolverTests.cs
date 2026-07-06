using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Xunit;
using ZonWiki.Api.Notes;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Tests.Notes;

/// <summary>
/// <see cref="WikiLinkTargetResolver"/> 單元測試（對應審查 finding #33：Wiki 連結解析改批次查詢消除 N+1）。
///
/// 驗證重點：
/// 1. 純函式 <see cref="WikiLinkTargetResolver.Resolve"/> 的比對規則（slug 優先、標題其次、找不到回 null）。
/// 2. <see cref="WikiLinkTargetResolver.BuildAsync"/> 的批次查詢只收錄「本使用者的有效筆記」
///    （不跨使用者、不含軟刪除），確保效能重構未破壞既有的比對語意與資料隔離。
///
/// 使用 EF Core InMemory（單參數 <see cref="ZonWikiDbContext"/> 建構子 → 不套用全域使用者過濾），
/// 讓測試聚焦在解析器本身「以 UserId + ValidFlag 明確過濾」的行為上。
/// </summary>
public sealed class WikiLinkTargetResolverTests : IAsyncLifetime
{
    private readonly DbContextOptions<ZonWikiDbContext> _dbOptions;
    private ZonWikiDbContext _db = null!;
    private readonly Guid _userId = Guid.NewGuid();
    private readonly Guid _otherUserId = Guid.NewGuid();

    /// <summary>
    /// 建構測試：每個測試實例使用獨立的 InMemory 資料庫，彼此互不干擾。
    /// </summary>
    public WikiLinkTargetResolverTests()
    {
        _dbOptions = new DbContextOptionsBuilder<ZonWikiDbContext>()
            .UseInMemoryDatabase($"wikilink-test-{Guid.NewGuid()}")
            .Options;
    }

    /// <summary>初始化 DbContext。</summary>
    public async Task InitializeAsync()
    {
        _db = new ZonWikiDbContext(_dbOptions);
        await _db.Database.EnsureCreatedAsync();
    }

    /// <summary>清理 DbContext。</summary>
    public async Task DisposeAsync()
    {
        await _db.Database.EnsureDeletedAsync();
        _db.Dispose();
    }

    /// <summary>
    /// 測試：錨點文字（大小寫 / 空白不同）經 slug 正規化後應對應到 slug 相符的目標筆記。
    /// </summary>
    [Fact]
    public async Task Resolve_MatchesTarget_BySlug()
    {
        // Arrange：標題 "My Referenced Note" → slug "my-referenced-note"。
        var targetId = await SeedNoteAsync("My Referenced Note");

        // Act：錨點以不同大小寫/空白書寫，仍應正規化為相同 slug 而命中。
        var resolver = await WikiLinkTargetResolver.BuildAsync(
            _db,
            _userId,
            new[] { "my  referenced NOTE" },
            CancellationToken.None);
        var resolved = resolver.Resolve("my  referenced NOTE");

        // Assert
        resolved.Should().Be(targetId);
    }

    /// <summary>
    /// 測試：當錨點的 slug 對不上、但「標題」完全相符時，退而以標題比對命中（標題後備路徑）。
    /// 刻意讓筆記的 Slug 與其標題正規化結果不同，以隔離出「標題比對」分支。
    /// </summary>
    [Fact]
    public async Task Resolve_FallsBackToTitle_WhenSlugDoesNotMatch()
    {
        // Arrange：標題 "Special Title" 但 Slug 被刻意設為不會由標題產生的值。
        var targetId = await SeedNoteAsync("Special Title", slugOverride: "totally-different-slug");

        // Act：錨點 = 標題原文；其 slug（special-title）對不上，改由標題命中。
        var resolver = await WikiLinkTargetResolver.BuildAsync(
            _db,
            _userId,
            new[] { "Special Title" },
            CancellationToken.None);
        var resolved = resolver.Resolve("Special Title");

        // Assert
        resolved.Should().Be(targetId);
    }

    /// <summary>
    /// 測試：slug 命中優先於標題命中。錨點同時可對上「A 筆記的 slug」與「B 筆記的標題」時，回傳 A。
    /// </summary>
    [Fact]
    public async Task Resolve_PrefersSlugMatch_OverTitleMatch()
    {
        // Arrange：
        //  A：Slug = "alpha"（= 錨點 "Alpha" 的正規化 slug），標題刻意無關。
        //  B：標題 = "Alpha"（會被錨點的標題比對命中），Slug 刻意不同以免與 A 的 slug 撞。
        var noteAId = await SeedNoteAsync("Unrelated Heading", slugOverride: "alpha");
        await SeedNoteAsync("Alpha", slugOverride: "alpha-different");

        // Act
        var resolver = await WikiLinkTargetResolver.BuildAsync(
            _db,
            _userId,
            new[] { "Alpha" },
            CancellationToken.None);
        var resolved = resolver.Resolve("Alpha");

        // Assert：以 slug 命中的 A 為準。
        resolved.Should().Be(noteAId);
    }

    /// <summary>
    /// 測試：沒有任何對應筆記的錨點應回傳 null（尚未建立的條目）。
    /// </summary>
    [Fact]
    public async Task Resolve_ReturnsNull_ForUnknownAnchor()
    {
        // Arrange
        await SeedNoteAsync("Existing Note");

        // Act
        var resolver = await WikiLinkTargetResolver.BuildAsync(
            _db,
            _userId,
            new[] { "Nonexistent Note" },
            CancellationToken.None);
        var resolved = resolver.Resolve("Nonexistent Note");

        // Assert
        resolved.Should().BeNull();
    }

    /// <summary>
    /// 測試（資料隔離＋軟刪除）：批次查詢只收錄「本使用者的有效筆記」，
    /// 不會命中他人筆記或已軟刪除（ValidFlag=false）的筆記。
    /// </summary>
    [Fact]
    public async Task BuildAsync_ExcludesOtherUsersAndSoftDeletedNotes()
    {
        // Arrange：三筆同標題 "Shared" 的筆記——他人的、軟刪除的、以及本人有效的。
        await SeedNoteAsync("Shared", userId: _otherUserId);                 // 他人 → 不可命中
        await SeedNoteAsync("Shared", validFlag: false);                    // 本人但已軟刪 → 不可命中
        var validId = await SeedNoteAsync("Shared");                        // 本人有效 → 應命中

        // Act
        var resolver = await WikiLinkTargetResolver.BuildAsync(
            _db,
            _userId,
            new[] { "Shared" },
            CancellationToken.None);
        var resolved = resolver.Resolve("Shared");

        // Assert：只命中本人有效筆記。
        resolved.Should().Be(validId);
    }

    /// <summary>
    /// 測試（批次去重）：一次帶入含重複的多個錨點，皆能正確各自解析（驗證批次建索引正常）。
    /// </summary>
    [Fact]
    public async Task BuildAsync_ResolvesMultipleAnchors_WithDuplicates()
    {
        // Arrange
        var firstId = await SeedNoteAsync("First Note");
        var secondId = await SeedNoteAsync("Second Note");

        // Act：錨點清單刻意含重複與一個不存在的項目。
        var anchors = new[] { "First Note", "Second Note", "First Note", "Ghost Note" };
        var resolver = await WikiLinkTargetResolver.BuildAsync(
            _db,
            _userId,
            anchors,
            CancellationToken.None);

        // Assert
        resolver.Resolve("First Note").Should().Be(firstId);
        resolver.Resolve("Second Note").Should().Be(secondId);
        resolver.Resolve("Ghost Note").Should().BeNull();
    }

    /// <summary>
    /// 建立測試筆記並存回資料庫。
    /// </summary>
    /// <param name="title">筆記標題。</param>
    /// <param name="slugOverride">若提供則以此為 Slug；否則由標題產生（與正式行為一致）。</param>
    /// <param name="userId">擁有者；預設為本測試使用者。</param>
    /// <param name="validFlag">有效旗標；設 false 代表軟刪除。</param>
    /// <returns>新建筆記的 Id。</returns>
    private async Task<Guid> SeedNoteAsync(
        string title,
        string? slugOverride = null,
        Guid? userId = null,
        bool validFlag = true)
    {
        var now = DateTime.UtcNow;
        var ownerId = userId ?? _userId;
        var note = new Note
        {
            Id = Guid.NewGuid(),
            UserId = ownerId,
            Title = title,
            Slug = slugOverride ?? NoteContentHelpers.GenerateSlug(title),
            ContentRaw = title,
            ContentHtml = $"<p>{title}</p>",
            ContentHash = Guid.NewGuid().ToString("N"),
            IsDraft = false,
            Kind = "note",
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = ownerId.ToString(),
            UpdatedUser = ownerId.ToString(),
            ValidFlag = validFlag,
        };

        _db.Note.Add(note);
        await _db.SaveChangesAsync();
        return note.Id;
    }
}
