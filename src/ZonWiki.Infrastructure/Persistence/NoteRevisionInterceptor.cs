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
/// 時間窗合併（coalescing，2026-08-13 使用者裁示——閱讀模式勾選/直編每下都是一次 PUT，
/// 版本噪音淹沒真正的救援點）：本次為 "update" 且「現存最新一版」同時滿足
///   (a) ChangeKind="update"（create/delete 快照永不被覆寫——首版與刪除快照是誤刪救援的底）
///   (b) ValidFlag=true（被軟刪進垃圾桶的版本列不可就地復用）
///   (c) UpdatedUser＝本次 actor（不同操作者的變更各自留版本）
///   (d) now − 最新版 CreatedDateTime &lt; <see cref="CoalesceWindow"/>——錨定「鏈首時間」而非
///       滑動窗：鏈最長 10 分鐘必斷，保證每 10 分鐘至少留一個救援點（對抗復審 H2 裁定）
///   (e) 本次有「真 HTTP 請求脈絡」（CurrentUserId 非空「且」非 SetCurrentUserId 背景冒用）——
///       背景服務（AI 精煉/框選提問）寫入永不合併，否則 AI 覆寫會吃掉使用者手動版本的
///       救援點（對抗復審 C2＋二輪復審 HIGH：背景流程一律冒用使用者 Id，單看非空判不出來）
/// → 就地覆寫最新版的 Title/ContentRaw/UpdatedDateTime/UpdatedUser（顯式 IsModified，
///   不倚賴 DetectChanges——本攔截器位於攔截器鏈尾），不新增列、RevisionNo 不變。
/// 已知殘餘風險（記於 DECISIONS.md）：背景服務寫的版本列與手動列無欄位可區分，
/// 其後 10 分鐘內的手動編輯會把「背景寫入當下」的快照併掉（前一版仍在，損失有限）。
///
/// 結構性注意事項：
/// - 必須註冊在 <see cref="AuditingSaveChangesInterceptor"/> 之後，且**自行蓋章**全部稽核欄位
///   （Id/時間/使用者/ValidFlag）：稽核攔截器在本攔截器之前執行、不會回頭補章，
///   漏蓋的話 CreatedDateTime 會存成 0001-01-01（測試 AssertAuditStamped 鎖住此坑）。
/// - 快照歸屬（UserId）取 note.UserId 而非 CurrentUserId：背景服務（AI 精煉/框選提問）
///   沒有 HTTP 脈絡、CurrentUserId 為空，但快照仍須歸屬筆記擁有者，否則查詢過濾器會讓歷史隱形。
/// - ⚠️ <c>ExecuteUpdate / ExecuteDelete</c> 不經過 SaveChanges、也就不觸發本攔截器——
///   目前使用處僅兩個：NoteEndpoints 的 LastOpenedDateTime（最後打開時間）與
///   NoteRenderMigrationService 的啟動一次性收斂（ContentHtml/RenderVersion；
///   皆為衍生/中繼欄位、無內容變更，安全）。
///   日後**嚴禁**用 ExecuteUpdate 改 Title/ContentRaw，否則版本快照會靜默漏寫。
/// - 同一請求內多次 SaveChanges（如 AI 整合的兩段式儲存）不會重複寫：第一次儲存後
///   實體狀態轉為 Unchanged，第二次掃描不到變更。
/// </summary>
public sealed class NoteRevisionInterceptor : SaveChangesInterceptor
{
    /// <summary>
    /// 時間窗合併的窗長：距最新 update 版的 CreatedDateTime 在此窗內的連續 update
    /// 併成一筆（就地覆寫）。錨定鏈首時間＝鏈最長此時距必斷，保證救援點密度。
    /// </summary>
    internal static readonly TimeSpan CoalesceWindow = TimeSpan.FromMinutes(10);

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

