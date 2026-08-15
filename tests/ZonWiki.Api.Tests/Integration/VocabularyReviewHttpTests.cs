using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Xunit;
using ZonWiki.Domain.Entities;
using ZonWiki.Domain.Srs;

namespace ZonWiki.Api.Tests.Integration;

/// <summary>
/// 單字庫「到期佇列＋四鍵複習」的整合測試（PAT 驗證）：
/// 新卡即到期、未到期不出現、Due 升序、複習後端排程更新（查 DB 確認 Due 有變）、
/// Again 重置/Lapses、四鍵預覽單調、非法評分 400、跨使用者 404、連續 Good 間隔遞增、/due 跨租戶隔離。
/// </summary>
[Collection(ApiIntegrationCollection.Name)]
public sealed class VocabularyReviewHttpTests
{
    private readonly ZonWikiApiFactory _factory;

    public VocabularyReviewHttpTests(ZonWikiApiFactory factory)
    {
        _factory = factory;
    }

    private async Task<(Guid UserId, HttpClient Client)> NewUserClientAsync()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"vocab-rev-{Guid.NewGuid():N}@example.com");
        return (userId, _factory.CreateClientWithToken(token));
    }

    private static async Task<Guid> CreateVocabularyAsync(HttpClient client, string word)
    {
        var response = await client.PostAsJsonAsync("/api/vocabulary", new { word });
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        return Guid.Parse((await response.ReadJsonAsync())["data"]!["id"]!.GetValue<string>());
    }

    private async Task<VocabularyWord> GetCardFromDbAsync(Guid id)
    {
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            return await db.VocabularyWord.IgnoreQueryFilters().AsNoTracking().FirstAsync(v => v.Id == id);
        }
    }

    /// <summary>直接為使用者種一張指定 Due 的卡（控制到期時間，供佇列排序/過濾測試）。</summary>
    private async Task<Guid> SeedCardAsync(Guid userId, string word, DateTime dueUtc)
    {
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            var now = DateTime.UtcNow;
            var card = new VocabularyWord
            {
                UserId = userId,
                Word = word,
                Difficulty = 2.5,
                Due = dueUtc,
                CreatedDateTime = now,
                UpdatedDateTime = now,
                CreatedUser = userId.ToString(),
                UpdatedUser = userId.ToString(),
            };
            db.VocabularyWord.Add(card);
            await db.SaveChangesAsync();
            return card.Id;
        }
    }

    // R1
    [Fact]
    public async Task GetDue_新卡立即到期_出現在佇列()
    {
        var (_, client) = await NewUserClientAsync();
        var id = await CreateVocabularyAsync(client, "duenow");

        var json = await (await client.GetAsync("/api/vocabulary/due")).ReadJsonAsync();

        json["data"]!.AsArray().Select(n => n!["id"]!.GetValue<string>()).Should().Contain(id.ToString());
    }

    // R2
    [Fact]
    public async Task GetDue_未到期卡_不出現()
    {
        var (userId, client) = await NewUserClientAsync();
        var futureId = await SeedCardAsync(userId, "future", DateTime.UtcNow.AddDays(3));

        var json = await (await client.GetAsync("/api/vocabulary/due")).ReadJsonAsync();

        json["data"]!.AsArray().Select(n => n!["id"]!.GetValue<string>()).Should().NotContain(futureId.ToString());
    }

    // R3
    [Fact]
    public async Task GetDue_依Due升序()
    {
        var (userId, client) = await NewUserClientAsync();
        var now = DateTime.UtcNow;
        var idLatest = await SeedCardAsync(userId, "latest", now.AddMinutes(-1));
        var idEarliest = await SeedCardAsync(userId, "earliest", now.AddHours(-5));
        var idMiddle = await SeedCardAsync(userId, "middle", now.AddHours(-2));

        var json = await (await client.GetAsync("/api/vocabulary/due")).ReadJsonAsync();
        var orderedIds = json["data"]!.AsArray().Select(n => n!["id"]!.GetValue<string>()).ToList();

        orderedIds.IndexOf(idEarliest.ToString()).Should().BeLessThan(orderedIds.IndexOf(idMiddle.ToString()));
        orderedIds.IndexOf(idMiddle.ToString()).Should().BeLessThan(orderedIds.IndexOf(idLatest.ToString()));
    }

    // R4
    [Fact]
    public async Task PostReview_Good_後端更新排程且Due往後()
    {
        var (_, client) = await NewUserClientAsync();
        var id = await CreateVocabularyAsync(client, "review-good");
        var before = DateTime.UtcNow;

        var response = await client.PostAsJsonAsync($"/api/vocabulary/{id}/review", new { rating = "good" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.ReadJsonAsync();
        json["data"]!["card"]!["reps"]!.GetValue<int>().Should().Be(1);
        json["data"]!["card"]!["state"]!.GetValue<string>().Should().Be("review");

        var card = await GetCardFromDbAsync(id);
        card.Due.Should().BeAfter(before, "複習後端排程應把 Due 往後推（查 DB 確認）");
        card.LastReviewDateTime.Should().NotBeNull();
        card.Stability.Should().Be(1);
    }

    // R5
    [Fact]
    public async Task PostReview_Again_Lapses與重置()
    {
        var (_, client) = await NewUserClientAsync();
        var id = await CreateVocabularyAsync(client, "review-again");

        // 先 good good 讓卡畢業（n=2, Review）。
        await client.PostAsJsonAsync($"/api/vocabulary/{id}/review", new { rating = "good" });
        await client.PostAsJsonAsync($"/api/vocabulary/{id}/review", new { rating = "good" });

        var json = await (await client.PostAsJsonAsync($"/api/vocabulary/{id}/review", new { rating = "again" })).ReadJsonAsync();

        json["data"]!["card"]!["lapses"]!.GetValue<int>().Should().Be(1);
        json["data"]!["card"]!["reps"]!.GetValue<int>().Should().Be(0);
        json["data"]!["card"]!["state"]!.GetValue<string>().Should().Be("relearning");
    }

    // R6
    [Fact]
    public async Task PostReview_成熟卡回四鍵下次間隔預覽_單調()
    {
        var (_, client) = await NewUserClientAsync();
        var id = await CreateVocabularyAsync(client, "mature");

        // 連 good 3 次到成熟（n=3, I=15）。
        await client.PostAsJsonAsync($"/api/vocabulary/{id}/review", new { rating = "good" });
        await client.PostAsJsonAsync($"/api/vocabulary/{id}/review", new { rating = "good" });
        var json = await (await client.PostAsJsonAsync($"/api/vocabulary/{id}/review", new { rating = "good" })).ReadJsonAsync();

        var preview = json["data"]!["card"]!["schedulePreview"]!;
        var again = preview["again"]!["intervalDays"]!.GetValue<double>();
        var hard = preview["hard"]!["intervalDays"]!.GetValue<double>();
        var good = preview["good"]!["intervalDays"]!.GetValue<double>();
        var easy = preview["easy"]!["intervalDays"]!.GetValue<double>();

        again.Should().Be(1);
        hard.Should().BeLessThan(good);
        good.Should().BeLessThan(easy);
        preview["good"]!["due"]!.GetValue<DateTime>().Should().BeAfter(DateTime.UtcNow);
    }

    // R7
    [Fact]
    public async Task PostReview_非法rating_回400()
    {
        var (_, client) = await NewUserClientAsync();
        var id = await CreateVocabularyAsync(client, "badrating");

        var response = await client.PostAsJsonAsync($"/api/vocabulary/{id}/review", new { rating = "xxx" });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    // R8
    [Fact]
    public async Task PostReview_跨使用者_回404()
    {
        var (_, clientA) = await NewUserClientAsync();
        var (_, clientB) = await NewUserClientAsync();
        var idB = await CreateVocabularyAsync(clientB, "b-card");

        var response = await clientA.PostAsJsonAsync($"/api/vocabulary/{idB}/review", new { rating = "good" });

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    // R9
    [Fact]
    public async Task PostReview_連續Good_間隔遞增_1_6_15()
    {
        var (_, client) = await NewUserClientAsync();
        var id = await CreateVocabularyAsync(client, "increasing");

        var stabilities = new List<double>();
        for (var i = 0; i < 3; i++)
        {
            (await client.PostAsJsonAsync($"/api/vocabulary/{id}/review", new { rating = "good" }))
                .StatusCode.Should().Be(HttpStatusCode.OK);
            stabilities.Add((await GetCardFromDbAsync(id)).Stability);
        }

        stabilities.Should().Equal(1, 6, 15);
    }

    // R11（審查 #1：SM-2 無間隔上限 → 連按 Easy 讓間隔暴衝、AddDays 溢位成 500）
    // 連按多次 Easy，每次 Review 與其後的清單／到期佇列讀取皆須 200（不得 500）。
    [Fact]
    public async Task PostReview_連按多次Easy_Review與清單讀取皆不500()
    {
        var (_, client) = await NewUserClientAsync();
        var id = await CreateVocabularyAsync(client, "easyoverflow");

        // 連按 15 次 Easy：未夾上限時，約第 11~12 次會讓 Stability 暴衝，
        // 使 Review 的 now.AddDays(interval) 或清單預覽的 now.AddDays(easy 間隔) 溢位成未攔截 500。
        for (var i = 0; i < 15; i++)
        {
            (await client.PostAsJsonAsync($"/api/vocabulary/{id}/review", new { rating = "easy" }))
                .StatusCode.Should().Be(HttpStatusCode.OK, $"第 {i + 1} 次 Easy 複習不得因間隔溢位回 500");
        }

        // 清單讀取會對每張卡計算四鍵預覽（now.AddDays(...)），最易踩溢位——須 200。
        (await client.GetAsync("/api/vocabulary")).StatusCode.Should().Be(HttpStatusCode.OK, "清單讀取不得因間隔溢位回 500");
        (await client.GetAsync("/api/vocabulary/due")).StatusCode.Should().Be(HttpStatusCode.OK);

        // 夾上限後，Stability 應停在上限內。
        var card = await GetCardFromDbAsync(id);
        card.Stability.Should().BeLessThanOrEqualTo(Sm2Scheduler.MaxIntervalDays);
    }

    // R10（審查 MEDIUM：/due 跨租戶隔離）
    [Fact]
    public async Task GetDue_跨使用者隔離_不含他人到期卡()
    {
        var (_, clientA) = await NewUserClientAsync();
        var (userIdB, _) = await NewUserClientAsync();
        var dueCardB = await SeedCardAsync(userIdB, "b-due", DateTime.UtcNow.AddMinutes(-1));

        var json = await (await clientA.GetAsync("/api/vocabulary/due")).ReadJsonAsync();

        json["data"]!.AsArray().Select(n => n!["id"]!.GetValue<string>())
            .Should().NotContain(dueCardB.ToString(), "A 的到期佇列不得含 B 的到期卡");
    }
}
