namespace ZonWiki.Domain.Entities;

/// <summary>
/// 一場英文口說教練對話（其他功能群 Phase 3・英文教練）。
///
/// 定位與慣例：
/// - 繼承 <see cref="AuditableEntity"/>＋實作 <see cref="IUserOwned"/> → 自動獲得六稽核欄、
///   使用者隔離全域過濾、fail-closed 具現化攔截器，欄名一律 <c>CoachSession_{Property}</c>。
/// - 一律以 UTC 儲存時間；一律軟刪除（ValidFlag=false），絕不硬刪。
/// - 逐字稿以子實體 <see cref="CoachMessage"/> 落地（一場多則）。
/// - <b>權威計量</b>（【審修-S9/A5】）：時長權威來自 <see cref="StartedDateTime"/> →
///   （<see cref="EndedDateTime"/> 或 now），不依賴收尾才能算對；<see cref="AccumulatedSeconds"/>
///   為心跳續扣的次要累計欄（批次 2 的 WS 心跳寫入），供預算計量器使用。
/// - CoachSession <b>登記</b>進垃圾桶白名單與活動流；子實體 CoachMessage <b>不</b>登記（避免每則逐字稿灌爆）。
/// </summary>
public class CoachSession : AuditableEntity, IUserOwned
{
    /// <summary>狀態字串常數：進行中。</summary>
    public const string StatusActive = "active";

    /// <summary>狀態字串常數：已結束。</summary>
    public const string StatusEnded = "ended";

    /// <summary>
    /// 擁有此教練場次的使用者識別碼。對應資料表欄位 CoachSession_UserId。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 場次標題（供清單顯示；開課時可由使用者給或以主題／時間自動命名）。
    /// </summary>
    public string Title { get; set; } = string.Empty;

    /// <summary>
    /// 主題（可空；使用者指定的對話主題，供 system prompt 脈絡）。
    /// </summary>
    public string? Topic { get; set; }

    /// <summary>
    /// 狀態："active"（進行中）／"ended"（已結束）。沿用碼庫以字串表示狀態的慣例。
    /// </summary>
    public string Status { get; set; } = StatusActive;

    /// <summary>
    /// 使用的 Live 模型代號（設定值化；模型退役時只換設定，見 CoachOptions.Model）。
    /// </summary>
    public string Model { get; set; } = string.Empty;

    /// <summary>
    /// 下課後由 VertexAdc 生成的整場摘要（可空；未收尾或摘要失敗時為 null）。
    /// </summary>
    public string? SummaryText { get; set; }

    /// <summary>
    /// Session Resumption 續連句柄（可空；Vertex 滾動下發，永遠保留最後一個，僅供重連帶回，
    /// <b>絕不接受前端傳入</b>）。
    /// </summary>
    public string? ResumptionHandle { get; set; }

    /// <summary>
    /// 開場時間（UTC；開課即寫）。【審修-S9/A5】日分鐘用量的權威起點。
    /// </summary>
    public DateTime StartedDateTime { get; set; }

    /// <summary>
    /// 心跳續扣累計秒數（批次 2 的 WS 心跳每 N 秒續扣落地，不依賴收尾才結算）。
    /// 為次要計量欄；日分鐘上限仍以 <see cref="StartedDateTime"/> →（<see cref="EndedDateTime"/> 或 now）為權威。
    /// </summary>
    public int AccumulatedSeconds { get; set; }

    /// <summary>
    /// 收尾時間（UTC；可空，未結束為 null）。
    /// </summary>
    public DateTime? EndedDateTime { get; set; }

    /// <summary>
    /// 導覽屬性：本場的逐字稿訊息（依 SeqNo 遞增）。
    /// </summary>
    public ICollection<CoachMessage> Messages { get; set; } = new List<CoachMessage>();
}
