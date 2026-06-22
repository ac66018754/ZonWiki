using Microsoft.EntityFrameworkCore;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Services;

/// <summary>
/// 祖先脈絡服務：透過自我參考的 ParentId 追溯節點的祖先鏈。
/// 用於組建 AI 提問的上下文 Prompt。
/// </summary>
public sealed class AncestryService
{
    private readonly ZonWikiDbContext _db;

    /// <summary>
    /// 建立祖先脈絡服務。
    /// </summary>
    public AncestryService(ZonWikiDbContext db)
    {
        _db = db;
    }

    /// <summary>
    /// 取得指定節點的完整祖先鏈（含該節點本身）。
    /// 從該節點開始，沿 ParentId 向上追溯至根節點，結果由上而下排序（根在前）。
    /// </summary>
    /// <param name="nodeId">節點識別碼。</param>
    /// <param name="canvasId">
    /// 限定追溯範圍的畫布識別碼。**跨帳號隔離關鍵**：祖先鏈只能在「同一張畫布」內追溯。
    /// Node 非 IUserOwned、且 ParentId 由前端建立節點時帶入、未驗證父節點同畫布，
    /// 若不限定畫布，使用者可把自己節點的 ParentId 指向他人畫布的節點，
    /// 使追溯跨入他人畫布、把他人節點內容帶進 AI 提問脈絡（間接跨帳號外洩）。
    /// 故一律以 `Node.CanvasId == canvasId` 過濾，越界的父節點視為不存在、追溯就此停止。
    /// </param>
    /// <param name="cancellationToken">取消權杖。</param>
    /// <returns>祖先節點清單（由根至該節點本身）；若節點不存在，則回傳空清單。</returns>
    public async Task<List<Node>> GetAncestryAsync(
        Guid nodeId,
        Guid canvasId,
        CancellationToken cancellationToken = default)
    {
        var result = new List<Node>();

        // 以迴圈向上追溯避免遞迴深度限制問題
        var currentId = nodeId;
        var visited = new HashSet<Guid>();

        while (true)
        {
            // 防止環形參考
            if (visited.Contains(currentId))
            {
                break;
            }
            visited.Add(currentId);

            // 僅在「同一張畫布」內追溯：越界（父節點屬於別張畫布／別人）即視為不存在、停止追溯。
            var node = await _db.Node
                .AsNoTracking()
                .FirstOrDefaultAsync(n => n.Id == currentId && n.CanvasId == canvasId, cancellationToken);

            if (node is null)
            {
                break;
            }

            result.Insert(0, node); // 插在開頭，保持根在前的順序

            // 若無父節點，到達根了
            if (!node.ParentId.HasValue)
            {
                break;
            }

            currentId = node.ParentId.Value;
        }

        return result;
    }

    /// <summary>
    /// 取得指定節點的完整祖先鏈（不含該節點本身）。
    /// 從該節點的父節點開始，沿 ParentId 向上追溯至根節點。
    /// </summary>
    /// <param name="nodeId">節點識別碼。</param>
    /// <param name="canvasId">限定追溯範圍的畫布識別碼（跨帳號隔離，見 <see cref="GetAncestryAsync"/>）。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    /// <returns>祖先節點清單（不含該節點）；若無祖先，則回傳空清單。</returns>
    public async Task<List<Node>> GetAncestorChainAsync(
        Guid nodeId,
        Guid canvasId,
        CancellationToken cancellationToken = default)
    {
        var full = await GetAncestryAsync(nodeId, canvasId, cancellationToken);

        // 移除最後一項（該節點本身）
        if (full.Count > 0)
        {
            full.RemoveAt(full.Count - 1);
        }

        return full;
    }
}
