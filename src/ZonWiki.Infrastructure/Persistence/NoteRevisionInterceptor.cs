using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Diagnostics;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Infrastructure.Persistence;

/// <summary>
/// 筆記版本快照攔截器：在每次 SaveChanges 掃描變更追蹤器，凡是筆記（Note）被
/// 「新增 / 標題或內容被修改 / 軟刪除」，就自動寫入一筆 <see cref="NoteRevision"/> 全文快照，
/// 與該次變更同一交易原子送出。
///
/// 為何用攔截器而非各端點自行寫入（設計決策，詳見 docs/DECISIONS.md）：
/// - 需求是「任何方式改變筆記內容都必須留版本」——防線必須設在唯一瓶頸點（SaveChanges），
///   而非仰賴每個端點自律。歷史上 /api/links/note-from 就是忘了寫版本的實例。
/// - 未來新增任何寫入路徑（新端點、新背景服務、MCP 工具）都自動被涵蓋，無法再漏。
///
/// 行為規則：
/// - Added → ChangeKind="create"（建立當下快照）。
/// - Modified 且 ValidFlag true→false → "delete"（軟刪除當下的最終快照——誤刪救援的關鍵）。
/// - Modified 且 Title 或 ContentRaw 確有變更 → "update"（改後快照）。
/// - 其餘不寫：純中繼資料變更（分類/標籤/草稿旗標/釘選）、還原（false→true，內容未變）、
///   同值重送（EF 值比較偵測不到變更）——避免產生與上一版完全相同的噪音版本。
/// - 版本序號取「該筆記現存最大序號＋1」，且取號**無視查詢過濾器**（IgnoreQueryFilters）：
///   (NoteId, RevisionNo) 唯一索引不分 ValidFlag，若只看有效列，遇到被軟刪的版本列會取到
///   重複序號、整批存檔爆唯一索引（此坑已由整合測試 SoftDeletedRevisionRow_DoesNotBreakNumbering 鎖住）。
///
/// 結構性注意事項：
/// - 必須註冊在 <see cref="AuditingSaveChangesInterceptor"/> 之後，且**自行蓋章**全部稽核欄位
///   （Id/時間/使用者/ValidFlag）：稽核攔截器在本攔截器之前執行、不會回頭補章，
///   漏蓋的話 CreatedDateTime 會存成 0001-01-01（測試 AssertAuditStamped 鎖住此坑）。
/// - 快照歸屬（UserId）取 note.UserId 而非 CurrentUserId：背景服務（AI 精煉/框選提問）
///   沒有 HTTP 脈絡、CurrentUserId 為空，但快照仍須歸屬筆記擁有者，否則查詢過濾器會讓歷史隱形。
/// - ⚠️ <c>ExecuteUpdate / ExecuteDelete</c> 不經過 SaveChanges、也就不觸發本攔截器——
///   目前唯一使用處是 NoteEndpoints 的 LastOpenedDateTime（無內容變更，安全）。
///   日後**嚴禁**用 ExecuteUpdate 改 Title/ContentRaw，否則版本快照會靜默漏寫。
/// - 同一請求內多次 SaveChanges（如 AI 整合的兩段式儲存）不會重複寫：第一次儲存後
///   實體狀態轉為 Unchanged，第二次掃描不到變更。
/// </summary>
public sealed class NoteRevisionInterceptor : SaveChangesInterceptor
{
    /// <inheritdoc />
    public override InterceptionResult<int> SavingChanges(
        DbContextEventData eventData,
        InterceptionResult<int> result)
    {
        if (eventData.Context is ZonWikiDbContext db)
        {
            CaptureRevisionsSync(db);
        }

        return base.SavingChanges(eventData, result);
    }

    /// <inheritdoc />
    public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        if (eventData.Context is ZonWikiDbContext db)
        {
            await CaptureRevisionsAsync(db, cancellationToken);
        }

