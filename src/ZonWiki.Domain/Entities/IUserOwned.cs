namespace ZonWiki.Domain.Entities;

/// <summary>
/// 使用者擁有權標記介面：凡屬於某位使用者的內容實體都實作此介面。
/// 系統以「每張表都帶 UserId」的方式做資料切分（每位使用者只看得到自己的資料），
/// 以便日後在 EF Core 套用「使用者隔離」的全域查詢過濾。
/// </summary>
public interface IUserOwned
{
    /// <summary>
    /// 擁有此資料的使用者識別碼。對應資料表欄位 {表名}_UserId。
    /// </summary>
    Guid UserId { get; set; }
}
