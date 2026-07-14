using Microsoft.EntityFrameworkCore;
using Serilog;
using Serilog.Events;
using ZonWiki.Api.Attachments;
using ZonWiki.Api.Auth;
using ZonWiki.Api.Endpoints;
using ZonWiki.Api.RateLimiting;
using ZonWiki.Api.Realtime;
using ZonWiki.Api.Services;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure;
using ZonWiki.Infrastructure.Auth;
using ZonWiki.Infrastructure.Notes;
using ZonWiki.Infrastructure.Persistence;

var builder = WebApplication.CreateBuilder(args);

// 結構化日誌（Serilog）：一律寫 Console（沿用 tmp/backend.log 導向），
// 並在設定有 Seq:ServerUrl 時額外送往本機 Seq（GUI 查詢、可跨專案；以 Application 屬性區分專案）。
// 決策：Seq sink 對「Seq 未啟動」具韌性（背景緩衝、不丟例外），故設了 URL 也不影響後端啟動。
var seqServerUrl = builder.Configuration["Seq:ServerUrl"];
builder.Services.AddSerilog((services, loggerConfiguration) =>
{
    loggerConfiguration
        .MinimumLevel.Information()
        .MinimumLevel.Override("Microsoft.AspNetCore", LogEventLevel.Information)
        .MinimumLevel.Override("Microsoft.EntityFrameworkCore", LogEventLevel.Warning)
        .Enrich.FromLogContext()
        .Enrich.WithProperty("Application", "ZonWiki.Api")
        .WriteTo.Console();

    if (!string.IsNullOrWhiteSpace(seqServerUrl))
    {
        loggerConfiguration.WriteTo.Seq(seqServerUrl);
    }
});

const string CorsPolicyName = "ZonWikiCors";

// CORS 允許來源：一律優先採設定（環境變數 Cors__AllowedOrigins 或 appsettings 的 Cors:AllowedOrigins）。
// 缺省時的回退僅限「開發環境」退回 http://localhost:3000（本機前端）；
// 正式環境必須由環境變數/設定「顯性」提供（見 docs：prod 要設 Cors__AllowedOrigins），
// 缺省即回退為「不允許任何跨域來源」，避免正式環境靜默沿用 localhost 這種過度寬鬆/不合實情的設定。
var configuredOrigins = builder.Configuration
    .GetSection("Cors:AllowedOrigins")
    .Get<string[]>();
var allowedOrigins = configuredOrigins
    ?? (builder.Environment.IsDevelopment() ? ["http://localhost:3000"] : []);

builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICurrentUser, CurrentUserService>();

builder.Services.AddCors(options =>
{
    options.AddPolicy(CorsPolicyName, policy =>
        policy.WithOrigins(allowedOrigins)
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials());
});

builder.Services.AddZonWikiInfrastructure(builder.Configuration);
builder.Services.AddZonWikiAuth(builder.Configuration, out var authConfigured);

// 端點限流（審查 #30/#58）：對 AI 提問／精煉、PAT 驗證、密碼登入端點加限流。
// 單機記憶體計數（不引入 Redis，見 docs/DECISIONS.md）；具名 policy 於各端點以 RequireRateLimiting 掛載。
builder.Services.AddZonWikiRateLimiting();

// AI 與 SSE 服務（P4 - 開問啦移植）
builder.Services.AddSingleton<SseHub>();
builder.Services.AddScoped<AskCancellationRegistry>();
builder.Services.AddScoped<AncestryService>();
builder.Services.AddScoped<CanvasService>(); // 畫布擁有權驗證＋CRUD 業務邏輯（#32）
builder.Services.AddScoped<AskOrchestrator>();
builder.Services.AddScoped<AskQueueService>();
builder.Services.AddScoped<RefineService>(); // 精煉成筆記協調器

// 重複規則「到期具現化」背景服務（#17）：每日把母規則的到期發生具現化成可打勾的實體任務卡。
builder.Services.AddHostedService<RecurringTaskMaterializationService>();

// 筆記附件（貼圖改存磁碟，內文只放短網址；見 docs/DECISIONS.md 2026-07-08）。
builder.Services.Configure<AttachmentOptions>(builder.Configuration.GetSection(AttachmentOptions.SectionName));
builder.Services.AddScoped<AttachmentService>();
builder.Services.AddSingleton<AttachmentOrphanScanner>();
// 孤兒附件定期清掃：每日一輪，未被內容引用且超過寬限期者軟刪除（絕不硬刪）。
builder.Services.AddHostedService<AttachmentOrphanCleanupService>();

