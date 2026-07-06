using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;
using ZonWiki.Api.Services;
using ZonWiki.Api.Tests.Integration;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Tests.Expenses;

/// <summary>
/// <see cref="ExpenseCategoryService"/> 的服務測試（真 PostgreSQL，重用整合基座容器以控管 EF 內部服務供應者數量）：
/// 惰性種子 8 預設、冪等不重複、復活軟刪列、名稱式 find-or-create、空／未知映射到「其他」、並發撞唯一索引韌性。
///
/// 以每測試各自的 DI scope 取一個 <see cref="ZonWikiDbContext"/>（CurrentUserId 為 Guid.Empty →
/// 不套全域過濾、隔離最終防線放行）；服務內一律以明確 UserId＋IgnoreQueryFilters 查詢，故行為確定。
/// </summary>
[Collection(ApiIntegrationCollection.Name)]
public sealed class ExpenseCategoryServiceTests
{
    private readonly ZonWikiApiFactory _factory;

    public ExpenseCategoryServiceTests(ZonWikiApiFactory factory)
    {
        _factory = factory;
    }

    private (IServiceScope Scope, ZonWikiDbContext Db) NewScope()
    {
        var scope = _factory.Services.CreateScope();
        return (scope, scope.ServiceProvider.GetRequiredService<ZonWikiDbContext>());
    }

    [Fact]
    public async Task EnsureDefaultCategories_首次_建立8預設且SortOrder0到7()
    {
        var userId = Guid.NewGuid();
        var (scope, db) = NewScope();
        using (scope)
        {
            var service = new ExpenseCategoryService(db);

            await service.EnsureDefaultCategoriesAsync(userId, CancellationToken.None);

            var cats = await db.ExpenseCategory.IgnoreQueryFilters()
                .Where(c => c.UserId == userId)
                .OrderBy(c => c.SortOrder)
                .ToListAsync();

            cats.Should().HaveCount(8);
            cats.Select(c => c.Name).Should().Equal("餐飲", "交通", "購物", "娛樂", "日用", "醫療", "訂閱", "其他");
            cats.Select(c => c.SortOrder).Should().Equal(0, 1, 2, 3, 4, 5, 6, 7);
        }
    }

    [Fact]
    public async Task EnsureDefaultCategories_再呼叫_不重複建立()
    {
        var userId = Guid.NewGuid();
        var (scope, db) = NewScope();
        using (scope)
        {
            var service = new ExpenseCategoryService(db);

            await service.EnsureDefaultCategoriesAsync(userId, CancellationToken.None);
            await service.EnsureDefaultCategoriesAsync(userId, CancellationToken.None);

            var count = await db.ExpenseCategory.IgnoreQueryFilters()
                .CountAsync(c => c.UserId == userId);
            count.Should().Be(8);
        }
    }

    [Fact]
    public async Task EnsureDefaultCategories_部分已存在_只補齊缺的且不重複()
    {
        // 修正 #4：批次查存在集合 → 只對缺的插入。先種 3 個，再呼叫應補齊為 8，不重複既有 3 個。
        var userId = Guid.NewGuid();

        var (seedScope, seedDb) = NewScope();
        using (seedScope)
        {
            foreach (var name in new[] { "餐飲", "交通", "購物" })
            {
                seedDb.ExpenseCategory.Add(new ExpenseCategory
                {
                    UserId = userId,
                    Name = name,
                    CreatedUser = "seed",
                    UpdatedUser = "seed",
                });
            }

            await seedDb.SaveChangesAsync();
        }

        var (scope, db) = NewScope();
        using (scope)
        {
            var service = new ExpenseCategoryService(db);

            await service.EnsureDefaultCategoriesAsync(userId, CancellationToken.None);

            var count = await db.ExpenseCategory.IgnoreQueryFilters()
                .CountAsync(c => c.UserId == userId);
            count.Should().Be(8, "只補齊缺的 5 個，不重複既有 3 個");
        }
    }

    [Fact]
    public async Task EnsureDefaultCategories_並發首建_只建8筆且不拋500()
    {
        // 修正 #4 核心路徑覆蓋：兩個獨立 DbContext 並發批次種子同一新使用者，一方整批插入成功、另一方
        // 撞並發衝突（(UserId,Name) 唯一索引 23505，或並發多列批次插入互鎖的 40P01 死結），
        // 都應被攔並走「detach＋逐筆 fallback」收斂，最終只留 8 筆、皆不拋。
        // 多跑幾輪以提高覆蓋到「死結」變體的機率（單列 fallback 不會死結，修正後每輪皆確定性收斂）。
        for (var iteration = 0; iteration < 12; iteration++)
        {
            var userId = Guid.NewGuid();

            var (scopeA, dbA) = NewScope();
            var (scopeB, dbB) = NewScope();
            using (scopeA)
            using (scopeB)
            {
                var serviceA = new ExpenseCategoryService(dbA);
                var serviceB = new ExpenseCategoryService(dbB);

                var taskA = serviceA.EnsureDefaultCategoriesAsync(userId, CancellationToken.None);
                var taskB = serviceB.EnsureDefaultCategoriesAsync(userId, CancellationToken.None);

                var act = async () => await Task.WhenAll(taskA, taskB);
                await act.Should().NotThrowAsync(
                    "並發批次種子撞唯一索引或死結，都應被攔並走逐筆 fallback（第 {0} 輪）", iteration);
            }

            var (verifyScope, verify) = NewScope();
            using (verifyScope)
            {
                var count = await verify.ExpenseCategory.IgnoreQueryFilters()
                    .CountAsync(c => c.UserId == userId);
                count.Should().Be(8, "並發首建最終只應有 8 筆（第 {0} 輪）", iteration);
            }
        }
    }

