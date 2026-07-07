using FluentAssertions;
using Xunit;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Services;

namespace ZonWiki.Api.Tests.Vocabulary;

/// <summary>
/// 單字庫白名單登記回歸（純靜態、無 DB）：VocabularyWord 已登記進 TrashTypeRegistry
/// （進垃圾桶）＋標題摘要正確。ActivityLogInterceptor 的登記由 HTTP 活動流測試覆蓋。
/// </summary>
public sealed class VocabularyWhitelistTests
{
    [Fact]
    public void TrashTypeRegistry_已登記VocabularyWord型別()
    {
        TrashTypeRegistry.GetEntityType("VocabularyWord").Should().Be(typeof(VocabularyWord));
        TrashTypeRegistry.GetAllSupportedTypes().Should().Contain("VocabularyWord");
    }

    [Fact]
    public void TrashTypeRegistry_標題取單字()
    {
        var card = new VocabularyWord { Word = "serendipity" };

        TrashTypeRegistry.GetTitle(card).Should().Be("serendipity");
    }
}
