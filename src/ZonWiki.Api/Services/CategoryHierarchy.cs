namespace ZonWiki.Api.Services;

/// <summary>
/// 分類階層計算器（唯讀、cycle-safe）：由「使用者所有分類的 (Id, ParentId, Name)」建立，
/// 提供兩項純函式查詢——
/// <list type="bullet">
/// <item><description><see cref="BuildPath"/>：某分類的「完整路徑」（如 <c>學習 / 併發</c>）。</description></item>
/// <item><description><see cref="DescendantsAndSelf"/>：某分類「自身 + 所有子孫」的 Id 集合。</description></item>
/// </list>
/// 兩者皆以 visited 集合防環——資料庫層可能被直接改成環狀 ParentId（API 端有防環，但 DB 直改可繞過），
/// 若不防環將導致無窮迴圈。搜尋端（分類路徑 / categoryId 範圍展開）與活動明細端（目前分類路徑）共用本類別。
/// </summary>
public sealed class CategoryHierarchy
{
    /// <summary>分類 Id → (ParentId, Name)。</summary>
    private readonly Dictionary<Guid, (Guid? ParentId, string Name)> _byId;

    /// <summary>父分類 Id → 直屬子分類 Id 清單。</summary>
    private readonly Dictionary<Guid, List<Guid>> _childrenByParent;

    /// <summary>
    /// 私有建構子：由 <see cref="Build"/> 呼叫。
    /// </summary>
    /// <param name="byId">分類 Id → (ParentId, Name) 對照。</param>
    /// <param name="childrenByParent">父分類 Id → 子分類 Id 清單。</param>
    private CategoryHierarchy(
        Dictionary<Guid, (Guid? ParentId, string Name)> byId,
        Dictionary<Guid, List<Guid>> childrenByParent)
    {
        _byId = byId;
        _childrenByParent = childrenByParent;
    }

    /// <summary>
    /// 由分類清單建立階層計算器。
    /// </summary>
    /// <param name="categories">分類的 (Id, ParentId, Name) 序列（通常為某使用者所有有效分類）。</param>
    /// <returns>可重複查詢的階層計算器。</returns>
    public static CategoryHierarchy Build(IEnumerable<(Guid Id, Guid? ParentId, string Name)> categories)
    {
        var byId = new Dictionary<Guid, (Guid?, string)>();
        var childrenByParent = new Dictionary<Guid, List<Guid>>();

        foreach (var (id, parentId, name) in categories)
        {
            byId[id] = (parentId, name);
            if (parentId is Guid parent)
            {
                if (!childrenByParent.TryGetValue(parent, out var list))
                {
                    list = new List<Guid>();
                    childrenByParent[parent] = list;
                }
                list.Add(id);
            }
        }

        return new CategoryHierarchy(byId, childrenByParent);
    }

    /// <summary>
    /// 分隔完整路徑各層級的字串（前後留白，與前端問題清單頁一致的視覺）。
    /// </summary>
    public const string PathSeparator = " / ";

    /// <summary>
    /// 計算某分類的完整路徑（由根到該分類，以 <see cref="PathSeparator"/> 串接）。
    /// 若分類不存在（例如已被軟刪除、不在建立時的清單中）回傳空字串。防環：回溯時記錄已訪 Id，遇環即止。
    /// </summary>
    /// <param name="categoryId">目標分類識別碼。</param>
    /// <returns>完整路徑；未知分類為空字串。</returns>
    public string BuildPath(Guid categoryId)
    {
        if (!_byId.ContainsKey(categoryId))
        {
            return string.Empty;
        }

        var names = new List<string>();
        var visited = new HashSet<Guid>();
        var current = (Guid?)categoryId;

        while (current is Guid id && _byId.TryGetValue(id, out var node) && visited.Add(id))
        {
            names.Add(node.Name);
            current = node.ParentId;
        }

        names.Reverse(); // 由葉到根收集 → 反轉為根到葉
        return string.Join(PathSeparator, names);
    }

    /// <summary>
    /// 計算某分類「自身 + 所有子孫」的 Id 集合（BFS）。防環：以 visited 集合避免重複展開。
    /// 若根分類不存在，仍回傳只含該根 Id 的集合（呼叫端據此仍能做「等於該 Id」的比對）。
    /// </summary>
    /// <param name="rootId">根分類識別碼。</param>
    /// <returns>自身與所有子孫的 Id 集合。</returns>
    public HashSet<Guid> DescendantsAndSelf(Guid rootId)
    {
        var result = new HashSet<Guid> { rootId };
        var queue = new Queue<Guid>();
        queue.Enqueue(rootId);

        while (queue.Count > 0)
        {
            var current = queue.Dequeue();
            if (!_childrenByParent.TryGetValue(current, out var children))
            {
                continue;
            }

            foreach (var child in children)
            {
                if (result.Add(child))
                {
                    queue.Enqueue(child);
                }
            }
        }

        return result;
    }
}
