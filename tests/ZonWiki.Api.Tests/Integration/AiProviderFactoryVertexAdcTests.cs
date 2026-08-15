using System.Net;
using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using FluentAssertions;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Ai;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Tests.Integration;

/// <summary>
/// <see cref="AiProviderFactory.ResolveAsync"/> 的 VertexAdc 分支整合測試（真 PostgreSQL，重用整合基座容器，
/// 注入 stub token provider）。
///
/// 驗證（含 ADC token 外流防護修正後的新不變量）：
/// - VertexAdc 列掛在「系統共用身分」(<see cref="AiProviderFactory.SharedModelUserId"/>) 名下 → 任何呼叫者
///   都能解析到，以 ADC token 建 OpenAI 相容 provider（SupportsResume=false）。
/// - 「非共用身分」名下的 VertexAdc 列 → 拋例外（防攻擊者把系統 ADC token 導向自控端點）。
/// - VertexAdc BaseUrl 非 Vertex AI 官方端點（即使是公開 https）→ 拋例外（專屬白名單，比一般 SSRF 檢查更嚴）。
/// - ADC 不可用（token provider 拋例外）→ 例外向外傳播、不靜默。
/// - 未知 Provider 類型 → 拋例外（不靜默退回預設 Claude）。
/// - PUT /api/canvas/models-config 收到 VertexAdc → 400（伺服器端 Provider 白名單，使用者不可自建）。
/// - 既有 ClaudeCli／OpenAiCompatible 類型行為不受影響（回歸）。
///
/// 各測試以唯一 Key 種子 AiModel，彼此隔離；種子與查詢用不同 DI scope／DbContext，避免追蹤干擾。
/// </summary>
[Collection(ApiIntegrationCollection.Name)]
public sealed class AiProviderFactoryVertexAdcTests
{
    private readonly ZonWikiApiFactory _factory;

    /// <summary>合法的 Vertex OpenAI 相容端點（公開 https，IsBaseUrlSafe 放行）。</summary>
    private const string VertexBaseUrl =
        "https://aiplatform.googleapis.com/v1/projects/demo/locations/global/endpoints/openapi";

    public AiProviderFactoryVertexAdcTests(ZonWikiApiFactory factory)
    {
        _factory = factory;
    }

    private (IServiceScope Scope, ZonWikiDbContext Db) NewScope()
    {
        var scope = _factory.Services.CreateScope();
        return (scope, scope.ServiceProvider.GetRequiredService<ZonWikiDbContext>());
    }

    /// <summary>建立工廠：_default 為非-Fake 空供應者（避免短路），注入指定的 stub token provider。</summary>
    private static AiProviderFactory CreateFactory(
        ZonWikiDbContext db,
        IVertexAdcTokenProvider? tokenProvider = null,
        IAiProvider? defaultProvider = null)
    {
        var resolver = new AiModelResolver(
            db, DataProtectionProvider.Create("ZonWikiTests"), NullLogger<AiModelResolver>.Instance);
        return new AiProviderFactory(
            defaultProvider ?? new NoopProvider(), db, resolver, new StubHttpClientFactory(), tokenProvider);
    }

    private async Task SeedAsync(AiModel model)
    {
        var (scope, db) = NewScope();
        using (scope)
        {
            db.AiModel.Add(model);
            await db.SaveChangesAsync();
        }
    }

    private static AiModel VertexModel(Guid userId, string key, string baseUrl = VertexBaseUrl) => new()
    {
        UserId = userId,
        Key = key,
        Label = "Vertex Gemini Lite",
        Provider = "VertexAdc",
        Kind = "chat",
        Enabled = true,
        ModelId = "google/gemini-2.5-flash-lite",
        BaseUrl = baseUrl,
        CreatedUser = "test",
        UpdatedUser = "test",
    };

    [Fact]
    public async Task ResolveAsync_共用身分VertexAdc設定_建OpenAiCompatible且用ADCtoken()
    {
        // Vertex 列一律掛在系統共用身分名下（安全修正）；任何呼叫者都能解析到它。
        var callerUserId = Guid.NewGuid();
        var key = $"vertex-{Guid.NewGuid():N}";
        await SeedAsync(VertexModel(AiProviderFactory.SharedModelUserId, key));

        var (scope, db) = NewScope();
        using (scope)
        {
            var stubToken = new StubTokenProvider("fake-adc-token");
            var factory = CreateFactory(db, stubToken);

            var resolved = await factory.ResolveAsync(callerUserId, key);

            resolved.Provider.Should().BeOfType<OpenAiCompatibleStreamingProvider>();
            resolved.SupportsResume.Should().BeFalse();
            resolved.Model.Should().Be("google/gemini-2.5-flash-lite");
            stubToken.CallCount.Should().Be(1, "解析 VertexAdc 應向 ADC 取一次 token");
        }
    }

