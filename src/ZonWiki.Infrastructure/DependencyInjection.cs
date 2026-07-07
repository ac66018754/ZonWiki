using System.Net.Http;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using ZonWiki.Infrastructure.Ai;
using ZonWiki.Infrastructure.Auth;
using ZonWiki.Infrastructure.Notes;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Infrastructure;

public static class DependencyInjection
{
    public const string PostgresConnectionName = "Postgres";

    public static IServiceCollection AddZonWikiInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString(PostgresConnectionName)
            ?? throw new InvalidOperationException(
                $"Connection string '{PostgresConnectionName}' is not configured.");

        services.AddSingleton<AuditingSaveChangesInterceptor>();
        services.AddSingleton<ActivityLogInterceptor>();
        services.AddSingleton<UserIsolationMaterializationInterceptor>();

        services.AddDbContext<ZonWikiDbContext>((sp, options) =>
        {
            options
                .UseNpgsql(connectionString, npgsql =>
                    npgsql.MigrationsAssembly(typeof(ZonWikiDbContext).Assembly.FullName))
                // 順序重要：先稽核（設好實體 Id/時間），再活動紀錄（自行設好紀錄列欄位）。
                .AddInterceptors(
                    sp.GetRequiredService<AuditingSaveChangesInterceptor>(),
                    sp.GetRequiredService<ActivityLogInterceptor>(),
                    // 使用者隔離「最終防線」：每筆 IUserOwned 具現化都再核對一次 UserId，
                    // 非本人即 fail-closed 中止——即使其他層已過濾過也再篩一次，杜絕任何回應外洩。
                    sp.GetRequiredService<UserIsolationMaterializationInterceptor>())
                // 使用者隔離過濾把 UserId 烤進模型，故模型快取需依使用者區分。
                .ReplaceService<Microsoft.EntityFrameworkCore.Infrastructure.IModelCacheKeyFactory,
                    Persistence.UserModelCacheKeyFactory>()
                // 抑制 ManyServiceProvidersCreatedWarning：正式環境是「單一主機＝單一內部服務供應者」，
                // 此警告永不觸發；但整合測試以 WebApplicationFactory／WithWebHostBuilder 啟動多個主機
                // （每個主機各建一個 EF 內部服務供應者），會累計超過 EF 的 20 個上限而把警告升級為例外，
                // 讓後續 DbContext 建立全數失敗。這是純測試情境的副作用，故一律忽略（不影響正式行為）。
                .ConfigureWarnings(warnings =>
                    warnings.Ignore(
                        Microsoft.EntityFrameworkCore.Diagnostics.CoreEventId.ManyServiceProvidersCreatedWarning));
        }, ServiceLifetime.Scoped, ServiceLifetime.Scoped);

        services.AddScoped<UserProvisioningService>();

        /// <summary>
        /// 註冊筆記 AI 服務：真實實作，透過 AiProviderFactory 解析的共用 Gemini 模型進行排版／美化。
        /// （PassThroughNoteAiService 仍保留為備援 Stub，未註冊使用。）
        /// </summary>
        services.AddScoped<INoteAiService, GeminiNoteAiService>();

        // AI 層註冊（P4 - 開問啦移植）
        // Data Protection 金鑰：明確固定「應用程式名稱」與「金鑰存放位置」。
        // 否則金鑰會以「內容根路徑」做隔離，API 以不同方式/路徑重啟時金鑰環就對不上
        // → 既有的登入 Cookie（zonwiki.auth）無法解密而被登出，連 AI 金鑰加密也會跨重啟失效。
        //
        // 金鑰存放路徑的決定方式：
        //  - 優先讀設定 DataProtection:KeyPath（環境變數寫法為 DataProtection__KeyPath）。
        //    雲端 / 容器部署時掛一個持久卷（例如 /app/dpkeys）並指定此設定，金鑰才能跨重建保存，
        //    也才能把舊機（本機）的主鑰搬過去、解開既有的 AI 金鑰密文。
        //  - 未設定時（本機開發）退回 %LOCALAPPDATA%\ZonWiki\DataProtection-Keys。
        // 兩種環境都維持相同的 ApplicationName("ZonWiki")，搬機後既有密文才解得開。
        var dataProtectionKeysPath = configuration["DataProtection:KeyPath"];
        if (string.IsNullOrWhiteSpace(dataProtectionKeysPath))
        {
            dataProtectionKeysPath = System.IO.Path.Combine(
                System.Environment.GetFolderPath(System.Environment.SpecialFolder.LocalApplicationData),
                "ZonWiki",
                "DataProtection-Keys");
        }

        // 確保金鑰資料夾存在：PersistKeysToFileSystem 不會自動建立目錄，
        // 容器首次啟動時掛載點可能是空目錄，需確保可寫入。
        System.IO.Directory.CreateDirectory(dataProtectionKeysPath);