var connectionString = builder.Configuration.GetConnectionString(
    DependencyInjection.PostgresConnectionName)
    ?? throw new InvalidOperationException("Postgres connection string missing.");

builder.Services.AddHealthChecks()
    .AddNpgSql(connectionString, name: "postgres");

builder.Services.AddOpenApi();

var app = builder.Build();

// Apply migrations on startup (dev convenience).
using (var scope = app.Services.CreateScope())
{
    var dbContext = scope.ServiceProvider.GetRequiredService<ZonWikiDbContext>();
    await dbContext.Database.MigrateAsync();

    // 正式環境沒有本機 claude CLI（僅 Local 有）→ 自動停用所有 ClaudeCli 模型，
    // 避免節點下拉選到一定會失敗的項目（遷移自本機的 claude-* 列也會被一併停用）。
    if (app.Environment.IsProduction())
    {
        var disabledClaudeCli = await dbContext.AiModel
            .IgnoreQueryFilters()
            .Where(m => m.Provider == "ClaudeCli" && m.Enabled)
            .ExecuteUpdateAsync(setters => setters.SetProperty(m => m.Enabled, false));
        if (disabledClaudeCli > 0)
        {
            app.Logger.LogInformation(
                "Prod 啟動：自動停用 {Count} 筆 ClaudeCli 模型（本機才有 CLI）", disabledClaudeCli);
        }
    }

    // 啟動清理：把任何殘留的 Running AiSession 標記為 Failed。
    // 同步式 AI 工作（便利貼／美化／排版／節點提問）無法跨「行程重啟」存活——
    // 啟動時仍是 Running 的，必是上次中斷／當掉留下的孤兒，否則會永遠卡在「AI 處理中」灌水。
    var orphanedRunning = await dbContext.AiSession
        .IgnoreQueryFilters()
        .Where(s => s.Status == "Running")
        .ExecuteUpdateAsync(setters => setters
            .SetProperty(s => s.Status, "Failed")
            .SetProperty(s => s.ErrorText, "伺服器重啟前未完成（已自動標記為失敗）")
            .SetProperty(s => s.UpdatedDateTime, DateTime.UtcNow));
    if (orphanedRunning > 0)
    {
        app.Logger.LogInformation(
            "啟動清理：將 {Count} 筆殘留 Running AiSession 標記為 Failed", orphanedRunning);
    }

    // 開發用 seed：若 DB 無任何使用者，建立一個開發使用者便於匯入/匯出測試
    if (app.Environment.IsDevelopment())
    {
        var userCount = await dbContext.User.CountAsync();
        if (userCount == 0)
        {
            var defaultEmail = builder.Configuration["Development:DefaultUserEmail"] ?? "dev@example.com";
            var provisioningService = scope.ServiceProvider.GetRequiredService<UserProvisioningService>();

            var devUser = await provisioningService.EnsureUserAsync(
                googleSub: "dev-user-google-sub",
                email: defaultEmail,
                displayName: "Dev User",
                avatarUrl: null,
                cancellationToken: CancellationToken.None);

            app.Logger.LogInformation("Development seed: Created dev user {UserId} ({Email})", devUser.Id, devUser.Email);
        }
    }

    // AI 模型種子：若內容根目錄存在 ai-models.json（已 gitignore、不含於公開 repo），
    // 把其中的「共用預設模型」等補種進 DB，讓 clone 下來的人不必先手動設定就能用 AI 功能。
    // 檔案不存在則略過（不是錯誤）。詳見 AiModelJsonSeeder 與 ai-models.example.json。
    var aiModelsPath = Path.Combine(app.Environment.ContentRootPath, "ai-models.json");
    var protectionProvider = scope.ServiceProvider
        .GetRequiredService<Microsoft.AspNetCore.DataProtection.IDataProtectionProvider>();
    await ZonWiki.Infrastructure.Ai.AiModelJsonSeeder.SeedAsync(
        dbContext,
        protectionProvider,
        app.Logger,
        aiModelsPath);
}

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseCors(CorsPolicyName);

// 驗證與授權：一律啟用（Cookie auth + 本機密碼 auth）
app.UseAuthentication();
app.UseAuthorization();

