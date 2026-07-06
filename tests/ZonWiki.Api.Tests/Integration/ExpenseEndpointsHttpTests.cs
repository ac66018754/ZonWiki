using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using Xunit;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Api.Tests.Integration;

/// <summary>
/// 記帳手動 CRUD＋分類端點的「真 HTTP」整合測試（PAT 驗證）：
/// 建立／驗證／篩選／分頁／更新／軟刪除／分類種子／跨使用者隔離／未驗證 401。
/// </summary>
[Collection(ApiIntegrationCollection.Name)]
public sealed class ExpenseEndpointsHttpTests
{
    private readonly ZonWikiApiFactory _factory;

    public ExpenseEndpointsHttpTests(ZonWikiApiFactory factory)
    {
        _factory = factory;
    }

    private async Task<(Guid UserId, HttpClient Client)> NewUserClientAsync()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"exp-{Guid.NewGuid():N}@example.com");
        return (userId, _factory.CreateClientWithToken(token));
    }

    private static async Task<Guid> CreateExpenseAsync(HttpClient client, object body)
    {
        var response = await client.PostAsJsonAsync("/api/expenses", body);
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var json = await response.ReadJsonAsync();
        return Guid.Parse(json["data"]!["id"]!.GetValue<string>());
    }

    [Fact]
    public async Task PostExpense_合法_回201並落庫()
    {
        var (_, client) = await NewUserClientAsync();

        var response = await client.PostAsJsonAsync("/api/expenses", new
        {
            amount = 120.50m,
            merchant = "全家便利商店",
            items = new[] { "咖啡", "御飯糰" },
        });

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var json = await response.ReadJsonAsync();
        json["data"]!["amount"]!.GetValue<decimal>().Should().Be(120.50m);
        json["data"]!["currency"]!.GetValue<string>().Should().Be("TWD");
        json["data"]!["source"]!.GetValue<string>().Should().Be("manual");
        json["data"]!["items"]!.AsArray().Should().HaveCount(2);
    }

    [Fact]
    public async Task PostExpense_金額非正_回400()
    {
        var (_, client) = await NewUserClientAsync();

        var response = await client.PostAsJsonAsync("/api/expenses", new { amount = 0m });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task PostExpense_categoryId非本人_回400()
    {
        var (_, clientA) = await NewUserClientAsync();
        var (_, clientB) = await NewUserClientAsync();

        // 取 B 的一個分類 Id。
        var bCats = await (await clientB.GetAsync("/api/expenses/categories")).ReadJsonAsync();
        var bCategoryId = bCats["data"]!.AsArray()[0]!["id"]!.GetValue<string>();

        // A 用 B 的分類建消費 → 400。
        var response = await clientA.PostAsJsonAsync("/api/expenses", new
        {
            amount = 50m,
            categoryId = bCategoryId,
        });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task GetExpenses_預設_回本人清單且不含軟刪()
    {
        var (_, client) = await NewUserClientAsync();
        var id1 = await CreateExpenseAsync(client, new { amount = 10m, merchant = "A店" });
        var id2 = await CreateExpenseAsync(client, new { amount = 20m, merchant = "B店" });

        // 軟刪 id1。
        (await client.DeleteAsync($"/api/expenses/{id1}")).StatusCode.Should().Be(HttpStatusCode.NoContent);

        var json = await (await client.GetAsync("/api/expenses")).ReadJsonAsync();
        var ids = json["data"]!.AsArray().Select(n => n!["id"]!.GetValue<string>()).ToList();
        ids.Should().Contain(id2.ToString());
        ids.Should().NotContain(id1.ToString());
    }

    [Fact]
    public async Task GetExpenses_from到to篩選_只回區間內()
    {
        var (_, client) = await NewUserClientAsync();
        await CreateExpenseAsync(client, new { amount = 11m, merchant = "一月", occurredDateTime = "2026-01-15T00:00:00Z" });
        await CreateExpenseAsync(client, new { amount = 22m, merchant = "三月", occurredDateTime = "2026-03-15T00:00:00Z" });
        await CreateExpenseAsync(client, new { amount = 33m, merchant = "五月", occurredDateTime = "2026-05-15T00:00:00Z" });

        var json = await (await client.GetAsync(
            "/api/expenses?from=2026-02-01T00:00:00Z&to=2026-04-01T00:00:00Z")).ReadJsonAsync();

        var merchants = json["data"]!.AsArray().Select(n => n!["merchant"]!.GetValue<string>()).ToList();
        merchants.Should().ContainSingle().Which.Should().Be("三月");
    }

    [Fact]
    public async Task GetExpenses_categoryId篩選_只回該分類()
    {
        var (_, client) = await NewUserClientAsync();
        var cats = await (await client.GetAsync("/api/expenses/categories")).ReadJsonAsync();
        var foodId = cats["data"]!.AsArray()
            .First(n => n!["name"]!.GetValue<string>() == "餐飲")!["id"]!.GetValue<string>();
        var trafficId = cats["data"]!.AsArray()
            .First(n => n!["name"]!.GetValue<string>() == "交通")!["id"]!.GetValue<string>();

        await CreateExpenseAsync(client, new { amount = 100m, categoryId = foodId, merchant = "餐" });
        await CreateExpenseAsync(client, new { amount = 200m, categoryId = trafficId, merchant = "車" });

        var json = await (await client.GetAsync($"/api/expenses?categoryId={foodId}")).ReadJsonAsync();
        var merchants = json["data"]!.AsArray().Select(n => n!["merchant"]!.GetValue<string>()).ToList();
        merchants.Should().ContainSingle().Which.Should().Be("餐");
    }

    [Fact]
    public async Task GetExpenses_未帶limit_套預設上限50()
    {
        // 修正 #5：未帶 limit 時套預設 50（避免無上限全量回傳）。直接種 55 筆（比 HTTP 逐筆快）。
        var (userId, client) = await NewUserClientAsync();

        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            var now = DateTime.UtcNow;
            for (var i = 0; i < 55; i++)
            {
                db.Expense.Add(new Expense
                {
                    UserId = userId,
                    OccurredDateTime = now.AddMinutes(-i),
                    Amount = 10m + i,
                    Currency = "TWD",
                    RawText = $"種子 {i}",
                    Source = "manual",
                    CreatedUser = userId.ToString(),
                    UpdatedUser = userId.ToString(),
                });
            }

            await db.SaveChangesAsync();
        }

        var json = await (await client.GetAsync("/api/expenses")).ReadJsonAsync();

        json["data"]!.AsArray().Should().HaveCount(50, "未帶 limit 應套預設 50");
        json["meta"]!["total"]!.GetValue<int>().Should().Be(55, "meta.total 仍反映實際總數");
    }

    [Fact]
    public async Task PostExpense_商家過長_回400()
    {
        // 修正 #3：Merchant ≤ 256 字元。
        var (_, client) = await NewUserClientAsync();

        var response = await client.PostAsJsonAsync("/api/expenses", new
        {
            amount = 10m,
            merchant = new string('店', 257),
        });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task PostExpense_品項過多_回400()
    {
        // 修正 #3：品項最多 50 項。
        var (_, client) = await NewUserClientAsync();

        var response = await client.PostAsJsonAsync("/api/expenses", new
        {
            amount = 10m,
            items = Enumerable.Range(0, 51).Select(i => $"品項{i}").ToArray(),
        });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task PostExpense_單筆品項過長_回400()
    {
        // 修正 #3：單筆品項 ≤ 100 字元。
        var (_, client) = await NewUserClientAsync();

        var response = await client.PostAsJsonAsync("/api/expenses", new
        {
            amount = 10m,
            items = new[] { new string('料', 101) },
        });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task PostExpense_金額超上限_回400()
    {
        // 修正 #3：金額 ≤ numeric(18,2) 上限（此值 1e17 已超出）。
        var (_, client) = await NewUserClientAsync();

        var response = await client.PostAsJsonAsync("/api/expenses", new
        {
            amount = 100000000000000000m,
        });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task GetExpenses_limit與offset_正確分頁且Meta含total()
    {
        var (_, client) = await NewUserClientAsync();
        for (var i = 0; i < 5; i++)
        {
            await CreateExpenseAsync(client, new { amount = 10m + i, merchant = $"店{i}" });
        }

        var json = await (await client.GetAsync("/api/expenses?limit=2&offset=1")).ReadJsonAsync();

        json["data"]!.AsArray().Should().HaveCount(2);
        json["meta"]!["total"]!.GetValue<int>().Should().Be(5);
    }

    [Fact]
    public async Task PutExpense_改金額與分類_更新成功且可清NeedsConfirmation()
    {
        var (_, client) = await NewUserClientAsync();
        var id = await CreateExpenseAsync(client, new { amount = 3000m, merchant = "誤聽", needsConfirmation = true });

        var cats = await (await client.GetAsync("/api/expenses/categories")).ReadJsonAsync();
        var foodId = cats["data"]!.AsArray()
            .First(n => n!["name"]!.GetValue<string>() == "餐飲")!["id"]!.GetValue<string>();

        var response = await client.PutAsJsonAsync($"/api/expenses/{id}", new
        {
            amount = 300m,
            categoryId = foodId,
            needsConfirmation = false,
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.ReadJsonAsync();
        json["data"]!["amount"]!.GetValue<decimal>().Should().Be(300m);
        json["data"]!["categoryName"]!.GetValue<string>().Should().Be("餐飲");
        json["data"]!["needsConfirmation"]!.GetValue<bool>().Should().BeFalse();
    }

    [Fact]
    public async Task PutExpense_跨使用者_回404()
    {
        var (_, clientA) = await NewUserClientAsync();
        var (_, clientB) = await NewUserClientAsync();
        var idB = await CreateExpenseAsync(clientB, new { amount = 99m, merchant = "B" });

        var response = await clientA.PutAsJsonAsync($"/api/expenses/{idB}", new { amount = 1m });

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task DeleteExpense_軟刪_回204且清單不再出現()
    {
        var (_, client) = await NewUserClientAsync();
        var id = await CreateExpenseAsync(client, new { amount = 55m, merchant = "刪我" });

        var del = await client.DeleteAsync($"/api/expenses/{id}");
        del.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var json = await (await client.GetAsync("/api/expenses")).ReadJsonAsync();
        json["data"]!.AsArray().Select(n => n!["id"]!.GetValue<string>()).Should().NotContain(id.ToString());
    }

    [Fact]
    public async Task GetCategories_首次_回8預設種子()
    {
        var (_, client) = await NewUserClientAsync();

        var json = await (await client.GetAsync("/api/expenses/categories")).ReadJsonAsync();
        var names = json["data"]!.AsArray().Select(n => n!["name"]!.GetValue<string>()).ToList();

        names.Should().Contain(new[] { "餐飲", "交通", "購物", "娛樂", "日用", "醫療", "訂閱", "其他" });
        names.Should().HaveCount(8);
    }

    [Fact]
    public async Task PostCategory_新名稱_建立成功()
    {
        var (_, client) = await NewUserClientAsync();

        var response = await client.PostAsJsonAsync("/api/expenses/categories", new { name = "寵物", icon = "🐾" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.ReadJsonAsync();
        json["data"]!["name"]!.GetValue<string>().Should().Be("寵物");

        var list = await (await client.GetAsync("/api/expenses/categories")).ReadJsonAsync();
        list["data"]!.AsArray().Select(n => n!["name"]!.GetValue<string>()).Should().Contain("寵物");
    }

    [Fact]
    public async Task PostCategory_名稱過長_回400()
    {
        // 修正 #3（延伸）：分類名稱 ≤ 128 字元，超長回友善 400 而非 DB 未包裝 500。
        var (_, client) = await NewUserClientAsync();

        var response = await client.PostAsJsonAsync("/api/expenses/categories",
            new { name = new string('類', 129) });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task NoToken_寫入端點_回401()
    {
        var client = _factory.CreateClient();

        var response = await client.PostAsJsonAsync("/api/expenses", new { amount = 10m });

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task CrossUser_讀他人Expense清單_看不到()
    {
        var (_, clientA) = await NewUserClientAsync();
        var (_, clientB) = await NewUserClientAsync();
        var idB = await CreateExpenseAsync(clientB, new { amount = 77m, merchant = "B私密" });

        var json = await (await clientA.GetAsync("/api/expenses")).ReadJsonAsync();

        json["data"]!.AsArray().Select(n => n!["id"]!.GetValue<string>()).Should().NotContain(idB.ToString());
    }
}
