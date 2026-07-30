using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using ZonWiki.Api.Auth;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 筆記浮層「手動快照」端點：
/// - POST /api/notes/{noteId}/overlay/snapshots：把該筆記「當下」的全部浮層元件與畫記
///   由伺服器端讀取並序列化保存一份（不信任 client 上傳的 payload）。
/// - GET  /api/notes/{noteId}/overlay/snapshots：快照清單（僅摘要，不含重量級 JSON）。
///
/// 設計取捨（詳見 docs/DECISIONS.md 2026-07-30 第二批）：
/// - 手動觸發（右下角工具列儲存鈕）而非自動——浮層變更頻率極高，自動快照會讓筆數爆炸。
/// - 「不去重」：內容與上一份相同也照存（使用者按下儲存＝明確存檔意圖）。
/// - 本階段無還原端點：快照為救援用途，需要時由 DB 人工還原（軟刪救援同款流程）。
/// </summary>
public static class NoteOverlaySnapshotEndpoints
{
    /// <summary>
    /// 序列化選項：camelCase（與前端 JSON 慣例一致），共用單例避免重複配置。
    /// </summary>
    private static readonly JsonSerializerOptions SerializerOptions = new(JsonSerializerDefaults.Web);

    /// <summary>
    /// 對應浮層快照端點。
    /// </summary>
    /// <param name="app">Web 應用程式。</param>
    public static void MapNoteOverlaySnapshotEndpoints(this WebApplication app)
    {
        app.MapPost("/api/notes/{noteId:guid}/overlay/snapshots", CreateSnapshotHandler)
            .RequireAuthorization();
        app.MapGet("/api/notes/{noteId:guid}/overlay/snapshots", ListSnapshotsHandler)
            .RequireAuthorization();
    }

    // ==================== Create Snapshot ====================

