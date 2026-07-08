using Microsoft.AspNetCore.Mvc.Testing;
using Testcontainers.PostgreSql;
using Xunit;

namespace ZonWiki.Api.Tests.Integration;

/// <summary>
/// WebApplicationFactory 整合測試基座（審查 #41）。
///
/// 這是「真 HTTP」整合測試的共用基座：以 <see cref="WebApplicationFactory{TEntryPoint}"/> 在記憶體中
/// 啟動整個 ZonWiki API（含真實驗證管線、EF Core、使用者隔離攔截器），並把資料庫連線字串
/// 覆寫成一顆由 Testcontainers 啟動的「真 PostgreSQL」容器——與正式環境同一套 Npgsql 提供者，
/// 確保 migration、trigram 索引、xmin 樂觀鎖等 Postgres 專屬行為皆真實生效（非 InMemory 假象）。
///
/// 生命週期：實作 <see cref="IAsyncLifetime"/>，容器於 <see cref="InitializeAsync"/> 啟動、
/// <see cref="DisposeAsync"/> 銷毀。透過 xUnit 的 <c>ICollectionFixture</c> 讓「同一個測試集合」
/// 共用「同一顆容器」（審查 #44），避免每個測試類別各起一顆容器拖慢 CI。
///
/// 設定覆寫要點：
/// 1. 連線字串 <c>ConnectionStrings:Postgres</c> → 指向容器（Program.cs 啟動時會 MigrateAsync 建結構）。
/// 2. 環境設為 "Testing" → 略過 Program.cs 的「開發用 seed」與「Production 專屬」啟動邏輯。
/// 3. <c>Ai:Provider=Fake</c> → 用 FakeAiProvider，避免相依本機才有的 claude CLI。
/// </summary>
public sealed class ZonWikiApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    /// <summary>
    /// 供整合測試使用的真實 PostgreSQL 容器（與 UserDataIsolationTests 同一映像，確保行為一致）。
    /// </summary>
    private readonly PostgreSqlContainer _postgresContainer = new PostgreSqlBuilder()
        .WithImage("postgres:16-alpine")
        .Build();

    /// <summary>
    /// 附件落地用的暫存根目錄（每次測試回合唯一；避免測試把圖檔寫進 repo 的 App_Data）。
    /// 注意：必須在此處（host build 之前）以環境變數注入——與連線字串同款的「唯一合法時機窗口」；
    /// 個別測試類別內再設環境變數已來不及（設定值於 host 首次 build 時凍結）。
    /// </summary>
    public string AttachmentRootPath { get; } = Path.Combine(
        Path.GetTempPath(), "zonwiki-test-attachments", Guid.NewGuid().ToString("N"));

    /// <summary>
    /// 啟動 PostgreSQL 容器，並以「環境變數」注入連線字串與測試設定。
    ///
    /// 為何用環境變數而非 <c>ConfigureAppConfiguration</c>：本 API 採「最小主機」（<c>WebApplication.CreateBuilder</c>），
    /// 其 <c>Program.cs</c> 在 <c>builder.Build()</c> 之前就讀取連線字串（<c>AddZonWikiInfrastructure</c>）。
    /// WebApplicationFactory 的 <c>ConfigureAppConfiguration</c> 覆寫要到 <c>Build()</c> 攔截時才套用——為時已晚。
    /// 而環境變數會被 <c>CreateBuilder</c> 的預設設定來源（AddEnvironmentVariables）在最初就讀入，
    /// 故一定趕得上。容器由本集合固定物件唯一擁有、共用一顆，設定程序層級環境變數不會與其它測試衝突。
    /// </summary>
    public async Task InitializeAsync()
    {
        await _postgresContainer.StartAsync();

        // 指向 Testcontainers 啟動的真實 PostgreSQL（Program.cs 啟動時會 MigrateAsync 建結構）。
        Environment.SetEnvironmentVariable(
            "ConnectionStrings__Postgres",
            _postgresContainer.GetConnectionString());
        // 用 Fake AI 提供者，測試不相依本機才有的 claude CLI。
        Environment.SetEnvironmentVariable("Ai__Provider", "Fake");
        // 環境設為 Testing：避開 Program.cs 內 IsDevelopment()／IsProduction() 專屬啟動分支。
        Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", "Testing");
        // 附件落地改指到暫存目錄（絕對路徑會直接採用，不以 ContentRoot 為基準）。
        Environment.SetEnvironmentVariable("Attachments__RootPath", AttachmentRootPath);
    }

    /// <summary>
    /// 停止並銷毀容器與底層主機，並清除本測試注入的環境變數。
    /// </summary>
    public new async Task DisposeAsync()
    {
        Environment.SetEnvironmentVariable("ConnectionStrings__Postgres", null);
        Environment.SetEnvironmentVariable("Ai__Provider", null);
        Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", null);
        Environment.SetEnvironmentVariable("Attachments__RootPath", null);
        await _postgresContainer.StopAsync();
        await _postgresContainer.DisposeAsync();
        await base.DisposeAsync();

        // 清掉本回合的附件暫存目錄（測試自建的暫存資料，非產品資料）。
        try
        {
            if (Directory.Exists(AttachmentRootPath))
            {
                Directory.Delete(AttachmentRootPath, recursive: true);
            }
        }
        catch
        {
            // 暫存目錄清理失敗不影響測試結果（OS 會定期清 Temp）。
        }
    }
}

/// <summary>
/// 整合測試集合定義：讓所有標註 <c>[Collection(ApiIntegrationCollection.Name)]</c> 的測試類別
/// 共用「同一個 <see cref="ZonWikiApiFactory"/> 實例」（即同一顆 PostgreSQL 容器與同一個 API 主機），
/// 大幅降低 CI 時間（審查 #44：ICollectionFixture 共用容器）。
/// </summary>
[CollectionDefinition(Name)]
public sealed class ApiIntegrationCollection : ICollectionFixture<ZonWikiApiFactory>
{
    /// <summary>
    /// 集合名稱常數（供 <c>[Collection(...)]</c> 引用，避免字串魔法值散落）。
    /// </summary>
    public const string Name = "ZonWiki API Integration";
}
