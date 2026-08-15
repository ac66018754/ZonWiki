namespace ZonWiki.Domain.Entities;

/// <summary>
/// 記帳分類（獨立於筆記的 Category——語意不同，避免污染筆記分類樹）。
/// 每位使用者各自維護一組分類；首次使用時惰性補齊 8 個預設分類
/// （餐飲／交通／購物／娛樂／日用／醫療／訂閱／其他）。
/// 唯一鍵為 (UserId, Name)（不含 ValidFlag），故軟刪後同名再建時採「復活」慣例，
/// 而非新增第二列，以免違反唯一索引。
/// </summary>
public class ExpenseCategory : AuditableEntity, IUserOwned
{
    /// <summary>
    /// 擁有此分類的使用者識別碼。對應資料表欄位 ExpenseCategory_UserId。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 分類名稱（必填；同一使用者內唯一）。例如「餐飲」「交通」。
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// 分類圖示（可空）。通常存 emoji 或短字串，供前端清單顯示。
    /// </summary>
    public string? Icon { get; set; }

    /// <summary>
    /// 排序權重（越小越前）。預設 0；8 個預設分類種子為 0..7。
    /// </summary>
    public int SortOrder { get; set; }

    /// <summary>
    /// 導覽屬性：歸屬於此分類的所有消費紀錄。
    /// </summary>
    public ICollection<Expense> Expenses { get; set; } = new List<Expense>();
}