    /// <summary>
    /// 建立浮層快照：讀取該筆記當下全部有效的浮層元件與畫記，序列化為 JSON 保存。
    /// </summary>
    /// <param name="noteId">筆記 Id。</param>
    /// <param name="http">HTTP 內容（取使用者身分）。</param>
    /// <param name="db">資料庫內容。</param>
    /// <param name="logger">記錄器。</param>
    /// <param name="ct">取消權杖。</param>
    /// <returns>新快照的序號與摘要。</returns>
    private static async Task<IResult> CreateSnapshotHandler(
        Guid noteId,
        HttpContext http,
        ZonWikiDbContext db,
        ILogger<object> logger,
        CancellationToken ct)
    {
        if (!TryUser(http, out var userGuid))
        {
            return Results.Unauthorized();
        }

        // 擁有權：顯式核對 UserId（不依賴隱式全域過濾——防日後重構誤用 IgnoreQueryFilters 而洩漏）。
        var ownsNote = await db.Note
            .IgnoreQueryFilters()
            .AnyAsync(n => n.Id == noteId && n.UserId == userGuid && n.ValidFlag, ct);
        if (!ownsNote)
        {
            return Results.NotFound(ApiResponse<object>.Fail("Note not found", 404));
        }

        try
        {
            // 只取「有效」列（走全域過濾）：軟刪的浮層/畫記不屬於「當下狀態」。
            var overlayItems = await db.NoteOverlayItem
                .AsNoTracking()
                .Where(o => o.NoteId == noteId)
                .OrderBy(o => o.ZIndex)
                .Select(o => new SnapshotOverlayItem(
                    o.Id, o.Kind, o.X, o.Y, o.Width, o.Height, o.ZIndex,
                    o.Color, o.Text, o.DataJson, o.IsQuestion, o.QuestionAnswer))
                .ToListAsync(ct);

            var marks = await db.NoteMark
                .AsNoTracking()
                .Where(m => m.NoteId == noteId)
                .OrderBy(m => m.AnchorStart)
                .Select(m => new SnapshotMark(
                    m.Id, m.Kind, m.AnchorText, m.AnchorStart, m.AnchorEnd,
                    m.AnchorPrefix, m.AnchorSuffix, m.Detached,
                    m.Color, m.TargetType, m.TargetId, m.TargetUrl, m.Text))
                .ToListAsync(ct);

            var itemsJson = JsonSerializer.Serialize(
                new SnapshotPayload(overlayItems, marks),
                SerializerOptions);
            var summary = BuildSummary(overlayItems, marks.Count);

            // 取號無視查詢過濾器：(NoteId, SnapshotNo) 唯一索引不分 ValidFlag，
            // 只看有效列會在有軟刪快照時取到重複序號（同 NoteRevision 的教訓）。
            var nextNo = (await db.NoteOverlaySnapshot
                .IgnoreQueryFilters()
                .Where(s => s.NoteId == noteId)
                .MaxAsync(s => (int?)s.SnapshotNo, ct) ?? 0) + 1;

            var snapshot = new NoteOverlaySnapshot
            {
                UserId = userGuid,
                NoteId = noteId,
                SnapshotNo = nextNo,
                ItemsJson = itemsJson,
                Summary = summary,
                CreatedUser = userGuid.ToString(),
                UpdatedUser = userGuid.ToString(),
            };
            db.NoteOverlaySnapshot.Add(snapshot);
            await db.SaveChangesAsync(ct);

            return Results.Ok(ApiResponse<object>.Ok(new
            {
                id = snapshot.Id,
                snapshotNo = snapshot.SnapshotNo,
                summary = snapshot.Summary,
                createdDateTime = snapshot.CreatedDateTime,
            }));
        }
        catch (DbUpdateException ex) when (IsSnapshotNumberCollision(ex))
        {
            // 並發雙擊：兩個請求取到同一序號，敗方撞唯一索引 → 409 請重試（不外洩裸 500）。
            return Results.Json(
                ApiResponse<object>.Fail("快照同時儲存衝突，請重試", 409),
                statusCode: StatusCodes.Status409Conflict);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to create overlay snapshot (noteId={NoteId})", noteId);
            return Results.StatusCode(500);
        }
    }

    // ==================== List Snapshots ====================

    /// <summary>
    /// 快照清單（依序號倒序；只含摘要欄位，不含重量級 ItemsJson）。
    /// </summary>
    /// <param name="noteId">筆記 Id。</param>
    /// <param name="http">HTTP 內容（取使用者身分）。</param>
    /// <param name="db">資料庫內容。</param>
    /// <param name="ct">取消權杖。</param>
    /// <returns>快照清單。</returns>
    private static async Task<IResult> ListSnapshotsHandler(
        Guid noteId,
        HttpContext http,
        ZonWikiDbContext db,
        CancellationToken ct)
    {
        if (!TryUser(http, out var userGuid))
        {
            return Results.Unauthorized();
        }

        var ownsNote = await db.Note
            .IgnoreQueryFilters()
            .AnyAsync(n => n.Id == noteId && n.UserId == userGuid && n.ValidFlag, ct);
        if (!ownsNote)
        {
            return Results.NotFound(ApiResponse<List<NoteOverlaySnapshotListItemDto>>.Fail("Note not found", 404));
        }

        var snapshots = await db.NoteOverlaySnapshot
            .Where(s => s.NoteId == noteId)
            .OrderByDescending(s => s.SnapshotNo)
            .Select(s => new NoteOverlaySnapshotListItemDto(
                s.Id, s.SnapshotNo, s.Summary, s.CreatedDateTime))
            .ToListAsync(ct);

        return Results.Ok(ApiResponse<List<NoteOverlaySnapshotListItemDto>>.Ok(snapshots));
    }

    // ==================== 共用輔助 ====================

