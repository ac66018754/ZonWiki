namespace ZonWiki.Domain.Entities;

/// <summary>
/// 筆記編輯歷史（版本）。記錄每次新增 / 修改 / 刪除時的內容快照，供檢視與還原。
/// </summary>
public class NoteRevision : AuditableEntity, IUserOwned
{
    /// <summary>
    /// 擁有此版本紀錄的使用者識別碼。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 對應的筆記識別碼。
    /// </summary>
    public Guid NoteId { get; set; }

    /// <summary>
    /// 版本序號（同一筆記內遞增）。
    /// </summary>
    public int RevisionNo { get; set; }

    /// <summary>
    /// 變更種類："create"（新增）、"update"（修改）、"delete"（刪除）。
    /// </summary>
    public string ChangeKind { get; set; } = "update";

    /// <summary>
    /// 該版本當下的標題快照。
    /// </summary>
    public string Title { get; set; } = string.Empty;

    /// <summary>
    /// 該版本當下的原始 Markdown 內容快照。
    /// </summary>
    public string ContentRaw { get; set; } = string.Empty;

    /// <summary>
    /// 導覽屬性：對應的筆記。
    /// </summary>
    public Note? Note { get; set; }
}
