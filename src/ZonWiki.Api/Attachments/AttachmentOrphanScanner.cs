using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Attachments;

/// <summary>
/// 孤兒附件掃描器：找出「建立超過寬限期、且未被任何內容引用」的附件並軟刪除（ValidFlag=0）。
///
/// 引用判定（保守設計，寧可留著也不誤殺）：附件 Id 字串出現在「同一位使用者」的
/// Note.ContentRaw、NoteRevision.ContentRaw（編輯歷史可還原）、NoteOverlayItem.DataJson
/// （圖片輪播）、TaskCard.Content、Node.Content 或 NodeRevision.Content（任務與畫布節點
/// 共用同一個 Markdown 編輯器，同樣能貼圖）任一處即算被引用；比對含軟刪除列
/// （垃圾桶內仍可還原）並用 ILIKE（大小寫不敏感，防使用者手動貼大寫 GUID 網址）。
///
/// 鐵則：絕不硬刪除——只壓 ValidFlag，磁碟檔案也保留（必要時 DBA 可把 ValidFlag 壓回復活）。
/// 已知取捨（見 docs/DECISIONS.md 2026-07-08）：被「永久清除（PurgedDateTime）」筆記引用的
/// 附件仍算被引用、永不回收；NoteRevision 無 trigram 索引（存量 base64 會讓 GIN 索引爆炸），
/// 每日一輪的順序掃描在單人規模可接受。
/// </summary>
public sealed class AttachmentOrphanScanner(
    IServiceScopeFactory scopeFactory,
    IOptions<AttachmentOptions> options,
    ILogger<AttachmentOrphanScanner> logger)
{
    /// <summary>
    /// 單輪最多處理的候選附件數（安全閥；避免極端情況下單輪掃描時間失控）。
    /// </summary>
    private const int MaxCandidatesPerRun = 500;

    /// <summary>
    /// 軟刪除孤兒附件時記錄的操作者字串（稽核欄位）。
    /// </summary>
    private const string ScannerActor = "system:attachment-orphan";

    /// <summary>
    /// 執行一輪孤兒掃描。
    /// </summary>
    /// <param name="ct">取消權杖。</param>
    /// <returns>本輪被軟刪除的孤兒附件數。</returns>
    public async Task<int> ScanOnceAsync(CancellationToken ct)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ZonWikiDbContext>();

        var cutoff = DateTime.UtcNow.AddHours(-options.Value.OrphanGraceHours);
        // 背景無 HttpContext → 全域使用者過濾會濾光，一律 IgnoreQueryFilters、條件自帶。
        var candidates = await db.NoteAttachment
            .IgnoreQueryFilters()
            .Where(a => a.ValidFlag && a.CreatedDateTime < cutoff)
            .OrderBy(a => a.CreatedDateTime)
            .Take(MaxCandidatesPerRun)
            .ToListAsync(ct);

        var cleanedCount = 0;
        foreach (var attachment in candidates)
        {
            ct.ThrowIfCancellationRequested();

            // 前端插入格式為小寫連字號 GUID；ILIKE 讓大小寫變體也算引用（不誤殺）。
            var pattern = $"%{attachment.Id:D}%";
            var userId = attachment.UserId;

            var isReferenced =
                await db.Note.IgnoreQueryFilters()
                    .AnyAsync(n => n.UserId == userId && EF.Functions.ILike(n.ContentRaw, pattern), ct)
                || await db.NoteRevision.IgnoreQueryFilters()
                    .AnyAsync(r => r.UserId == userId && EF.Functions.ILike(r.ContentRaw, pattern), ct)
                || await db.NoteOverlayItem.IgnoreQueryFilters()
                    .AnyAsync(o => o.UserId == userId && o.DataJson != null && EF.Functions.ILike(o.DataJson, pattern), ct)
                || await db.TaskCard.IgnoreQueryFilters()
                    .AnyAsync(t => t.UserId == userId && EF.Functions.ILike(t.Content, pattern), ct)
                || await db.Node.IgnoreQueryFilters()
                    .AnyAsync(n => n.UserId == userId && EF.Functions.ILike(n.Content, pattern), ct)
                || await db.NodeRevision.IgnoreQueryFilters()
                    .AnyAsync(r => r.UserId == userId && EF.Functions.ILike(r.Content, pattern), ct);
            if (isReferenced)
            {
                continue;
            }

            var now = DateTime.UtcNow;
            attachment.ValidFlag = false;
            attachment.DeletedDateTime = now;
            attachment.UpdatedDateTime = now;
            attachment.UpdatedUser = ScannerActor;
            cleanedCount++;
        }

        if (cleanedCount > 0)
        {
            await db.SaveChangesAsync(ct);
        }

        logger.LogInformation(
            "孤兒附件掃描完成：候選 {CandidateCount} 件、軟刪除 {CleanedCount} 件（寬限 {GraceHours} 小時）",
            candidates.Count, cleanedCount, options.Value.OrphanGraceHours);
        return cleanedCount;
    }
}
