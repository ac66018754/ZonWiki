namespace ZonWiki.Domain.Dtos;

/// <summary>
/// 任務群組資料傳輸物件（簡要）。
/// </summary>
/// <param name="Id">群組識別碼。</param>
/// <param name="Name">群組名稱。</param>
/// <param name="Color">群組顏色（可空）。</param>
/// <param name="SortOrder">排序序號。</param>
public sealed record TaskGroupDto(
    Guid Id,
    string Name,
    string? Color,
    int SortOrder);

/// <summary>
/// 任務卡片資料傳輸物件（簡要，清單/看板用）。
/// </summary>
/// <param name="Id">卡片識別碼。</param>
/// <param name="Title">卡片標題。</param>
/// <param name="Status">狀態（todo/doing/done）。</param>
/// <param name="Priority">優先度（0-3）。</param>
/// <param name="PlannedDateTime">預計時間（UTC，可空）。</param>
/// <param name="DueDateTime">到期時間（UTC，可空）。</param>
/// <param name="GroupId">所屬群組識別碼（可空）。</param>
/// <param name="SortOrder">排序序號。</param>
/// <param name="SubTaskTotal">子任務總數（用於卡片顯示進度）。</param>
/// <param name="SubTaskDone">已完成的子任務數。</param>
/// <param name="Tags">貼在此任務上的標籤（與筆記共用標籤庫）。</param>
/// <param name="SubTasks">子任務清單（供清單／看板卡片在外層直接展開顯示）。</param>
public sealed record TaskCardSummaryDto(
    Guid Id,
    string Title,
    string Status,
    int Priority,
    DateTime? PlannedDateTime,
    DateTime? DueDateTime,
    Guid? GroupId,
    int SortOrder,
    DateTime CreatedDateTime,
    int SubTaskTotal = 0,
    int SubTaskDone = 0,
    List<TagRefDto>? Tags = null,
    List<SubTaskDto>? SubTasks = null,
    Guid? ParentId = null);

/// <summary>
/// 子任務（檢核清單項目）資料傳輸物件。
/// </summary>
/// <param name="Id">子任務識別碼。</param>
/// <param name="TaskCardId">所屬任務卡片識別碼。</param>
/// <param name="Title">子任務標題。</param>
/// <param name="IsDone">是否已完成。</param>
/// <param name="SortOrder">卡片內排序序號。</param>
/// <param name="CreatedDateTime">建立時間（UTC）。</param>
/// <param name="CompletedDateTime">完成時間（UTC，未完成為 null）。</param>
public sealed record SubTaskDto(
    Guid Id,
    Guid TaskCardId,
    string Title,
    bool IsDone,
    int SortOrder,
    DateTime CreatedDateTime,
    DateTime? CompletedDateTime);

/// <summary>
/// 建立子任務的請求內容。
/// </summary>
/// <param name="Title">子任務標題（必填）。</param>
/// <param name="SortOrder">排序序號（預設 0；通常由後端自動排到最後）。</param>
public sealed record CreateSubTaskRequest(
    string Title,
    int SortOrder = 0);

/// <summary>
/// 更新子任務的請求內容（所有欄位皆選擇性）。
/// </summary>
/// <param name="Title">子任務標題（null = 不更新）。</param>
/// <param name="IsDone">是否完成（null = 不更新）。</param>
/// <param name="SortOrder">排序序號（null = 不更新）。</param>
public sealed record UpdateSubTaskRequest(
    string? Title = null,
    bool? IsDone = null,
    int? SortOrder = null);

/// <summary>
/// 重新排序某卡片底下子任務的請求（依清單順序寫回 SortOrder）。
/// </summary>
/// <param name="OrderedIds">依新順序排列的子任務識別碼清單。</param>
public sealed record ReorderSubTasksRequest(
    List<Guid> OrderedIds);

/// <summary>
/// 任務卡片資料傳輸物件（詳細，含內容）。
/// </summary>
/// <param name="Id">卡片識別碼。</param>
/// <param name="Title">卡片標題。</param>
/// <param name="Content">卡片內容（Markdown）。</param>
/// <param name="Status">狀態（todo/doing/done）。</param>
/// <param name="Priority">優先度（0-3）。</param>
/// <param name="PlannedDateTime">預計時間（UTC，可空）。</param>
/// <param name="DueDateTime">到期時間（UTC，可空）。</param>
/// <param name="GroupId">所屬群組識別碼（可空）。</param>
/// <param name="SortOrder">排序序號。</param>
/// <param name="RecurrenceRule">重複規則（iCal RRULE，可空）。</param>
/// <param name="CreatedDateTime">建立時間（UTC）。</param>
/// <param name="UpdatedDateTime">最後更新時間（UTC）。</param>
public sealed record TaskCardDetailDto(
    Guid Id,
    string Title,
    string Content,
    string Status,
    int Priority,
    DateTime? PlannedDateTime,
    DateTime? DueDateTime,
    Guid? GroupId,
    int SortOrder,
    string? RecurrenceRule,
    DateTime CreatedDateTime,
    DateTime UpdatedDateTime,
    List<SubTaskDto>? SubTasks = null,
    List<TagRefDto>? Tags = null,
    Guid? ParentId = null);

