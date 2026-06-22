namespace ZonWiki.Domain.Entities;

/// <summary>
/// 筆記（由舊的 Article 進化而來；DB 為真相、可在網頁編輯）。
/// 日記是筆記的一種（Kind = "journal"）。分類採多對多（透過 NoteCategory），不再有單一 CategoryId。
/// </summary>
public class Note : AuditableEntity, IUserOwned
{
    /// <summary>
    /// 擁有此筆記的使用者識別碼。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 標題。
    /// </summary>
    public string Title { get; set; } = string.Empty;

    /// <summary>
    /// 網址代稱（slug，使用者範圍內唯一）。
    /// </summary>
    public string Slug { get; set; } = string.Empty;

    /// <summary>
    /// 原始 Markdown 內容（真相）。
    /// </summary>
    public string ContentRaw { get; set; } = string.Empty;

    /// <summary>
    /// 由 Markdown 渲染出的 HTML 快取（顯示用，可由 ContentRaw 重新產生）。
    /// </summary>
    public string ContentHtml { get; set; } = string.Empty;

    /// <summary>
    /// 內容雜湊（SHA-256，用於匯入時判斷是否有變更）。
    /// </summary>
    public string ContentHash { get; set; } = string.Empty;

    /// <summary>
    /// 匯入來源檔路徑（相對於 docs/notes-seed 根目錄；僅由 Markdown 匯入而來的筆記有值）。nullable。
    /// </summary>
    public string? SourceFilePath { get; set; }

    /// <summary>
    /// 是否為草稿。true = 草稿（未發布）；false = 已發布。
    /// </summary>
    public bool IsDraft { get; set; }

    /// <summary>
    /// 筆記種類："note"（一般筆記）或 "journal"（日記）。
    /// </summary>
    public string Kind { get; set; } = "note";

    /// <summary>
    /// 日記日期（UTC 日期，僅 Kind = "journal" 時有值）。供依日期查詢日記。nullable。
    /// </summary>
    public DateTime? JournalDate { get; set; }

    /// <summary>
    /// 導覽屬性：此筆記的留言清單。
    /// </summary>
    public ICollection<Comment> Comments { get; set; } = new List<Comment>();

    /// <summary>
    /// 導覽屬性：此筆記與分類的多對多關聯。
    /// </summary>
    public ICollection<NoteCategory> NoteCategories { get; set; } = new List<NoteCategory>();

    /// <summary>
    /// 導覽屬性：此筆記與標籤的多對多關聯。
    /// </summary>
    public ICollection<NoteTag> NoteTags { get; set; } = new List<NoteTag>();
}
