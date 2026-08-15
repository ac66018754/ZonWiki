namespace ZonWiki.Domain.Dtos;

/// <summary>
/// 時間追蹤項目 DTO（回應用）。
/// </summary>
/// <param name="Id">項目識別碼。</param>
/// <param name="Title">項目名稱。</param>
/// <param name="Category">自由文字分類（未分類為 null）。</param>
/// <param name="Note">備註（無備註為 null）。</param>
/// <param name="StartedDateTime">開始時間（UTC）。</param>
/// <param name="EndedDateTime">結束時間（UTC）；null = 計時中。</param>
/// <param name="DurationSeconds">時長（秒）＝結束－開始；計時中為 null。由後端即時計算、不落欄位。</param>
public sealed record TimeEntryDto(
    Guid Id,
    string Title,
    string? Category,
    string? Note,
    DateTime StartedDateTime,
    DateTime? EndedDateTime,
    long? DurationSeconds);

/// <summary>
/// 建立時間追蹤項目（＝開始計時）的請求。
/// </summary>
/// <param name="Title">項目名稱（必填，最長 200 字）。</param>
/// <param name="Category">分類（可空，最長 128 字；空白視為未分類）。</param>
/// <param name="Note">備註（可空，最長 1000 字；空白視為無備註）。</param>
/// <param name="StartedDateTime">開始時間（可空＝伺服器當下；接受 Z／offset／無尾碼，一律正規化為 UTC）。</param>
public sealed record CreateTimeEntryRequest(
    string? Title,
    string? Category = null,
    string? Note = null,
    DateTime? StartedDateTime = null);

/// <summary>
/// 結束計時的請求（body 可整個省略）。
/// </summary>
/// <param name="EndedDateTime">結束時間（可空＝伺服器當下；不得早於開始時間，可相等＝零時長）。</param>
public sealed record StopTimeEntryRequest(DateTime? EndedDateTime = null);

/// <summary>
/// 編輯時間追蹤項目的請求：所有欄位皆選擇性，null＝不更新。
/// 分類帶空字串或純空白＝清為未分類（與 QuickLink 同款語意）。
/// 結束時間只能「設值」（含對進行中項目補記結束），不能清回 null（要重新計時請開新項目）。
/// </summary>
/// <param name="Title">新名稱（null＝不改；帶了但空白＝400）。</param>
/// <param name="Category">新分類（null＝不改；空白＝清為未分類）。</param>
/// <param name="Note">新備註（null＝不改；空白＝清為無備註）。</param>
/// <param name="StartedDateTime">新開始時間（null＝不改）。</param>
/// <param name="EndedDateTime">新結束時間（null＝不改）。</param>
public sealed record UpdateTimeEntryRequest(
    string? Title = null,
    string? Category = null,
    string? Note = null,
    DateTime? StartedDateTime = null,
    DateTime? EndedDateTime = null);

/// <summary>
/// 「既有項目」範本 DTO：使用者歷史用過的「名稱＋分類」組合（供 iOS 捷徑「選既有」快速帶入）。
/// </summary>
/// <param name="Title">項目名稱。</param>
/// <param name="Category">分類（未分類為 null）。</param>
public sealed record TimeEntryTemplateDto(
    string Title,
    string? Category);

/// <summary>
/// 時間追蹤彙總 DTO（供 iOS 主畫面小工具顯示「今日／本週做了哪些、各花多少、進行中」）。
/// </summary>
/// <param name="Scope">範圍："day" 或 "week"。</param>
/// <param name="From">範圍起（UTC，含）。</param>
/// <param name="To">範圍迄（UTC，不含）。</param>
/// <param name="TotalSeconds">範圍內總時長（秒；進行中項目以「查詢當下已經過時間」即時併入）。</param>
/// <param name="RunningCount">範圍內仍在進行中的項目數。</param>
/// <param name="Items">範圍內各項目（依開始時間逆序）。</param>
/// <param name="ByCategory">依分類彙總（依時長逆序）。</param>
public sealed record TimeEntrySummaryDto(
    string Scope,
    DateTime From,
    DateTime To,
    long TotalSeconds,
    int RunningCount,
    IReadOnlyList<TimeEntrySummaryItemDto> Items,
    IReadOnlyList<TimeEntryCategoryTotalDto> ByCategory);

/// <summary>
/// 彙總中的單一項目。
/// </summary>
/// <param name="Id">項目識別碼。</param>
/// <param name="Title">項目名稱。</param>
/// <param name="Category">分類（未分類為 null）。</param>
/// <param name="Seconds">此項目時長（秒；進行中＝查詢當下已經過時間）。</param>
/// <param name="Running">是否進行中。</param>
public sealed record TimeEntrySummaryItemDto(
    Guid Id,
    string Title,
    string? Category,
    long Seconds,
    bool Running);

/// <summary>
/// 依分類的時長彙總。
/// </summary>
/// <param name="Category">分類名稱（未分類顯示為「未分類」）。</param>
/// <param name="Seconds">該分類總時長（秒）。</param>
/// <param name="RunningCount">該分類進行中的項目數。</param>
public sealed record TimeEntryCategoryTotalDto(
    string Category,
    long Seconds,
    int RunningCount);
