using Microsoft.EntityFrameworkCore;
using ZonWiki.Api.Services;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 「畫布設定」相關端點：System Prompt CRUD、畫布分類（CanvasCat）CRUD 與關聯設定、
/// 以及單一畫布的系統設定（所屬分類 / 自選 Prompt / 實際生效清單）。
///
/// 路由全部掛在 /api/canvas 群組下，對應前端 kaiwen-api.ts 的契約。
/// 所有寫入都驗證資源屬於目前使用者（多租戶隔離）；關聯表採整組取代 + 硬刪除語意。
/// </summary>
public static class CanvasSystemEndpoints
{
    /// <summary>
    /// 註冊「畫布設定」相關端點。
    /// </summary>
    /// <param name="app">Web 應用程式。</param>
    public static void MapCanvasSystemEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/canvas");

        // System Prompt CRUD
        group.MapGet("/system-prompts", ListSystemPrompts).WithName("ListSystemPrompts").WithOpenApi();
        group.MapPost("/system-prompts", CreateSystemPrompt).WithName("CreateSystemPrompt").WithOpenApi();
        group.MapPut("/system-prompts/{id}", UpdateSystemPrompt).WithName("UpdateSystemPrompt").WithOpenApi();
        group.MapDelete("/system-prompts/{id}", DeleteSystemPrompt).WithName("DeleteSystemPrompt").WithOpenApi();

        // 畫布分類（CanvasCat）CRUD 與關聯
        group.MapGet("/categories", ListCategories).WithName("ListCanvasCategories").WithOpenApi();
        group.MapPost("/categories", CreateCategory).WithName("CreateCanvasCategory").WithOpenApi();
        group.MapPut("/categories/{id}", RenameCategory).WithName("RenameCanvasCategory").WithOpenApi();
        group.MapDelete("/categories/{id}", DeleteCategory).WithName("DeleteCanvasCategory").WithOpenApi();
        group.MapPut("/categories/{id}/canvases", SetCategoryCanvases).WithName("SetCategoryCanvases").WithOpenApi();
        group.MapPut("/categories/{id}/prompts", SetCategoryPrompts).WithName("SetCategoryPrompts").WithOpenApi();