/// <summary>
/// 建立任務卡片的請求內容。
/// </summary>
/// <param name="Title">卡片標題。</param>
/// <param name="Content">卡片內容（Markdown，可空）。</param>
/// <param name="Status">狀態（預設 "todo"）。</param>
/// <param name="Priority">優先度（預設 0）。</param>
/// <param name="PlannedDateTime">預計時間（UTC，可空）。</param>
/// <param name="DueDateTime">到期時間（UTC，可空）。</param>
/// <param name="GroupId">所屬群組識別碼（可空）。</param>
/// <param name="SortOrder">排序序號（預設 0）。</param>
/// <param name="RecurrenceRule">重複規則（iCal RRULE，可空）。</param>
public sealed record CreateTaskCardRequest(
    string Title,
    string Content = "",
    string Status = "todo",
    int Priority = 0,
    DateTime? PlannedDateTime = null,
    DateTime? DueDateTime = null,
    Guid? GroupId = null,
    int SortOrder = 0,
    string? RecurrenceRule = null,
    Guid? ParentId = null);

/// <summary>
/// 更新任務卡片的請求內容（所有欄位皆選擇性）。
/// </summary>
/// <param name="Title">卡片標題（可空；若無傳則保留原值）。</param>
/// <param name="Content">卡片內容（Markdown，可空）。</param>
/// <param name="Status">狀態（可空；若無傳則保留原值）。</param>
/// <param name="Priority">優先度（null = 不更新）。</param>
/// <param name="PlannedDateTime">預計時間（可空）。</param>
/// <param name="DueDateTime">到期時間（可空）。</param>
/// <param name="GroupId">所屬群組識別碼（可空）。</param>
/// <param name="SortOrder">排序序號（null = 不更新）。</param>
/// <param name="RecurrenceRule">重複規則（可空）。</param>
/// <param name="ClearPlannedDateTime">是否清除排程日期（true 時把 PlannedDateTime 設為 null；用以區分「不更新」與「清空」）。</param>
/// <param name="ClearDueDateTime">是否清除截止日期（true 時把 DueDateTime 設為 null）。</param>
/// <param name="ClearGroupId">是否清除所屬分類（true 時把 GroupId 設為 null，即移出分類）。</param>
public sealed record UpdateTaskCardRequest(
    string? Title = null,
    string? Content = null,
    string? Status = null,
    int? Priority = null,
    DateTime? PlannedDateTime = null,
    DateTime? DueDateTime = null,
    Guid? GroupId = null,
    int? SortOrder = null,
    string? RecurrenceRule = null,
    Guid? ParentId = null,
    bool ClearPlannedDateTime = false,
    bool ClearDueDateTime = false,
    bool ClearGroupId = false,
    bool ClearParentId = false);

/// <summary>
/// 建立任務群組的請求內容。
/// </summary>
/// <param name="Name">群組名稱。</param>
/// <param name="Color">群組顏色（可空）。</param>
/// <param name="SortOrder">排序序號（預設 0）。</param>
public sealed record CreateTaskGroupRequest(
    string Name,
    string? Color = null,
    int SortOrder = 0);

/// <summary>
/// 更新任務群組的請求內容。
/// </summary>
/// <param name="Name">群組名稱（可空；若無傳則保留原值）。</param>
/// <param name="Color">群組顏色（可空）。</param>
/// <param name="SortOrder">排序序號（null = 不更新）。</param>
public sealed record UpdateTaskGroupRequest(
    string? Name = null,
    string? Color = null,
    int? SortOrder = null);

/// <summary>
/// 任務卡片關聯資料傳輸物件。
/// </summary>
/// <param name="Id">關聯識別碼。</param>
/// <param name="SourceTaskCardId">來源卡片識別碼。</param>
/// <param name="TargetTaskCardId">目標卡片識別碼。</param>
/// <param name="Kind">關聯種類（"related"）。</param>
public sealed record TaskRelationDto(
    Guid Id,
    Guid SourceTaskCardId,
    Guid TargetTaskCardId,
    string Kind);

/// <summary>
/// 建立任務卡片關聯的請求內容。
/// </summary>
/// <param name="SourceTaskCardId">來源卡片識別碼。</param>
/// <param name="TargetTaskCardId">目標卡片識別碼。</param>
/// <param name="Kind">關聯種類（預設 "related"）。</param>
public sealed record CreateTaskRelationRequest(
    Guid SourceTaskCardId,
    Guid TargetTaskCardId,
    string Kind = "related");

/// <summary>
/// 筆記↔任務卡片連結資料傳輸物件。
/// </summary>
/// <param name="Id">連結識別碼。</param>
/// <param name="NoteId">筆記識別碼。</param>
/// <param name="TaskCardId">卡片識別碼。</param>
public sealed record NoteTaskLinkDto(
    Guid Id,
    Guid NoteId,
    Guid TaskCardId);

/// <summary>
/// 建立筆記↔卡片連結的請求內容。
/// </summary>
/// <param name="NoteId">筆記識別碼。</param>
/// <param name="TaskCardId">卡片識別碼。</param>
public sealed record CreateNoteTaskLinkRequest(
    Guid NoteId,
    Guid TaskCardId);

/// <summary>
/// 任務看板檢視資料（含卡片按群組與狀態分群）。
/// </summary>
/// <param name="Groups">群組清單。</param>
/// <param name="Cards">卡片清單（含所屬群組與狀態資訊）。</param>
public sealed record TaskBoardViewDto(
    List<TaskGroupDto> Groups,
    List<TaskCardSummaryDto> Cards);

/// <summary>
/// 任務行事曆檢視資料（含卡片依日期範圍篩選）。
/// </summary>
/// <param name="Cards">卡片清單（依 PlannedDateTime 或 DueDateTime 篩選）。</param>
/// <param name="From">查詢開始日期（UTC）。</param>
/// <param name="To">查詢結束日期（UTC）。</param>
public sealed record TaskCalendarViewDto(
    List<TaskCardSummaryDto> Cards,
    DateTime From,
    DateTime To);
