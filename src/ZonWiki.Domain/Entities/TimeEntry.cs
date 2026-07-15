namespace ZonWiki.Domain.Entities;

/// <summary>
/// 時間追蹤項目：記錄使用者「每天把時間花在什麼上面」的一段計時。
///
/// 生命週期：建立即開始計時（<see cref="StartedDateTime"/>）；
/// <see cref="EndedDateTime"/> 為 null 代表「計時中」，按「結束」或 PUT 補上結束時間即完成。
/// 時長不落欄位，由 API 依兩端時間差即時計算（避免「改時間忘了同步時長」的一致性負擔）。
/// 所有時間一律存 UTC（鐵則 #12），前端依使用者時區顯示。
/// </summary>
public class TimeEntry : AuditableEntity, IUserOwned
{
    /// <summary>
    /// 擁有者使用者 Id（IUserOwned：自動吃到「使用者隔離＋ValidFlag」全域查詢過濾）。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 項目名稱（做了什麼事），必填，最長 200 字。
    /// </summary>
    public string Title { get; set; } = string.Empty;

    /// <summary>
    /// 自由文字分類（例如「工作」「運動」「閱讀」），可空，最長 128 字；
    /// 與 QuickLink 的分類同款輕量語意（空白視為未分類、存 null）。
    /// </summary>
    public string? Category { get; set; }

    /// <summary>
    /// 開始時間（UTC）。建立時未指定則取伺服器當下時間。
    /// </summary>
    public DateTime StartedDateTime { get; set; }

    /// <summary>
    /// 結束時間（UTC）；null 代表「計時中」。必須不早於 <see cref="StartedDateTime"/>（可相等＝零時長）。
    /// </summary>
    public DateTime? EndedDateTime { get; set; }
}
