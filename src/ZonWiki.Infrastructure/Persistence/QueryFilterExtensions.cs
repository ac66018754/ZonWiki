using Microsoft.EntityFrameworkCore;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Infrastructure.Persistence;

/// <summary>
/// 為 DbContext 設定全域查詢過濾（EF Core Query Filters）。
/// 對所有實作 IUserOwned 的實體套用「UserId == 目前使用者 + ValidFlag == true」的過濾。
/// </summary>
public static class QueryFilterExtensions
{
    /// <summary>
    /// 對 ModelBuilder 的所有實作 IUserOwned 的實體套用使用者隔離過濾。
    /// 必須在 OnModelCreating 結束時呼叫，之後才能使用 DbContext。
    /// </summary>
    /// <param name="modelBuilder">EF Core ModelBuilder。</param>
    /// <param name="currentUserId">
    /// 目前登入使用者的 Id（已解析的值；會以常數烤進模型）。
    /// 傳「值」而非 <see cref="ICurrentUser"/>，是為了同時支援背景工作的使用者覆寫
    /// （見 <see cref="ZonWikiDbContext.SetCurrentUserId"/>）。
    /// </param>
    public static void ApplyUserIsolationFilters(
        this ModelBuilder modelBuilder,
        Guid currentUserId)
    {
        // 取得所有實作 IUserOwned 的實體型別
        var userOwnedTypes = modelBuilder.Model
            .GetEntityTypes()
            .Where(et => typeof(IUserOwned).IsAssignableFrom(et.ClrType))
            .ToList();

        foreach (var entityType in userOwnedTypes)
        {
            var clrType = entityType.ClrType;

            // 動態建構過濾：UserId == 目前使用者 AND ValidFlag == true
            var parameter = System.Linq.Expressions.Expression.Parameter(clrType, "e");

            var userIdProperty = clrType.GetProperty(nameof(IUserOwned.UserId))
                ?? throw new InvalidOperationException(
                    $"Entity {clrType.Name} implements IUserOwned but has no UserId property.");

            var userIdAccess = System.Linq.Expressions.Expression.Property(parameter, userIdProperty);
            var currentUserIdConstant = System.Linq.Expressions.Expression.Constant(currentUserId);

            // UserId == currentUserId
            var userIdFilter = System.Linq.Expressions.Expression.Equal(userIdAccess, currentUserIdConstant);

            // ValidFlag == true（對所有 AuditableEntity 適用）
            var validFlagProperty = clrType.GetProperty(nameof(AuditableEntity.ValidFlag))
                ?? throw new InvalidOperationException(
                    $"Entity {clrType.Name} is not an AuditableEntity (missing ValidFlag property).");

            var validFlagAccess = System.Linq.Expressions.Expression.Property(parameter, validFlagProperty);
            var trueConstant = System.Linq.Expressions.Expression.Constant(true);

            // ValidFlag == true
            var validFlagFilter = System.Linq.Expressions.Expression.Equal(validFlagAccess, trueConstant);

            // (UserId == currentUser.UserId) AND (ValidFlag == true)
            var combinedFilter = System.Linq.Expressions.Expression.AndAlso(userIdFilter, validFlagFilter);

            var lambda = System.Linq.Expressions.Expression.Lambda(combinedFilter, parameter);

            // 套用 QueryFilter：EntityTypeBuilder.HasQueryFilter 直接接受 LambdaExpression（不需反射）。
            // 註：UserId 以常數烤進模型，故搭配 UserModelCacheKeyFactory「依使用者」區分模型快取，
            //     避免不同使用者共用到第一位使用者的過濾條件。
            modelBuilder.Entity(clrType).HasQueryFilter(lambda);
        }
    }
}
