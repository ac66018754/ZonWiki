using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Diagnostics;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Infrastructure.Persistence;

/// <summary>
/// 活動紀錄攔截器：在每次 SaveChanges 時，掃描變更追蹤器，對「使用者關心的實體型別」
/// （筆記 / 任務 / 子任務 / 開問啦節點 / AI 模型(API Key) / 快速紀錄 / 快速連結 / 系統提示詞）
/// 自動產生一筆 <see cref="ActivityLog"/>（標題級，附「變更摘要 Detail」），與本次變更一起存進同一交易。
///
/// 設計重點：
/// - 集中於一處攔截，所有新增/編輯/刪除（含 AI 自動建立的節點）都會被記錄，不需逐一改各端點。
/// - 動作分類：Added→created；Deleted→deleted；Modified 時 ValidFlag true→false 視為 deleted、
///   false→true 視為 restored，其餘有實質欄位變更才記 updated（只動 UpdatedDateTime 不算）。
/// - 「編輯」附變更摘要（Detail）：短字串欄位附「舊 → 新」、長文欄位只列名稱、
///   分類/標籤變更列出加入/移出的名稱。排除稽核欄、影子屬性（xmin）與衍生欄位（ContentHtml/Slug…）。
/// - 分類/標籤變更（NoteCategory / NoteTag）：本 repo 的移除＝軟刪（ValidFlag true→false）、
///   重加＝復活（false→true），故攔 Added ＋ ValidFlag 翻轉；依「所屬筆記」分組，
///   合併進「同一筆」note/updated 活動（若該筆記本身也有欄位變更則一併串接；否則獨立產生一筆）。
/// - 必須在 <see cref="AuditingSaveChangesInterceptor"/> 之後註冊：稽核攔截器先跑（設好其他實體的
///   Id/時間），本攔截器再產生紀錄，並「自行」設好紀錄列的 Id/時間/使用者欄位。
/// - 無法歸屬使用者（CurrentUserId 為空，如設計階段）時不記錄，避免污染。
/// - 需要「分類/標籤名稱、筆記標題」來組摘要，故會對同一 DbContext 發唯讀查詢（AsNoTracking）補齊，
///   同步 / 非同步兩條 SaveChanges 路徑各以對應查詢實作（全 repo 皆走 async，同步路徑僅為完備）。
/// </summary>
public sealed class ActivityLogInterceptor : SaveChangesInterceptor
{
    /// <inheritdoc />
    public override InterceptionResult<int> SavingChanges(
        DbContextEventData eventData,
        InterceptionResult<int> result)
    {
        if (eventData.Context is ZonWikiDbContext db)
        {
            CaptureActivitiesSync(db);
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
            await CaptureActivitiesAsync(db, cancellationToken);
        }

        return await base.SavingChangesAsync(eventData, result, cancellationToken);
    }

    // ══════════════════════════════ 進入點（sync / async）══════════════════════════════

    /// <summary>
    /// 非同步路徑：掃描變更 → 以非同步查詢補齊名稱 → 組裝並加入本次儲存。
    /// </summary>
    /// <param name="db">ZonWiki 資料庫內容。</param>
    /// <param name="ct">取消權杖。</param>
    private static async Task CaptureActivitiesAsync(ZonWikiDbContext db, CancellationToken ct)
    {
        var context = TryBeginCapture(db);
        if (context is null)
        {
            return;
        }

        var scan = context.Scan;

        // 補齊摘要所需名稱（分類 / 標籤 / 未被追蹤的筆記標題）。
        var categoryNames = scan.NeededCategoryIds.Count == 0
            ? EmptyNames
            : await db.Category.AsNoTracking()
                .Where(c => scan.NeededCategoryIds.Contains(c.Id))
                .Select(c => new { c.Id, c.Name })
                .ToDictionaryAsync(x => x.Id, x => x.Name, ct);

        var tagNames = scan.NeededTagIds.Count == 0
            ? EmptyNames
            : await db.Tag.AsNoTracking()
                .Where(t => scan.NeededTagIds.Contains(t.Id))
                .Select(t => new { t.Id, t.Name })
                .ToDictionaryAsync(x => x.Id, x => x.Name, ct);

        var noteTitles = scan.NeededNoteTitleIds.Count == 0
            ? EmptyNames
            : await db.Note.AsNoTracking()
                .Where(n => scan.NeededNoteTitleIds.Contains(n.Id))
                .Select(n => new { n.Id, n.Title })
                .ToDictionaryAsync(x => x.Id, x => x.Title, ct);

        AssembleAndAdd(db, context, categoryNames, tagNames, noteTitles);
    }

