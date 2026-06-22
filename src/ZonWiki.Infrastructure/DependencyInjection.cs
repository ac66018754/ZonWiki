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
                    Persistence.UserModelCacheKeyFactory>();
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
        services.AddScoped<AiProviderFactory>();

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

        return services;
    }
}