        services.AddDataProtection()
            .SetApplicationName("ZonWiki")
            .PersistKeysToFileSystem(new System.IO.DirectoryInfo(dataProtectionKeysPath));
        services.AddScoped<AiModelResolver>();
        // VertexAdc 的 ADC token 提供者：singleton 持有 GoogleCredential 以跨請求快取／自動刷新 token。
        // 註冊在 AiProviderFactory 之前，讓工廠的選填建構參數能自動注入。
        services.AddSingleton<IVertexAdcTokenProvider, VertexAdcTokenProvider>();
        services.AddScoped<AiProviderFactory>();

        // 「精煉成筆記」：yt-dlp 擷取 + 文章抓取 + OpenAI 相容轉錄（Groq）。
        services.AddScoped<Refine.ITranscriptionService, Refine.OpenAiCompatibleTranscriptionService>();
        services.AddScoped<Refine.ArticleFetchService>();
        var ytDlpPath = configuration["Refine:YtDlpPath"] ?? "yt-dlp";
        // 住宅代理 + 登入 cookies（皆可選）：讓資料中心 IP 的 prod 借「住宅 IP ＋ 已登入」抓
        // 會擋資料中心或需登入的站（YouTube/IG）。設定鍵：Refine:Proxy、Refine:CookiesPath。
        var refineProxy = configuration["Refine:Proxy"];
        var refineCookiesPath = configuration["Refine:CookiesPath"];
        services.AddScoped(sp => new Refine.YtDlpService(
            sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<Refine.YtDlpService>>(),
            ytDlpPath, refineProxy, refineCookiesPath));
        // 上傳檔案精煉用：以 ffmpeg 把上傳的影音轉成 16kHz 單聲道 mp3 再送轉錄。
        var ffmpegPath = configuration["Refine:FfmpegPath"] ?? "ffmpeg";
        services.AddScoped(sp => new Refine.FfmpegAudioService(
            sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<Refine.FfmpegAudioService>>(),
            ffmpegPath));

        // 預設 AI 供應者：優先用 Fake（測試）、否則用本機 claude CLI
        var aiProviderType = configuration["Ai:Provider"] ?? "Default";
        if (aiProviderType == "Fake")
        {
            services.AddSingleton<IAiProvider>(new FakeAiProvider());
        }
        else
        {
            var claudeOptions = new ClaudeCliOptions();
            configuration.GetSection("Ai:ClaudeCli").Bind(claudeOptions);
            services.AddSingleton<IAiProvider>(new ClaudeCliProvider(claudeOptions));
        }

        services.AddHttpClient("ai", client =>
        {
            client.Timeout = TimeSpan.FromSeconds(600);
        });

        // ── TTS 子系統（其他功能群 Phase 2）：文字轉語音供應者＋音檔併檔／量時長合成器 ──────
        // 條件註冊（照 Ai:Provider 範式）：Tts:Provider=Fake（整合測試）→ Fake 短路真外呼；否則真實實作。
        // 真實 TTS 走 Cloud TTS API＋ADC token（GeminiCloudTtsService）；併檔重用既有 ffmpeg 路徑設定鍵 Refine:FfmpegPath。
        var ttsProviderType = configuration["Tts:Provider"] ?? "Default";
        if (string.Equals(ttsProviderType, "Fake", StringComparison.OrdinalIgnoreCase))
        {
            services.AddScoped<Tts.ITextToSpeechService, Tts.FakeTextToSpeechService>();
            services.AddScoped<Tts.ITtsAudioComposer, Tts.FakeAudioComposer>();
        }
        else
        {
            services.AddScoped<Tts.ITextToSpeechService, Tts.GeminiCloudTtsService>();
            var ffprobePath = configuration["Tts:FfprobePath"];
            services.AddScoped<Tts.ITtsAudioComposer>(sp => new Tts.TtsAudioComposer(
                sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<Tts.TtsAudioComposer>>(),
                ffmpegPath, // 重用「精煉」已解析的 ffmpeg 路徑（Refine:FfmpegPath，預設 "ffmpeg"）
                ffprobePath));
        }

        // Cloud TTS 命名 client：合成單段（≤4000 bytes）通常數秒內回，給 120 秒上限即足夠。
        services.AddHttpClient(Tts.GeminiCloudTtsService.HttpClientName, client =>
        {
            client.Timeout = TimeSpan.FromSeconds(120);
        });

        // 文章抓取專用 client：關閉自動轉址（AllowAutoRedirect=false）。
        // SSRF 防護要求「每個轉址目標都要重跑守門」，若讓 HttpClient 自動跟隨轉址，
        // 中途轉去內網 IP 的那一跳就繞過了 RefineUrlGuard；故改由 ArticleFetchService 逐跳手動驗證後再跟隨。
        services.AddHttpClient("refine-article", client =>
        {
            client.Timeout = TimeSpan.FromSeconds(60);
        })
        .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler
        {
            AllowAutoRedirect = false,
        });

        return services;
    }
}
