using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Xunit;
using ZonWiki.Api.Common;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Tests.Common;

/// <summary>
/// <see cref="ConcurrencyTokenExtensions"/> 的單元測試（樂觀鎖 xmin 併發權杖，#4/#34）。
///
/// 這裡驗證的是「純變更追蹤層」邏輯，與資料庫提供者無關，因此用 InMemory 即可：
/// 直接對追蹤中的實體讀寫 xmin 影子屬性，鎖定 <c>GetConcurrencyVersion</c>／<c>ApplyBaseVersion</c>
/// 的行為契約。真正的 xmin 由 PostgreSQL 產生與比對，另由整合測試
/// （<c>Integration.OptimisticConcurrencyTests</c>）以真實資料庫覆蓋。
/// </summary>
public sealed class ConcurrencyTokenExtensionsTests : IDisposable
{
    /// <summary>xmin 影子屬性名稱（與 <see cref="ConcurrencyTokenExtensions"/> 內部常數一致）。</summary>
    private const string XminPropertyName = "xmin";

    /// <summary>每個測試實例使用獨立的 InMemory 資料庫。</summary>
    private readonly ZonWikiDbContext _db;

    /// <summary>建構測試：以 InMemory 提供者建立不套用使用者過濾的 DbContext。</summary>
    public ConcurrencyTokenExtensionsTests()
    {
        var options = new DbContextOptionsBuilder<ZonWikiDbContext>()
            .UseInMemoryDatabase($"concurrency-ext-{Guid.NewGuid()}")
            .Options;

        // 單參數建構子 → 不套用全域使用者過濾，聚焦於擴充方法本身的行為。
        _db = new ZonWikiDbContext(options);
    }

    /// <summary>清理 DbContext。</summary>
    public void Dispose() => _db.Dispose();

    /// <summary>
    /// 測試：<c>GetConcurrencyVersion</c> 回傳 xmin 影子屬性目前值（uint）轉成的 long。
    /// </summary>
    [Fact]
    public void GetConcurrencyVersion_ReturnsXminCurrentValue_AsLong()
    {
        // Arrange：追蹤一個實體並手動設定其 xmin 影子屬性（模擬資料庫回填的版本）。
        var entry = TrackNote();
        entry.Property(XminPropertyName).CurrentValue = 12345u;

        // Act
        var version = entry.GetConcurrencyVersion();

        // Assert
        version.Should().Be(12345L);
    }

    /// <summary>
    /// 測試：xmin 未設定（預設 0）時 <c>GetConcurrencyVersion</c> 回 0（＝版本未知，不參與併發檢查）。
    /// </summary>
    [Fact]
    public void GetConcurrencyVersion_ReturnsZero_WhenXminIsDefault()
    {
        // Arrange
        var entry = TrackNote();

        // Act
        var version = entry.GetConcurrencyVersion();

        // Assert
        version.Should().Be(0L);
    }

    /// <summary>
    /// 測試（邊界）：xmin 可超過 <see cref="int.MaxValue"/>（uint 上限約 42.9 億）。
    /// <c>GetConcurrencyVersion</c> 必須以 long 無損回傳，不可溢位成負值。
    /// </summary>
    [Fact]
    public void GetConcurrencyVersion_HandlesUintValuesAboveIntMax()
    {
        // Arrange：接近 uint 上限的 xmin。
        var entry = TrackNote();
        entry.Property(XminPropertyName).CurrentValue = uint.MaxValue;

        // Act
        var version = entry.GetConcurrencyVersion();

        // Assert：4294967295，而非 -1。
        version.Should().Be(4294967295L);
    }

    /// <summary>
    /// 測試：<c>ApplyBaseVersion</c> 在收到非 null 版本時，將其設為 xmin 的 OriginalValue，
    /// 供 SaveChanges 產生 <c>WHERE xmin = @original</c> 做併發比對。
    /// </summary>
    [Fact]
    public void ApplyBaseVersion_SetsXminOriginalValue_WhenProvided()
    {
        // Arrange
        var entry = TrackNote();

        // Act
        entry.ApplyBaseVersion(777L);

        // Assert
        entry.Property(XminPropertyName).OriginalValue.Should().Be(777u);
    }

    /// <summary>
    /// 測試（向後相容）：<c>ApplyBaseVersion(null)</c> 不動 OriginalValue（＝不做併發檢查、last-write-wins）。
    /// </summary>
    [Fact]
    public void ApplyBaseVersion_IsNoOp_WhenBaseVersionIsNull()
    {
        // Arrange：先給 OriginalValue 一個可辨識的值。
        var entry = TrackNote();
        entry.Property(XminPropertyName).OriginalValue = 999u;

        // Act
        entry.ApplyBaseVersion(null);

        // Assert：維持不變。
        entry.Property(XminPropertyName).OriginalValue.Should().Be(999u);
    }

    /// <summary>
    /// 測試（往返無損）：<c>GetConcurrencyVersion</c> 產生的 long 再交給 <c>ApplyBaseVersion</c>，
    /// 即使版本超過 int.MaxValue，也必須還原回同一個 uint（unchecked 轉型正確、無溢位）。
    /// 這鎖死「前端把 Version 原封帶回為 baseVersion」的往返正確性。
    /// </summary>
    [Fact]
    public void ApplyBaseVersion_RoundTripsWithGetConcurrencyVersion_AboveIntMax()
    {
        // Arrange：以接近 uint 上限的 xmin 讀出版本。
        var entry = TrackNote();
        entry.Property(XminPropertyName).CurrentValue = uint.MaxValue - 3u;
        var carriedVersion = entry.GetConcurrencyVersion();

        // Act：把讀出的版本再套回（模擬前端帶回 baseVersion）。
        entry.ApplyBaseVersion(carriedVersion);

        // Assert：OriginalValue 還原回原始 uint。
        entry.Property(XminPropertyName).OriginalValue.Should().Be(uint.MaxValue - 3u);
    }

    // ==================== 測試小工具 ====================

    /// <summary>
    /// 建立並追蹤一個最小可用的 <see cref="Note"/>（含 xmin 影子屬性），回傳其 EntityEntry。
    /// 以 Attach（Unchanged 狀態）追蹤，讓 OriginalValue 語意成立。
    /// </summary>
    private Microsoft.EntityFrameworkCore.ChangeTracking.EntityEntry TrackNote()
    {
        var now = DateTime.UtcNow;
        var note = new Note
        {
            Id = Guid.NewGuid(),
            UserId = Guid.NewGuid(),
            Title = "版本測試筆記",
            Slug = "version-test-note",
            ContentRaw = "內容",
            ContentHtml = "<p>內容</p>",
            ContentHash = "hash",
            Kind = "note",
            IsDraft = false,
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true,
        };

        return _db.Attach(note);
    }
}