    /// <summary>
    /// 同步路徑：掃描變更 → 以同步查詢補齊名稱 → 組裝並加入本次儲存。
    /// </summary>
    /// <param name="db">ZonWiki 資料庫內容。</param>
    private static void CaptureActivitiesSync(ZonWikiDbContext db)
    {
        var context = TryBeginCapture(db);
        if (context is null)
        {
            return;
        }

        var scan = context.Scan;

        var categoryNames = scan.NeededCategoryIds.Count == 0
            ? EmptyNames
            : db.Category.AsNoTracking()
                .Where(c => scan.NeededCategoryIds.Contains(c.Id))
                .Select(c => new { c.Id, c.Name })
                .ToDictionary(x => x.Id, x => x.Name);

        var tagNames = scan.NeededTagIds.Count == 0
            ? EmptyNames
            : db.Tag.AsNoTracking()
                .Where(t => scan.NeededTagIds.Contains(t.Id))
                .Select(t => new { t.Id, t.Name })
                .ToDictionary(x => x.Id, x => x.Name);

        var noteTitles = scan.NeededNoteTitleIds.Count == 0
            ? EmptyNames
            : db.Note.AsNoTracking()
                .Where(n => scan.NeededNoteTitleIds.Contains(n.Id))
                .Select(n => new { n.Id, n.Title })
                .ToDictionary(x => x.Id, x => x.Title);

        AssembleAndAdd(db, context, categoryNames, tagNames, noteTitles);
    }

    /// <summary>空名稱字典（共用，避免每次配置）。</summary>
    private static readonly Dictionary<Guid, string> EmptyNames = new();

    // ══════════════════════════════ 掃描階段 ══════════════════════════════

    /// <summary>
    /// 前置檢查並掃描變更追蹤器；若無使用者身分或無可記錄的變更則回 null。
    /// </summary>
    /// <param name="db">ZonWiki 資料庫內容。</param>
    /// <returns>掃描結果與擷取脈絡；不需記錄時為 null。</returns>
    private static CaptureContext? TryBeginCapture(ZonWikiDbContext db)
    {
        var userId = db.CurrentUserId;
        if (userId == Guid.Empty)
        {
            return null; // 無法歸屬使用者（例如遷移/設計階段）→ 不記錄
        }

        var scan = ScanChanges(db);
        if (scan.Primaries.Count == 0 && scan.LinkDeltasByNote.Count == 0)
        {
            return null; // 沒有任何可記錄的變更
        }

        return new CaptureContext(userId, db.CurrentSource, scan);
    }

