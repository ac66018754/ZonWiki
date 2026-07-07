namespace ZonWiki.Domain.Entities;

/// <summary>
/// 一張單字卡（單字庫）。可由手動新增、AI 友善端點（教練 Function Calling／外部 AI PAT）建立。
///
/// 重要慣例：
/// - <see cref="Word"/> 入庫前一律 trim＋統一小寫正規化（服務層 <c>NormalizeWord</c> 做），
///   唯一索引 (UserId, Word) <b>不含 ValidFlag</b>；重複入庫走「復活軟刪列」upsert（設計書 §3.2）。
/// - SRS 欄位（<see cref="Due"/> 等）DB 型別照 FSRS 形狀設計，值由本波的 SM-2 排程器填入，
///   目的是「未來換 FSRS 不動表」（設計書 §3.1）；映射語意見各欄註解。
/// - 時間一律以 UTC 儲存；一律軟刪除（繼承 <see cref="AuditableEntity"/> 的 ValidFlag）。
/// - 註：<c>_SourceCoachSessionId</c> FK→CoachSession 延到 Phase 3 才加（CoachSession 屆時才建表）。
/// </summary>
public class VocabularyWord : AuditableEntity, IUserOwned
{
    /// <summary>
    /// 擁有此單字卡的使用者識別碼。對應資料表欄位 VocabularyWord_UserId。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 單字（正規化後：trim＋小寫）。同一使用者內唯一（唯一索引不含 ValidFlag）。
    /// </summary>
    public string Word { get; set; } = string.Empty;

    /// <summary>
    /// 音標（IPA；可空）。通常由 AI 補釋義端點填入。
    /// </summary>
    public string? Phonetic { get; set; }

    /// <summary>
    /// 詞性（如 noun／verb／adjective；可空）。
    /// </summary>
    public string? PartOfSpeech { get; set; }

    /// <summary>
    /// 英文釋義（可空）。
    /// </summary>
    public string? DefinitionEn { get; set; }

    /// <summary>
    /// 中文釋義（可空）。
    /// </summary>
    public string? DefinitionZh { get; set; }

    /// <summary>
    /// 例句（可空）。
    /// </summary>
    public string? ExampleSentence { get; set; }

    /// <summary>
    /// 來源筆記識別碼（可空；單向關聯 FK→Note，不改 Note 實體）。
    /// 供前端做「來源筆記可點連結」（以 Note 的 slug 導頁）。
    /// </summary>
    public Guid? SourceNoteId { get; set; }

    /// <summary>
    /// 來源教練場次識別碼（可空；單向關聯 FK→CoachSession，Restrict＝不連鎖硬刪）。
    /// 由英文教練的 add_vocabulary Function Calling 建卡時填入，供「來源場次可點連結」。
    /// nullable 後補（Phase 2 延後項）：既有單字卡此欄為 null，零成本補 FK。
    /// </summary>
    public Guid? SourceCoachSessionId { get; set; }

    // ── SRS（DB 欄位照 FSRS 形狀，值由 SM-2 填；未來換 FSRS 不動表，設計書 §3.1）───────────

    /// <summary>
    /// 下次到期時間（UTC；timestamptz）。新卡＝建立當下（立即到期，進入今日複習佇列）。
    /// 對應 _Due 欄；由服務層以「複習當下 + 間隔天數」計算。
    /// </summary>
    public DateTime Due { get; set; }

    /// <summary>
    /// FSRS 形狀的 _Stability 欄。本波 SM-2 語意＝「目前排程間隔（天）」
    ///（間隔是 FSRS stability「達目標留存率天數」的自然代理），並作為成熟卡下次間隔的乘算基底。
    /// </summary>
    public double Stability { get; set; }

    /// <summary>
    /// FSRS 形狀的 _Difficulty 欄。本波 SM-2 語意＝「難易因子 EF」（1.3~2.5+，越大越易；
    /// 與 FSRS「越大越難」方向相反，僅為容器，換 FSRS 時重算）。
    /// </summary>
    public double Difficulty { get; set; }

    /// <summary>
    /// 卡片狀態列舉（New/Learning/Review/Relearning）；EF 預設以 int 儲存。對應 _State 欄。
    /// </summary>
    public VocabularyReviewState State { get; set; }

    /// <summary>
    /// FSRS 形狀的 _Reps 欄。本波 SM-2 語意＝「連續成功次數 n」（Again 歸零；
    /// 與 FSRS「總複習次數單調遞增」不同，換 FSRS 時重算）。
    /// </summary>
    public int Reps { get; set; }

    /// <summary>
    /// 遺忘次數（僅已畢業卡遺忘時累加）。對應 _Lapses 欄。
    /// </summary>
    public int Lapses { get; set; }

    /// <summary>
    /// 最後複習時間（UTC；可空，新卡為 null）。對應 _LastReviewDateTime 欄。
    /// </summary>
    public DateTime? LastReviewDateTime { get; set; }

    /// <summary>
    /// 導覽屬性：來源筆記（單向；可空）。
    /// </summary>
    public Note? SourceNote { get; set; }

    /// <summary>
    /// 導覽屬性：來源教練場次（單向；可空）。
    /// </summary>
    public CoachSession? SourceCoachSession { get; set; }
}
