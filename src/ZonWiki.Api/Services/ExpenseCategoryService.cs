using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Services;

/// <summary>
/// 記帳分類服務：惰性種子（首次補齊 8 預設分類）、清單、以及名稱式 find-or-create（含復活軟刪列）。
/// 由記帳端點與 <see cref="ExpenseParsingService"/> 共用。
///
/// 一律以「明確 UserId ＋ IgnoreQueryFilters」查詢：既能在有 HttpContext 的請求內正確運作，
/// 也能在背景／測試（無全域過濾）維持確定行為；復活軟刪列必須忽略過濾才看得到 ValidFlag=false 的列。
/// </summary>
public sealed class ExpenseCategoryService
{
    private readonly ZonWikiDbContext _db;

    /// <summary>「無法歸類」的保底分類名稱。</summary>
    public const string FallbackCategoryName = "其他";

    /// <summary>自訂（非預設）分類的排序權重：排在 8 個預設分類之後。</summary>
    private const int CustomCategorySortOrder = 100;

    /// <summary>
    /// 8 個預設分類（名稱＋圖示），SortOrder 依序 0..7。首次列分類或解析時惰性補齊。
    /// </summary>
    public static readonly IReadOnlyList<(string Name, string Icon)> DefaultCategories = new[]
    {
        ("餐飲", "🍽️"),
        ("交通", "🚗"),
        ("購物", "🛒"),
        ("娛樂", "🎮"),
        ("日用", "🧴"),
        ("醫療", "💊"),
        ("訂閱", "🔁"),
        ("其他", "📦"),
    };

    /// <summary>
    /// 建立記帳分類服務。
    /// </summary>
    /// <param name="db">資料庫內容。</param>
    public ExpenseCategoryService(ZonWikiDbContext db)
    {
        _db = db;
    }

    /// <summary>
    /// 惰性種子：確保 8 個預設分類存在（一次 <c>WHERE Name IN (...)</c> 查存在集合，只對缺的插入＋復活軟刪列）。
    /// 冪等：已存在則不重複建立；被軟刪的預設會被復活；並發首建撞唯一索引具韌性。
    ///
    /// 效能（審查修正 #4）：原本對 8 個分類各做一次 find-or-create（8 次來回、最多 8 次 SaveChanges，N+1），
    /// 改為「一次批次查詢既有集合 → 只對缺的新增／對軟刪的復活 → 一次 SaveChanges」。
    /// 全部已存在且無需復活時直接返回（零寫入）。
    /// </summary>
    /// <param name="userId">使用者識別碼。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    public async Task EnsureDefaultCategoriesAsync(Guid userId, CancellationToken cancellationToken)
    {
        var defaultNames = DefaultCategories.Select(c => c.Name).ToList();

        // 一次撈出「已存在」的預設分類（含軟刪列；IgnoreQueryFilters 略過全域過濾），避免 N+1。
        var existing = await _db.ExpenseCategory
            .IgnoreQueryFilters()
            .Where(c => c.UserId == userId && defaultNames.Contains(c.Name))
            .ToListAsync(cancellationToken);

        // (UserId, Name) 唯一 → 名稱不重複，可安全建索引。
        var existingByName = existing.ToDictionary(c => c.Name, StringComparer.Ordinal);

        // 追蹤「本方法自己新增」的實體，供並發撞索引時精準卸除（不誤動其它來源的追蹤）。
        var added = new List<ExpenseCategory>();
        var anyRevived = false;
        for (var sortOrder = 0; sortOrder < DefaultCategories.Count; sortOrder++)
        {
            var (name, icon) = DefaultCategories[sortOrder];
            if (existingByName.TryGetValue(name, out var found))
            {
                // 已存在：若為軟刪狀態則就地復活（延後到單次 SaveChanges 一起存）。
                if (!found.ValidFlag)
                {
                    found.ValidFlag = true;
                    found.DeletedDateTime = null;
                    found.UpdatedUser = userId.ToString();
                    anyRevived = true;
                }

                continue;
            }

            // 缺的才新增。
            var created = new ExpenseCategory
            {
                UserId = userId,
                Name = name,
                Icon = icon,
                SortOrder = sortOrder,
                CreatedUser = userId.ToString(),
                UpdatedUser = userId.ToString(),
            };
            _db.ExpenseCategory.Add(created);
            added.Add(created);
        }

        // 沒有任何新增、也沒有復活 → 零變更，省一次 SaveChanges。
        if (added.Count == 0 && !anyRevived)
        {
            return;
        }

        try
        {
            await _db.SaveChangesAsync(cancellationToken);
        }
        catch (Exception ex) when (IsConcurrencyConflict(ex))
        {
            // 並發首建：另一路同時也在種同一使用者的預設分類，本次整批 SaveChanges（EF 單一隱含交易）失敗。
            // 可能是撞 (UserId, Name) 唯一索引（23505），也可能是「並發多列批次插入在單一交易內持有多個索引鎖 →
            // 互相等待成死結（40P01）」——後者正是「批次插入」相對「逐列自動提交插入」多出來的並發風險。
            // 復原：只卸除「本方法自己碰過」的實體（新增的＋批次載入且可能已改復活的既有列），不動 DbContext 內
            // 其它來源的 ExpenseCategory 追蹤；再改走「逐筆 find-or-create-or-revive」自 DB 讀真實狀態收斂——
            // 逐列插入各自「單列、立即提交、不跨列持鎖」，天生不會死結，且冪等、不重複、不拋 500。
            DetachEntities(added);
            DetachEntities(existing);
            for (var sortOrder = 0; sortOrder < DefaultCategories.Count; sortOrder++)
            {
                var (name, icon) = DefaultCategories[sortOrder];
                await FindCreateOrReviveAsync(userId, name, icon, sortOrder, cancellationToken);
            }
        }
    }