    /// <summary>
    /// 掃描變更追蹤器，分別收集「主要實體活動」與「連結（分類/標籤）變更」。
    /// </summary>
    /// <param name="db">ZonWiki 資料庫內容。</param>
    /// <returns>掃描結果。</returns>
    private static ScanResult ScanChanges(ZonWikiDbContext db)
    {
        var scan = new ScanResult();

        // 先找出「本批次整個被刪除的分類 / 標籤」——刪除一個分類/標籤時會連帶移除它在各筆記上的關聯，
        // 這些連帶移除不代表「使用者逐一編輯了那些筆記」，故要略過、不記成每篇筆記各一筆假的 updated。
        var (deletedCategoryIds, deletedTagIds) = CollectDeletedParents(db);

        foreach (EntityEntry entry in db.ChangeTracker.Entries())
        {
            switch (entry.Entity)
            {
                case ActivityLog:
                    continue; // 不記錄活動紀錄自己

                case NoteCategory noteCategory:
                {
                    var action = ClassifyLinkAction(entry);
                    // 分類本身正被整個刪除 → 其連帶移除不記逐筆活動。
                    if (action == LinkAction.Remove && deletedCategoryIds.Contains(noteCategory.CategoryId))
                    {
                        continue;
                    }
                    if (action != LinkAction.None)
                    {
                        var delta = scan.GetOrAddLinkDelta(noteCategory.NoteId);
                        var bucket = action == LinkAction.Add ? delta.AddedCategoryIds : delta.RemovedCategoryIds;
                        bucket.Add(noteCategory.CategoryId);
                        scan.NeededCategoryIds.Add(noteCategory.CategoryId);
                    }
                    continue;
                }

                case NoteTag noteTag:
                {
                    var action = ClassifyLinkAction(entry);
                    // 標籤本身正被整個刪除 → 其連帶移除不記逐筆活動。
                    if (action == LinkAction.Remove && deletedTagIds.Contains(noteTag.TagId))
                    {
                        continue;
                    }
                    if (action != LinkAction.None)
                    {
                        var delta = scan.GetOrAddLinkDelta(noteTag.NoteId);
                        var bucket = action == LinkAction.Add ? delta.AddedTagIds : delta.RemovedTagIds;
                        bucket.Add(noteTag.TagId);
                        scan.NeededTagIds.Add(noteTag.TagId);
                    }
                    continue;
                }
            }

            // 記下所有被追蹤的筆記標題（供「純連結變更」的筆記取當下標題，免查 DB）。
            if (entry.Entity is Note trackedNote)
            {
                scan.TrackedNoteTitles[trackedNote.Id] = trackedNote.Title;
            }

            var mapped = MapEntity(entry.Entity);
            if (mapped is null)
            {
                continue; // 非關心的實體型別
            }

            var primaryAction = ClassifyAction(entry);
            if (primaryAction is null)
            {
                continue; // 無實質變更
            }

            var (entityType, title) = mapped.Value;
            var entityId = entry.Entity is AuditableEntity ae ? ae.Id : Guid.Empty;
            var fieldSummary = primaryAction == "updated" ? BuildFieldSummary(entry) : null;

            scan.Primaries.Add(new PrimaryDraft(
                entityType,
                entityId,
                primaryAction,
                title,
                fieldSummary,
                IsNote: entry.Entity is Note));
        }

        // 已被追蹤（in-memory 可取標題）的筆記不需再查 DB；只留「純連結變更且未載入筆記」者。
        scan.NeededNoteTitleIds.RemoveWhere(id => scan.TrackedNoteTitles.ContainsKey(id));

        return scan;
    }

    // ══════════════════════════════ 組裝階段 ══════════════════════════════