        // 一次查齊所有涉及筆記的「現存最新一版」完整實體（追蹤查詢，合併時就地覆寫；
        // 其 RevisionNo 同時就是取號用的現存最大序號——避免逐筆 N+1）。
        // IgnoreQueryFilters：唯一索引不分 ValidFlag/使用者，取號與合併判定必須看「全部」列
        //（背景服務無 CurrentUserId，使用者過濾器會讓查詢空手而回、取號歸零撞唯一索引）。
        var latestByNoteId = (await db.NoteRevision
                .IgnoreQueryFilters()
                .Where(r => noteIds.Contains(r.NoteId))
                .GroupBy(r => r.NoteId)
                .Select(g => g.OrderByDescending(r => r.RevisionNo).First())
                .ToListAsync(ct))
            .ToDictionary(r => r.NoteId);

        AssembleAndAdd(db, drafts, latestByNoteId);
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

        var latestByNoteId = db.NoteRevision
            .IgnoreQueryFilters()
            .Where(r => noteIds.Contains(r.NoteId))
            .GroupBy(r => r.NoteId)
            .Select(g => g.OrderByDescending(r => r.RevisionNo).First())
            .ToList()
            .ToDictionary(r => r.NoteId);

        AssembleAndAdd(db, drafts, latestByNoteId);
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
    /// 依草稿與「現存最新一版」組出快照：滿足時間窗合併條件者就地覆寫最新版，
    /// 其餘新增快照列（皆與本次變更同一交易原子送出）。
    /// </summary>
    /// <param name="db">ZonWiki 資料庫內容。</param>
    /// <param name="drafts">快照草稿清單。</param>
    /// <param name="latestByNoteId">筆記 Id → 現存最新版本列（追蹤中實體；無列者不在字典中）。</param>
    private static void AssembleAndAdd(
        ZonWikiDbContext db,
        List<RevisionDraft> drafts,
        IReadOnlyDictionary<Guid, NoteRevision> latestByNoteId)
    {
        var now = DateTime.UtcNow;

        foreach (var (note, changeKind) in drafts)
        {
            var latest = latestByNoteId.GetValueOrDefault(note.Id);

            // 快照歸屬與操作者：
            // - UserId 一律取筆記擁有者（背景服務無 CurrentUserId 也要歸屬正確，歷史才查得到）。
            // - CreatedUser/UpdatedUser 優先記實際操作者（CurrentUserId），無脈絡時退回擁有者。
            var actor = db.CurrentUserId != Guid.Empty
                ? db.CurrentUserId.ToString()
                : note.UserId.ToString();

            // 時間窗合併（條件說明見類別註解 (a)–(e)）：就地覆寫最新版、不新增列。
            // (e) 的「有 HTTP 脈絡」不能只看 CurrentUserId 非空——背景流程一律
            // SetCurrentUserId 冒用使用者（隔離過濾需要），必須同時排除覆寫脈絡
            //（對抗復審 HIGH：否則背景 AI 覆寫仍會併掉使用者手動版本）。
            var canCoalesce =
                changeKind == "update"
                && db.CurrentUserId != Guid.Empty
                && !db.IsUserContextOverridden
                && latest is not null
                && latest.ChangeKind == "update"
                && latest.ValidFlag
                && latest.UpdatedUser == actor
                && now - latest.CreatedDateTime < CoalesceWindow;

            if (canCoalesce)
            {
                latest!.Title = Truncate(note.Title, 500);
                latest.ContentRaw = note.ContentRaw ?? string.Empty;
                latest.UpdatedDateTime = now;
                latest.UpdatedUser = actor;

                // 顯式標記恰好 4 欄——本攔截器位於攔截器鏈尾，不可倚賴後續 DetectChanges；
                // 且絕不可整列標 Modified（未載入欄位會被預設值覆寫）。
                var entry = db.Entry(latest);
                entry.Property(nameof(NoteRevision.Title)).IsModified = true;
                entry.Property(nameof(NoteRevision.ContentRaw)).IsModified = true;
                entry.Property(nameof(AuditableEntity.UpdatedDateTime)).IsModified = true;
                entry.Property(nameof(AuditableEntity.UpdatedUser)).IsModified = true;
                continue;
            }

            var nextNo = (latest?.RevisionNo ?? 0) + 1;

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
