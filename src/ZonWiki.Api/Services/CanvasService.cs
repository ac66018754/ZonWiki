using Microsoft.EntityFrameworkCore;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Services;

/// <summary>
/// 開問啦畫布業務服務：集中「擁有權驗證（多租戶隔離）」與少數共用的 CRUD 業務邏輯。
///
/// 過去這些查詢散落在 <c>KaiWenCanvasEndpoints</c> 的每個端點裡（同一段
/// 「以畫布 UserId 為邊界撈取自己資源」重複 10+ 次，審查 #32）。抽出後，
/// 端點只負責「認證檢查 → 參數解析 → 呼叫本服務 → 組回應」，擁有權邊界只有一份真相。
///
/// 隔離原則：Node / Edge / InlineLink / Highlight 本身不帶 UserId，一律經由其所屬
/// 畫布的 <c>Canvas.UserId</c> 判斷擁有者；全域查詢過濾器另外保證只看得到 ValidFlag=true 者。
/// </summary>
public sealed class CanvasService
{
    private readonly ZonWikiDbContext _db;

    /// <summary>
    /// 建立畫布業務服務。
    /// </summary>
    /// <param name="db">資料庫內容（scoped）。</param>
    public CanvasService(ZonWikiDbContext db)
    {
        _db = db;
    }

    /// <summary>
    /// 取得屬於指定使用者的畫布；不存在或非本人擁有時回 null。
    /// </summary>
    /// <param name="userId">目前使用者識別碼。</param>
    /// <param name="canvasId">畫布識別碼。</param>
    /// <param name="ct">取消權杖。</param>
    /// <returns>畫布實體；找不到或非擁有者則為 null。</returns>
    public Task<Canvas?> FindOwnedCanvasAsync(
        Guid userId,
        Guid canvasId,
        CancellationToken ct) =>
        _db.Canvas.FirstOrDefaultAsync(c => c.Id == canvasId && c.UserId == userId, ct);

    /// <summary>
    /// 取得屬於指定使用者（經所屬畫布判斷）的節點；不存在或越權時回 null。
    /// </summary>
    /// <param name="userId">目前使用者識別碼。</param>
    /// <param name="nodeId">節點識別碼。</param>
    /// <param name="ct">取消權杖。</param>
    /// <returns>節點實體；找不到或越權則為 null。</returns>
    public Task<Node?> FindOwnedNodeAsync(
        Guid userId,
        Guid nodeId,
        CancellationToken ct) =>
        _db.Node
            .Where(n => n.Canvas != null && n.Canvas.UserId == userId)
            .FirstOrDefaultAsync(n => n.Id == nodeId, ct);

    /// <summary>
    /// 取得屬於指定使用者（經所屬畫布判斷）的邊；不存在或越權時回 null。
    /// </summary>
    /// <param name="userId">目前使用者識別碼。</param>
    /// <param name="edgeId">邊識別碼。</param>
    /// <param name="ct">取消權杖。</param>
    /// <returns>邊實體；找不到或越權則為 null。</returns>
    public Task<Edge?> FindOwnedEdgeAsync(
        Guid userId,
        Guid edgeId,
        CancellationToken ct) =>
        _db.Edge
            .Where(e => e.Canvas != null && e.Canvas.UserId == userId)
            .FirstOrDefaultAsync(e => e.Id == edgeId, ct);

    /// <summary>
    /// 取得屬於指定使用者（經所屬畫布判斷）的行內連結；不存在或越權時回 null。
    /// </summary>
    /// <param name="userId">目前使用者識別碼。</param>
    /// <param name="linkId">行內連結識別碼。</param>
    /// <param name="ct">取消權杖。</param>
    /// <returns>行內連結實體；找不到或越權則為 null。</returns>
    public Task<InlineLink?> FindOwnedInlineLinkAsync(
        Guid userId,
        Guid linkId,
        CancellationToken ct) =>
        _db.InlineLink
            .Where(il => il.Canvas != null && il.Canvas.UserId == userId)
            .FirstOrDefaultAsync(il => il.Id == linkId, ct);

