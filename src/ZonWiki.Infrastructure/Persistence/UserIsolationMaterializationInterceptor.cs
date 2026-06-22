using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Ai;

namespace ZonWiki.Infrastructure.Persistence;

/// <summary>
/// 使用者隔離「最終防線」攔截器（縱深防禦 / fail-closed）。
///
/// 不論查詢從哪裡來、是否已被全域查詢過濾或端點自行過濾過，只要從資料庫「具現化（materialize）」出
/// 一筆實作 <see cref="IUserOwned"/> 的實體，就在它離開資料層、被組成 DTO 回應之前，
/// **再用目前使用者的 UserId 核對一次**。一旦核對出「這筆不是目前使用者的」，立即拋例外中止整個請求——
/// 寧可這個請求失敗，也絕不把別人的資料吐出去（外洩一次的代價遠大於一個請求失敗）。
///
/// 為何要這層（即使別處已篩過）：
/// 本系統的隔離原本只靠單層全域查詢過濾，任何一處查詢忘了過濾（例如先前的全站搜尋）就會破口。
/// 這層與「是哪個查詢、哪個端點」完全無關，對「所有 IUserOwned 的具現化」一律生效，
/// 因此**未來新增的任何查詢也自動受保護**，不需要每個開發者每次都記得手動再篩。成本極低（每列一次欄位比較）。
///
/// 刻意放行（非外洩）：
/// 1. 目前使用者為 <see cref="Guid.Empty"/>：未登入 / 資料庫遷移 / 開發種子 / 無 HttpContext 的系統情境。
///    此時全域過濾已讓「真實使用者的資料」查不到，且這些情境本就不對外回應使用者私有資料。
/// 2. 全站共用 AI 模型（<see cref="AiProviderFactory.SharedModelUserId"/>，…a1）：系統擁有、刻意跨使用者共用的
///    資源（其 DTO 不含明碼金鑰）；它本來就不屬於任何單一使用者，故放行。
///
/// 涵蓋範圍說明：
/// 開問啦子實體（Node / Edge / Highlight / InlineLink / NodeImage / NodeRevision / AiMessage 與關聯表）
/// **不是** <see cref="IUserOwned"/>、沒有 UserId 可在此核對；它們的擁有權來自所屬 Canvas，
/// 改由各查詢明確以 <c>Canvas.UserId == 目前使用者</c> Join 過濾保護（見 SearchEndpoints / NoteMarkEndpoints 等）。
/// </summary>
public sealed class UserIsolationMaterializationInterceptor : IMaterializationInterceptor
{
    /// <summary>
    /// 記錄器（可為 null；測試直接 new 此攔截器時不一定提供）。
    /// </summary>
    private readonly ILogger<UserIsolationMaterializationInterceptor>? _logger;

    /// <summary>
    /// 建立使用者隔離最終防線攔截器。
    /// </summary>
    /// <param name="logger">記錄器；偵測到跨帳號具現化時記錄詳細資訊（伺服器端）。</param>
    public UserIsolationMaterializationInterceptor(
        ILogger<UserIsolationMaterializationInterceptor>? logger = null)
    {
        _logger = logger;
    }

    /// <summary>
    /// 在每一筆實體「具現化並完成屬性填值之後」被呼叫。
    /// 對 <see cref="IUserOwned"/> 實體核對其 UserId 是否屬於目前使用者；不符即 fail-closed 中止。
    /// </summary>
    /// <param name="materializationData">具現化情境資料（含目前 <see cref="Microsoft.EntityFrameworkCore.DbContext"/>）。</param>
    /// <param name="instance">剛具現化完成的實體實例。</param>
    /// <returns>驗證通過時原樣回傳該實例。</returns>
    /// <exception cref="UnauthorizedAccessException">具現化出「非目前使用者」的 IUserOwned 實體時拋出（防外洩）。</exception>
    public object InitializedInstance(
        MaterializationInterceptionData materializationData,
        object instance)
    {
        // 只檢查實作 IUserOwned 的實體；其餘（User 本體 / 開問啦子實體 / 關聯表）此處不適用。
        if (instance is not IUserOwned owned)
        {
            return instance;
        }

        // 取得目前 DbContext 的使用者；非 ZonWikiDbContext 情境則略過（理論上不會發生）。
        if (materializationData.Context is not ZonWikiDbContext db)
        {
            return instance;
        }

        var currentUserId = db.CurrentUserId;

        // 放行 1：無使用者情境（未登入 / 遷移 / 種子 / 背景未設覆寫）。
        if (currentUserId == Guid.Empty)
        {
            return instance;
        }

        // 放行 2：全站共用 AI 模型（系統擁有、刻意跨使用者共用）。
        if (owned.UserId == AiProviderFactory.SharedModelUserId)
        {
            return instance;
        }

        // 命中跨帳號：具現化出「非目前使用者」的資料 → fail-closed，立即中止，避免吐出他人內容。
        if (owned.UserId != currentUserId)
        {
            _logger?.LogError(
                "使用者隔離最終防線攔截到跨帳號資料：實體 {EntityType} 的 UserId 為 {OwnerUserId}，"
                + "但目前使用者為 {CurrentUserId}。已中止此請求以防止跨帳號外洩。",
                instance.GetType().Name,
                owned.UserId,
                currentUserId);

            throw new UnauthorizedAccessException(
                "偵測到跨使用者資料存取，已基於安全考量中止此請求。");
        }

        return instance;
    }
}