    [Fact]
    public async Task ResolveAsync_非共用身分的VertexAdc列_拋例外防token外流()
    {
        // 攻擊情境：一般使用者在自己名下建 VertexAdc 列 → 解析時必須拋錯（不得取 ADC token 送到其 BaseUrl）。
        var attackerUserId = Guid.NewGuid();
        var key = $"vertex-{Guid.NewGuid():N}";
        await SeedAsync(VertexModel(
            attackerUserId, key, baseUrl: "https://aiplatform.googleapis.com/v1/x/openapi"));

        var (scope, db) = NewScope();
        using (scope)
        {
            var stubToken = new StubTokenProvider("secret-adc-token");
            var factory = CreateFactory(db, stubToken);

            var act = async () => await factory.ResolveAsync(attackerUserId, key);
            (await act.Should().ThrowAsync<InvalidOperationException>())
                .WithMessage("*系統共用身分*");
            stubToken.CallCount.Should().Be(0, "拋錯應在取 ADC token 之前，token 絕不可被取出");
        }
    }

    [Fact]
    public async Task ResolveAsync_同鍵下自有列勝過共用VertexAdc列_不觸發ADC()
    {
        // 排序決定性：攻擊者用共用鍵在自己名下建一筆「合法的 OpenAiCompatible」列，
        // 解析時應命中自己的列（own 勝 shared），不會非決定性漂移到共用 VertexAdc 分支去取 ADC token。
        var attackerUserId = Guid.NewGuid();
        var sharedKey = $"vertex-{Guid.NewGuid():N}";

        await SeedAsync(VertexModel(AiProviderFactory.SharedModelUserId, sharedKey));
        await SeedAsync(new AiModel
        {
            UserId = attackerUserId,
            Key = sharedKey,
            Label = "attacker own",
            Provider = "OpenAiCompatible",
            Kind = "chat",
            Enabled = true,
            ModelId = "gpt-x",
            BaseUrl = "https://api.example.com/v1",
            ApiKeyEncrypted = "plain-test-key",
            CreatedUser = "test",
            UpdatedUser = "test",
        });

        var (scope, db) = NewScope();
        using (scope)
        {
            var stubToken = new StubTokenProvider("secret-adc-token");
            var factory = CreateFactory(db, stubToken);

            var resolved = await factory.ResolveAsync(attackerUserId, sharedKey);

            resolved.Provider.Should().BeOfType<OpenAiCompatibleStreamingProvider>();
            resolved.Model.Should().Be("gpt-x", "應命中攻擊者自己的 OpenAiCompatible 列（own 勝 shared）");
            stubToken.CallCount.Should().Be(0, "既未走 VertexAdc 分支，ADC token 絕不可被取出");
        }
    }

    [Fact]
    public async Task ResolveAsync_VertexAdc_BaseUrl非官方端點_拋例外()
    {
        // 即使是「公開 https」端點（一般 SSRF 檢查會放行），VertexAdc 專屬白名單也必須擋下非 Vertex 官方域名。
        var callerUserId = Guid.NewGuid();
        var key = $"vertex-{Guid.NewGuid():N}";
        await SeedAsync(VertexModel(
            AiProviderFactory.SharedModelUserId, key, baseUrl: "https://evil.example.com/v1"));

        var (scope, db) = NewScope();
        using (scope)
        {
            var stubToken = new StubTokenProvider("secret-adc-token");
            var factory = CreateFactory(db, stubToken);

            var act = async () => await factory.ResolveAsync(callerUserId, key);
            await act.Should().ThrowAsync<InvalidOperationException>();
            stubToken.CallCount.Should().Be(0, "BaseUrl 白名單不過應在取 ADC token 之前");
        }
    }

    [Fact]
    public async Task ResolveAsync_VertexAdc_BaseUrl不安全_拋例外()
    {
        var callerUserId = Guid.NewGuid();
        var key = $"vertex-{Guid.NewGuid():N}";
        await SeedAsync(VertexModel(AiProviderFactory.SharedModelUserId, key, "http://localhost/v1"));

        var (scope, db) = NewScope();
        using (scope)
        {
            var factory = CreateFactory(db, new StubTokenProvider("t"));

            var act = async () => await factory.ResolveAsync(callerUserId, key);
            await act.Should().ThrowAsync<InvalidOperationException>();
        }
    }

    [Fact]
    public async Task ResolveAsync_VertexAdc_ADC不可用_拋明確例外()
    {
        var callerUserId = Guid.NewGuid();
        var key = $"vertex-{Guid.NewGuid():N}";
        await SeedAsync(VertexModel(AiProviderFactory.SharedModelUserId, key));

        var (scope, db) = NewScope();
        using (scope)
        {
            var throwing = new ThrowingTokenProvider(
                "ADC 憑證不可用，請先跑 gcloud auth application-default login");
            var factory = CreateFactory(db, throwing);

            var act = async () => await factory.ResolveAsync(callerUserId, key);
            (await act.Should().ThrowAsync<InvalidOperationException>())
                .WithMessage("*gcloud auth application-default login*");
        }
    }

