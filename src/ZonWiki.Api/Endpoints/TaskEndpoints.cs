using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using ZonWiki.Api.Auth;
using ZonWiki.Api.Common;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 任務卡片（TaskCard）相關的 API 端點：
/// GET/POST /api/tasks（查詢/建立）、GET/PUT/DELETE /api/tasks/{id}（詳細/更新/刪除）。
/// 支援 view=list|board|calendar 及排序參數。
/// </summary>
public static class TaskEndpoints
{
    /// <summary>
    /// 任務卡片允許的狀態值（allow-list）。
    /// 前端看板／清單僅使用 todo／doing／done 這三種；任何其他值一律視為非法輸入並回 400（審查 #42）。
    /// 採 Ordinal（大小寫敏感）比對，因前端固定使用小寫值。
    /// </summary>
    private static readonly IReadOnlySet<string> AllowedTaskStatuses =
        new HashSet<string>(StringComparer.Ordinal) { "todo", "doing", "done" };

    public static void MapTaskEndpoints(this IEndpointRouteBuilder app)
    {
        /// <summary>
        /// 查詢當前使用者的任務卡片（支援多視圖與排序）。
        /// GET /api/tasks?view=list|board|calendar&sort=plannedDate|dueDate|createdDate|priority&from={date}&to={date}
        /// </summary>
        app.MapGet("/api/tasks", async (
            ZonWikiDbContext db,
            HttpContext httpContext,
            string view = "list",
            string sort = "createdDate",
            DateTime? from = null,
            DateTime? to = null,
            CancellationToken ct = default) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            // 基礎查詢：當前使用者且有效的卡片（含子任務與標籤，供卡片顯示進度與標籤）。
            var query = db.TaskCard
                .Include(t => t.Children)
                .Include(t => t.TaskTags)
                    .ThenInclude(tt => tt.Tag)
                .Where(t => t.UserId == userGuid && t.ValidFlag);

            // 依視圖類型處理
            return view.ToLower() switch
            {
                "board" => await GetBoardView(db, query, ct),
                "calendar" => await GetCalendarView(db, query, from, to, ct),
                _ => await GetListView(db, query, sort, ct) // 預設 list
            };
        });

