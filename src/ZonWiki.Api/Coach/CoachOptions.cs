namespace ZonWiki.Api.Coach;

/// <summary>
/// 英文教練（Vertex Live）子系統的強型別設定（其他功能群 Phase 3）。
///
/// 以 <c>Configure&lt;CoachOptions&gt;(config.GetSection("Coach"))</c> 綁定；未提供的鍵一律採此處預設值。
/// 涵蓋：Live 連線目標（Region／Project／Model）、護欄門檻（日分鐘上限／單場硬上限／最小計費顆粒／
/// 單場加字上限）、全站花費熔斷門檻（每日／每月美元預算）、連線安全（AllowedOrigins／建線限流）、
/// 重連退避、以及語音／語言等預設。批次 1 用到護欄與花費相關欄位；連線／重連相關欄位供批次 2 使用。
/// </summary>
public sealed class CoachOptions
{
    /// <summary>設定區段名稱（appsettings 的 "Coach" 區段）。</summary>
    public const string SectionName = "Coach";

    /// <summary>
    /// Vertex 區域（Live native-audio GA 支援區域；預設 us-central1 最穩）。組 WS URL 用（非使用者輸入）。
    /// </summary>
    public string Region { get; set; } = "us-central1";

    /// <summary>
    /// GCP 專案識別碼（組 model 完整資源路徑用）。
    /// </summary>
    public string Project { get; set; } = "zonwiki-prod";

    /// <summary>
    /// Live 模型代號（設定值化；模型退役 2026-12-13 時只換此設定，見設計書 §1）。
    /// </summary>
    public string Model { get; set; } = "gemini-live-2.5-flash-native-audio";

    /// <summary>
    /// 每人每日分鐘上限（預設 60）。以權威 StartedDateTime→(EndedDateTime 或 now) 計算，未收尾 active 以 now 保守計入。
    /// </summary>
    public int DailyMinuteLimit { get; set; } = 60;

    /// <summary>
    /// 單場絕對時長硬上限（分鐘；預設 30）。到點主動 Abort Vertex WS（批次 2 的 send-side backstop）。
    /// </summary>
    public int MaxSessionMinutes { get; set; } = 30;

    /// <summary>
    /// 最小計費顆粒（分鐘；預設 1）。每場至少計此分鐘數，讓「連 &lt;1 分鐘就斷」的抖動照樣吃日額度。
    /// </summary>
    public int MinBilledMinutes { get; set; } = 1;

    /// <summary>
    /// 單場 add_vocabulary 加字上限（預設 20）。防語音 prompt-inject「加這 300 個字」計費放大（批次 2 用）。
    /// </summary>
    public int MaxVocabAddsPerSession { get; set; } = 20;

    /// <summary>
    /// 全站每日花費上限（美元；預設 5）。跨過即停開新課。&lt;=0 視為「不設限（停用熔斷）」。
    /// </summary>
    public decimal GlobalDailyBudget { get; set; } = 5.0m;

    /// <summary>
    /// 全站每月花費上限（美元；預設 50）。跨過即停開新課。&lt;=0 視為「不設限（停用熔斷）」。
    /// </summary>
    public decimal GlobalMonthlyBudget { get; set; } = 50.0m;

    /// <summary>
    /// 允許的 WebSocket 連線來源（Origin 白名單；【審修-S7】prod 缺省即空陣列＝拒所有，不 fall-open）。批次 2 用。
    /// </summary>
    public string[] AllowedOrigins { get; set; } = System.Array.Empty<string>();

    /// <summary>
    /// 孤兒回收寬限秒數（心跳未答超過此值即真的 Abort；預設 90）。批次 2 用。
    /// </summary>
    public int OrphanGraceSeconds { get; set; } = 90;

    /// <summary>
    /// 重連指數退避基底毫秒（實際延遲＝Base×2^n；預設 1000）。批次 2 用。
    /// </summary>
    public int ReconnectBaseMs { get; set; } = 1000;

    /// <summary>
    /// 重連最大嘗試次數（耗盡即推 fatal 終態；預設 5）。批次 2 用。
    /// </summary>
    public int MaxReconnectAttempts { get; set; } = 5;

    /// <summary>
    /// 內容窗壓縮觸發 token 數（setup.contextWindowCompression.triggerTokens，string(int64)；預設 "16000"）。批次 2 用。
    /// </summary>
    public string TriggerTokens { get; set; } = "16000";

    /// <summary>
    /// 預設教練語音（Live prebuiltVoiceConfig.voiceName；預設 "Kore"）。批次 2 用。
    /// </summary>
    public string Voice { get; set; } = "Kore";

    /// <summary>
    /// 預設語言碼（Live speechConfig.languageCode；預設 "en-US"）。批次 2 用。
    /// </summary>
    public string LanguageCode { get; set; } = "en-US";

    /// <summary>
    /// 每人／IP 每分鐘建線次數上限（WS upgrade 限流；預設 5）。批次 2 用。
    /// </summary>
    public int ConnectRateLimitPerMinute { get; set; } = 5;
}
