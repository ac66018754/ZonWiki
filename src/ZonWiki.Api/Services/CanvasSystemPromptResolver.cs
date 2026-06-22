using Microsoft.EntityFrameworkCore;
using ZonWiki.Domain.Dtos;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Services;

/// <summary>
/// 解析「單一畫布實際生效的 System Prompt」。
///
/// 來源依序合併並去重（同一個 System Prompt 只算一次，先出現者優先）：
/// 1. global：標記為全域（IsGlobal）的 System Prompt，自動套用到所有畫布。
/// 2. category：此畫布所屬分類（CanvasCat）吃到的 System Prompt。
/// 3. own：此畫布自己額外勾選的 System Prompt。
///
/// 提問時（AskOrchestrator）會把這些內容串接後注入給 AI；「畫布設定」面板也用它顯示生效清單。
///
/// 重要：本解析器以「明確傳入的 userId」做隔離，並對 IUserOwned 實體（SystemPrompt / CanvasCat）
/// 使用 IgnoreQueryFilters + 手動條件（UserId == userId AND ValidFlag）。原因是 AskOrchestrator
/// 在背景 scope 執行時 ICurrentUser 可能為空，導致全域過濾器（依 ICurrentUser）會把資料全部過濾掉。
/// 改用明確 userId 後，端點（有登入情境）與背景提問（無 HTTP 情境）兩種路徑行為一致且正確。
/// </summary>
public static class CanvasSystemPromptResolver
{
    /// <summary>
    /// 解析指定畫布實際生效的 System Prompt 清單（已合併三來源並去重）。
    /// </summary>
    /// <param name="db">資料庫內容。</param>
    /// <param name="userId">資源擁有者（目前使用者）識別碼，用於明確隔離。</param>
    /// <param name="canvasId">畫布識別碼。</param>
    /// <param name="ct">取消權杖。</param>
    /// <returns>實際生效的 System Prompt（含來源標記）。</returns>
    public static async Task<List<EffectiveSystemPromptDto>> ResolveAsync(
        ZonWikiDbContext db,
        Guid userId,
        Guid canvasId,
        CancellationToken ct)
    {
        var result = new List<EffectiveSystemPromptDto>();
        var seen = new HashSet<Guid>();

        // 防禦性檢查：確認此畫布確實屬於傳入的 userId 且有效（背景 scope 全域過濾器可能失效，故明確驗證）。
        // 不屬於則回空清單——避免任何「以他人畫布 Id 解析」的越權路徑。
        var canvasOwned = await db.Canvas
            .IgnoreQueryFilters()
            .AnyAsync(c => c.Id == canvasId && c.UserId == userId && c.ValidFlag, ct);
        if (!canvasOwned)
        {
            return result;
        }

        // 1) 全域來源：本人、有效、且 IsGlobal 的 System Prompt。
        var globals = await db.SystemPrompt
            .IgnoreQueryFilters()
            .Where(p => p.UserId == userId && p.ValidFlag && p.IsGlobal)
            .OrderBy(p => p.CreatedDateTime)
            .ToListAsync(ct);
        foreach (var p in globals)
        {
            if (seen.Add(p.Id))
            {
                result.Add(new EffectiveSystemPromptDto(
                    p.Id.ToString(),
                    p.Title,
                    p.Content,
                    "global",
                    null));
            }
        }

        // 2) 分類來源：此畫布所屬分類 → 分類吃到的 System Prompt。
        var categoryIds = await db.CanvasCategory
            .Where(cc => cc.CanvasId == canvasId)
            .Select(cc => cc.CategoryId)
            .ToListAsync(ct);

        if (categoryIds.Count > 0)
        {
            // 分類名稱對照（本人 + 有效）。
            var categoryNames = await db.CanvasCat
                .IgnoreQueryFilters()
                .Where(c => categoryIds.Contains(c.Id) && c.UserId == userId && c.ValidFlag)
                .ToDictionaryAsync(c => c.Id, c => c.Name, ct);

            // 分類↔System Prompt 關聯。
            var links = await db.CategorySystemPrompt
                .Where(csp => categoryIds.Contains(csp.CategoryId))
                .ToListAsync(ct);

            var linkedPromptIds = links.Select(l => l.SystemPromptId).Distinct().ToList();
            // 載入對應的 System Prompt（本人 + 有效；已軟刪除者自然被排除）。
            var promptsById = await db.SystemPrompt
                .IgnoreQueryFilters()
                .Where(p => linkedPromptIds.Contains(p.Id) && p.UserId == userId && p.ValidFlag)
                .ToDictionaryAsync(p => p.Id, ct);

            foreach (var link in links)
            {
                if (!promptsById.TryGetValue(link.SystemPromptId, out var prompt))
                {
                    // 對應的 System Prompt 已被軟刪除或非本人 → 跳過。
                    continue;
                }

                if (!seen.Add(prompt.Id))
                {
                    continue;
                }

                categoryNames.TryGetValue(link.CategoryId, out var categoryName);
                result.Add(new EffectiveSystemPromptDto(
                    prompt.Id.ToString(),
                    prompt.Title,
                    prompt.Content,
                    "category",
                    categoryName));
            }
        }

        // 3) 自選來源：此畫布自己額外勾選的 System Prompt。
        var ownPromptIds = await db.CanvasSystemPrompt
            .Where(csp => csp.CanvasId == canvasId)
            .Select(csp => csp.SystemPromptId)
            .ToListAsync(ct);

        if (ownPromptIds.Count > 0)
        {
            var ownPrompts = await db.SystemPrompt
                .IgnoreQueryFilters()
                .Where(p => ownPromptIds.Contains(p.Id) && p.UserId == userId && p.ValidFlag)
                .OrderBy(p => p.CreatedDateTime)
                .ToListAsync(ct);
            foreach (var prompt in ownPrompts)
            {
                if (seen.Add(prompt.Id))
                {
                    result.Add(new EffectiveSystemPromptDto(
                        prompt.Id.ToString(),
                        prompt.Title,
                        prompt.Content,
                        "own",
                        null));
                }
            }
        }

        return result;
    }

    /// <summary>
    /// 串接後的 System Prompt 內容總長度上限（避免大量 / 超長 prompt 串接後塞爆 AI 供應商造成 DoS）。
    /// </summary>
    private const int MaxCombinedLength = 200000;

    /// <summary>
    /// 把生效的 System Prompt 內容串接成單一字串（供注入 AI）；無任何內容時回 null。
    /// 串接總長度超過上限時截斷（保留前面的來源，較高優先序者先注入）。
    /// </summary>
    /// <param name="effective">實際生效的 System Prompt 清單。</param>
    /// <returns>以兩個換行分隔的串接內容；若皆為空白則回 null。</returns>
    public static string? Combine(IEnumerable<EffectiveSystemPromptDto> effective)
    {
        var builder = new System.Text.StringBuilder();
        foreach (var item in effective)
        {
            var content = item.Content;
            if (string.IsNullOrWhiteSpace(content))
            {
                continue;
            }

            var separatorLength = builder.Length > 0 ? 2 : 0;
            if (builder.Length + separatorLength + content.Length > MaxCombinedLength)
            {
                // 超過總長度上限 → 截斷，不再串接後續來源。
                break;
            }

            if (builder.Length > 0)
            {
                builder.Append("\n\n");
            }
            builder.Append(content);
        }

        return builder.Length == 0 ? null : builder.ToString();
    }
}
