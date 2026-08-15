using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;
using ZonWiki.Api.Tests.Integration;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Tests.Coach;

/// <summary>
/// 教練活動流登記回歸（Phase 3；DB 級，經真實 <c>ActivityLogInterceptor</c>）：
/// 新增 <b>CoachSession</b> 應產生一筆 EntityType="coach" 的活動流；新增 <b>CoachMessage</b>（逐字稿）
/// <b>不</b>應產生任何活動流（避免每則逐字稿灌爆）。
/// </summary>
[Collection(ApiIntegrationCollection.Name)]
public sealed class CoachActivityLogTests
{
    private readonly ZonWikiApiFactory _factory;

    public CoachActivityLogTests(ZonWikiApiFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task 新增CoachSession_產生coach活動流()
    {
        var userId = Guid.NewGuid();
        Guid sessionId;

        var scope = _factory.Services.CreateScope();
        using (scope)
        {
            var db = scope.ServiceProvider.GetRequiredService<ZonWikiDbContext>();
            db.SetCurrentUserId(userId); // 讓活動流攔截器能歸屬使用者（第一次查詢前設定）。

            var session = new CoachSession
            {
                UserId = userId,
                Title = "口說練習：面試英文",
                Status = CoachSession.StatusActive,
                Model = "test-model",
                StartedDateTime = DateTime.UtcNow,
                CreatedUser = userId.ToString(),
                UpdatedUser = userId.ToString(),
            };
            db.CoachSession.Add(session);
            await db.SaveChangesAsync();
            sessionId = session.Id;
        }

        var verifyScope = _factory.Services.CreateScope();
        using (verifyScope)
        {
            var db = verifyScope.ServiceProvider.GetRequiredService<ZonWikiDbContext>();
            var log = await db.ActivityLog.IgnoreQueryFilters().AsNoTracking()
                .FirstOrDefaultAsync(a => a.EntityId == sessionId);

            log.Should().NotBeNull();
            log!.EntityType.Should().Be("coach");
            log.ActionType.Should().Be("created");
            log.Title.Should().Be("口說練習：面試英文");
        }
    }

    [Fact]
    public async Task 新增CoachMessage_不產生活動流()
    {
        var userId = Guid.NewGuid();
        Guid messageId;

        var scope = _factory.Services.CreateScope();
        using (scope)
        {
            var db = scope.ServiceProvider.GetRequiredService<ZonWikiDbContext>();
            db.SetCurrentUserId(userId);

            var session = new CoachSession
            {
                UserId = userId,
                Title = "場次",
                Status = CoachSession.StatusActive,
                Model = "test-model",
                StartedDateTime = DateTime.UtcNow,
                CreatedUser = userId.ToString(),
                UpdatedUser = userId.ToString(),
            };
            db.CoachSession.Add(session);
            await db.SaveChangesAsync();

            var message = new CoachMessage
            {
                UserId = userId,
                CoachSessionId = session.Id,
                Role = CoachMessage.RoleUser,
                Content = "How do I say this?",
                SeqNo = 1,
                CreatedUser = userId.ToString(),
                UpdatedUser = userId.ToString(),
            };
            db.CoachMessage.Add(message);
            await db.SaveChangesAsync();
            messageId = message.Id;
        }

        var verifyScope = _factory.Services.CreateScope();
        using (verifyScope)
        {
            var db = verifyScope.ServiceProvider.GetRequiredService<ZonWikiDbContext>();
            var log = await db.ActivityLog.IgnoreQueryFilters().AsNoTracking()
                .FirstOrDefaultAsync(a => a.EntityId == messageId);

            log.Should().BeNull("CoachMessage 逐字稿不應登記活動流");
        }
    }
}
