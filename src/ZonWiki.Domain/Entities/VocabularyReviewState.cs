namespace ZonWiki.Domain.Entities;

/// <summary>
/// 單字卡的複習狀態（SRS 狀態機）。
/// 儲存為整數（對應設計書 §3.2 的 _State(int)），DB 欄位照 FSRS 形狀設計，
/// 值由本波的 SM-2 排程器填入；未來換 FSRS 時重算此欄、不動表結構。
/// </summary>
public enum VocabularyReviewState
{
    /// <summary>
    /// 從未複習過的新卡（建立當下即到期、進入今日複習佇列）。
    /// </summary>
    New = 0,

    /// <summary>
    /// 複習過但尚未「畢業」（例如新卡第一次按 Again 後仍在學習階段）。
    /// </summary>
    Learning = 1,

    /// <summary>
    /// 已畢業，進入間隔遞增的複習期（成熟卡）。
    /// </summary>
    Review = 2,

    /// <summary>
    /// 曾畢業後遺忘、正在重新學習中（Review 卡按 Again 後落入此狀態）。
    /// </summary>
    Relearning = 3,
}
