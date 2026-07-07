using Microsoft.EntityFrameworkCore;

namespace ZonWiki.Infrastructure.Persistence;

/// <summary>
/// 教練子系統專用的短命 DbContext 工廠（其他功能群 Phase 3，【審修-A2】短命 DbContext 不變式）。
///
/// 為何自建而非用 EF 的 <c>AddDbContextFactory</c>：既有 <c>AddDbContext</c> 已註冊 scoped 的
/// <see cref="DbContextOptions{TContext}"/>，再呼叫 <c>AddDbContextFactory</c> 會重複註冊該選項並造成
/// 生命週期衝突，可能連累整個 App 的 DbContext 解析。此工廠捕捉一份<b>獨立</b>的選項
/// （同一 Npgsql 連線＋Migrations Assembly），與既有 scoped 註冊完全隔離、互不干擾。
///
/// 用途：供 <c>CoachBudgetService</c>（singleton）建短命 context 累計全站花費（僅碰非 IUserOwned 的
/// CoachBudgetLedger 全站計量表，無需使用者隔離過濾與稽核攔截器；稽核欄由服務層手動補齊）。
///
/// <b>安全（重要）</b>：此工廠建出的 context <b>不套使用者隔離全域過濾、不掛稽核／具現化防線攔截器</b>
/// （currentUser 為 null → OnModelCreating 不加過濾）。故<b>只註冊為具體型別、絕不註冊為泛型
/// <c>IDbContextFactory&lt;ZonWikiDbContext&gt;</c></b>——避免未來有人天真注入泛型工廠，拿它去查
/// <c>Note</c>／<c>TaskCard</c> 這類 IUserOwned 實體造成跨租戶外洩。<b>只能用於非 IUserOwned 的全站表</b>。
/// </summary>
public sealed class CoachDbContextFactory : IDbContextFactory<ZonWikiDbContext>
{
    private readonly DbContextOptions<ZonWikiDbContext> _options;

    /// <summary>
    /// 以預先建好的選項建立工廠。
    /// </summary>
    /// <param name="options">獨立的 DbContext 選項（同一資料庫連線）。</param>
    public CoachDbContextFactory(DbContextOptions<ZonWikiDbContext> options)
    {
        _options = options;
    }

    /// <summary>
    /// 建立一個新的短命 <see cref="ZonWikiDbContext"/>（未帶 ICurrentUser → 無使用者隔離過濾，
    /// 適合全站計量表讀寫）。呼叫端負責 Dispose（建議以 <c>await using</c>）。
    /// </summary>
    /// <returns>新的 DbContext 實例。</returns>
    public ZonWikiDbContext CreateDbContext() => new(_options);
}
