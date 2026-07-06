using System.Data.Common;
using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ZonWiki.Api.Auth;
using ZonWiki.Api.RateLimiting;
using ZonWiki.Api.Services;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 記帳（其他功能群 Phase 1）端點：手動 CRUD、分類（惰性種子）、本月彙總、
/// 文字解析入庫（Cookie，硬時間預算＋失敗保底 CaptureItem）、外部 AI 一句話記帳（PAT，冪等＋名稱式分類＋組合限流）。
/// 統一 <see cref="ApiResponse{T}"/> 信封；一律軟刪除；時間存 UTC。
/// </summary>
public static class ExpenseEndpoints
{
    /// <summary>解析失敗保底路徑的日誌分類名稱。</summary>
    private const string LoggerCategory = "ZonWiki.Api.Endpoints.ExpenseEndpoints";

    /// <summary>解析硬時間預算的設定鍵（秒）。</summary>
    private const string ParseBudgetConfigKey = "Expense:ParseBudgetSeconds";

    /// <summary>解析硬時間預算預設值（秒；落在設計 §5.3 的 10–15 秒 band 內）。</summary>
    private const double DefaultParseBudgetSeconds = 12.0;

    /// <summary>
    /// 解析硬時間預算下限（秒）。放寬到 0.2 秒純為讓「逾時降級」路徑能寫成快速的確定性測試
    ///（TDD 要求逾時後 CaptureItem 必落庫）；生產設定應維持 10–15（見 docs/DECISIONS.md）。
    /// </summary>
    private const double MinParseBudgetSeconds = 0.2;

    /// <summary>解析硬時間預算上限（秒）。</summary>
    private const double MaxParseBudgetSeconds = 15.0;

    // ── 應用層輸入上限（不動 DB schema，純應用層擋；違反回 400）──────────────────
    /// <summary>解析文字（一句話）最大長度（字元）。超過即拒，避免超長輸入灌爆 LLM／DB。</summary>
    private const int MaxParseTextLength = 1000;

    /// <summary>清單端點未帶 limit 時的預設回傳筆數（仍夾在 1..2000）。</summary>
    private const int DefaultListLimit = 50;

    /// <summary>商家名稱最大長度（字元；對齊 DB Merchant HasMaxLength(256)）。</summary>
    private const int MaxMerchantLength = 256;

    /// <summary>幣別字串最大長度（字元；對齊 DB Currency HasMaxLength(8)）。</summary>
    private const int MaxCurrencyLength = 8;

    /// <summary>金額上限（對齊 DB numeric(18,2) 的最大值；避免溢位與異常大值）。</summary>
    private const decimal MaxAmount = 9999999999999999.99m;

    /// <summary>單筆品項最大字元數。</summary>
    private const int MaxItemLength = 100;

    /// <summary>品項清單最大項數。</summary>
    private const int MaxItemCount = 50;

    /// <summary>分類名稱最大長度（字元；對齊 DB ExpenseCategory.Name HasMaxLength(128)）。</summary>
    private const int MaxCategoryNameLength = 128;

    /// <summary>
    /// 註冊記帳相關端點。
    /// </summary>
    /// <param name="app">端點路由建構器。</param>
    public static void MapExpenseEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/expenses", ListExpensesHandler);
        app.MapPost("/api/expenses", CreateExpenseHandler);
        app.MapPut("/api/expenses/{id:guid}", UpdateExpenseHandler);
        app.MapDelete("/api/expenses/{id:guid}", DeleteExpenseHandler);

        app.MapGet("/api/expenses/categories", ListCategoriesHandler);
        app.MapPost("/api/expenses/categories", CreateCategoryHandler);

        app.MapGet("/api/expenses/stats", StatsHandler);

        // 網頁文字解析（Cookie）：AiPolicy（端點 SlidingWindow 20/分）＋組合限流 marker 雙層並存。
        // 補掛 marker 的原因：解析端點同樣會觸發付費 LLM，持 PAT 者若改打此端點即可繞過 /api/ai/expenses 的
        // 組合限流（TokenBucket 15/補8＋SlidingWindow 30）。GlobalLimiter chained 對帶 marker 的端點生效、
        // 與端點 AiPolicy 並存（兩層都要放行才通過），堵住此繞道。
        app.MapPost("/api/expenses/parse", ParseExpenseHandler)
            .RequireRateLimiting(RateLimitingExtensions.AiPolicy)
            .WithMetadata(new PatAiRateLimitMarker());