    /// <summary>
    /// 依掃描結果與已補齊的名稱字典，組出 ActivityLog 列並加入本次儲存。
    /// </summary>
    /// <param name="db">ZonWiki 資料庫內容。</param>
    /// <param name="context">擷取脈絡（使用者 / 來源 / 掃描結果）。</param>
    /// <param name="categoryNames">分類 Id → 名稱。</param>
    /// <param name="tagNames">標籤 Id → 名稱。</param>
    /// <param name="noteTitles">（未被追蹤的）筆記 Id → 標題。</param>
    private static void AssembleAndAdd(
        ZonWikiDbContext db,
        CaptureContext context,
        IReadOnlyDictionary<Guid, string> categoryNames,
        IReadOnlyDictionary<Guid, string> tagNames,
        IReadOnlyDictionary<Guid, string> noteTitles)
    {
        var scan = context.Scan;
        var now = DateTime.UtcNow;
        var userKey = context.UserId.ToString();
        var pending = new List<ActivityLog>();

        // 主要實體活動：筆記的 updated 會併入同批次的連結變更摘要。
        var coveredNoteIds = new HashSet<Guid>();
        foreach (var primary in scan.Primaries)
        {
            string? detail = null;

            if (primary.IsNote)
            {
                coveredNoteIds.Add(primary.EntityId);

                // 只有「編輯」才附摘要；新增/刪除/還原一律不附連結雜訊。
                if (primary.Action == "updated")
                {
                    var linkSummary = scan.LinkDeltasByNote.TryGetValue(primary.EntityId, out var delta)
                        ? BuildLinkSummary(delta, categoryNames, tagNames)
                        : null;
                    detail = JoinSummaries(primary.FieldSummary, linkSummary);
                }
            }
            else if (primary.Action == "updated")
            {
                detail = primary.FieldSummary;
            }

            pending.Add(BuildActivity(context, now, userKey, primary.EntityType, primary.EntityId, primary.Action, primary.Title, detail));
        }

        // 純連結變更（該筆記本身無主要活動）→ 各自產生一筆 note/updated。
        foreach (var (noteId, delta) in scan.LinkDeltasByNote)
        {
            if (coveredNoteIds.Contains(noteId))
            {
                continue; // 已併入該筆記的主要活動
            }

            var linkSummary = BuildLinkSummary(delta, categoryNames, tagNames);
            if (string.IsNullOrEmpty(linkSummary))
            {
                continue; // 名稱全查不到（例如分類已被硬刪）→ 不記空活動
            }

            var title = scan.TrackedNoteTitles.TryGetValue(noteId, out var trackedTitle)
                ? trackedTitle
                : noteTitles.GetValueOrDefault(noteId, string.Empty);

            pending.Add(BuildActivity(context, now, userKey, "note", noteId, "updated", title, linkSummary));
        }

        if (pending.Count > 0)
        {
            db.ActivityLog.AddRange(pending);
        }
    }

    /// <summary>
    /// 建立一筆 ActivityLog（統一設定 Id / 時間 / 使用者 / 來源 / 截斷）。
    /// </summary>
    private static ActivityLog BuildActivity(
        CaptureContext context,
        DateTime now,
        string userKey,
        string entityType,
        Guid entityId,
        string action,
        string title,
        string? detail) => new()
    {
        Id = Guid.NewGuid(),
        UserId = context.UserId,
        ActionType = action,
        EntityType = entityType,
        EntityId = entityId,
        Title = Truncate(title, 200),
        Detail = string.IsNullOrEmpty(detail) ? null : Truncate(detail, ActivityLog.DetailMaxLength),
        Source = context.Source,
        CreatedDateTime = now,
        UpdatedDateTime = now,
        CreatedUser = userKey,
        UpdatedUser = userKey,
        ValidFlag = true,
    };

    // ══════════════════════════════ 分類與摘要 ══════════════════════════════

    /// <summary>
    /// 把實體對應成 (活動型別字串, 標題)。回傳 null 表示不關心此型別。
    /// </summary>
    private static (string EntityType, string Title)? MapEntity(object entity) => entity switch
    {
        Note n => ("note", n.Title),
        TaskCard t => ("taskcard", t.Title),
        SubTask s => ("subtask", s.Title),
        Node nd => ("node", FirstLine(nd.Content)),
        AiModel m => ("aimodel", string.IsNullOrWhiteSpace(m.Label) ? m.Key : m.Label),
        CaptureItem c => ("capture", FirstLine(c.RawContent)),
        QuickLink q => ("quicklink", q.Title),
        SystemPrompt p => ("prompt", p.Title),
        TimeEntry te => ("timeentry", te.Title),
        _ => null,
    };

    /// <summary>
    /// 依變更狀態判定主要實體動作；Modified 需區分軟刪除 / 還原 / 真正編輯。回傳 null 表示不記錄。
    /// </summary>
    private static string? ClassifyAction(EntityEntry entry)
    {
        switch (entry.State)
        {
            case EntityState.Added:
                return "created";
            case EntityState.Deleted:
                return "deleted";
            case EntityState.Modified:
            {
                var flip = DetectValidFlagFlip(entry);
                if (flip == LinkAction.Remove) return "deleted"; // 軟刪除
                if (flip == LinkAction.Add) return "restored"; // 還原

                // 只有「除了 UpdatedDateTime/UpdatedUser 以外」確有欄位變更，才算一次編輯
                var hasRealChange = entry.Properties.Any(p =>
                    p.IsModified &&
                    p.Metadata.Name != nameof(AuditableEntity.UpdatedDateTime) &&
                    p.Metadata.Name != nameof(AuditableEntity.UpdatedUser));
                return hasRealChange ? "updated" : null;
            }
            default:
                return null;
        }
    }