        return await base.SavingChangesAsync(eventData, result, cancellationToken);
    }

    // ══════════════════════════════ 進入點（sync / async）══════════════════════════════

    /// <summary>
    /// 非同步路徑：掃描變更 → 非同步查詢各筆記現存最大版本序號 → 組裝快照並加入本次儲存。
    /// </summary>
    /// <param name="db">ZonWiki 資料庫內容。</param>
    /// <param name="ct">取消權杖。</param>
    private static async Task CaptureRevisionsAsync(ZonWikiDbContext db, CancellationToken ct)
    {
        var drafts = ScanNotes(db);
        if (drafts.Count == 0)
        {
            return;
        }

        var noteIds = drafts.Select(d => d.Note.Id).ToList();

        // 一次查齊所有涉及筆記的現存最大序號（避免逐筆 N+1）。
        // IgnoreQueryFilters：唯一索引不分 ValidFlag/使用者，取號必須看「全部」列。
        var maxNoByNoteId = await db.NoteRevision
            .IgnoreQueryFilters()
            .Where(r => noteIds.Contains(r.NoteId))
            .GroupBy(r => r.NoteId)
            .Select(g => new { NoteId = g.Key, MaxNo = g.Max(r => r.RevisionNo) })
            .ToDictionaryAsync(x => x.NoteId, x => x.MaxNo, ct);

        AssembleAndAdd(db, drafts, maxNoByNoteId);
    }

    /// <summary>
    /// 同步路徑：與非同步版行為一致（全 repo 皆走 async，此路徑僅為完備）。
    /// </summary>
    /// <param name="db">ZonWiki 資料庫內容。</param>
    private static void CaptureRevisionsSync(ZonWikiDbContext db)
    {
        var drafts = ScanNotes(db);
        if (drafts.Count == 0)
        {
            return;
        }

        var noteIds = drafts.Select(d => d.Note.Id).ToList();

        var maxNoByNoteId = db.NoteRevision
            .IgnoreQueryFilters()
            .Where(r => noteIds.Contains(r.NoteId))
            .GroupBy(r => r.NoteId)
            .Select(g => new { NoteId = g.Key, MaxNo = g.Max(r => r.RevisionNo) })
            .ToDictionary(x => x.NoteId, x => x.MaxNo);

        AssembleAndAdd(db, drafts, maxNoByNoteId);
    }

    // ══════════════════════════════ 掃描階段 ══════════════════════════════

    /// <summary>
    /// 掃描變更追蹤器，找出本批次需要寫快照的筆記與其變更種類。
    /// </summary>
    /// <param name="db">ZonWiki 資料庫內容。</param>
    /// <returns>快照草稿清單（無需寫入時為空）。</returns>
    private static List<RevisionDraft> ScanNotes(ZonWikiDbContext db)
    {
        var drafts = new List<RevisionDraft>();

        // 防雙寫保險：本批次已有「待新增」的快照列的筆記（理論上僅發生於過渡期
        // 殘留的顯式寫入），攔截器讓路、不再補寫，避免撞 (NoteId, RevisionNo) 唯一索引。
        var noteIdsWithPendingRevision = new HashSet<Guid>();
        foreach (EntityEntry entry in db.ChangeTracker.Entries())
        {
            if (entry.Entity is NoteRevision pending && entry.State == EntityState.Added)
            {
                noteIdsWithPendingRevision.Add(pending.NoteId);
            }
        }

        foreach (EntityEntry entry in db.ChangeTracker.Entries())
        {
            if (entry.Entity is not Note note)
            {
                continue;
            }

            var changeKind = ClassifyChange(entry);
            if (changeKind is null || noteIdsWithPendingRevision.Contains(note.Id))
            {
                continue;
            }

            drafts.Add(new RevisionDraft(note, changeKind));
        }

        return drafts;
    }

    /// <summary>
    /// 判定筆記變更的快照種類；回傳 null 表示不需要快照。
    /// </summary>
    /// <param name="entry">筆記的變更追蹤項目。</param>
    /// <returns>"create" / "update" / "delete"，或 null（不寫）。</returns>
    private static string? ClassifyChange(EntityEntry entry)
    {
        switch (entry.State)
        {
            case EntityState.Added:
                return "create";

            case EntityState.Modified:
            {
                // 軟刪除（ValidFlag true→false）→ delete 快照（保留刪除當下的最終內容）。
                // 還原（false→true）內容未變 → 不寫。
                var validFlagProp = entry.Property(nameof(AuditableEntity.ValidFlag));
                var wasValid = validFlagProp.OriginalValue as bool? ?? true;
                var isValid = validFlagProp.CurrentValue as bool? ?? true;
                if (wasValid && !isValid)
                {
                    return "delete";
                }
                if (!wasValid && isValid)
                {
                    return null;
                }

                // 只有「標題或內容」確有變更才算一次版本（EF 以值比較判定，
                // 同值重送不觸發；純中繼資料變更（草稿旗標等）不觸發）。
                var titleChanged = entry.Property(nameof(Note.Title)).IsModified;
                var contentChanged = entry.Property(nameof(Note.ContentRaw)).IsModified;
                return titleChanged || contentChanged ? "update" : null;
            }

            default:
                // Deleted（硬刪）不寫：本系統一律軟刪除；硬刪列的外鍵也容不下快照。
                return null;
        }
    }

    // ══════════════════════════════ 組裝階段 ══════════════════════════════

    /// <summary>
    /// 依草稿與現存最大序號組出快照列並加入本次儲存（同一交易原子送出）。
    /// </summary>
    /// <param name="db">ZonWiki 資料庫內容。</param>
    /// <param name="drafts">快照草稿清單。</param>
    /// <param name="maxNoByNoteId">筆記 Id → 現存最大版本序號（無列者不在字典中）。</param>
    private static void AssembleAndAdd(
        ZonWikiDbContext db,
        List<RevisionDraft> drafts,
        IReadOnlyDictionary<Guid, int> maxNoByNoteId)
    {
        var now = DateTime.UtcNow;

        foreach (var (note, changeKind) in drafts)
        {
            var nextNo = maxNoByNoteId.GetValueOrDefault(note.Id, 0) + 1;

            // 快照歸屬與操作者：
            // - UserId 一律取筆記擁有者（背景服務無 CurrentUserId 也要歸屬正確，歷史才查得到）。
            // - CreatedUser/UpdatedUser 優先記實際操作者（CurrentUserId），無脈絡時退回擁有者。
            var actor = db.CurrentUserId != Guid.Empty
                ? db.CurrentUserId.ToString()
                : note.UserId.ToString();

            db.NoteRevision.Add(new NoteRevision
            {
                Id = Guid.NewGuid(),
                UserId = note.UserId,
                NoteId = note.Id,
                RevisionNo = nextNo,
                ChangeKind = changeKind,
                // Title 欄位上限 varchar(500)：截斷防「快照列超長→整批交易 rollback→使用者存檔 500」。
                Title = Truncate(note.Title, 500),
                ContentRaw = note.ContentRaw ?? string.Empty,
                CreatedDateTime = now,
                UpdatedDateTime = now,
                CreatedUser = actor,
                UpdatedUser = actor,
                ValidFlag = true,
            });
        }
    }

    /// <summary>
    /// 截斷過長字串（以字元數計）：超過上限時取「max-1 個字元＋省略號」，確保結果長度不超過 max。
    /// </summary>
    /// <param name="s">原字串（null 視為空）。</param>
    /// <param name="max">結果的最大字元長度（含省略號）。</param>
    /// <returns>長度 ≤ max 的字串。</returns>
    private static string Truncate(string? s, int max)
    {
        s ??= string.Empty;
        if (s.Length <= max)
        {
            return s;
        }
        return max <= 1 ? s[..max] : s[..(max - 1)] + "…";
    }

    /// <summary>
    /// 快照草稿：待寫快照的筆記與其變更種類。
    /// </summary>
    /// <param name="Note">筆記實體（取快照內容與歸屬）。</param>
    /// <param name="ChangeKind">變更種類（create / update / delete）。</param>
    private sealed record RevisionDraft(Note Note, string ChangeKind);
}