    [Fact]
    public async Task EnsureDefaultCategories_某預設被軟刪_復活而非新建()
    {
        var userId = Guid.NewGuid();
        var (scope, db) = NewScope();
        using (scope)
        {
            var service = new ExpenseCategoryService(db);
            await service.EnsureDefaultCategoriesAsync(userId, CancellationToken.None);

            var food = await db.ExpenseCategory.IgnoreQueryFilters()
                .FirstAsync(c => c.UserId == userId && c.Name == "餐飲");
            var foodId = food.Id;
            food.ValidFlag = false;
            food.DeletedDateTime = DateTime.UtcNow;
            await db.SaveChangesAsync();

            await service.EnsureDefaultCategoriesAsync(userId, CancellationToken.None);

            var foodRows = await db.ExpenseCategory.IgnoreQueryFilters()
                .Where(c => c.UserId == userId && c.Name == "餐飲")
                .ToListAsync();
            foodRows.Should().HaveCount(1);
            foodRows[0].Id.Should().Be(foodId, "應復活同一列而非新建");
            foodRows[0].ValidFlag.Should().BeTrue();
        }
    }

    [Fact]
    public async Task ResolveCategoryByName_已存在_回既有Id()
    {
        var userId = Guid.NewGuid();
        var (scope, db) = NewScope();
        using (scope)
        {
            var service = new ExpenseCategoryService(db);
            await service.EnsureDefaultCategoriesAsync(userId, CancellationToken.None);

            var existing = await db.ExpenseCategory.IgnoreQueryFilters()
                .FirstAsync(c => c.UserId == userId && c.Name == "交通");

            var resolved = await service.ResolveCategoryByNameAsync(userId, "交通", CancellationToken.None);

            resolved.Id.Should().Be(existing.Id);
        }
    }

    [Fact]
    public async Task ResolveCategoryByName_不存在_建立新分類()
    {
        var userId = Guid.NewGuid();
        var (scope, db) = NewScope();
        using (scope)
        {
            var service = new ExpenseCategoryService(db);

            var resolved = await service.ResolveCategoryByNameAsync(userId, "寵物", CancellationToken.None);

            resolved.Name.Should().Be("寵物");
            var rows = await db.ExpenseCategory.IgnoreQueryFilters()
                .Where(c => c.UserId == userId && c.Name == "寵物")
                .ToListAsync();
            rows.Should().HaveCount(1);
        }
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public async Task ResolveCategoryByName_名稱空_映射到其他(string? name)
    {
        var userId = Guid.NewGuid();
        var (scope, db) = NewScope();
        using (scope)
        {
            var service = new ExpenseCategoryService(db);

            var resolved = await service.ResolveCategoryByNameAsync(userId, name, CancellationToken.None);

            resolved.Name.Should().Be(ExpenseCategoryService.FallbackCategoryName);
        }
    }

    [Fact]
    public async Task ResolveCategoryByName_名稱撞已軟刪列_復活不違反唯一約束()
    {
        var userId = Guid.NewGuid();
        var (scope, db) = NewScope();
        using (scope)
        {
            var service = new ExpenseCategoryService(db);

            var first = await service.ResolveCategoryByNameAsync(userId, "訂閱", CancellationToken.None);
            var subId = first.Id;
            first.ValidFlag = false;
            first.DeletedDateTime = DateTime.UtcNow;
            await db.SaveChangesAsync();

            var again = await service.ResolveCategoryByNameAsync(userId, "訂閱", CancellationToken.None);

            again.Id.Should().Be(subId);
            again.ValidFlag.Should().BeTrue();
            var rows = await db.ExpenseCategory.IgnoreQueryFilters()
                .CountAsync(c => c.UserId == userId && c.Name == "訂閱");
            rows.Should().Be(1);
        }
    }

    [Fact]
    public async Task ResolveCategoryByName_並發同名_只建一筆且不拋500()
    {
        var userId = Guid.NewGuid();

        // 兩個獨立 DI scope／DbContext 並發解析同一個新名稱 → 一方 INSERT 成功、另一方撞 (UserId,Name)
        // 唯一索引，應被攔截並改用既有列，最終只留一筆、皆不拋例外。
        var (scopeA, dbA) = NewScope();
        var (scopeB, dbB) = NewScope();
        using (scopeA)
        using (scopeB)
        {
            var serviceA = new ExpenseCategoryService(dbA);
            var serviceB = new ExpenseCategoryService(dbB);

            var taskA = serviceA.ResolveCategoryByNameAsync(userId, "露營", CancellationToken.None);
            var taskB = serviceB.ResolveCategoryByNameAsync(userId, "露營", CancellationToken.None);

            var act = async () => await Task.WhenAll(taskA, taskB);
            await act.Should().NotThrowAsync();
        }

        var (verifyScope, verify) = NewScope();
        using (verifyScope)
        {
            var rows = await verify.ExpenseCategory.IgnoreQueryFilters()
                .CountAsync(c => c.UserId == userId && c.Name == "露營");
            rows.Should().Be(1, "並發同名只應建立一筆");
        }
    }
}