        /// <summary>
        /// 建立新任務卡片。
        /// POST /api/tasks
        /// Body: { title, content?, status?, priority?, plannedDateTime?, dueDateTime?, groupId?, sortOrder?, recurrenceRule? }
        /// </summary>
        app.MapPost("/api/tasks", async (
            ZonWikiDbContext db,
            HttpContext httpContext,
            CreateTaskCardRequest request,
            CancellationToken ct) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            // 狀態驗證（審查 #42）：建立時的 status 必須是允許值（todo／doing／done）之一，
            // 避免任意字串（含空字串）被直接寫入卡片狀態。
            if (!AllowedTaskStatuses.Contains(request.Status))
            {
                return Results.Json(
                    ApiResponse<object>.Fail($"非法的任務狀態：{request.Status}", 400),
                    statusCode: StatusCodes.Status400BadRequest);
            }

            // 如果 IsPinnedToHome==true 且未指定 HomeSortOrder，查該使用者目前釘選任務的最大 HomeSortOrder。
            int homeSortOrder = 0;
            if (request.IsPinnedToHome)
            {
                var maxSortOrder = await db.TaskCard
                    .Where(t => t.UserId == userGuid && t.IsPinnedToHome && t.ValidFlag)
                    .MaxAsync(t => (int?)t.HomeSortOrder, ct);
                homeSortOrder = (maxSortOrder ?? -1) + 1;
            }

            var card = new TaskCard
            {
                Id = Guid.NewGuid(),
                UserId = userGuid,
                Title = request.Title,
                Content = request.Content ?? string.Empty,
                Status = request.Status,
                Priority = request.Priority,
                PlannedDateTime = request.PlannedDateTime,
                DueDateTime = request.DueDateTime,
                GroupId = request.GroupId,
                SortOrder = request.SortOrder,
                // 空白重複規則正規化為 null（＝一次性任務，不被具現化背景服務當母規則）。
                RecurrenceRule = string.IsNullOrWhiteSpace(request.RecurrenceRule)
                    ? null
                    : request.RecurrenceRule,
                ParentId = request.ParentId,
                // 建立時即為 done → 記下完成時間。
                CompletedDateTime = request.Status == "done" ? DateTime.UtcNow : null,
                IsLongTerm = request.IsLongTerm,
                TargetDateTime = request.TargetDateTime,
                TargetGranularity = request.TargetGranularity,
                IsPinnedToHome = request.IsPinnedToHome,
                HomeSortOrder = homeSortOrder,
                CreatedDateTime = DateTime.UtcNow,
                UpdatedDateTime = DateTime.UtcNow,
                CreatedUser = userId,
                UpdatedUser = userId,
                ValidFlag = true
            };

            db.TaskCard.Add(card);
            await db.SaveChangesAsync(ct);

            var dto = MapToDetailDto(card, db.Entry(card).GetConcurrencyVersion());
            return Results.Created($"/api/tasks/{card.Id}", ApiResponse<TaskCardDetailDto>.Ok(dto));
        });

        /// <summary>
        /// 取得單一任務卡片詳細資訊。
        /// GET /api/tasks/{id}
        /// </summary>
        app.MapGet("/api/tasks/{id:guid}", async (
            Guid id,
            ZonWikiDbContext db,
            HttpContext httpContext,
            CancellationToken ct) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            var card = await db.TaskCard
                .Include(t => t.Children)
                .Include(t => t.TaskTags)
                    .ThenInclude(tt => tt.Tag)
                .FirstOrDefaultAsync(t => t.Id == id && t.UserId == userGuid && t.ValidFlag, ct);

            if (card == null)
            {
                return Results.NotFound(ApiResponse<object>.Fail("卡片不存在或已刪除"));
            }

            var dto = MapToDetailDto(card, db.Entry(card).GetConcurrencyVersion());
            return Results.Ok(ApiResponse<TaskCardDetailDto>.Ok(dto));
        });

        /// <summary>
        /// 更新任務卡片。
        /// PUT /api/tasks/{id}
        /// Body: { title?, content?, status?, priority?, plannedDateTime?, dueDateTime?, groupId?, sortOrder?, recurrenceRule? }
        /// </summary>
        app.MapPut("/api/tasks/{id:guid}", async (
            Guid id,
            ZonWikiDbContext db,
            HttpContext httpContext,
            UpdateTaskCardRequest request,
            CancellationToken ct) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            // 狀態驗證（審查 #42）：更新採 PATCH 語意——未帶／空字串 status 代表「略過不改」（仍視為合法）；
            // 但一旦帶了非空的 status，就必須是允許值（todo／doing／done）之一，否則回 400，
            // 避免任意字串被直接寫入 card.Status（先驗證輸入再查資源，快速失敗）。
            if (!string.IsNullOrEmpty(request.Status) && !AllowedTaskStatuses.Contains(request.Status))
            {
                return Results.Json(
                    ApiResponse<object>.Fail($"非法的任務狀態：{request.Status}", 400),
                    statusCode: StatusCodes.Status400BadRequest);
            }

            var card = await db.TaskCard
                .FirstOrDefaultAsync(t => t.Id == id && t.UserId == userGuid && t.ValidFlag, ct);

            if (card == null)
            {
                return Results.NotFound(ApiResponse<object>.Fail("卡片不存在或已刪除"));
            }

            // 選擇性更新欄位
            if (!string.IsNullOrEmpty(request.Title))
                card.Title = request.Title;
            if (request.Content != null)
                card.Content = request.Content;
            if (!string.IsNullOrEmpty(request.Status))
            {
                var wasDone = card.Status == "done";
                card.Status = request.Status;
                var isDone = request.Status == "done";
                // 進入 done → 記完成時間；離開 done → 清空。
                if (isDone && !wasDone) card.CompletedDateTime = DateTime.UtcNow;
                else if (!isDone && wasDone) card.CompletedDateTime = null;
            }
            if (request.Priority.HasValue)
                card.Priority = request.Priority.Value;
            // 父任務：傳值＝設定父任務；ClearParentId=true＝改為頂層任務（null）。
            // 防環：父任務不可為自己（簡易防呆；深層環由前端排除自身與子孫）。
            if (request.ParentId != null && request.ParentId != card.Id)
                card.ParentId = request.ParentId;
            else if (request.ClearParentId)
                card.ParentId = null;
            // 日期/分類：傳值＝設定該值；ClearXxx=true＝清空為 null；兩者皆無＝維持原值。
            if (request.PlannedDateTime != null)
                card.PlannedDateTime = request.PlannedDateTime;
            else if (request.ClearPlannedDateTime)
                card.PlannedDateTime = null;
            if (request.DueDateTime != null)
                card.DueDateTime = request.DueDateTime;
            else if (request.ClearDueDateTime)
                card.DueDateTime = null;
            if (request.GroupId != null)
                card.GroupId = request.GroupId;
            else if (request.ClearGroupId)
                card.GroupId = null;
            if (request.SortOrder.HasValue)
                card.SortOrder = request.SortOrder.Value;
            // 重複規則：傳 null＝不更新；傳空白＝停止重複（清為 null，不再被具現化）；傳規則＝設定母規則。
            if (request.RecurrenceRule != null)
                card.RecurrenceRule = string.IsNullOrWhiteSpace(request.RecurrenceRule)
                    ? null
                    : request.RecurrenceRule;
            // 新增欄位更新邏輯
            if (request.IsLongTerm.HasValue)
                card.IsLongTerm = request.IsLongTerm.Value;
            if (request.TargetDateTime != null)
                card.TargetDateTime = request.TargetDateTime;
            else if (request.ClearTargetDateTime)
                card.TargetDateTime = null;
            if (request.TargetGranularity != null)
                card.TargetGranularity = request.TargetGranularity;
            else if (request.ClearTargetGranularity)
                card.TargetGranularity = null;
            // IsPinnedToHome：傳值＝更新；当由 false 變 true 且未同時指定 HomeSortOrder 時，自動指派。
            if (request.IsPinnedToHome.HasValue)
            {
                var wasPinned = card.IsPinnedToHome;
                card.IsPinnedToHome = request.IsPinnedToHome.Value;
                // 若由 false 變 true 且未指定 HomeSortOrder，自動指派為最大 + 1。
                if (!wasPinned && request.IsPinnedToHome.Value && !request.HomeSortOrder.HasValue)
                {
                    var maxSortOrder = await db.TaskCard
                        .Where(t => t.UserId == userGuid && t.IsPinnedToHome && t.ValidFlag)
                        .MaxAsync(t => (int?)t.HomeSortOrder, ct);
                    card.HomeSortOrder = (maxSortOrder ?? -1) + 1;
                }
            }
            if (request.HomeSortOrder.HasValue)
                card.HomeSortOrder = request.HomeSortOrder.Value;

            card.UpdatedDateTime = DateTime.UtcNow;
            card.UpdatedUser = userId;

            // 樂觀鎖（#4/#34）：若前端帶回 baseVersion，以其比對 xmin 偵測併發衝突。
            db.Entry(card).ApplyBaseVersion(request.BaseVersion);

            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateConcurrencyException)
            {
                // 載入後被其他來源改過 → 回 409，讓前端提示覆蓋或重新載入。
                return Results.Json(
                    ApiResponse<TaskCardDetailDto>.Fail("此項已被其他來源修改", 409),
                    statusCode: StatusCodes.Status409Conflict);
            }

            var dto = MapToDetailDto(card, db.Entry(card).GetConcurrencyVersion());
            return Results.Ok(ApiResponse<TaskCardDetailDto>.Ok(dto));
        });

        /// <summary>
        /// 刪除任務卡片（軟刪除）。
        /// DELETE /api/tasks/{id}
        /// </summary>
        app.MapDelete("/api/tasks/{id:guid}", async (
            Guid id,
            ZonWikiDbContext db,
            HttpContext httpContext,
            CancellationToken ct) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            var card = await db.TaskCard
                .FirstOrDefaultAsync(t => t.Id == id && t.UserId == userGuid && t.ValidFlag, ct);

            if (card == null)
            {
                return Results.NotFound(ApiResponse<object>.Fail("卡片不存在或已刪除"));
            }

            // 軟刪除（連同其子任務一併軟刪，避免子任務變孤兒）
            var now = DateTime.UtcNow;
            card.ValidFlag = false;
            card.DeletedDateTime = now;
            card.UpdatedDateTime = now;
            card.UpdatedUser = userId;

            var children = await db.TaskCard
                .Where(c => c.ParentId == id && c.UserId == userGuid && c.ValidFlag)
                .ToListAsync(ct);
            foreach (var child in children)
            {
                child.ValidFlag = false;
                child.DeletedDateTime = now;
                child.UpdatedDateTime = now;
                child.UpdatedUser = userId;
            }

            await db.SaveChangesAsync(ct);

            return Results.Ok(ApiResponse<object>.Ok(new { message = "卡片已刪除" }));
        });

        /// <summary>
        /// 設定任務卡片的標籤（整組取代；與筆記共用 Tag 標籤庫）。
        /// PUT /api/tasks/{id}/tags  Body: ["tagGuid", ...]
        /// </summary>
        app.MapPut("/api/tasks/{id:guid}/tags", async (
            Guid id,
            ZonWikiDbContext db,
            HttpContext httpContext,
            List<Guid> tagIds,
            ILogger<object> logger,
            CancellationToken ct) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            var card = await db.TaskCard
                .FirstOrDefaultAsync(t => t.Id == id && t.UserId == userGuid && t.ValidFlag, ct);
            if (card == null)
            {
                return Results.NotFound(ApiResponse<object>.Fail("卡片不存在或已刪除"));
            }

            try
            {
            // 僅接受屬於本人且有效的標籤（明確比對 UserId；不倚賴全域過濾器作為唯一防線）。
            var requested = (tagIds ?? new List<Guid>()).Distinct().ToList();
            var validTagIds = await db.Tag
                .Where(t => requested.Contains(t.Id) && t.UserId == userGuid && t.ValidFlag)
                .Select(t => t.Id)
                .ToListAsync(ct);

            // 載入所有既有關聯（含軟刪除，需 IgnoreQueryFilters）以便復活，避免違反 (TaskCardId,TagId) 唯一索引。
            var existing = await db.TaskTag
                .IgnoreQueryFilters()
                .Where(tt => tt.TaskCardId == id && tt.UserId == userGuid)
                .ToListAsync(ct);
            var existingTagIds = existing.Select(tt => tt.TagId).ToHashSet();

            // 既有關聯：在清單內→確保有效（復活）；不在→軟刪除。
            foreach (var link in existing)
            {
                var shouldHave = validTagIds.Contains(link.TagId);
                if (link.ValidFlag != shouldHave)
                {
                    link.ValidFlag = shouldHave;
                    link.DeletedDateTime = shouldHave ? null : DateTime.UtcNow;
                    link.UpdatedDateTime = DateTime.UtcNow;
                    link.UpdatedUser = userId;
                }
            }

            // 清單內但尚無關聯者：新增。
            foreach (var tagId in validTagIds.Where(t => !existingTagIds.Contains(t)))
            {
                db.TaskTag.Add(new TaskTag
                {
                    Id = Guid.NewGuid(),
                    UserId = userGuid,
                    TaskCardId = id,
                    TagId = tagId,
                    CreatedDateTime = DateTime.UtcNow,
                    UpdatedDateTime = DateTime.UtcNow,
                    CreatedUser = userId,
                    UpdatedUser = userId,
                    ValidFlag = true,
                });
            }

            await db.SaveChangesAsync(ct);
            return Results.Ok(ApiResponse<object>.Ok(new { id }));
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to assign task tags (userId={UserId}, taskId={TaskId})", userGuid, id);
                return Results.StatusCode(500);
            }
        });
    }

    /// <summary>
    /// 清單視圖：傳回排序後的卡片清單。
    /// </summary>
    private static async Task<IResult> GetListView(
        ZonWikiDbContext db,
        IQueryable<TaskCard> query,
        string sort,
        CancellationToken ct)
    {
        var cards = sort.ToLower() switch
        {
            "planneddate" => await query.OrderBy(t => t.PlannedDateTime).ThenBy(t => t.SortOrder).ToListAsync(ct),
            "duedate" => await query.OrderBy(t => t.DueDateTime).ThenBy(t => t.SortOrder).ToListAsync(ct),
            "priority" => await query.OrderByDescending(t => t.Priority).ThenBy(t => t.SortOrder).ToListAsync(ct),
            _ => await query.OrderBy(t => t.CreatedDateTime).ThenBy(t => t.SortOrder).ToListAsync(ct) // createdDate
        };

        var dtos = cards.Select(MapToSummaryDto).ToList();
        return Results.Ok(ApiResponse<List<TaskCardSummaryDto>>.Ok(dtos));
    }

    /// <summary>
    /// 看板視圖：傳回按群組與狀態分群的卡片。
    /// </summary>
    private static async Task<IResult> GetBoardView(
        ZonWikiDbContext db,
        IQueryable<TaskCard> query,
        CancellationToken ct)
    {
        var cards = await query.OrderBy(t => t.SortOrder).ToListAsync(ct);
        var userId = cards.FirstOrDefault()?.UserId;

        if (!userId.HasValue)
        {
            return Results.Ok(ApiResponse<TaskBoardViewDto>.Ok(
                new TaskBoardViewDto(new List<TaskGroupDto>(), new List<TaskCardSummaryDto>())));
        }

        // 載入該使用者的群組
        var groups = await db.TaskGroup
            .Where(g => g.UserId == userId.Value && g.ValidFlag)
            .OrderBy(g => g.SortOrder)
            .Select(g => new TaskGroupDto(g.Id, g.Name, g.Color, g.SortOrder))
            .ToListAsync(ct);

        var cardDtos = cards.Select(MapToSummaryDto).ToList();
        var boardView = new TaskBoardViewDto(groups, cardDtos);

        return Results.Ok(ApiResponse<TaskBoardViewDto>.Ok(boardView));
    }

    /// <summary>
    /// 行事曆視圖：傳回指定日期範圍內的卡片。
    /// </summary>
    private static async Task<IResult> GetCalendarView(
        ZonWikiDbContext db,
        IQueryable<TaskCard> query,
        DateTime? from,
        DateTime? to,
        CancellationToken ct)
    {
        var fromDate = from ?? DateTime.UtcNow.AddDays(-7);
        var toDate = to ?? DateTime.UtcNow.AddDays(7);

        var cards = await query
            .Where(t => (t.PlannedDateTime >= fromDate && t.PlannedDateTime <= toDate) ||
                        (t.DueDateTime >= fromDate && t.DueDateTime <= toDate))
            .OrderBy(t => t.PlannedDateTime ?? t.DueDateTime)
            .ToListAsync(ct);

        var cardDtos = cards.Select(MapToSummaryDto).ToList();
        var calendarView = new TaskCalendarViewDto(cardDtos, fromDate, toDate);

        return Results.Ok(ApiResponse<TaskCalendarViewDto>.Ok(calendarView));
    }

    /// <summary>
    /// 從卡片的 TaskTags 導覽（需先 Include）萃取標籤參照清單。
    /// 全域過濾器已濾掉無效關聯/標籤；仍防呆 null 與 ValidFlag。
    /// </summary>
    /// <summary>
    /// 對外公開的投影方式（供 HomePageEndpoints 使用）。
    /// </summary>
    public static TaskCardSummaryDto MapToSummaryDtoPublic(TaskCard card) =>
        MapToSummaryDto(card);

    private static List<TagRefDto> MapTags(TaskCard card) =>
        (card.TaskTags ?? new List<TaskTag>())
            .Where(tt => tt.ValidFlag && tt.Tag != null && tt.Tag.ValidFlag)
            .Select(tt => new TagRefDto(tt.Tag!.Id, tt.Tag.Name))
            .OrderBy(t => t.Name)
            .ToList();

    /// <summary>
    /// 從卡片的 Children 導覽（子任務＝子 TaskCard，需先 Include）萃取有效子任務（依排序）。
    /// 子任務以 SubTaskDto 形狀回傳以相容前端；其 Id 即「子任務的任務 Id」（點擊可開完整任務）。
    /// IsDone＝子任務狀態為 done。
    /// </summary>
    private static List<SubTaskDto> MapSubTasks(TaskCard card) =>
        (card.Children ?? new List<TaskCard>())
            .Where(c => c.ValidFlag)
            .OrderBy(c => c.SortOrder)
            .ThenBy(c => c.CreatedDateTime)
            .Select(c => new SubTaskDto(
                c.Id, card.Id, c.Title, c.Status == "done", c.SortOrder,
                c.CreatedDateTime, c.CompletedDateTime))
            .ToList();

    private static TaskCardSummaryDto MapToSummaryDto(TaskCard card)
    {
        // 子任務＝子卡片（Children，需先 Include）；未載入時視為 0。
        var children = card.Children ?? new List<TaskCard>();
        var total = children.Count(c => c.ValidFlag);
        var done = children.Count(c => c.ValidFlag && c.Status == "done");
        return new(
            card.Id,
            card.Title,
            card.Status,
            card.Priority,
            card.PlannedDateTime,
            card.DueDateTime,
            card.GroupId,
            card.SortOrder,
            card.CreatedDateTime,
            total,
            done,
            MapTags(card),
            MapSubTasks(card),
            card.ParentId,
            card.IsLongTerm,
            card.TargetDateTime,
            card.TargetGranularity,
            card.IsPinnedToHome,
            card.HomeSortOrder);
    }

    /// <summary>
    /// 將 TaskCard 實體映射為詳細 DTO。
    /// </summary>
    /// <param name="card">任務卡片實體。</param>
    /// <param name="version">樂觀鎖版本（xmin，#4/#34）；由呼叫端以 <c>db.Entry(card).GetConcurrencyVersion()</c> 取得。</param>
    /// <returns>任務卡片詳細 DTO。</returns>
    private static TaskCardDetailDto MapToDetailDto(TaskCard card, long version)
    {
        var subTasks = MapSubTasks(card);
        return new(
            card.Id,
            card.Title,
            card.Content,
            card.Status,
            card.Priority,
            card.PlannedDateTime,
            card.DueDateTime,
            card.GroupId,
            card.SortOrder,
            card.RecurrenceRule,
            card.CreatedDateTime,
            card.UpdatedDateTime,
            subTasks,
            MapTags(card),
            card.ParentId,
            card.IsLongTerm,
            card.TargetDateTime,
            card.TargetGranularity,
            card.IsPinnedToHome,
            card.HomeSortOrder,
            version);
    }
}