    /// <summary>
    /// 從 HTTP 內容解析目前使用者。
    /// </summary>
    /// <param name="http">HTTP 內容。</param>
    /// <param name="userGuid">解析出的使用者 Id。</param>
    /// <returns>是否成功解析。</returns>
    private static bool TryUser(HttpContext http, out Guid userGuid)
    {
        var raw = http.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
        return Guid.TryParse(raw, out userGuid);
    }

    /// <summary>
    /// 建立顯示用摘要：各型別數量以「・」串接（僅列非零者）；全空為「（空浮層）」。
    /// </summary>
    /// <param name="overlayItems">浮層元件清單。</param>
    /// <param name="markCount">畫記數量。</param>
    /// <returns>摘要字串（長度受 Summary 欄位上限保護）。</returns>
    private static string BuildSummary(IReadOnlyList<SnapshotOverlayItem> overlayItems, int markCount)
    {
        var parts = new List<string>();
        AppendCount(parts, "便利貼", overlayItems.Count(i => i.Kind == "sticky"));
        AppendCount(parts, "文字框", overlayItems.Count(i => i.Kind == "text"));
        AppendCount(parts, "塗鴉", overlayItems.Count(i => i.Kind == "drawing"));
        AppendCount(parts, "圖片板", overlayItems.Count(i => i.Kind == "slide"));
        AppendCount(parts, "畫記", markCount);
        var summary = parts.Count == 0 ? "（空浮層）" : string.Join("・", parts);
        // 防禦性截斷：現行五類固定標籤不可能超限，但欄位上限 varchar(200)——
        // 超長會讓整批儲存 rollback 成 500（同 ActivityLogInterceptor.Truncate 的教訓）。
        return summary.Length <= NoteOverlaySnapshot.SummaryMaxLength
            ? summary
            : summary[..(NoteOverlaySnapshot.SummaryMaxLength - 1)] + "…";
    }

    /// <summary>
    /// 數量大於零時把「{標籤}{數量}」加進摘要片段。
    /// </summary>
    private static void AppendCount(List<string> parts, string label, int count)
    {
        if (count > 0)
        {
            parts.Add($"{label}{count}");
        }
    }

    /// <summary>
    /// 判定例外是否為「快照序號」唯一索引衝突（PostgreSQL 23505 且撞的是該索引）。
    /// </summary>
    private static bool IsSnapshotNumberCollision(DbUpdateException ex) =>
        ex.InnerException is PostgresException pg
        && pg.SqlState == PostgresErrorCodes.UniqueViolation
        && pg.ConstraintName == "UX_NoteOverlaySnapshot_NoteId_SnapshotNo";

    /// <summary>
    /// 快照內容：浮層元件與畫記的完整狀態（序列化為 ItemsJson）。
    /// </summary>
    /// <param name="OverlayItems">浮層元件（便利貼/文字框/塗鴉/圖片板）。</param>
    /// <param name="Marks">文字標註（畫重點/關聯/備註）。</param>
    private sealed record SnapshotPayload(
        List<SnapshotOverlayItem> OverlayItems,
        List<SnapshotMark> Marks);

    /// <summary>
    /// 快照中的浮層元件（NoteOverlayItem 的完整欄位投影）。
    /// </summary>
    private sealed record SnapshotOverlayItem(
        Guid Id,
        string Kind,
        double X,
        double Y,
        double Width,
        double Height,
        int ZIndex,
        string? Color,
        string? Text,
        string? DataJson,
        bool IsQuestion,
        string? QuestionAnswer);

    /// <summary>
    /// 快照中的文字標註（NoteMark 的完整欄位投影）。
    /// </summary>
    private sealed record SnapshotMark(
        Guid Id,
        string Kind,
        string AnchorText,
        int AnchorStart,
        int AnchorEnd,
        string AnchorPrefix,
        string AnchorSuffix,
        bool Detached,
        string? Color,
        string? TargetType,
        Guid? TargetId,
        string? TargetUrl,
        string? Text);
}
