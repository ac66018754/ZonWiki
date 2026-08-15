using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using ZonWiki.Domain.Entities;
using ZonWiki.Domain.Srs;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Services;

/// <summary>
/// 單字庫共用資料存取服務：集中「單字正規化＋復活軟刪列 upsert＋依 Id 查本人卡」，
/// 供 CRUD 端點與 AI 補釋義端點共用（避免各端點重複）。
///
/// 一律以「明確 UserId ＋ IgnoreQueryFilters」查詢：既能在有 HttpContext 的請求內正確運作，
/// 也能在背景／測試（無全域過濾）維持確定行為；復活軟刪列必須忽略過濾才看得到 ValidFlag=false 的列。
/// 唯一索引 (UserId, Word) 不含 ValidFlag → 同字重送走復活慣例；並發首建撞 23505 攔截改查既有列。
/// </summary>
public sealed class VocabularyService
{
    private readonly ZonWikiDbContext _db;

    /// <summary>
    /// 建立單字庫服務。
    /// </summary>
    /// <param name="db">資料庫內容。</param>
    public VocabularyService(ZonWikiDbContext db)
    {
        _db = db;
    }

    /// <summary>
    /// 單字正規化：Trim ＋ 統一小寫（ToLowerInvariant）。入庫前一律套用（設計書 §3.2）。
    /// </summary>
    /// <param name="raw">原始單字字串。</param>
    /// <returns>正規化後的單字。</returns>
    public static string NormalizeWord(string? raw) => (raw ?? string.Empty).Trim().ToLowerInvariant();

    /// <summary>
    /// 依 (UserId, 正規化 Word) find-or-create-or-revive：
    /// 找到有效列→直接回；找到軟刪列→復活後回；找不到→以 SM-2 新卡預設建立。
    /// 新建若撞 (UserId, Word) 唯一索引（並發首建）→ 攔截後改查既有列使用／復活，確保不回 500、不建重複。
    /// </summary>
    /// <param name="userId">使用者識別碼。</param>
    /// <param name="word">單字（未正規化亦可，內部會正規化）。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    /// <returns>upsert 結果（卡片實體 ＋ 是否為本次全新建立）。</returns>
    public async Task<VocabularyUpsertResult> UpsertAsync(
        Guid userId,
        string word,
        CancellationToken cancellationToken)
    {
        var normalized = NormalizeWord(word);

        var existing = await FindByWordAsync(userId, normalized, cancellationToken);
        if (existing is not null)
        {
            // 找到既有列（含軟刪）→ 若為軟刪則復活；回傳值本身在此不需要（實體已被追蹤並回傳）。
            await ReviveIfSoftDeletedAsync(existing, userId, cancellationToken);
            return new VocabularyUpsertResult(existing, Created: false);
        }

        var created = BuildNewCard(userId, normalized);
        _db.VocabularyWord.Add(created);

        try
        {
            await _db.SaveChangesAsync(cancellationToken);
            return new VocabularyUpsertResult(created, Created: true);
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            // 並發首建：另一路已插入同字列。卸掉本次衝突的新列，改查既有列（連軟刪也算）使用／復活。
            _db.Entry(created).State = EntityState.Detached;

            var raced = await FindByWordAsync(userId, normalized, cancellationToken);
            if (raced is null)
            {
                // 理論上唯一違反後必查得到；查不到則讓原例外往外拋（不吞）。
                throw;
            }

            await ReviveIfSoftDeletedAsync(raced, userId, cancellationToken);
            return new VocabularyUpsertResult(raced, Created: false);
        }
    }

    /// <summary>
    /// 依 Id 查本人的「有效」單字卡（IgnoreQueryFilters ＋ 明確 UserId ＋ ValidFlag）。
    /// </summary>
    /// <param name="userId">使用者識別碼。</param>
    /// <param name="id">單字卡 Id。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    /// <returns>單字卡；不存在或非本人／已軟刪回 null。</returns>
    public Task<VocabularyWord?> FindByIdAsync(Guid userId, Guid id, CancellationToken cancellationToken)
        => _db.VocabularyWord
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(v => v.Id == id && v.UserId == userId && v.ValidFlag, cancellationToken);

    /// <summary>
    /// 以 (UserId, Word) 查單字卡（IgnoreQueryFilters，連軟刪列也查得到，供復活慣例使用）。
    /// </summary>
    private Task<VocabularyWord?> FindByWordAsync(Guid userId, string normalizedWord, CancellationToken cancellationToken)
        => _db.VocabularyWord
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(v => v.UserId == userId && v.Word == normalizedWord, cancellationToken);

    /// <summary>
    /// 若卡片為軟刪狀態則復活（ValidFlag=true、清 DeletedDateTime）並存檔；已有效則不動。
    /// </summary>
    /// <returns>是否有進行復活（true＝本次復活了一張軟刪卡）。</returns>
    private async Task<bool> ReviveIfSoftDeletedAsync(
        VocabularyWord card,
        Guid userId,
        CancellationToken cancellationToken)
    {
        if (card.ValidFlag)
        {
            return false;
        }

        card.ValidFlag = true;
        card.DeletedDateTime = null;
        card.UpdatedUser = userId.ToString();
        await _db.SaveChangesAsync(cancellationToken);
        return true;
    }

    /// <summary>
    /// 建立一張 SM-2 新卡（預設值）：EF=2.5→Difficulty、Reps=0、Lapses=0、Stability=0、State=New、
    /// Due=建立當下（立即到期，進 /due 佇列）、LastReviewDateTime=null。
    /// </summary>
    private static VocabularyWord BuildNewCard(Guid userId, string normalizedWord)
    {
        var seed = Sm2Scheduler.NewCard();
        var userKey = userId.ToString();
        return new VocabularyWord
        {
            UserId = userId,
            Word = normalizedWord,
            Difficulty = seed.EasinessFactor,
            Stability = seed.IntervalDays,
            Reps = seed.Repetitions,
            Lapses = seed.Lapses,
            State = seed.State,
            Due = DateTime.UtcNow,
            LastReviewDateTime = null,
            CreatedUser = userKey,
            UpdatedUser = userKey,
        };
    }

    /// <summary>判斷 <see cref="DbUpdateException"/> 是否為 PostgreSQL 唯一約束違反（SQLSTATE 23505）。</summary>
    private static bool IsUniqueViolation(DbUpdateException exception)
        => exception.InnerException is DbException { SqlState: "23505" };
}

/// <summary>
/// 單字 upsert 的結果。
/// </summary>
/// <param name="Word">upsert 後的單字卡實體（已被 DbContext 追蹤，端點可續改欄位再存）。</param>
/// <param name="Created">是否為本次「全新建立」（true＝新建回 201；false＝既有/復活回 200）。</param>
public sealed record VocabularyUpsertResult(VocabularyWord Word, bool Created);
