using Microsoft.EntityFrameworkCore.ChangeTracking;

namespace ZonWiki.Api.Common;

/// <summary>
/// 樂觀鎖（PostgreSQL xmin 併發權杖，#4/#34）輔助方法。
/// 供更新端點「讀出目前版本回傳前端」與「套用前端帶回的 baseVersion 以偵測併發衝突」。
/// </summary>
public static class ConcurrencyTokenExtensions
{
    /// <summary>
    /// EF Core 由 <c>UseXminAsConcurrencyToken()</c> 產生的影子屬性名稱（對應 PostgreSQL 系統欄 xmin）。
    /// </summary>
    private const string XminPropertyName = "xmin";

    /// <summary>
    /// 讀取實體目前的 xmin 併發權杖並轉為 long，供 API 回應攜帶版本給前端。
    /// SaveChanges 之後 Npgsql 會回填最新 xmin，故本方法在存檔後呼叫可取得「新版本」。
    /// </summary>
    /// <param name="entry">追蹤中的實體項目（<c>db.Entry(entity)</c>）。</param>
    /// <returns>目前版本（xmin，以 long 表示；未追蹤到值時回 0）。</returns>
    public static long GetConcurrencyVersion(this EntityEntry entry)
    {
        var value = entry.Property(XminPropertyName).CurrentValue;
        return value is uint xmin ? xmin : 0L;
    }

    /// <summary>
    /// 若前端提供 baseVersion，將其設為 xmin 的 OriginalValue，
    /// 讓 SaveChanges 以此值比對資料庫現值：不符即丟 <see cref="Microsoft.EntityFrameworkCore.DbUpdateConcurrencyException"/>。
    /// 未提供（null）＝沿用 last-write-wins（不做併發檢查），保持向後相容。
    /// </summary>
    /// <param name="entry">追蹤中的實體項目（<c>db.Entry(entity)</c>）。</param>
    /// <param name="baseVersion">前端載入資料時記下的版本；null 表不做併發檢查。</param>
    public static void ApplyBaseVersion(this EntityEntry entry, long? baseVersion)
    {
        if (baseVersion is null)
        {
            return;
        }

        // xmin 為 uint；前端以 long 攜帶，這裡收斂回 uint 供 EF 產生 WHERE xmin = @original。
        entry.Property(XminPropertyName).OriginalValue = unchecked((uint)baseVersion.Value);
    }
}