        // 外部 AI／捷徑（PAT）：組合限流 marker（TokenBucket＋SlidingWindow 串接的 GlobalLimiter）。
        app.MapPost("/api/ai/expenses", AiExpenseHandler)
            .WithMetadata(new PatAiRateLimitMarker());
    }

    // ── 手動 CRUD ────────────────────────────────────────────────────────────

    /// <summary>
    /// 列出消費（分頁＋from/to/categoryId 篩選）。
    /// </summary>
    private static async Task<IResult> ListExpensesHandler(
        HttpContext http,
        ZonWikiDbContext db,
        DateTime? from,
        DateTime? to,
        Guid? categoryId,
        int? limit,
        int? offset,
        CancellationToken ct)
    {
        var userId = ExtractUserId(http);
        if (userId == Guid.Empty)
        {
            return Unauthorized();
        }

        var query = db.Expense.IgnoreQueryFilters()
            .Where(e => e.UserId == userId && e.ValidFlag);

        if (from.HasValue)
        {
            var fromUtc = NormalizeToUtc(from.Value);
            query = query.Where(e => e.OccurredDateTime >= fromUtc);
        }

        if (to.HasValue)
        {
            var toUtc = NormalizeToUtc(to.Value);
            query = query.Where(e => e.OccurredDateTime <= toUtc);
        }

        if (categoryId.HasValue)
        {
            query = query.Where(e => e.CategoryId == categoryId.Value);
        }

        var total = await query.CountAsync(ct);

        var orderedQuery = query.OrderByDescending(e => e.OccurredDateTime).ThenByDescending(e => e.CreatedDateTime);

        IQueryable<Expense> pagedQuery = orderedQuery;
        if (offset.HasValue && offset.Value > 0)
        {
            pagedQuery = pagedQuery.Skip(offset.Value);
        }

        // 分頁上限：未帶 limit 時套預設 50（避免無上限全量掃描回大量列）；帶了則沿舊夾在 1..2000。
        var effectiveLimit = limit.HasValue ? Math.Clamp(limit.Value, 1, 2000) : DefaultListLimit;
        pagedQuery = pagedQuery.Take(effectiveLimit);

        var rows = await pagedQuery
            .Select(e => new ExpenseRow(
                e.Id,
                e.OccurredDateTime,
                e.Amount,
                e.Currency,
                e.CategoryId,
                e.Category != null ? e.Category.Name : null,
                e.Merchant,
                e.ItemsJson,
                e.RawText,
                e.Source,
                e.NeedsConfirmation,
                e.CreatedDateTime))
            .ToListAsync(ct);

        var dtos = rows.Select(ToDto).ToList();
        return Results.Ok(ApiResponse<List<ExpenseDto>>.Ok(dtos, new { total }));
    }

    /// <summary>
    /// 手動建立一筆消費。
    /// </summary>
    private static async Task<IResult> CreateExpenseHandler(
        HttpContext http,
        ZonWikiDbContext db,
        CreateExpenseRequest request,
        CancellationToken ct)
    {
        var userId = ExtractUserId(http);
        if (userId == Guid.Empty)
        {
            return Unauthorized();
        }

        // 應用層輸入上限（金額正負／上限、幣別／商家長度、品項數與長度）。
        var validationError = ValidateExpenseInput(request.Amount, request.Currency, request.Merchant, request.Items);
        if (validationError is not null)
        {
            return Results.Json(ApiResponse<ExpenseDto>.Fail(validationError, 400), statusCode: 400);
        }

        // 若指定分類，須屬本人且有效。
        if (request.CategoryId is Guid requestedCategory
            && !await CategoryBelongsToUserAsync(db, userId, requestedCategory, ct))
        {
            return Results.Json(ApiResponse<ExpenseDto>.Fail("分類不存在或不屬於你", 400), statusCode: 400);
        }

        var userKey = userId.ToString();
        var occurred = request.OccurredDateTime.HasValue
            ? NormalizeToUtc(request.OccurredDateTime.Value)
            : DateTime.UtcNow;

        var rawText = string.IsNullOrWhiteSpace(request.RawText)
            ? (string.IsNullOrWhiteSpace(request.Merchant) ? $"手動記帳 {request.Amount}" : request.Merchant!)
            : request.RawText!;

        var expense = new Expense
        {
            UserId = userId,
            OccurredDateTime = occurred,
            Amount = request.Amount,
            Currency = string.IsNullOrWhiteSpace(request.Currency) ? "TWD" : request.Currency!,
            CategoryId = request.CategoryId,
            Merchant = request.Merchant,
            ItemsJson = SerializeItems(request.Items),
            RawText = rawText,
            Source = "manual",
            NeedsConfirmation = request.NeedsConfirmation ?? false,
            CreatedUser = userKey,
            UpdatedUser = userKey,
        };
        db.Expense.Add(expense);
        await db.SaveChangesAsync(ct);

        var dto = await LoadDtoAsync(db, userId, expense.Id, ct);
        return Results.Created($"/api/expenses/{expense.Id}", ApiResponse<ExpenseDto>.Ok(dto!));
    }

    /// <summary>
    /// 更新一筆消費（只改有給的欄位；可就地清除待確認）。
    /// </summary>
    private static async Task<IResult> UpdateExpenseHandler(
        HttpContext http,
        ZonWikiDbContext db,
        Guid id,
        UpdateExpenseRequest request,
        CancellationToken ct)
    {
        var userId = ExtractUserId(http);
        if (userId == Guid.Empty)
        {
            return Unauthorized();
        }

        // 應用層輸入上限（與建立一致）：先驗證再載入實體。
        var validationError = ValidateExpenseInput(request.Amount, request.Currency, request.Merchant, request.Items);
        if (validationError is not null)
        {
            return Results.Json(ApiResponse<ExpenseDto>.Fail(validationError, 400), statusCode: 400);
        }

        var expense = await db.Expense.IgnoreQueryFilters()
            .FirstOrDefaultAsync(e => e.Id == id && e.UserId == userId && e.ValidFlag, ct);
        if (expense is null)
        {
            return Results.Json(ApiResponse<ExpenseDto>.Fail("消費紀錄不存在", 404), statusCode: 404);
        }

        // 金額上下限已由 ValidateExpenseInput 檢查；此處只在有給時套用。
        if (request.Amount.HasValue)
        {
            expense.Amount = request.Amount.Value;
        }

        if (request.CategoryId is Guid newCategory)
        {
            if (!await CategoryBelongsToUserAsync(db, userId, newCategory, ct))
            {
                return Results.Json(ApiResponse<ExpenseDto>.Fail("分類不存在或不屬於你", 400), statusCode: 400);
            }

            expense.CategoryId = newCategory;
        }

        if (request.Currency is not null)
        {
            expense.Currency = string.IsNullOrWhiteSpace(request.Currency) ? expense.Currency : request.Currency;
        }

        if (request.Merchant is not null)
        {
            expense.Merchant = request.Merchant;
        }

        if (request.Items is not null)
        {
            expense.ItemsJson = SerializeItems(request.Items);
        }

        if (request.OccurredDateTime.HasValue)
        {
            expense.OccurredDateTime = NormalizeToUtc(request.OccurredDateTime.Value);
        }

        if (request.NeedsConfirmation.HasValue)
        {
            expense.NeedsConfirmation = request.NeedsConfirmation.Value;
        }

        expense.UpdatedUser = userId.ToString();
        await db.SaveChangesAsync(ct);

        var dto = await LoadDtoAsync(db, userId, expense.Id, ct);
        return Results.Ok(ApiResponse<ExpenseDto>.Ok(dto!));
    }

    /// <summary>
    /// 軟刪除一筆消費。
    /// </summary>
    private static async Task<IResult> DeleteExpenseHandler(
        HttpContext http,
        ZonWikiDbContext db,
        Guid id,
        CancellationToken ct)
    {
        var userId = ExtractUserId(http);
        if (userId == Guid.Empty)
        {
            return Unauthorized();
        }

        var expense = await db.Expense.IgnoreQueryFilters()
            .FirstOrDefaultAsync(e => e.Id == id && e.UserId == userId && e.ValidFlag, ct);
        if (expense is null)
        {
            return Results.Json(ApiResponse<object>.Fail("消費紀錄不存在", 404), statusCode: 404);
        }

        expense.ValidFlag = false;
        expense.DeletedDateTime = DateTime.UtcNow;
        expense.UpdatedUser = userId.ToString();
        await db.SaveChangesAsync(ct);

        return Results.NoContent();
    }

    // ── 分類 ─────────────────────────────────────────────────────────────────

    /// <summary>
    /// 列出分類（含惰性種子的 8 預設）。
    /// </summary>
    private static async Task<IResult> ListCategoriesHandler(
        HttpContext http,
        ExpenseCategoryService categoryService,
        CancellationToken ct)
    {
        var userId = ExtractUserId(http);
        if (userId == Guid.Empty)
        {
            return Unauthorized();
        }

        var categories = await categoryService.ListAsync(userId, ct);
        var dtos = categories
            .Select(c => new ExpenseCategoryDto(c.Id, c.Name, c.Icon, c.SortOrder))
            .ToList();
        return Results.Ok(ApiResponse<List<ExpenseCategoryDto>>.Ok(dtos));
    }

    /// <summary>
    /// 建立分類（名稱式 find-or-create＋復活）。
    /// </summary>
    private static async Task<IResult> CreateCategoryHandler(
        HttpContext http,
        ExpenseCategoryService categoryService,
        CreateExpenseCategoryRequest request,
        CancellationToken ct)
    {
        var userId = ExtractUserId(http);
        if (userId == Guid.Empty)
        {
            return Unauthorized();
        }

        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return Results.Json(ApiResponse<ExpenseCategoryDto>.Fail("分類名稱為必填", 400), statusCode: 400);
        }

        // 應用層擋名稱長度（對齊 DB 上限）：超長改回友善 400，而非讓 DB 丟未包裝的 500。
        if (request.Name.Trim().Length > MaxCategoryNameLength)
        {
            return Results.Json(
                ApiResponse<ExpenseCategoryDto>.Fail($"分類名稱過長，請縮短到 {MaxCategoryNameLength} 字元以內", 400),
                statusCode: 400);
        }

        var category = await categoryService.ResolveCategoryByNameAsync(userId, request.Name, ct);
        var dto = new ExpenseCategoryDto(category.Id, category.Name, category.Icon, category.SortOrder);
        return Results.Ok(ApiResponse<ExpenseCategoryDto>.Ok(dto));
    }

    // ── 本月彙總 ─────────────────────────────────────────────────────────────

    /// <summary>
    /// 本月（或指定月）彙總：以 UTC 月界計算總額與筆數。
    /// </summary>
    private static async Task<IResult> StatsHandler(
        HttpContext http,
        ZonWikiDbContext db,
        string? month,
        CancellationToken ct)
    {
        var userId = ExtractUserId(http);
        if (userId == Guid.Empty)
        {
            return Unauthorized();
        }

        if (!TryResolveMonthRange(month, out var monthLabel, out var startUtc, out var endUtc))
        {
            return Results.Json(ApiResponse<ExpenseStatsDto>.Fail("month 格式須為 YYYY-MM", 400), statusCode: 400);
        }

        var query = db.Expense.IgnoreQueryFilters()
            .Where(e => e.UserId == userId
                && e.ValidFlag
                && e.OccurredDateTime >= startUtc
                && e.OccurredDateTime < endUtc);

        var count = await query.CountAsync(ct);
        var total = count == 0 ? 0m : await query.SumAsync(e => e.Amount, ct);

        return Results.Ok(ApiResponse<ExpenseStatsDto>.Ok(new ExpenseStatsDto(total, count, monthLabel)));
    }

    // ── 解析入庫（Cookie）─────────────────────────────────────────────────────

    /// <summary>
    /// 網頁內文字→解析→入庫（Cookie）。硬時間預算＋失敗／逾時保底 CaptureItem。
    /// </summary>
    private static async Task<IResult> ParseExpenseHandler(
        HttpContext http,
        ZonWikiDbContext db,
        ExpenseParsingService parsingService,
        ExpenseCategoryService categoryService,
        IConfiguration configuration,
        ILoggerFactory loggerFactory,
        ParseExpenseRequest request,
        CancellationToken ct)
    {
        var userId = ExtractUserId(http);
        if (userId == Guid.Empty)
        {
            return Unauthorized();
        }

        var text = (request.Text ?? string.Empty).Trim();
        if (text.Length == 0)
        {
            return Results.Json(ApiResponse<ExpenseParseResponseDto>.Fail("內容為必填", 400), statusCode: 400);
        }

        if (text.Length > MaxParseTextLength)
        {
            return Results.Json(
                ApiResponse<ExpenseParseResponseDto>.Fail($"內容過長，請縮短到 {MaxParseTextLength} 字元以內", 400),
                statusCode: 400);
        }

        var result = await ParseAndStoreAsync(
            db,
            parsingService,
            categoryService,
            configuration,
            loggerFactory.CreateLogger(LoggerCategory),
            userId,
            text,
            request.DeviceNowIso,
            request.TimeZone,
            source: "web",
            clientRequestId: null,
            requestAborted: ct);

        return Results.Ok(ApiResponse<ExpenseParseResponseDto>.Ok(result));
    }

    // ── 外部 AI／捷徑（PAT）─────────────────────────────────────────────────────

    /// <summary>
    /// 外部 AI／捷徑一句話記帳（PAT）。clientRequestId 冪等（重送回既有結果）；名稱式分類；硬預算＋保底。
    /// </summary>
    private static async Task<IResult> AiExpenseHandler(
        HttpContext http,
        ZonWikiDbContext db,
        ExpenseParsingService parsingService,
        ExpenseCategoryService categoryService,
        IConfiguration configuration,
        ILoggerFactory loggerFactory,
        AiExpenseRequest request,
        CancellationToken ct)
    {
        var userId = ExtractUserId(http);
        if (userId == Guid.Empty)
        {
            return Unauthorized();
        }

        var text = (request.Text ?? string.Empty).Trim();
        if (text.Length == 0)
        {
            return Results.Json(ApiResponse<ExpenseParseResponseDto>.Fail("內容為必填", 400), statusCode: 400);
        }

        if (text.Length > MaxParseTextLength)
        {
            return Results.Json(
                ApiResponse<ExpenseParseResponseDto>.Fail($"內容過長，請縮短到 {MaxParseTextLength} 字元以內", 400),
                statusCode: 400);
        }

        var clientRequestId = string.IsNullOrWhiteSpace(request.ClientRequestId)
            ? null
            : request.ClientRequestId!.Trim();

        // 冪等前置查詢：帶 clientRequestId 且已存在同鍵消費 → 直接回既有結果（連軟刪也算，避免重送重建）。
        if (clientRequestId is not null)
        {
            var existingDto = await FindExistingByClientRequestIdAsync(db, userId, clientRequestId, ct);
            if (existingDto is not null)
            {
                return Results.Ok(ApiResponse<ExpenseParseResponseDto>.Ok(
                    new ExpenseParseResponseDto(true, existingDto, false, null, "已入庫（冪等重送）")));
            }
        }

        var result = await ParseAndStoreAsync(
            db,
            parsingService,
            categoryService,
            configuration,
            loggerFactory.CreateLogger(LoggerCategory),
            userId,
            text,
            request.DeviceNowIso,
            request.TimeZone,
            source: "api",
            clientRequestId: clientRequestId,
            requestAborted: ct);

        return Results.Ok(ApiResponse<ExpenseParseResponseDto>.Ok(result));
    }

    // ── 解析＋入庫＋保底 共用核心 ───────────────────────────────────────────────

    /// <summary>
    /// 解析並入庫的共用核心：以「硬時間預算」施加取消。
    /// 例外處理分兩段（審查修正 #6，縮小攔截範圍，避免把儲存失敗誤當 AI 失敗）：
    /// ①「AI 解析」失敗（逾時／請求中止／供應者建構失敗如 ADC 不可用／未知 Provider／不安全 BaseUrl／供應者 Error）
    ///   或壞 JSON 降級 → 以「未取消的權杖」建 CaptureItem 回「已暫存」（一句話永不丟失）。
    /// ②「入庫（儲存層）」的非預期例外 → 記 Error 後往外拋（回 500），不偽裝成 AI 失敗降級；
    ///   唯 clientRequestId 的並發冪等（23505）仍由 StoreParsedExpenseAsync 內部攔截並改回既有結果。
    /// </summary>
    private static async Task<ExpenseParseResponseDto> ParseAndStoreAsync(
        ZonWikiDbContext db,
        ExpenseParsingService parsingService,
        ExpenseCategoryService categoryService,
        IConfiguration configuration,
        ILogger logger,
        Guid userId,
        string text,
        string? deviceNowIso,
        string? timeZone,
        string source,
        string? clientRequestId,
        CancellationToken requestAborted)
    {
        var budgetSeconds = ResolveParseBudgetSeconds(configuration);

        // 硬時間預算：request ct ＋ 預算 CTS linked。逾時→OperationCanceledException。
        using var budgetCts = new CancellationTokenSource(TimeSpan.FromSeconds(budgetSeconds));
        using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(requestAborted, budgetCts.Token);

        // 步驟 1：只有「AI 解析」（含供應者建構、逾時、請求中止、供應者硬錯）包在降級 try 裡。
        // 這類「AI 失敗」——逾時／請求中止（OperationCanceledException）、供應者硬錯（ExpenseParseException）、
        // 解析供應者建構失敗（ADC 不可用／未知 Provider／不安全 BaseUrl 的 InvalidOperationException）——
        // 一律走保底路建 CaptureItem 回「已暫存」，絕不回 500（設計 §5.3／§1.6『一句話永不丟失』）。
        ExpenseParseOutcome outcome;
        try
        {
            outcome = await parsingService.ParseAsync(userId, text, deviceNowIso, timeZone, linkedCts.Token);
        }
        catch (Exception exception)
        {
            // 逾時（budget 觸發）屬預期，記 Information；其餘記 Warning 以利在 Seq 追蹤（例如 ADC 未設定）。
            // 關鍵：保底以「未取消的權杖」寫入（見 DeferToCaptureAsync），否則逾時情境下 SaveChanges 會立即被取消。
            if (exception is OperationCanceledException && budgetCts.IsCancellationRequested)
            {
                logger.LogInformation("記帳解析逾時（budget={BudgetSeconds}s），降級為暫存。", budgetSeconds);
            }
            else
            {
                logger.LogWarning(exception, "記帳解析失敗，降級為暫存（source={Source}）。", source);
            }

            return await DeferToCaptureAsync(db, userId, text, source);
        }

        // 解析降級（壞 JSON／金額缺失，屬正常降級而非例外）→ 保底 CaptureItem。
        if (!outcome.Success)
        {
            return await DeferToCaptureAsync(db, userId, text, source);
        }

        // 步驟 2：入庫（儲存層）。冪等並發競態（23505）由 StoreParsedExpenseAsync 內部攔截並改回既有結果；
        // 其餘「非預期儲存例外」不再偽裝成 AI 失敗降級——記 Error 後往外拋（回 500）。
        // 理由：同一個 DB 若真的掛了，連保底的 CaptureItem 也一樣寫不進去，降級只會遮蔽真正的儲存故障。
        try
        {
            return await StoreParsedExpenseAsync(
                db, categoryService, userId, text, source, clientRequestId, outcome);
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "記帳入庫失敗（非 AI 失敗，不降級；source={Source}）。", source);
            throw;
        }
    }

    /// <summary>
    /// 成功解析後入庫：名稱式解析分類→建 Expense。clientRequestId 有值時攔截唯一違反（並發冪等）改回既有結果。
    /// </summary>
    private static async Task<ExpenseParseResponseDto> StoreParsedExpenseAsync(
        ZonWikiDbContext db,
        ExpenseCategoryService categoryService,
        Guid userId,
        string text,
        string source,
        string? clientRequestId,
        ExpenseParseOutcome outcome)
    {
        var category = await categoryService.ResolveCategoryByNameAsync(userId, outcome.CategoryName, CancellationToken.None);

        var userKey = userId.ToString();
        var expense = new Expense
        {
            UserId = userId,
            OccurredDateTime = outcome.OccurredDateTimeUtc,
            Amount = outcome.Amount,
            Currency = outcome.Currency,
            CategoryId = category.Id,
            Merchant = outcome.Merchant,
            ItemsJson = outcome.ItemsJson,
            RawText = text,
            Source = source,
            ClientRequestId = clientRequestId,
            NeedsConfirmation = outcome.NeedsConfirmation,
            CreatedUser = userKey,
            UpdatedUser = userKey,
        };
        db.Expense.Add(expense);

        try
        {
            await db.SaveChangesAsync(CancellationToken.None);
        }
        catch (DbUpdateException ex) when (clientRequestId is not null && IsUniqueViolation(ex))
        {
            // 冪等並發競態：另一路已用同 clientRequestId 插入。卸掉本次衝突列，改回既有結果。
            db.Entry(expense).State = EntityState.Detached;
            var existingDto = await FindExistingByClientRequestIdAsync(db, userId, clientRequestId, CancellationToken.None);
            if (existingDto is not null)
            {
                return new ExpenseParseResponseDto(true, existingDto, false, null, "已入庫（冪等並發）");
            }

            throw;
        }

        var dto = await LoadDtoAsync(db, userId, expense.Id, CancellationToken.None);
        return new ExpenseParseResponseDto(true, dto, false, null, "已入庫");
    }

    /// <summary>
    /// 保底：以「未取消的權杖」建立 CaptureItem（RawContent=原文），回「已暫存」。
    /// </summary>
    private static async Task<ExpenseParseResponseDto> DeferToCaptureAsync(
        ZonWikiDbContext db,
        Guid userId,
        string text,
        string source)
    {
        var userKey = userId.ToString();
        var now = DateTime.UtcNow;
        var capture = new CaptureItem
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            // 網頁路標 text；PAT 捷徑多為語音聽寫來源，標 voice 以利後續分流。
            Source = source == "api" ? "voice" : "text",
            RawContent = text,
            Status = "inbox",
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = userKey,
            UpdatedUser = userKey,
            ValidFlag = true,
        };
        db.CaptureItem.Add(capture);

        // 關鍵：用 CancellationToken.None（非已逾時的 linked token），確保保底一定寫得進去。
        await db.SaveChangesAsync(CancellationToken.None);

        return new ExpenseParseResponseDto(
            false,
            null,
            true,
            capture.Id,
            "AI 忙碌或無法解析，已暫存到收件匣，稍後可手動整理");
    }

    // ── 共用工具 ─────────────────────────────────────────────────────────────

    /// <summary>
    /// 驗證消費輸入欄位的應用層上限（不動 DB schema，純應用層擋）。Create／Update 共用。
    /// 只檢查「本次有提供」的欄位（null＝未提供，跳過）；回傳第一個違反的繁中錯誤訊息，全部合法回 null。
    /// </summary>
    /// <param name="amount">金額（null＝未提供不檢查；提供則須 &gt; 0 且 ≤ <see cref="MaxAmount"/>）。</param>
    /// <param name="currency">幣別（null＝未提供；提供則長度 ≤ <see cref="MaxCurrencyLength"/>）。</param>
    /// <param name="merchant">商家（null＝未提供；提供則長度 ≤ <see cref="MaxMerchantLength"/>）。</param>
    /// <param name="items">品項清單（null＝未提供；提供則項數 ≤ <see cref="MaxItemCount"/>、單項 ≤ <see cref="MaxItemLength"/>）。</param>
    /// <returns>第一個違反的錯誤訊息；全部合法回 null。</returns>
    private static string? ValidateExpenseInput(
        decimal? amount,
        string? currency,
        string? merchant,
        List<string>? items)
    {
        if (amount.HasValue && (amount.Value <= 0m || amount.Value > MaxAmount))
        {
            return $"金額必須為正且不超過 {MaxAmount}";
        }

        if (currency is not null && currency.Length > MaxCurrencyLength)
        {
            return $"幣別過長，請縮短到 {MaxCurrencyLength} 字元以內";
        }

        if (merchant is not null && merchant.Length > MaxMerchantLength)
        {
            return $"商家名稱過長，請縮短到 {MaxMerchantLength} 字元以內";
        }

        if (items is not null)
        {
            if (items.Count > MaxItemCount)
            {
                return $"品項數過多，最多 {MaxItemCount} 項";
            }

            foreach (var item in items)
            {
                if (item is not null && item.Length > MaxItemLength)
                {
                    return $"單筆品項過長，請縮短到 {MaxItemLength} 字元以內";
                }
            }
        }

        return null;
    }

    /// <summary>解析設定的硬時間預算（秒），夾在 [Min, Max]。</summary>
    private static double ResolveParseBudgetSeconds(IConfiguration configuration)
    {
        var configured = configuration.GetValue<double?>(ParseBudgetConfigKey) ?? DefaultParseBudgetSeconds;
        return Math.Clamp(configured, MinParseBudgetSeconds, MaxParseBudgetSeconds);
    }

    /// <summary>以 (UserId, ClientRequestId) 查既有消費（IgnoreQueryFilters，連軟刪也算），回其 DTO 或 null。</summary>
    private static async Task<ExpenseDto?> FindExistingByClientRequestIdAsync(
        ZonWikiDbContext db,
        Guid userId,
        string clientRequestId,
        CancellationToken ct)
    {
        var row = await db.Expense.IgnoreQueryFilters()
            .Where(e => e.UserId == userId && e.ClientRequestId == clientRequestId)
            .Select(e => new ExpenseRow(
                e.Id,
                e.OccurredDateTime,
                e.Amount,
                e.Currency,
                e.CategoryId,
                e.Category != null ? e.Category.Name : null,
                e.Merchant,
                e.ItemsJson,
                e.RawText,
                e.Source,
                e.NeedsConfirmation,
                e.CreatedDateTime))
            .FirstOrDefaultAsync(ct);

        return row is null ? null : ToDto(row);
    }

    /// <summary>載入單筆消費並映射成 DTO（含分類名稱）。</summary>
    private static async Task<ExpenseDto?> LoadDtoAsync(
        ZonWikiDbContext db,
        Guid userId,
        Guid expenseId,
        CancellationToken ct)
    {
        var row = await db.Expense.IgnoreQueryFilters()
            .Where(e => e.Id == expenseId && e.UserId == userId)
            .Select(e => new ExpenseRow(
                e.Id,
                e.OccurredDateTime,
                e.Amount,
                e.Currency,
                e.CategoryId,
                e.Category != null ? e.Category.Name : null,
                e.Merchant,
                e.ItemsJson,
                e.RawText,
                e.Source,
                e.NeedsConfirmation,
                e.CreatedDateTime))
            .FirstOrDefaultAsync(ct);

        return row is null ? null : ToDto(row);
    }

    /// <summary>檢查分類是否屬於使用者且有效。</summary>
    private static Task<bool> CategoryBelongsToUserAsync(
        ZonWikiDbContext db,
        Guid userId,
        Guid categoryId,
        CancellationToken ct)
        => db.ExpenseCategory.IgnoreQueryFilters()
            .AnyAsync(c => c.Id == categoryId && c.UserId == userId && c.ValidFlag, ct);

    /// <summary>把中繼投影列映射成回應 DTO（反序列化 ItemsJson）。</summary>
    private static ExpenseDto ToDto(ExpenseRow row)
        => new(
            row.Id,
            row.OccurredDateTime,
            row.Amount,
            row.Currency,
            row.CategoryId,
            row.CategoryName,
            row.Merchant,
            DeserializeItems(row.ItemsJson),
            row.RawText,
            row.Source,
            row.NeedsConfirmation,
            row.CreatedDateTime);

    /// <summary>把品項清單序列化成 JSON 字串（空／null 回 null）。</summary>
    private static string? SerializeItems(List<string>? items)
        => items is { Count: > 0 } ? JsonSerializer.Serialize(items) : null;

    /// <summary>把 ItemsJson 反序列化成清單（失敗回 null）。</summary>
    private static List<string>? DeserializeItems(string? itemsJson)
    {
        if (string.IsNullOrWhiteSpace(itemsJson))
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<List<string>>(itemsJson);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>把任意 Kind 的 DateTime 正規化為 UTC（Npgsql timestamptz 參數要求 UTC Kind）。</summary>
    private static DateTime NormalizeToUtc(DateTime value)
        => value.Kind switch
        {
            DateTimeKind.Utc => value,
            DateTimeKind.Local => value.ToUniversalTime(),
            _ => DateTime.SpecifyKind(value, DateTimeKind.Utc),
        };

    /// <summary>解析 month（YYYY-MM；空＝本月），輸出 UTC 月界 [start, end) 與標籤。</summary>
    private static bool TryResolveMonthRange(
        string? month,
        out string monthLabel,
        out DateTime startUtc,
        out DateTime endUtc)
    {
        int year;
        int monthNumber;
        if (string.IsNullOrWhiteSpace(month))
        {
            var now = DateTime.UtcNow;
            year = now.Year;
            monthNumber = now.Month;
        }
        else if (!TryParseMonth(month, out year, out monthNumber))
        {
            monthLabel = string.Empty;
            startUtc = default;
            endUtc = default;
            return false;
        }

        startUtc = new DateTime(year, monthNumber, 1, 0, 0, 0, DateTimeKind.Utc);
        endUtc = startUtc.AddMonths(1);
        monthLabel = $"{year:D4}-{monthNumber:D2}";
        return true;
    }

    /// <summary>解析 "YYYY-MM" 字串。</summary>
    private static bool TryParseMonth(string month, out int year, out int monthNumber)
    {
        year = 0;
        monthNumber = 0;
        var parts = month.Split('-');
        if (parts.Length != 2)
        {
            return false;
        }

        if (!int.TryParse(parts[0], NumberStyles.None, CultureInfo.InvariantCulture, out year)
            || !int.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out monthNumber))
        {
            return false;
        }

        return year is >= 1 and <= 9999 && monthNumber is >= 1 and <= 12;
    }

    /// <summary>判斷 <see cref="DbUpdateException"/> 是否為 PostgreSQL 唯一約束違反（SQLSTATE 23505）。</summary>
    private static bool IsUniqueViolation(DbUpdateException exception)
        => exception.InnerException is DbException { SqlState: "23505" };

    /// <summary>自 HttpContext 取使用者 Id（Cookie 或 PAT 皆帶 user_id 宣告）；缺失回 Guid.Empty。</summary>
    private static Guid ExtractUserId(HttpContext http)
    {
        var userIdClaim = http.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
        return !string.IsNullOrEmpty(userIdClaim) && Guid.TryParse(userIdClaim, out var userId)
            ? userId
            : Guid.Empty;
    }

    /// <summary>統一 401 回應。</summary>
    private static IResult Unauthorized()
        => Results.Json(ApiResponse<object>.Fail("Invalid user identity", 401), statusCode: 401);

    /// <summary>清單／單筆查詢的中繼投影列（供 EF 投影後在記憶體映射 DTO，含 ItemsJson 反序列化）。</summary>
    private sealed record ExpenseRow(
        Guid Id,
        DateTime OccurredDateTime,
        decimal Amount,
        string Currency,
        Guid? CategoryId,
        string? CategoryName,
        string? Merchant,
        string? ItemsJson,
        string RawText,
        string Source,
        bool NeedsConfirmation,
        DateTime CreatedDateTime);
}
