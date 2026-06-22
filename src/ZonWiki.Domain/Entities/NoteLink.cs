namespace ZonWiki.Domain.Entities;

/// <summary>
/// 筆記之間的連結（Wiki 連結 [[X]] 解析而來；同時作為反向連結與知識圖譜的邊）。
/// </summary>
public class NoteLink : AuditableEntity, IUserOwned
{
    /// <summary>
    /// 擁有此連結的使用者識別碼。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 連結來源筆記識別碼（內文出現 [[X]] 的那篇）。
    /// </summary>
    public Guid SourceNoteId { get; set; }

    /// <summary>
    /// 連結目標筆記識別碼（被指向的那篇）。可能尚未存在（未建立的條目）時為 null。
    /// </summary>
    public Guid? TargetNoteId { get; set; }

    /// <summary>
    /// 連結文字（[[ ]] 內的原始字串），用於目標尚未建立時的顯示與日後比對。
    /// </summary>
    public string AnchorText { get; set; } = string.Empty;

    /// <summary>
    /// 導覽屬性：來源筆記。
    /// </summary>
    public Note? SourceNote { get; set; }

    /// <summary>
    /// 導覽屬性：目標筆記。
    /// </summary>
    public Note? TargetNote { get; set; }
}