    /// <summary>
    /// 掃描本批次「整個被刪除」的分類 / 標籤 Id（硬刪 Deleted，或軟刪 ValidFlag true→false）。
    /// 供上層略過「刪分類/標籤時連帶移除的筆記關聯」，避免產生每篇筆記各一筆的假 updated 活動。
    /// </summary>
    /// <param name="db">ZonWiki 資料庫內容。</param>
    /// <returns>被刪除的分類 Id 集合與標籤 Id 集合。</returns>
    private static (HashSet<Guid> CategoryIds, HashSet<Guid> TagIds) CollectDeletedParents(ZonWikiDbContext db)
    {
        var categoryIds = new HashSet<Guid>();
        var tagIds = new HashSet<Guid>();

        foreach (EntityEntry entry in db.ChangeTracker.Entries())
        {
            if (entry.Entity is not Category && entry.Entity is not Tag)
            {
                continue;
            }

            var beingRemoved = entry.State == EntityState.Deleted
                || (entry.State == EntityState.Modified && DetectValidFlagFlip(entry) == LinkAction.Remove);
            if (!beingRemoved)
            {
                continue;
            }

            switch (entry.Entity)
            {
                case Category category:
                    categoryIds.Add(category.Id);
                    break;
                case Tag tag:
                    tagIds.Add(tag.Id);
                    break;
            }
        }

        return (categoryIds, tagIds);
    }

    /// <summary>
    /// 判定連結（NoteCategory / NoteTag）的變更為「加入 / 移出 / 無」。
    /// 本 repo 移除＝軟刪（ValidFlag true→false）、重加＝復活（false→true）、初次加入＝Added。
    /// </summary>
    private static LinkAction ClassifyLinkAction(EntityEntry entry)
    {
        switch (entry.State)
        {
            case EntityState.Added:
                // 新增列：ValidFlag=true 才算加入（防禦性：極少數 seed 可能直接加軟刪列）。
                return entry.Entity is AuditableEntity { ValidFlag: true } ? LinkAction.Add : LinkAction.None;
            case EntityState.Deleted:
                return LinkAction.Remove; // 硬刪（理論上不會發生，仍視為移出）
            case EntityState.Modified:
                return DetectValidFlagFlip(entry); // 依 ValidFlag 翻轉判定
            default:
                return LinkAction.None;
        }
    }

    /// <summary>
    /// 偵測 Modified 實體的 ValidFlag 翻轉：true→false＝Remove（軟刪）、false→true＝Add（復活）、其餘 None。
    /// </summary>
    private static LinkAction DetectValidFlagFlip(EntityEntry entry)
    {
        var validFlagProp = entry.Properties.FirstOrDefault(
            p => p.Metadata.Name == nameof(AuditableEntity.ValidFlag));
        if (validFlagProp is null)
        {
            return LinkAction.None;
        }

        var wasValid = validFlagProp.OriginalValue as bool? ?? true;
        var isValid = validFlagProp.CurrentValue as bool? ?? true;
        if (wasValid && !isValid) return LinkAction.Remove;
        if (!wasValid && isValid) return LinkAction.Add;
        return LinkAction.None;
    }