// 限流中介軟體：置於驗證/授權之後，使限流分區函式能讀到已驗證的 user_id 宣告（per-user 分區）。
// 具名 policy 於各端點以 RequireRateLimiting 掛載；逾限回 429＋Retry-After（見 RateLimitingExtensions）。
app.UseRateLimiter();

app.MapHealthChecks("/healthz").AllowAnonymous();
app.MapGet("/", () => Results.Ok(new { name = "ZonWiki API", status = "alive", authConfigured })).AllowAnonymous();

// 對應驗證端點（OAuth + 本機密碼）
app.MapZonWikiAuthEndpoints(authConfigured);
app.MapAuthPasswordEndpoints();
app.MapProfileEndpoints(); // 個人頁：profile/stats/activity/改 email/刪帳號
app.MapApiTokenEndpoints(); // 個人頁：API 個人存取權杖（PAT）產生/列出/撤銷

// AI 整合端點：給外部 AI 助理（Claude Code / Hermes / ChatGPT Action）以權杖呼叫，
// 一次完成「資料夾名稱→巢狀分類、Markdown→筆記、正確歸類、貼標籤」。
app.MapAiIntegrationEndpoints();

// 給 ChatGPT Custom GPT Action 用的精簡 OpenAPI 文件（公開可讀；實際呼叫仍需 Bearer 權杖）。
// servers 位址優先採設定 Api:PublicBaseUrl，否則由當前請求推算（本機→localhost、prod→公開網域）。
app.MapGet("/openapi/zonwiki-ai.json", (HttpContext http, IConfiguration config) =>
{
    var configuredBase = config["Api:PublicBaseUrl"];
    var baseUrl = !string.IsNullOrWhiteSpace(configuredBase)
        ? configuredBase.TrimEnd('/')
        : $"{http.Request.Scheme}://{http.Request.Host}";
    return Results.Text(AiOpenApiDocument.Build(baseUrl), "application/json");
}).AllowAnonymous();

app.MapCategoryEndpoints();
app.MapNoteEndpoints();
app.MapTagEndpoints();
app.MapNoteWriteEndpoints(authConfigured);
app.MapAskQueueEndpoints(authConfigured);
app.MapCommentEndpoints(authConfigured);
app.MapTaskEndpoints();
app.MapTaskGroupEndpoints();
app.MapSubTaskEndpoints();
app.MapTaskRelationEndpoints();
app.MapNoteTaskLinkEndpoints();
app.MapEntityLinkEndpoints(); // 通用實體關聯：任務/子任務/筆記/節點 互連
app.MapNoteMarkEndpoints(); // 筆記文字標註：畫重點/做關聯/寫備註
app.MapNoteOverlayEndpoints(); // 筆記浮層：便利貼/塗鴉/圖片輪播
app.MapAttachmentEndpoints(); // 筆記附件：貼上/上傳圖片存磁碟，內文只放短網址
app.MapQuickLinkEndpoints();
app.MapCaptureItemEndpoints();
app.MapTimeEntryEndpoints(); // 時間追蹤：記錄每天把時間花在什麼上面（支援 iOS 捷徑 PAT 呼叫）
app.MapCalendarEndpoints();
app.MapHomePageEndpoints();

// 使用者設定與垃圾桶（P5 - 全站共用設定）
app.MapUserSettingsEndpoints();
app.MapTrashEndpoints();

// 精煉成筆記：URL → 抓字幕/音訊轉錄 → AI 整理成分類筆記（非同步，進「AI 處理中」佇列）
app.MapRefineEndpoints();

// Canvas SSE 端點（P4 - 開問啦移植）
app.MapCanvasEndpoints();

// 開問啦 Canvas REST API（P4 - 完整 CRUD）
app.MapKaiWenCanvasEndpoints();

// 開問啦畫布標註（便利貼 / 塗鴉 / 圖片板）— 與筆記浮層對等、綁定畫布
app.MapCanvasAnnotationEndpoints();

// 畫布設定：System Prompt CRUD、畫布分類與關聯、單一畫布系統設定
app.MapCanvasSystemEndpoints();

// 全站搜尋端點（I6 - 納入筆記、任務、畫布、節點）
app.MapSearchEndpoints();

// 問題清單端點（列出被標記為「問題」的浮層元件，支援依分類含子孫過濾）
app.MapQuestionEndpoints();

// 通用 AI 提問（供開問啦畫布便利貼「繼續問」等無筆記脈絡場景）
app.MapAiEndpoints();

app.Run();

public partial class Program;
