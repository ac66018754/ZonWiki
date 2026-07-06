using Microsoft.EntityFrameworkCore;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Notes;

/// <summary>
/// Wiki 連結（[[X]]）目標解析器。
///
/// 效能：一次把所有錨點文字對應的候選筆記用「單一 WHERE...IN」查詢撈回並建成記憶體索引，
/// 之後每個 [[X]] 都是純記憶體查表，避免「每個連結各查一次資料庫」的 N+1 問題（K 趟降為 1 趟）。
///
/// 比對規則（與原本行為一致）：先比對 slug（更精確），找不到再比對標題；都沒有則目標為 null（尚未建立的條目）。
/// </summary>
public sealed class WikiLinkTargetResolver
{
    /// <summary>錨點文字 → 其計算出的 slug（避免重複計算）。</summary>
    private readonly IReadOnlyDictionary<string, string> _slugByAnchor;

    /// <summary>slug → 目標筆記 Id（同 slug 取第一筆）。</summary>
    private readonly IReadOnlyDictionary<string, Guid> _idBySlug;

    /// <summary>標題 → 目標筆記 Id（同標題取第一筆）。</summary>
    private readonly IReadOnlyDictionary<string, Guid> _idByTitle;

    /// <summary>
    /// 私有建構子；請用 <see cref="BuildAsync"/> 建立實例。
    /// </summary>
    /// <param name="slugByAnchor">錨點文字對應的 slug 對照表。</param>
    /// <param name="idBySlug">slug 對應的目標筆記 Id。</param>
    /// <param name="idByTitle">標題對應的目標筆記 Id。</param>
    private WikiLinkTargetResolver(
        IReadOnlyDictionary<string, string> slugByAnchor,
        IReadOnlyDictionary<string, Guid> idBySlug,
        IReadOnlyDictionary<string, Guid> idByTitle)
    {
        _slugByAnchor = slugByAnchor;
        _idBySlug = idBySlug;
        _idByTitle = idByTitle;
    }

    /// <summary>
    /// 依錨點文字清單建立解析器：去重後以單一查詢撈回所有可能的目標筆記。
    /// </summary>
    /// <param name="db">資料庫內容。</param>
    /// <param name="userId">擁有者使用者識別碼（只在此使用者的有效筆記內比對）。</param>
    /// <param name="anchorTexts">所有出現過的錨點文字（可含重複，內部會去重查詢）。</param>
    /// <param name="ct">取消權杖。</param>
    /// <returns>建立完成的解析器。</returns>
    public static async Task<WikiLinkTargetResolver> BuildAsync(
        ZonWikiDbContext db,
        Guid userId,
        IReadOnlyCollection<string> anchorTexts,
        CancellationToken ct)
    {
        // 去重：查詢與 slug 計算只需針對相異的錨點文字。
        var distinctAnchors = anchorTexts.Distinct().ToList();
        var slugByAnchor = distinctAnchors.ToDictionary(
            anchor => anchor,
            NoteContentHelpers.GenerateSlug);

        var slugSet = slugByAnchor.Values.ToHashSet();
        var titleSet = distinctAnchors.ToHashSet();

        // 單一 WHERE...IN 撈回：slug 或標題命中任一集合的有效筆記（K 趟查詢降為 1 趟）。
        var candidates = await db.Note
            .Where(note => note.UserId == userId
                && note.ValidFlag
                && (slugSet.Contains(note.Slug) || titleSet.Contains(note.Title)))
            .Select(note => new { note.Id, note.Slug, note.Title })
            .ToListAsync(ct);

        // 記憶體建索引：同 slug/標題取第一筆（對齊原本 FirstOrDefault 的行為）。
        var idBySlug = new Dictionary<string, Guid>();
        var idByTitle = new Dictionary<string, Guid>();
        foreach (var candidate in candidates)
        {
            idBySlug.TryAdd(candidate.Slug, candidate.Id);
            idByTitle.TryAdd(candidate.Title, candidate.Id);
        }

        return new WikiLinkTargetResolver(slugByAnchor, idBySlug, idByTitle);
    }

    /// <summary>
    /// 解析單一錨點文字對應的目標筆記 Id：先比對 slug，找不到再比對標題；都沒有回 null。
    /// </summary>
    /// <param name="anchorText">錨點文字（[[X]] 內的 X）。</param>
    /// <returns>目標筆記 Id；尚未建立對應筆記時為 null。</returns>
    public Guid? Resolve(string anchorText)
    {
        if (_slugByAnchor.TryGetValue(anchorText, out var slug)
            && _idBySlug.TryGetValue(slug, out var idBySlug))
        {
            return idBySlug;
        }

        if (_idByTitle.TryGetValue(anchorText, out var idByTitle))
        {
            return idByTitle;
        }

        return null;
    }
}