    /// <summary>
    /// 建立「編輯」的欄位變更摘要：掃描已變更且非排除的欄位，短字串附「舊 → 新」、長文只列名稱。
    /// 排除稽核欄、影子屬性（xmin）、衍生欄位（ContentHtml/Slug…）與無中文對照的欄位。
    /// </summary>
    /// <param name="entry">變更追蹤項目。</param>
    /// <returns>以「；」串接的摘要；無可顯示欄位時為 null。</returns>
    private static string? BuildFieldSummary(EntityEntry entry)
    {
        var parts = new List<string>();
        foreach (var prop in entry.Properties)
        {
            if (!prop.IsModified || prop.Metadata.IsShadowProperty())
            {
                continue;
            }

            var name = prop.Metadata.Name;
            if (ExcludedFields.Contains(name) || !FieldLabels.TryGetValue(name, out var label))
            {
                continue; // 稽核欄 / 衍生欄 / 無對照欄位一律不列（避免噪音與內部名稱外洩）
            }

            if (LongTextFields.Contains(name))
            {
                parts.Add(label); // 長文欄位只列名稱，不附完整前後內容
            }
            else
            {
                parts.Add($"{label}「{FormatValue(prop.OriginalValue)}」→「{FormatValue(prop.CurrentValue)}」");
            }
        }

        return parts.Count == 0 ? null : string.Join("；", parts);
    }

    /// <summary>
    /// 建立「分類/標籤變更」摘要：加入分類「x」；移出分類「y」；加入標籤「z」；移除標籤「w」。
    /// </summary>
    /// <param name="delta">某筆記的連結變更集合。</param>
    /// <param name="categoryNames">分類 Id → 名稱。</param>
    /// <param name="tagNames">標籤 Id → 名稱。</param>
    /// <returns>以「；」串接的摘要；全無可解析名稱時為 null。</returns>
    private static string? BuildLinkSummary(
        LinkDelta delta,
        IReadOnlyDictionary<Guid, string> categoryNames,
        IReadOnlyDictionary<Guid, string> tagNames)
    {
        var parts = new List<string>();
        AppendNamed(parts, "加入分類", delta.AddedCategoryIds, categoryNames);
        AppendNamed(parts, "移出分類", delta.RemovedCategoryIds, categoryNames);
        AppendNamed(parts, "加入標籤", delta.AddedTagIds, tagNames);
        AppendNamed(parts, "移除標籤", delta.RemovedTagIds, tagNames);
        return parts.Count == 0 ? null : string.Join("；", parts);
    }

    /// <summary>
    /// 把某群 Id 以「動詞「名稱」」形式（去重、跳過查不到名稱者）加進摘要片段清單。
    /// </summary>
    private static void AppendNamed(
        List<string> parts,
        string verb,
        List<Guid> ids,
        IReadOnlyDictionary<Guid, string> names)
    {
        foreach (var id in ids.Distinct())
        {
            if (names.TryGetValue(id, out var name) && !string.IsNullOrWhiteSpace(name))
            {
                parts.Add($"{verb}「{name}」");
            }
        }
    }

    /// <summary>
    /// 串接「欄位摘要」與「連結摘要」；任一為空則略過，兩者皆空回 null。
    /// </summary>
    private static string? JoinSummaries(string? fieldSummary, string? linkSummary)
    {
        var segments = new[] { fieldSummary, linkSummary }
            .Where(s => !string.IsNullOrEmpty(s))
            .ToArray();
        return segments.Length == 0 ? null : string.Join("；", segments);
    }

    /// <summary>
    /// 格式化欄位值供摘要顯示：null/空＝「（空）」、bool＝是/否、日期＝yyyy-MM-dd、其餘字串化並截斷。
    /// </summary>
    private static string FormatValue(object? value)
    {
        switch (value)
        {
            case null:
                return "（空）";
            case bool b:
                return b ? "是" : "否";
            case DateTime dt:
                return dt.ToString("yyyy-MM-dd");
            default:
                var s = value.ToString() ?? string.Empty;
                if (string.IsNullOrWhiteSpace(s)) return "（空）";
                return s.Length > FieldValueMaxLength ? s[..FieldValueMaxLength] + "…" : s;
        }
    }

    /// <summary>取首行並去除前後空白（節點/快速紀錄等多行內容用）。</summary>
    private static string FirstLine(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return string.Empty;
        return s.Split('\n')[0].Trim();
    }

