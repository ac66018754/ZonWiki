using FluentAssertions;
using ZonWiki.Infrastructure.Persistence;
using Xunit;

namespace ZonWiki.Infrastructure.Tests.Domain;

/// <summary>
/// 「唯一索引衝突 → 併發衝突（409）」轉譯範圍的單元測試（feature/slug-alias 包3，
/// 對抗式復審 CRITICAL #1 的修復鎖定）。
///
/// 背景：兩個請求同時把不同筆記改名到同一標題時，敗方會撞
/// UX_Note_UserId_Slug（或 alias 的 UX_NoteSlugAlias_UserId_Slug_NoteId）唯一索引；
/// 原本的轉譯只認 UX_NoteRevision_NoteId_RevisionNo，其餘外洩成裸 500（已實測重現）。
/// 語意上三者同為「使用者層級的併發寫入衝突」，應一體轉為 DbUpdateConcurrencyException
/// 讓各端點既有的 409 處理接住。
/// </summary>
public sealed class UniqueCollisionTranslationTests
{
    /// <summary>三個使用者可見的併發唯一索引都必須在轉譯範圍內。</summary>
    /// <param name="constraintName">撞到的唯一索引名稱。</param>
    [Theory]
    [InlineData("UX_NoteRevision_NoteId_RevisionNo")]
    [InlineData("UX_Note_UserId_Slug")]
    [InlineData("UX_NoteSlugAlias_UserId_Slug_NoteId")]
    public void IsUserFacingUniqueCollision_KnownConcurrencyIndexes_ReturnTrue(string constraintName)
    {
        ZonWikiDbContext.IsUserFacingUniqueCollision(constraintName).Should().BeTrue();
    }

    /// <summary>其他唯一索引（如 AiModel 的 Key）不得被誤轉成 409——那些是真正的資料錯誤。</summary>
    /// <param name="constraintName">撞到的唯一索引名稱。</param>
    [Theory]
    [InlineData("UX_AiModel_UserId_Key")]
    [InlineData("UX_ApiToken_TokenHash")]
    [InlineData("")]
    [InlineData(null)]
    public void IsUserFacingUniqueCollision_OtherIndexes_ReturnFalse(string? constraintName)
    {
        ZonWikiDbContext.IsUserFacingUniqueCollision(constraintName).Should().BeFalse();
    }
}
