namespace ZonWiki.Domain.Entities;

/// <summary>
/// 筆記「舊網址代稱」（slug alias）：當一篇筆記改標題、slug 隨新標題重產時，
/// 把「讓出的舊 slug」永久保留為一筆別名，讓舊網址永遠能解析回原篇（或在名字被別篇取用後導向消歧異）。
///
/// 設計要點（詳見 docs/DECISIONS.md 2026-07-31「筆記 URL 改版」）：
/// - slug 跟著「現在的標題」走：改標題即以 GenerateSlug 重產 slug，舊 slug 落成此別名（不遺失既有連結）。
/// - 名字可重用：改名／建立撞「別名」不加序號（歧義交由消歧異頁處理），撞「活著的 slug」才加序號。
/// - <see cref="OriginalTitle"/> 記「讓出當下的標題」，供消歧異頁顯示「曾用此名（現名《…》）」時辨識是哪一篇。
/// - (UserId, Slug, NoteId) 唯一（只約束有效列）：同一篇對同一個 slug 至多一筆有效別名；
///   反覆改名（S→S2→S…）時以「復活軟刪列」重用，不會撞唯一索引（同 NoteRevision 取號的教訓）。
/// </summary>
public class NoteSlugAlias : AuditableEntity, IUserOwned
{
    /// <summary>
    /// slug 與原標題欄位（<see cref="Slug"/> / <see cref="OriginalTitle"/>）的最大長度（字元）。
    /// 與 Note.Slug／Note.Title 的上限一致（別名本質上就是某個歷史版本的 slug 與標題）。
    /// </summary>
    public const int SlugMaxLength = 500;

    /// <summary>
    /// 擁有此別名的使用者識別碼。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 別名所指向的筆記識別碼（即當年讓出這個 slug 的那一篇）。
    /// </summary>
    public Guid NoteId { get; set; }

    /// <summary>
    /// 讓出的舊 slug（別名本體；解析時以此比對舊網址）。
    /// </summary>
    public string Slug { get; set; } = string.Empty;

    /// <summary>
    /// 讓出這個 slug 當下、該筆記的標題（消歧異顯示用；例如「曾用此名（現名《…》）」）。
    /// </summary>
    public string OriginalTitle { get; set; } = string.Empty;

    /// <summary>
    /// 導覽屬性：別名所指向的筆記。
    /// </summary>
    public Note? Note { get; set; }
}