    [Fact]
    public async Task SaveModelsConfig_收到VertexAdc_回400不落庫()
    {
        // 伺服器端 Provider 白名單：使用者不可經 models-config 端點建立 VertexAdc（否則即可外流系統 ADC token）。
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"vertex-cfg-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);

        var body = new
        {
            Models = new[]
            {
                new
                {
                    Key = "attacker-vertex",
                    Label = "偷 token",
                    Provider = "VertexAdc",
                    Kind = "chat",
                    Enabled = true,
                    ModelId = "google/gemini-2.5-flash-lite",
                    BaseUrl = "https://attacker.example.com/v1",
                    ApiKey = (string?)null,
                    TimeoutSeconds = 300,
                    Notes = (string?)null,
                },
            },
        };

        var response = await client.PutAsJsonAsync("/api/canvas/models-config", body);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest, "VertexAdc 僅能由系統設定，端點應回 400");

        var (scope, db) = NewScope();
        using (scope)
        {
            var leaked = await db.AiModel.IgnoreQueryFilters()
                .AnyAsync(m => m.UserId == userId && m.Key == "attacker-vertex");
            leaked.Should().BeFalse("被拒的 VertexAdc 設定絕不可落庫");
        }
    }

    [Fact]
    public async Task ResolveAsync_未知Provider類型_拋例外不靜默回Claude()
    {
        var userId = Guid.NewGuid();
        var key = $"bogus-{Guid.NewGuid():N}";
        var bogus = VertexModel(userId, key);
        bogus.Provider = "Bogus";
        await SeedAsync(bogus);

        var (scope, db) = NewScope();
        using (scope)
        {
            var factory = CreateFactory(db, new StubTokenProvider("t"));

            var act = async () => await factory.ResolveAsync(userId, key);
            (await act.Should().ThrowAsync<InvalidOperationException>())
                .WithMessage("*Bogus*");
        }
    }

    [Fact]
    public async Task ResolveAsync_ClaudeCli類型_仍回預設供應者()
    {
        var userId = Guid.NewGuid();
        var key = $"claude-{Guid.NewGuid():N}";
        await SeedAsync(new AiModel
        {
            UserId = userId,
            Key = key,
            Label = "Claude Sonnet",
            Provider = "ClaudeCli",
            Kind = "chat",
            Enabled = true,
            ModelId = "sonnet",
            CreatedUser = "test",
            UpdatedUser = "test",
        });

        var (scope, db) = NewScope();
        using (scope)
        {
            var noop = new NoopProvider();
            var factory = CreateFactory(db, new StubTokenProvider("t"), noop);

            var resolved = await factory.ResolveAsync(userId, key);

            resolved.Provider.Should().BeSameAs(noop);
            resolved.Model.Should().Be("sonnet");
            resolved.SupportsResume.Should().BeTrue();
        }
    }

    [Fact]
    public async Task ResolveAsync_OpenAiCompatible類型_不受影響()
    {
        var userId = Guid.NewGuid();
        var key = $"openai-{Guid.NewGuid():N}";
        await SeedAsync(new AiModel
        {
            UserId = userId,
            Key = key,
            Label = "OpenAI Lite",
            Provider = "OpenAiCompatible",
            Kind = "chat",
            Enabled = true,
            ModelId = "gpt-x",
            BaseUrl = "https://api.example.com/v1",
            ApiKeyEncrypted = "plain-test-key",
            CreatedUser = "test",
            UpdatedUser = "test",
        });

        var (scope, db) = NewScope();
        using (scope)
        {
            var factory = CreateFactory(db, new StubTokenProvider("t"));

            var resolved = await factory.ResolveAsync(userId, key);

            resolved.Provider.Should().BeOfType<OpenAiCompatibleStreamingProvider>();
            resolved.SupportsResume.Should().BeFalse();
        }
    }

    /// <summary>回固定 token 的 stub，並計數呼叫次數。</summary>
    private sealed class StubTokenProvider(string token) : IVertexAdcTokenProvider
    {
        public int CallCount { get; private set; }

        public Task<string> GetAccessTokenAsync(CancellationToken cancellationToken = default)
        {
            CallCount++;
            return Task.FromResult(token);
        }
    }

    /// <summary>模擬 ADC 不可用：取 token 時拋例外。</summary>
    private sealed class ThrowingTokenProvider(string message) : IVertexAdcTokenProvider
    {
        public Task<string> GetAccessTokenAsync(CancellationToken cancellationToken = default)
            => throw new InvalidOperationException(message);
    }

    /// <summary>非-Fake 的空供應者，僅避免工廠短路（StreamAsync 不會被本測試呼叫）。</summary>
    private sealed class NoopProvider : IAiProvider
    {
        public async IAsyncEnumerable<AiStreamEvent> StreamAsync(
            string prompt, string? resumeSessionId = null, string? model = null, string? systemPrompt = null,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            await Task.CompletedTask;
            yield break;
        }
    }

    /// <summary>最小 IHttpClientFactory（本測試只建構供應者、不發 HTTP）。</summary>
    private sealed class StubHttpClientFactory : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new();
    }
}