    /// <summary>
    /// 精準卸除指定的 <see cref="ExpenseCategory"/> 實體（並發批次種子撞唯一索引後的復原用）：
    /// 只 detach「本方法自己新增／載入」的那幾筆，讓後續「逐筆 find-or-create-or-revive」能自 DB
    /// 讀取真實狀態，而不會誤丟同一 DbContext 內其它程式未存檔的 <see cref="ExpenseCategory"/> 變更。
    /// </summary>
    /// <param name="categories">要卸除追蹤的實體集合。</param>
    private void DetachEntities(IEnumerable<ExpenseCategory> categories)
    {
        foreach (var category in categories)
        {
            var entry = _db.Entry(category);
            if (entry.State != EntityState.Detached)
            {
                entry.State = EntityState.Detached;
            }
        }
    }

    /// <summary>
    /// 列出使用者的有效分類（先惰性補齊預設），依 SortOrder、Name 排序。
    /// </summary>
    /// <param name="userId">使用者識別碼。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    /// <returns>有效分類清單。</returns>
    public async Task<IReadOnlyList<ExpenseCategory>> ListAsync(Guid userId, CancellationToken cancellationToken)
    {
        await EnsureDefaultCategoriesAsync(userId, cancellationToken);

        return await _db.ExpenseCategory
            .IgnoreQueryFilters()
            .Where(c => c.UserId == userId && c.ValidFlag)
            .OrderBy(c => c.SortOrder)
            .ThenBy(c => c.Name)
            .ToListAsync(cancellationToken);
    }

    /// <summary>
    /// 依名稱 find-or-create（復活軟刪列）解析分類；名稱空／未提供時映射到「其他」。
    /// </summary>
    /// <param name="userId">使用者識別碼。</param>
    /// <param name="name">分類名稱（可空／可未知）。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    /// <returns>解析／建立／復活後的分類。</returns>
    public async Task<ExpenseCategory> ResolveCategoryByNameAsync(
        Guid userId,
        string? name,
        CancellationToken cancellationToken)
    {
        var trimmed = (name ?? string.Empty).Trim();
        if (trimmed.Length == 0)
        {
            trimmed = FallbackCategoryName;
        }

        var sortOrder = DefaultSortOrderFor(trimmed);
        var icon = DefaultIconFor(trimmed);
        return await FindCreateOrReviveAsync(userId, trimmed, icon, sortOrder, cancellationToken);
    }