    /// <summary>
    /// 截斷過長字串（以字元數計）：超過上限時取「max-1 個字元 ＋ 省略號」，
    /// 確保結果長度**不超過 max**（省略號本身佔 1 字元）——否則會超出 DB 欄位上限，
    /// 導致與使用者變更同一交易的 log 插入失敗、整批 rollback（使用者存檔直接 500）。
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
        // 保留 1 字元給省略號，確保總長不超過 max。
        return max <= 1 ? s[..max] : s[..(max - 1)] + "…";
    }

    // ══════════════════════════════ 常數與型別 ══════════════════════════════

    /// <summary>欄位值在摘要中顯示的最大字元長度。</summary>
    private const int FieldValueMaxLength = 30;

    /// <summary>
    /// 不納入「變更摘要」的欄位名（稽核欄 + 衍生 / 快取欄）。
    /// 影子屬性（xmin 等）另以 <c>IsShadowProperty()</c> 排除。
    /// </summary>
    private static readonly HashSet<string> ExcludedFields = new(StringComparer.Ordinal)
    {
        nameof(AuditableEntity.Id),
        nameof(AuditableEntity.CreatedDateTime),
        nameof(AuditableEntity.CreatedUser),
        nameof(AuditableEntity.UpdatedDateTime),
        nameof(AuditableEntity.UpdatedUser),
        nameof(AuditableEntity.ValidFlag),
        nameof(AuditableEntity.DeletedDateTime),
        nameof(AuditableEntity.PurgedDateTime),
        nameof(Note.ContentHtml),
        nameof(Note.ContentHash),
        nameof(Note.Slug),
        nameof(Note.LastOpenedDateTime),
        nameof(TaskCard.CompletedDateTime),
    };

    /// <summary>
    /// 欄位名 → 使用者可讀中文標籤。只有在此對照表內的欄位才會出現在變更摘要中（避免內部名稱外洩）。
    /// </summary>
    private static readonly Dictionary<string, string> FieldLabels = new(StringComparer.Ordinal)
    {
        // 筆記
        [nameof(Note.Title)] = "標題",
        [nameof(Note.ContentRaw)] = "內容",
        [nameof(Note.Kind)] = "類型",
        [nameof(Note.IsDraft)] = "草稿",
        [nameof(Note.JournalDate)] = "日記日期",
        // 任務（與筆記共用 Title；其餘為任務專屬）
        [nameof(TaskCard.Content)] = "內容",
        [nameof(TaskCard.Status)] = "狀態",
        [nameof(TaskCard.Priority)] = "優先度",
        [nameof(TaskCard.PlannedDateTime)] = "排程時間",
        [nameof(TaskCard.DueDateTime)] = "截止時間",
        [nameof(TaskCard.ParentId)] = "父任務",
        [nameof(TaskCard.IsLongTerm)] = "長期任務",
        [nameof(TaskCard.IsPinnedToHome)] = "首頁釘選",
        [nameof(TaskCard.TargetDateTime)] = "目標日",
        [nameof(TaskCard.RecurrenceRule)] = "重複規則",
        // 快速捕捉
        [nameof(CaptureItem.RawContent)] = "內容",
        // 時間追蹤（Title 已由上方「標題」涵蓋；時間欄位見 LongTextFields 的說明）
        // ⚠️ 此字典的鍵是「屬性名稱字串」（全域、不分實體型別）：加新條目前必須 grep
        //    其他實體是否有同名屬性——例如這裡的 "Category" 也會讓 QuickLink.Category 的
        //    變更開始出現在活動摘要（已評估為合理行為並以測試鎖住；見設計文件 2026-07-15）。
        [nameof(TimeEntry.Category)] = "分類",
        [nameof(TimeEntry.Note)] = "備註",
        [nameof(TimeEntry.StartedDateTime)] = "開始時間",
        [nameof(TimeEntry.EndedDateTime)] = "結束時間",
    };

    /// <summary>
    /// 長文欄位：摘要中只列名稱、不附完整前後內容（避免膨脹與外洩）。
    /// 時間追蹤的開始/結束時間也歸此類——FormatValue 對 DateTime 只印日期（yyyy-MM-dd），
    /// 「同日只改時分」會記成「相同→相同」的白紀錄且值為 UTC 易生時區混淆，故只列欄名。
    /// </summary>
    private static readonly HashSet<string> LongTextFields = new(StringComparer.Ordinal)
    {
        nameof(Note.ContentRaw),
        nameof(TaskCard.Content),
        nameof(CaptureItem.RawContent),
        nameof(TimeEntry.Note),
        nameof(TimeEntry.StartedDateTime),
        nameof(TimeEntry.EndedDateTime),
    };

    /// <summary>連結變更動作。</summary>
    private enum LinkAction
    {
        /// <summary>無變更（不記錄）。</summary>
        None,

        /// <summary>加入（新增或復活）。</summary>
        Add,

        /// <summary>移出（軟刪除或硬刪）。</summary>
        Remove,
    }

    /// <summary>掃描出的主要實體活動草稿。</summary>
    /// <param name="EntityType">活動型別字串（note/taskcard/…）。</param>
    /// <param name="EntityId">實體識別碼。</param>
    /// <param name="Action">動作（created/updated/deleted/restored）。</param>
    /// <param name="Title">標題。</param>
    /// <param name="FieldSummary">欄位變更摘要（updated 時，可空）。</param>
    /// <param name="IsNote">是否為筆記（決定是否併入連結變更摘要）。</param>
    private sealed record PrimaryDraft(
        string EntityType,
        Guid EntityId,
        string Action,
        string Title,
        string? FieldSummary,
        bool IsNote);

    /// <summary>某筆記在本批次的分類 / 標籤加入 / 移出集合。</summary>
    private sealed class LinkDelta
    {
        /// <summary>加入的分類 Id。</summary>
        public List<Guid> AddedCategoryIds { get; } = new();

        /// <summary>移出的分類 Id。</summary>
        public List<Guid> RemovedCategoryIds { get; } = new();

        /// <summary>加入的標籤 Id。</summary>
        public List<Guid> AddedTagIds { get; } = new();

        /// <summary>移除的標籤 Id。</summary>
        public List<Guid> RemovedTagIds { get; } = new();
    }

    /// <summary>變更追蹤器掃描結果。</summary>
    private sealed class ScanResult
    {
        /// <summary>主要實體活動草稿清單。</summary>
        public List<PrimaryDraft> Primaries { get; } = new();

        /// <summary>依「所屬筆記」分組的連結變更。</summary>
        public Dictionary<Guid, LinkDelta> LinkDeltasByNote { get; } = new();

        /// <summary>被追蹤到的筆記 Id → 當下標題（供純連結變更取標題，免查 DB）。</summary>
        public Dictionary<Guid, string> TrackedNoteTitles { get; } = new();

        /// <summary>需要補查名稱的分類 Id。</summary>
        public HashSet<Guid> NeededCategoryIds { get; } = new();

        /// <summary>需要補查名稱的標籤 Id。</summary>
        public HashSet<Guid> NeededTagIds { get; } = new();

        /// <summary>需要補查標題的筆記 Id（連結變更但未被追蹤者，組裝階段才決定）。</summary>
        public HashSet<Guid> NeededNoteTitleIds { get; } = new();

        /// <summary>取得或建立某筆記的連結變更集合。</summary>
        /// <param name="noteId">筆記識別碼。</param>
        /// <returns>該筆記的連結變更集合。</returns>
        public LinkDelta GetOrAddLinkDelta(Guid noteId)
        {
            if (!LinkDeltasByNote.TryGetValue(noteId, out var delta))
            {
                delta = new LinkDelta();
                LinkDeltasByNote[noteId] = delta;
                // 先假設需要補標題；掃描完成後若發現已被追蹤，補查集合可含冗餘 Id（查詢無害）。
                NeededNoteTitleIds.Add(noteId);
            }
            return delta;
        }
    }

    /// <summary>擷取脈絡：使用者 / 來源 / 掃描結果。</summary>
    /// <param name="UserId">操作者使用者識別碼。</param>
    /// <param name="Source">操作來源（web 或 API 權杖名）。</param>
    /// <param name="Scan">變更掃描結果。</param>
    private sealed record CaptureContext(Guid UserId, string Source, ScanResult Scan);
}
