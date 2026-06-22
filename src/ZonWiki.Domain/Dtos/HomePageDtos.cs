namespace ZonWiki.Domain.Dtos;

/// <summary>
/// 常用連結卡資料傳輸物件（簡要）。
/// </summary>
/// <param name="Id">連結卡識別碼。</param>
/// <param name="Title">卡片標題（顯示文字）。</param>
/// <param name="Url">目標網址。</param>
/// <param name="IconKey">圖示識別鍵（可空）。</param>
/// <param name="Category">分類（自由文字；可空＝未分類）。</param>
/// <param name="SortOrder">排序序號。</param>
/// <param name="Tags">貼在此連結卡上的標籤（與筆記/任務共用標籤庫）。</param>
public sealed record QuickLinkDto(
    Guid Id,
    string Title,
    string Url,
    string? IconKey,
    string? Category,
    int SortOrder,
    List<TagRefDto>? Tags = null);

/// <summary>
/// 建立常用連結卡的請求內容。
/// </summary>
/// <param name="Title">卡片標題（顯示文字）。</param>
/// <param name="Url">目標網址。</param>
/// <param name="IconKey">圖示識別鍵（可空）。</param>
/// <param name="Category">分類（自由文字；可空＝未分類）。</param>
/// <param name="SortOrder">排序序號（預設 0）。</param>
public sealed record CreateQuickLinkRequest(
    string Title,
    string Url,
    string? IconKey = null,
    string? Category = null,
    int SortOrder = 0);

/// <summary>
/// 更新常用連結卡的請求內容（所有欄位皆選擇性）。
/// </summary>
/// <param name="Title">卡片標題（可空；若無傳則保留原值）。</param>
/// <param name="Url">目標網址（可空；若無傳則保留原值）。</param>
/// <param name="IconKey">圖示識別鍵（可空）。</param>
/// <param name="Category">分類（null = 不更新；空字串 = 清為未分類）。</param>
/// <param name="SortOrder">排序序號（null = 不更新）。</param>
public sealed record UpdateQuickLinkRequest(
    string? Title = null,
    string? Url = null,
    string? IconKey = null,
    string? Category = null,
    int? SortOrder = null);

/// <summary>
/// 快速捕捉項目資料傳輸物件（簡要）。
/// </summary>
/// <param name="Id">捕捉項目識別碼。</param>
/// <param name="Source">捕捉來源（"web" / "voice" / "text"）。</param>
/// <param name="RawContent">原始內容。</param>
/// <param name="AudioPath">錄音檔路徑（可空，source = voice 時才有）。</param>
/// <param name="Status">狀態（"inbox" / "filed"）。</param>
/// <param name="FiledTargetType">歸檔目標型別（"note" / "taskcard"，未歸檔時為空）。</param>
/// <param name="FiledTargetId">歸檔目標識別碼（未歸檔時為空）。</param>
/// <param name="CreatedDateTime">建立時間（UTC）。</param>
public sealed record CaptureItemDto(
    Guid Id,
    string Source,
    string RawContent,
    string? AudioPath,
    string Status,
    string? FiledTargetType,
    Guid? FiledTargetId,
    DateTime CreatedDateTime);

/// <summary>
/// 建立快速捕捉項目的請求內容。
/// </summary>
/// <param name="Source">捕捉來源（"web" / "voice" / "text"）。</param>
/// <param name="RawContent">原始內容。</param>
/// <param name="AudioPath">錄音檔路徑（source = voice 時才有）。</param>
public sealed record CreateCaptureItemRequest(
    string Source,
    string RawContent,
    string? AudioPath = null);

/// <summary>
/// 歸檔捕捉項目的請求內容（將捕捉轉換成筆記或任務卡片）。
/// </summary>
/// <param name="FiledTargetType">目標型別（"note" 或 "taskcard"）。</param>
/// <param name="FiledTargetId">已建立的目標實體識別碼（Note.Id 或 TaskCard.Id）。</param>
public sealed record ArchiveCaptureItemRequest(
    string FiledTargetType,
    Guid FiledTargetId);

/// <summary>
/// 捕捉項目衍生出的筆記 / 任務（供分流彈窗顯示「過去新增過哪些」）。
/// </summary>
/// <param name="Id">關聯識別碼。</param>
/// <param name="TargetType">目標型別（"note" 或 "taskcard"）。</param>
/// <param name="TargetId">目標識別碼。</param>
/// <param name="Title">目標標題（已刪除則顯示提示字樣）。</param>
/// <param name="Slug">筆記的網址 slug（任務為 null）。</param>
/// <param name="IsDeleted">目標是否已被刪除。</param>
public sealed record CaptureLinkDto(
    Guid Id,
    string TargetType,
    Guid TargetId,
    string Title,
    string? Slug,
    bool IsDeleted);

/// <summary>
/// 為捕捉項目新增一筆「衍生關聯」的請求（筆記/任務由前端先以既有端點建立後回填）。
/// </summary>
/// <param name="TargetType">目標型別（"note" 或 "taskcard"）。</param>
/// <param name="TargetId">已建立的目標實體識別碼。</param>
public sealed record CreateCaptureLinkRequest(
    string TargetType,
    Guid TargetId);

/// <summary>
/// 當週簡化日曆資料（首頁用，含該週的任務與日記）。
/// </summary>
/// <param name="StartDate">該週開始日期（UTC）。</param>
/// <param name="EndDate">該週結束日期（UTC）。</param>
/// <param name="Tasks">該週的任務卡片清單（依計劃時間排序）。</param>
/// <param name="JournalNotes">該週的日記清單（依日期排序）。</param>
public sealed record WeeklyCalendarSummaryDto(
    DateTime StartDate,
    DateTime EndDate,
    List<TaskCardSummaryDto> Tasks,
    List<NoteSummaryDto> JournalNotes);

/// <summary>
/// 首頁聚合資料（一次回傳首頁所需的所有資料）。
/// </summary>
/// <param name="WeeklyCalendar">當週日曆精簡資料。</param>
/// <param name="TodayTodos">今日待辦清單（狀態 = todo / doing）。</param>
/// <param name="QuickLinks">常用連結卡清單。</param>
/// <param name="RecentCaptures">最近 5 個捕捉項目（依建立時間倒序）。</param>
public sealed record HomePageAggregateDto(
    WeeklyCalendarSummaryDto WeeklyCalendar,
    List<TaskCardSummaryDto> TodayTodos,
    List<QuickLinkDto> QuickLinks,
    List<CaptureItemDto> RecentCaptures);

/// <summary>
/// 行事曆檢視資料（某時間區間內的任務與日記）。
/// </summary>
/// <param name="Tasks">該區間的任務卡片清單（依計劃時間或截止時間排序）。</param>
/// <param name="JournalNotes">該區間的日記清單（依日記日期排序）。</param>
/// <param name="From">查詢開始日期（UTC）。</param>
/// <param name="To">查詢結束日期（UTC）。</param>
public sealed record CalendarViewDto(
    List<TaskCardSummaryDto> Tasks,
    List<NoteSummaryDto> JournalNotes,
    DateTime From,
    DateTime To);