    /// <summary>
    /// 依 (UserId, Name) 找既有分類：找到就（必要時）復活並回傳；找不到就新建。
    /// 新建若撞 (UserId, Name) 唯一索引（並發首建）→ 攔截後改查既有列使用，確保不回 500、不建重複。
    /// </summary>
    private async Task<ExpenseCategory> FindCreateOrReviveAsync(
        Guid userId,
        string name,
        string? icon,
        int sortOrder,
        CancellationToken cancellationToken)
    {
        var existing = await FindByNameAsync(userId, name, cancellationToken);
        if (existing is not null)
        {
            await ReviveIfSoftDeletedAsync(existing, userId, cancellationToken);
            return existing;
        }

        var created = new ExpenseCategory
        {
            UserId = userId,
            Name = name,
            Icon = icon,
            SortOrder = sortOrder,
            CreatedUser = userId.ToString(),
            UpdatedUser = userId.ToString(),
        };
        _db.ExpenseCategory.Add(created);

        try
        {
            await _db.SaveChangesAsync(cancellationToken);
            return created;
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            // 並發首建：另一路已插入同名列。卸掉本次衝突的新列，改查既有列（連軟刪也算）使用／復活。
            _db.Entry(created).State = EntityState.Detached;

            var raced = await FindByNameAsync(userId, name, cancellationToken);
            if (raced is null)
            {
                // 理論上唯一違反後必查得到；查不到則讓原例外往外拋（不吞）。
                throw;
            }

            await ReviveIfSoftDeletedAsync(raced, userId, cancellationToken);
            return raced;
        }
    }

    /// <summary>
    /// 以 (UserId, Name) 查分類（IgnoreQueryFilters，連軟刪列也查得到，供復活慣例使用）。
    /// </summary>
    private Task<ExpenseCategory?> FindByNameAsync(Guid userId, string name, CancellationToken cancellationToken)
        => _db.ExpenseCategory
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(c => c.UserId == userId && c.Name == name, cancellationToken);

    /// <summary>
    /// 若分類為軟刪狀態則復活（ValidFlag=true、清 DeletedDateTime）並存檔；已有效則不動。
    /// </summary>
    private async Task ReviveIfSoftDeletedAsync(
        ExpenseCategory category,
        Guid userId,
        CancellationToken cancellationToken)
    {
        if (category.ValidFlag)
        {
            return;
        }

        category.ValidFlag = true;
        category.DeletedDateTime = null;
        category.UpdatedUser = userId.ToString();
        await _db.SaveChangesAsync(cancellationToken);
    }

    /// <summary>
    /// 取得名稱的預設排序權重：預設分類用其索引（0..7），自訂分類排在其後（<see cref="CustomCategorySortOrder"/>）。
    /// </summary>
    private static int DefaultSortOrderFor(string name)
    {
        for (var i = 0; i < DefaultCategories.Count; i++)
        {
            if (string.Equals(DefaultCategories[i].Name, name, StringComparison.Ordinal))
            {
                return i;
            }
        }

        return CustomCategorySortOrder;
    }

    /// <summary>
    /// 取得預設分類的圖示；自訂分類無預設圖示（回 null）。
    /// </summary>
    private static string? DefaultIconFor(string name)
    {
        foreach (var (defaultName, icon) in DefaultCategories)
        {
            if (string.Equals(defaultName, name, StringComparison.Ordinal))
            {
                return icon;
            }
        }

        return null;
    }

    /// <summary>
    /// 判斷 <see cref="DbUpdateException"/> 是否為 PostgreSQL 唯一約束違反（SQLSTATE 23505）。
    /// 透過 <see cref="DbException.SqlState"/> 判定，避免在 Api 層直接相依 Npgsql 型別。
    /// </summary>
    private static bool IsUniqueViolation(DbUpdateException exception)
        => exception.InnerException is DbException { SqlState: "23505" };

    /// <summary>
    /// 判斷例外鏈中是否含「並發衝突」訊號：唯一索引違反（23505）、死結（40P01）、序列化失敗（40001）。
    /// 這些在並發下皆屬「可由冪等重試／逐筆收斂化解」的暫時性衝突。
    /// EF／Npgsql 可能把底層 <see cref="DbException"/> 多層包裝（外層 DbUpdateException，甚至再被執行策略
    /// 包成「likely due to a transient failure」的 InvalidOperationException），故走訪整條 InnerException 鏈
    /// 以 <see cref="DbException.SqlState"/> 判定，避免只看最外層而漏接。
    /// </summary>
    /// <param name="exception">待判斷的例外（含其 InnerException 鏈）。</param>
    /// <returns>鏈中任一層為 23505／40P01／40001 時為 true。</returns>
    private static bool IsConcurrencyConflict(Exception exception)
    {
        for (Exception? current = exception; current is not null; current = current.InnerException)
        {
            if (current is DbException { SqlState: "23505" or "40P01" or "40001" })
            {
                return true;
            }
        }

        return false;
    }
}
