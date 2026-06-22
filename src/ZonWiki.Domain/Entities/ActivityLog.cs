namespace ZonWiki.Domain.Entities;

/// <summary>
/// 活動紀錄：記錄使用者「在什麼時候、對哪個實體、做了什麼動作」（標題級，不含內容細節）。
/// 由 EF Core 的 <c>ActivityLogInterceptor</c> 在每次 SaveChanges 時自動產生，
/// 涵蓋筆記、任務、子任務、開問啦節點、AI 模型(API Key)、快速紀錄、快速連結、系統提示詞(Prompt)
/// 的新增 / 編輯 / 刪除（軟刪）/ 還原。
///
/// 動作發生時間即此列的 <see cref="AuditableEntity.CreatedDateTime"/>（UTC，前端依時區顯示）。
/// </summary>
public class ActivityLog : AuditableEntity, IUserOwned
{
    /// <summary>
    /// 擁有此活動紀錄的使用者識別碼。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 動作類型："created"（新增）/ "updated"（編輯）/ "deleted"（刪除）/ "restored"（還原）。
    /// </summary>
    public string ActionType { get; set; } = string.Empty;

    /// <summary>
    /// 被操作的實體型別："note" / "taskcard" / "subtask" / "node" /
    /// "aimodel" / "capture" / "quicklink" / "prompt"。
    /// </summary>
    public string EntityType { get; set; } = string.Empty;

    /// <summary>
    /// 被操作的實體識別碼（供日後導覽/比對；不保證對端仍存在）。
    /// </summary>
    public Guid EntityId { get; set; }

    /// <summary>
    /// 動作當下該實體的標題 / 名稱（標題級摘要；節點/快速紀錄取首行片段，刻意不存完整內容）。
    /// </summary>
    public string Title { get; set; } = string.Empty;
}