    /// <summary>
    /// 取得屬於指定使用者（經重點所屬節點的畫布判斷）的重點標記；不存在或越權時回 null。
    /// 重點（Highlight）不直接掛畫布，故經由 Node → Canvas.UserId 兩段判斷擁有者。
    /// </summary>
    /// <param name="userId">目前使用者識別碼。</param>
    /// <param name="highlightId">重點識別碼。</param>
    /// <param name="ct">取消權杖。</param>
    /// <returns>重點實體；找不到或越權則為 null。</returns>
    public Task<Highlight?> FindOwnedHighlightAsync(
        Guid userId,
        Guid highlightId,
        CancellationToken ct) =>
        _db.Highlight
            .Where(h => _db.Node
                .Where(n => n.Canvas != null && n.Canvas.UserId == userId)
                .Select(n => n.Id)
                .Contains(h.NodeId))
            .FirstOrDefaultAsync(h => h.Id == highlightId, ct);

    /// <summary>
    /// 驗證一組節點 Id 是否「全部」屬於指定畫布（且有效）。
    /// 用於建立 / 重接「邊」與「行內連結」、以及指定父節點時，
    /// 確保 source / target / parent 節點都確實落在同一張（呼叫端已驗證擁有的）畫布內，
    /// 避免產生指向他人 / 別張畫布節點的跨界參考——這既是資料完整性，也是防越權的縱深防禦
    /// （與 SearchEndpoints / AncestryService 的同帳號、同畫布限制相呼應）。
    /// </summary>
    /// <param name="canvasId">節點必須隸屬的畫布識別碼（呼叫端須先確認此畫布屬於目前使用者）。</param>
    /// <param name="ct">取消令牌。</param>
    /// <param name="nodeIds">要驗證的節點識別碼（可重複；空集合視為通過）。</param>
    /// <returns>所有不重複的節點 Id 都屬於該畫布時回 true，否則 false。</returns>
    public async Task<bool> NodesBelongToCanvasAsync(
        Guid canvasId,
        CancellationToken ct,
        params Guid[] nodeIds)
    {
        var distinctIds = nodeIds.Distinct().ToList();
        if (distinctIds.Count == 0)
        {
            return true;
        }

        // 以「畫布 Id」為擁有權邊界（畫布本身已由呼叫端驗證屬於目前使用者）。
        var matchedCount = await _db.Node
            .Where(n => n.CanvasId == canvasId && n.ValidFlag && distinctIds.Contains(n.Id))
            .Select(n => n.Id)
            .Distinct()
            .CountAsync(ct);

        return matchedCount == distinctIds.Count;
    }

    /// <summary>
    /// 軟刪除節點，並一併軟刪除以此節點為來源或目標的連線（Edge），
    /// 避免畫布上殘留指向已刪除節點的懸空連線。呼叫端須先驗證節點屬於目前使用者。
    /// 一律軟刪除（ValidFlag=false，設 DeletedDateTime 以進統一垃圾桶），絕不硬刪。
    /// </summary>
    /// <param name="node">已驗證擁有權的節點實體。</param>
    /// <param name="ct">取消權杖。</param>
    public async Task SoftDeleteNodeAsync(
        Node node,
        CancellationToken ct)
    {
        node.ValidFlag = false;
        node.DeletedDateTime = DateTime.UtcNow; // 進統一垃圾桶需設刪除時間

        var incidentEdges = await _db.Edge
            .Where(e => e.CanvasId == node.CanvasId
                && (e.SourceNodeId == node.Id || e.TargetNodeId == node.Id))
            .ToListAsync(ct);
        foreach (var edge in incidentEdges)
        {
            edge.ValidFlag = false;
            edge.DeletedDateTime = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync(ct);
    }
}
