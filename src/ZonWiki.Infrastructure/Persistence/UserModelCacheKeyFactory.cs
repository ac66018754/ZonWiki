using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;

namespace ZonWiki.Infrastructure.Persistence;

/// <summary>
/// 讓 EF Core 的模型快取「依目前使用者」區分。
/// 因為使用者隔離的全域查詢過濾會把目前使用者的 UserId 以常數方式烤進模型，
/// 若所有使用者共用同一份快取模型，會誤用到第一位使用者的過濾條件（資料外洩風險）。
/// 因此以 (Context 型別, 目前使用者 Id, 是否設計階段) 作為模型快取鍵，確保每位使用者各自一份模型。
/// </summary>
public sealed class UserModelCacheKeyFactory : IModelCacheKeyFactory
{
    /// <summary>
    /// 產生模型快取鍵。
    /// </summary>
    /// <param name="context">目前的 DbContext。</param>
    /// <param name="designTime">是否為設計階段（migration 等工具）。</param>
    /// <returns>包含目前使用者 Id 的複合快取鍵。</returns>
    public object Create(DbContext context, bool designTime)
    {
        var userId = context is ZonWikiDbContext zonWiki ? zonWiki.CurrentUserId : Guid.Empty;
        return (context.GetType(), userId, designTime);
    }
}
