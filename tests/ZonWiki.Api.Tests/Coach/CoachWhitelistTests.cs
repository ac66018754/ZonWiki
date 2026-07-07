using FluentAssertions;
using Xunit;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Services;

namespace ZonWiki.Api.Tests.Coach;

/// <summary>
/// 教練白名單登記回歸（純靜態，Phase 3；設計書 §1 白名單逐表登記）：
/// <b>CoachSession 登記</b>進垃圾桶（TrashTypeRegistry）；<b>CoachMessage／CoachBudgetLedger 不登記</b>
/// （逐字稿灌爆／全站計量帳非使用者主資料）。ActivityLog 的 CoachSession="coach"、CoachMessage 不登記
/// 由 <c>CoachActivityLogTests</c>（DB 級）覆蓋。
/// </summary>
public sealed class CoachWhitelistTests
{
    [Fact]
    public void TrashTypeRegistry_登記CoachSession()
    {
        TrashTypeRegistry.GetEntityType("CoachSession").Should().Be(typeof(CoachSession));
        TrashTypeRegistry.GetAllSupportedTypes().Should().Contain("CoachSession");
    }

    [Fact]
    public void TrashTypeRegistry_CoachSession標題取Title()
    {
        var session = new CoachSession { Title = "口說練習" };
        TrashTypeRegistry.GetTitle(session).Should().Be("口說練習");
    }

    [Fact]
    public void TrashTypeRegistry_未登記CoachMessage()
    {
        TrashTypeRegistry.GetEntityType("CoachMessage").Should().BeNull();
        TrashTypeRegistry.GetAllSupportedTypes().Should().NotContain("CoachMessage");
        // 未登記型別 → GetTitle 回預設「(無標題)」。
        TrashTypeRegistry.GetTitle(new CoachMessage { Content = "hi" }).Should().Be("(無標題)");
    }

    [Fact]
    public void TrashTypeRegistry_未登記CoachBudgetLedger()
    {
        TrashTypeRegistry.GetEntityType("CoachBudgetLedger").Should().BeNull();
        TrashTypeRegistry.GetAllSupportedTypes().Should().NotContain("CoachBudgetLedger");
    }
}