        // 單一畫布的系統設定
        group.MapGet("/canvases/{canvasId}/system", GetCanvasSystem).WithName("GetCanvasSystem").WithOpenApi();
        group.MapPut("/canvases/{canvasId}/categories", SetCanvasCategories).WithName("SetCanvasCategories").WithOpenApi();
        group.MapPut("/canvases/{canvasId}/system-prompts", SetCanvasOwnPrompts).WithName("SetCanvasOwnPrompts").WithOpenApi();
    }

    /// <summary>
    /// System Prompt 內容長度上限（避免異常超長內容塞爆 DB / AI）。
    /// </summary>
    private const int MaxPromptContentLength = 50000;

    /// <summary>
    /// 單次整組設定請求允許的識別碼數量上限（避免超大清單造成查詢負擔）。
    /// </summary>
    private const int MaxIdsPerRequest = 1000;

    // ───────────────────────── System Prompt CRUD ─────────────────────────

    /// <summary>
    /// 列出目前使用者的所有 System Prompt（全域排前、其餘依建立時間）。
    /// </summary>
    private static async Task<IResult> ListSystemPrompts(
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return Unauthorized<List<SystemPromptDto>>();
        }

        var prompts = await db.SystemPrompt
            .OrderByDescending(p => p.IsGlobal)
            .ThenBy(p => p.CreatedDateTime)
            .Select(p => new SystemPromptDto(
                p.Id.ToString(),
                p.Title,
                p.Content,
                p.IsGlobal))
            .ToListAsync(ct);

        return CanvasJsonHelper.JsonOk(ApiResponse<List<SystemPromptDto>>.Ok(prompts));
    }

    /// <summary>
    /// 建立新的 System Prompt。
    /// </summary>
    private static async Task<IResult> CreateSystemPrompt(
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        CreateSystemPromptRequest req,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return Unauthorized<SystemPromptDto>();
        }

        if (string.IsNullOrWhiteSpace(req.Title))
        {
            return BadRequest<SystemPromptDto>("Title is required");
        }

        var content = req.Content ?? string.Empty;
        if (content.Length > MaxPromptContentLength)
        {
            return BadRequest<SystemPromptDto>($"Content exceeds {MaxPromptContentLength} characters");
        }

        var prompt = new SystemPrompt
        {
            Id = Guid.NewGuid(),
            UserId = currentUser.UserId,
            Title = req.Title.Trim(),
            Content = content,
            IsGlobal = req.IsGlobal,
        };

        db.SystemPrompt.Add(prompt);
        await db.SaveChangesAsync(ct);

        return CanvasJsonHelper.JsonOk(
            ApiResponse<SystemPromptDto>.Ok(new SystemPromptDto(
                prompt.Id.ToString(),
                prompt.Title,
                prompt.Content,
                prompt.IsGlobal)),
            StatusCodes.Status201Created);
    }

    /// <summary>
    /// 更新 System Prompt（標題、內容、全域旗標）。
    /// </summary>
    private static async Task<IResult> UpdateSystemPrompt(
        string id,
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        UpdateSystemPromptRequest req,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return Unauthorized<SystemPromptDto>();
        }

        if (!Guid.TryParse(id, out var promptGuid))
        {
            return BadRequest<SystemPromptDto>("Invalid system prompt ID");
        }

        // 全域過濾器已限定本人 + 有效
        var prompt = await db.SystemPrompt.FirstOrDefaultAsync(p => p.Id == promptGuid && p.UserId == currentUser.UserId, ct);
        if (prompt is null)
        {
            return NotFound<SystemPromptDto>("System prompt not found");
        }

        if (string.IsNullOrWhiteSpace(req.Title))
        {
            return BadRequest<SystemPromptDto>("Title is required");
        }

        var content = req.Content ?? string.Empty;
        if (content.Length > MaxPromptContentLength)
        {
            return BadRequest<SystemPromptDto>($"Content exceeds {MaxPromptContentLength} characters");
        }

        prompt.Title = req.Title.Trim();
        prompt.Content = content;
        prompt.IsGlobal = req.IsGlobal;
        await db.SaveChangesAsync(ct);

        return CanvasJsonHelper.JsonOk(
            ApiResponse<SystemPromptDto>.Ok(new SystemPromptDto(
                prompt.Id.ToString(),
                prompt.Title,
                prompt.Content,
                prompt.IsGlobal)));
    }

    /// <summary>
    /// 刪除 System Prompt（軟刪除本體 + 硬刪除其所有分類 / 畫布關聯）。
    /// </summary>
    private static async Task<IResult> DeleteSystemPrompt(
        string id,
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return Unauthorized<object>();
        }

        if (!Guid.TryParse(id, out var promptGuid))
        {
            return BadRequest<object>("Invalid system prompt ID");
        }

        var prompt = await db.SystemPrompt.FirstOrDefaultAsync(p => p.Id == promptGuid && p.UserId == currentUser.UserId, ct);
        if (prompt is null)
        {
            return NotFound<object>("System prompt not found");
        }

        // 硬刪除關聯（關聯表採硬刪除語意）
        var categoryLinks = await db.CategorySystemPrompt
            .Where(csp => csp.SystemPromptId == promptGuid)
            .ToListAsync(ct);
        var canvasLinks = await db.CanvasSystemPrompt
            .Where(csp => csp.SystemPromptId == promptGuid)
            .ToListAsync(ct);
        db.CategorySystemPrompt.RemoveRange(categoryLinks);
        db.CanvasSystemPrompt.RemoveRange(canvasLinks);

        // 軟刪除本體
        prompt.ValidFlag = false;
        await db.SaveChangesAsync(ct);

        return CanvasJsonHelper.JsonOk(
            ApiResponse<object>.Ok(new { SystemPrompt_Id = prompt.Id.ToString() }));
    }

    // ───────────────────────── 畫布分類 CRUD 與關聯 ─────────────────────────

    /// <summary>
    /// 列出目前使用者的所有畫布分類（含其包含的畫布、吃到的 System Prompt 關聯）。
    /// </summary>
    private static async Task<IResult> ListCategories(
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return Unauthorized<List<CategoryWithLinksDto>>();
        }

        var categories = await db.CanvasCat
            .AsNoTracking()
            .OrderBy(c => c.Name)
            .ToListAsync(ct);
        var categoryIds = categories.Select(c => c.Id).ToList();

        var canvasLinks = await db.CanvasCategory
            .AsNoTracking()
            .Where(cc => categoryIds.Contains(cc.CategoryId))
            .ToListAsync(ct);
        var promptLinks = await db.CategorySystemPrompt
            .AsNoTracking()
            .Where(csp => categoryIds.Contains(csp.CategoryId))
            .ToListAsync(ct);

        var result = categories
            .Select(c => new CategoryWithLinksDto(
                c.Id.ToString(),
                c.Name,
                canvasLinks.Where(cc => cc.CategoryId == c.Id).Select(cc => cc.CanvasId.ToString()).ToList(),
                promptLinks.Where(csp => csp.CategoryId == c.Id).Select(csp => csp.SystemPromptId.ToString()).ToList()))
            .ToList();

        return CanvasJsonHelper.JsonOk(ApiResponse<List<CategoryWithLinksDto>>.Ok(result));
    }

    /// <summary>
    /// 建立新的畫布分類。
    /// </summary>
    private static async Task<IResult> CreateCategory(
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        CreateCategoryRequest req,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return Unauthorized<CategoryWithLinksDto>();
        }

        if (string.IsNullOrWhiteSpace(req.Name))
        {
            return BadRequest<CategoryWithLinksDto>("Name is required");
        }

        var category = new CanvasCat
        {
            Id = Guid.NewGuid(),
            UserId = currentUser.UserId,
            Name = req.Name.Trim(),
        };

        db.CanvasCat.Add(category);
        await db.SaveChangesAsync(ct);

        return CanvasJsonHelper.JsonOk(
            ApiResponse<CategoryWithLinksDto>.Ok(new CategoryWithLinksDto(
                category.Id.ToString(),
                category.Name,
                new List<string>(),
                new List<string>())),
            StatusCodes.Status201Created);
    }

    /// <summary>
    /// 重新命名畫布分類。
    /// </summary>
    private static async Task<IResult> RenameCategory(
        string id,
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        UpdateCategoryRequest req,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return Unauthorized<CategoryWithLinksDto>();
        }

        if (!Guid.TryParse(id, out var categoryGuid))
        {
            return BadRequest<CategoryWithLinksDto>("Invalid category ID");
        }

        var category = await db.CanvasCat.FirstOrDefaultAsync(c => c.Id == categoryGuid && c.UserId == currentUser.UserId, ct);
        if (category is null)
        {
            return NotFound<CategoryWithLinksDto>("Category not found");
        }

        if (string.IsNullOrWhiteSpace(req.Name))
        {
            return BadRequest<CategoryWithLinksDto>("Name is required");
        }

        category.Name = req.Name.Trim();
        await db.SaveChangesAsync(ct);

        return CanvasJsonHelper.JsonOk(
            ApiResponse<object>.Ok(new { Category_Id = category.Id.ToString() }));
    }

    /// <summary>
    /// 刪除畫布分類（軟刪除本體 + 硬刪除其所有畫布 / Prompt 關聯）。
    /// </summary>
    private static async Task<IResult> DeleteCategory(
        string id,
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return Unauthorized<object>();
        }

        if (!Guid.TryParse(id, out var categoryGuid))
        {
            return BadRequest<object>("Invalid category ID");
        }

        var category = await db.CanvasCat.FirstOrDefaultAsync(c => c.Id == categoryGuid && c.UserId == currentUser.UserId, ct);
        if (category is null)
        {
            return NotFound<object>("Category not found");
        }

        var canvasLinks = await db.CanvasCategory
            .Where(cc => cc.CategoryId == categoryGuid)
            .ToListAsync(ct);
        var promptLinks = await db.CategorySystemPrompt
            .Where(csp => csp.CategoryId == categoryGuid)
            .ToListAsync(ct);
        db.CanvasCategory.RemoveRange(canvasLinks);
        db.CategorySystemPrompt.RemoveRange(promptLinks);

        category.ValidFlag = false;
        await db.SaveChangesAsync(ct);

        return CanvasJsonHelper.JsonOk(
            ApiResponse<object>.Ok(new { Category_Id = category.Id.ToString() }));
    }

    /// <summary>
    /// 設定某分類「包含哪些畫布」（整組取代）。
    /// </summary>
    private static async Task<IResult> SetCategoryCanvases(
        string id,
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        SetIdsRequest req,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return Unauthorized<object>();
        }

        if (!Guid.TryParse(id, out var categoryGuid))
        {
            return BadRequest<object>("Invalid category ID");
        }

        var category = await db.CanvasCat.FirstOrDefaultAsync(c => c.Id == categoryGuid && c.UserId == currentUser.UserId, ct);
        if (category is null)
        {
            return NotFound<object>("Category not found");
        }

        // 僅接受屬於本人且有效的畫布（過濾掉非法 / 他人 / 已刪除者）
        if ((req.Ids?.Count ?? 0) > MaxIdsPerRequest)
        {
            return BadRequest<object>($"Too many IDs (max {MaxIdsPerRequest})");
        }

        var requestedCanvasIds = ParseGuids(req.Ids);
        var validCanvasIds = await db.Canvas
            .Where(c => requestedCanvasIds.Contains(c.Id) && c.UserId == currentUser.UserId)
            .Select(c => c.Id)
            .ToListAsync(ct);

        var existing = await db.CanvasCategory
            .Where(cc => cc.CategoryId == categoryGuid)
            .ToListAsync(ct);
        db.CanvasCategory.RemoveRange(existing);
        foreach (var canvasGuid in validCanvasIds.Distinct())
        {
            db.CanvasCategory.Add(new CanvasCategory
            {
                Id = Guid.NewGuid(),
                CanvasId = canvasGuid,
                CategoryId = categoryGuid,
            });
        }
        await db.SaveChangesAsync(ct);

        return CanvasJsonHelper.JsonOk(
            ApiResponse<object>.Ok(new { Category_Id = category.Id.ToString() }));
    }

    /// <summary>
    /// 設定某分類「吃到哪些 System Prompt」（整組取代）。
    /// </summary>
    private static async Task<IResult> SetCategoryPrompts(
        string id,
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        SetIdsRequest req,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return Unauthorized<object>();
        }

        if (!Guid.TryParse(id, out var categoryGuid))
        {
            return BadRequest<object>("Invalid category ID");
        }

        var category = await db.CanvasCat.FirstOrDefaultAsync(c => c.Id == categoryGuid && c.UserId == currentUser.UserId, ct);
        if (category is null)
        {
            return NotFound<object>("Category not found");
        }

        if ((req.Ids?.Count ?? 0) > MaxIdsPerRequest)
        {
            return BadRequest<object>($"Too many IDs (max {MaxIdsPerRequest})");
        }

        var requestedPromptIds = ParseGuids(req.Ids);
        var validPromptIds = await db.SystemPrompt
            .Where(p => requestedPromptIds.Contains(p.Id) && p.UserId == currentUser.UserId)
            .Select(p => p.Id)
            .ToListAsync(ct);

        var existing = await db.CategorySystemPrompt
            .Where(csp => csp.CategoryId == categoryGuid)
            .ToListAsync(ct);
        db.CategorySystemPrompt.RemoveRange(existing);
        foreach (var promptGuid in validPromptIds.Distinct())
        {
            db.CategorySystemPrompt.Add(new CategorySystemPrompt
            {
                Id = Guid.NewGuid(),
                CategoryId = categoryGuid,
                SystemPromptId = promptGuid,
            });
        }
        await db.SaveChangesAsync(ct);

        return CanvasJsonHelper.JsonOk(
            ApiResponse<object>.Ok(new { Category_Id = category.Id.ToString() }));
    }

    // ───────────────────────── 單一畫布系統設定 ─────────────────────────

    /// <summary>
    /// 取得單一畫布的系統設定：所屬分類、自選 Prompt、實際生效清單。
    /// </summary>
    private static async Task<IResult> GetCanvasSystem(
        string canvasId,
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return Unauthorized<CanvasSystemConfigDto>();
        }

        if (!Guid.TryParse(canvasId, out var canvasGuid))
        {
            return BadRequest<CanvasSystemConfigDto>("Invalid canvas ID");
        }

        // 驗證畫布屬於本人且有效
        var canvasExists = await db.Canvas.AnyAsync(c => c.Id == canvasGuid && c.UserId == currentUser.UserId, ct);
        if (!canvasExists)
        {
            return NotFound<CanvasSystemConfigDto>("Canvas not found");
        }

        var categoryIds = await db.CanvasCategory
            .Where(cc => cc.CanvasId == canvasGuid)
            .Select(cc => cc.CategoryId.ToString())
            .ToListAsync(ct);

        var ownPromptIds = await db.CanvasSystemPrompt
            .Where(csp => csp.CanvasId == canvasGuid)
            .Select(csp => csp.SystemPromptId.ToString())
            .ToListAsync(ct);

        var effective = await CanvasSystemPromptResolver.ResolveAsync(db, currentUser.UserId, canvasGuid, ct);

        return CanvasJsonHelper.JsonOk(
            ApiResponse<CanvasSystemConfigDto>.Ok(new CanvasSystemConfigDto(
                categoryIds,
                ownPromptIds,
                effective)));
    }

    /// <summary>
    /// 設定某畫布「所屬哪些分類」（整組取代）。
    /// </summary>
    private static async Task<IResult> SetCanvasCategories(
        string canvasId,
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        SetIdsRequest req,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return Unauthorized<object>();
        }

        if (!Guid.TryParse(canvasId, out var canvasGuid))
        {
            return BadRequest<object>("Invalid canvas ID");
        }

        var canvasExists = await db.Canvas.AnyAsync(c => c.Id == canvasGuid && c.UserId == currentUser.UserId, ct);
        if (!canvasExists)
        {
            return NotFound<object>("Canvas not found");
        }

        if ((req.Ids?.Count ?? 0) > MaxIdsPerRequest)
        {
            return BadRequest<object>($"Too many IDs (max {MaxIdsPerRequest})");
        }

        var requestedCategoryIds = ParseGuids(req.Ids);
        var validCategoryIds = await db.CanvasCat
            .Where(c => requestedCategoryIds.Contains(c.Id) && c.UserId == currentUser.UserId)
            .Select(c => c.Id)
            .ToListAsync(ct);

        var existing = await db.CanvasCategory
            .Where(cc => cc.CanvasId == canvasGuid)
            .ToListAsync(ct);
        db.CanvasCategory.RemoveRange(existing);
        foreach (var categoryGuid in validCategoryIds.Distinct())
        {
            db.CanvasCategory.Add(new CanvasCategory
            {
                Id = Guid.NewGuid(),
                CanvasId = canvasGuid,
                CategoryId = categoryGuid,
            });
        }
        await db.SaveChangesAsync(ct);

        return CanvasJsonHelper.JsonOk(
            ApiResponse<object>.Ok(new { Canvas_Id = canvasGuid.ToString() }));
    }

    /// <summary>
    /// 設定某畫布「額外自選哪些 System Prompt」（整組取代）。
    /// </summary>
    private static async Task<IResult> SetCanvasOwnPrompts(
        string canvasId,
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        SetIdsRequest req,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return Unauthorized<object>();
        }

        if (!Guid.TryParse(canvasId, out var canvasGuid))
        {
            return BadRequest<object>("Invalid canvas ID");
        }

        var canvasExists = await db.Canvas.AnyAsync(c => c.Id == canvasGuid && c.UserId == currentUser.UserId, ct);
        if (!canvasExists)
        {
            return NotFound<object>("Canvas not found");
        }

        if ((req.Ids?.Count ?? 0) > MaxIdsPerRequest)
        {
            return BadRequest<object>($"Too many IDs (max {MaxIdsPerRequest})");
        }

        var requestedPromptIds = ParseGuids(req.Ids);
        var validPromptIds = await db.SystemPrompt
            .Where(p => requestedPromptIds.Contains(p.Id) && p.UserId == currentUser.UserId)
            .Select(p => p.Id)
            .ToListAsync(ct);

        var existing = await db.CanvasSystemPrompt
            .Where(csp => csp.CanvasId == canvasGuid)
            .ToListAsync(ct);
        db.CanvasSystemPrompt.RemoveRange(existing);
        foreach (var promptGuid in validPromptIds.Distinct())
        {
            db.CanvasSystemPrompt.Add(new CanvasSystemPrompt
            {
                Id = Guid.NewGuid(),
                CanvasId = canvasGuid,
                SystemPromptId = promptGuid,
            });
        }
        await db.SaveChangesAsync(ct);

        return CanvasJsonHelper.JsonOk(
            ApiResponse<object>.Ok(new { Canvas_Id = canvasGuid.ToString() }));
    }

    // ───────────────────────── 共用小工具 ─────────────────────────

    /// <summary>
    /// 把字串識別碼清單解析成 Guid 清單（忽略無法解析者）。
    /// </summary>
    /// <param name="ids">字串識別碼清單（可為 null）。</param>
    /// <returns>成功解析的 Guid 清單。</returns>
    private static List<Guid> ParseGuids(List<string>? ids)
    {
        var result = new List<Guid>();
        if (ids is null)
        {
            return result;
        }

        foreach (var raw in ids)
        {
            if (Guid.TryParse(raw, out var guid))
            {
                result.Add(guid);
            }
        }

        return result;
    }

    /// <summary>
    /// 產生 401 未授權回應。
    /// </summary>
    private static IResult Unauthorized<T>() =>
        CanvasJsonHelper.JsonError(
            ApiResponse<T>.Fail("Authentication required", 401),
            StatusCodes.Status401Unauthorized);

    /// <summary>
    /// 產生 400 錯誤請求回應。
    /// </summary>
    private static IResult BadRequest<T>(string error) =>
        CanvasJsonHelper.JsonError(
            ApiResponse<T>.Fail(error),
            StatusCodes.Status400BadRequest);

    /// <summary>
    /// 產生 404 找不到資源回應。
    /// </summary>
    private static IResult NotFound<T>(string error) =>
        CanvasJsonHelper.JsonError(
            ApiResponse<T>.Fail(error, 404),
            StatusCodes.Status404NotFound);
}
