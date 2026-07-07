namespace ZonWiki.Domain.Dtos;

/// <summary>
/// 單一評分鍵的「下次排程預覽」。
/// 由後端 SM-2 排程器（Sm2Scheduler.PreviewIntervals）計算，與實際 <c>POST /review</c> 走同一段程式碼路徑，
/// 保證預覽＝按下去的實際結果（設計書 §3.4／§3.1「排程一律後端計算，DB-as-truth」）。
/// </summary>
/// <param name="IntervalDays">此鍵下次間隔（整數天）。</param>
/// <param name="Due">此鍵下次到期時間（UTC＝目前時間 + IntervalDays 天）。</param>
public sealed record SchedulePreviewDto(
    double IntervalDays,
    DateTime Due);

/// <summary>
/// 單字卡的回應 DTO（時間為 UTC，前端依裝置時區顯示）。
/// <see cref="SchedulePreview"/> 為權威預覽（前端複習卡的四鍵按鈕直接消費此值，不再自行降級估算）。
/// </summary>
/// <param name="Id">單字卡識別碼。</param>
/// <param name="Word">單字（正規化後）。</param>
/// <param name="Phonetic">音標（可空）。</param>
/// <param name="PartOfSpeech">詞性（可空）。</param>
/// <param name="DefinitionEn">英文釋義（可空）。</param>
/// <param name="DefinitionZh">中文釋義（可空）。</param>
/// <param name="ExampleSentence">例句（可空）。</param>
/// <param name="SourceNoteId">來源筆記識別碼（可空）。</param>
/// <param name="SourceNoteSlug">來源筆記 slug（可空；供前端以 /notes/{slug} 做正確連結，切勿用 id 硬組）。</param>
/// <param name="SourceNoteTitle">來源筆記標題（可空；供連結顯示文字）。</param>
/// <param name="Due">下次到期時間（UTC）。</param>
/// <param name="Stability">FSRS 形狀 _Stability（本波＝目前排程間隔天數）。</param>
/// <param name="Difficulty">FSRS 形狀 _Difficulty（本波＝EF）。</param>
/// <param name="State">卡片狀態字串：new／learning／review／relearning。</param>
/// <param name="Reps">連續成功次數。</param>
/// <param name="Lapses">遺忘次數。</param>
/// <param name="LastReviewDateTime">最後複習時間（UTC；新卡為 null）。</param>
/// <param name="CreatedDateTime">建立時間（UTC）。</param>
/// <param name="SchedulePreview">四鍵→下次排程預覽（鍵：again／hard／good／easy）。</param>
public sealed record VocabularyWordDto(
    Guid Id,
    string Word,
    string? Phonetic,
    string? PartOfSpeech,
    string? DefinitionEn,
    string? DefinitionZh,
    string? ExampleSentence,
    Guid? SourceNoteId,
    string? SourceNoteSlug,
    string? SourceNoteTitle,
    DateTime Due,
    double Stability,
    double Difficulty,
    string State,
    int Reps,
    int Lapses,
    DateTime? LastReviewDateTime,
    DateTime CreatedDateTime,
    IReadOnlyDictionary<string, SchedulePreviewDto> SchedulePreview);

/// <summary>
/// 手動新增單字卡的請求。單字入庫前一律 trim＋小寫正規化。
/// </summary>
/// <param name="Word">單字（必填）。</param>
/// <param name="Phonetic">音標（可空）。</param>
/// <param name="PartOfSpeech">詞性（可空）。</param>
/// <param name="DefinitionEn">英文釋義（可空）。</param>
/// <param name="DefinitionZh">中文釋義（可空）。</param>
/// <param name="ExampleSentence">例句（可空）。</param>
/// <param name="SourceNoteId">來源筆記識別碼（可空；若給須屬本人且有效）。</param>
public sealed record CreateVocabularyRequest(
    string Word,
    string? Phonetic = null,
    string? PartOfSpeech = null,
    string? DefinitionEn = null,
    string? DefinitionZh = null,
    string? ExampleSentence = null,
    Guid? SourceNoteId = null);

/// <summary>
/// 更新單字卡的請求（只更新有給的欄位）。
/// 註：<b>Word 不可改</b>（避免唯一索引搬移）；要改字＝刪掉重加。
/// </summary>
/// <param name="Phonetic">音標（可空）。</param>
/// <param name="PartOfSpeech">詞性（可空）。</param>
/// <param name="DefinitionEn">英文釋義（可空）。</param>
/// <param name="DefinitionZh">中文釋義（可空）。</param>
/// <param name="ExampleSentence">例句（可空）。</param>
/// <param name="SourceNoteId">來源筆記識別碼（可空；若給須屬本人且有效）。</param>
public sealed record UpdateVocabularyRequest(
    string? Phonetic = null,
    string? PartOfSpeech = null,
    string? DefinitionEn = null,
    string? DefinitionZh = null,
    string? ExampleSentence = null,
    Guid? SourceNoteId = null);

/// <summary>
/// 複習評分請求。
/// </summary>
/// <param name="Rating">評分字串（大小寫不敏感）："again"／"hard"／"good"／"easy"。</param>
public sealed record ReviewVocabularyRequest(
    string Rating);

/// <summary>
/// 複習後的回應：回傳更新後的卡片。
/// 卡片自身的 <see cref="VocabularyWordDto.SchedulePreview"/> 反映「下一次複習」的四鍵預覽
///（與 <c>GET /due</c> 同構）；前端只需消費 <c>card.schedulePreview</c>，不再另有獨立 Preview 欄。
/// </summary>
/// <param name="Card">複習後的單字卡。</param>
public sealed record ReviewVocabularyResponseDto(
    VocabularyWordDto Card);

/// <summary>
/// AI 友善端點的請求（教練 Function Calling／外部 AI PAT）：只給 word＋context，後端補釋義。
/// </summary>
/// <param name="Word">單字（必填）。</param>
/// <param name="Context">上下文/例句（可空；供 AI 補釋義更精準）。</param>
public sealed record AiVocabularyRequest(
    string Word,
    string? Context = null);

/// <summary>
/// AI 友善端點的回應：word 永不丟失（先入庫），釋義補齊與否由 <see cref="Enriched"/> 標示。
/// </summary>
/// <param name="Card">入庫（或復活）後的單字卡。</param>
/// <param name="Enriched">是否成功補上釋義（false＝逾時／壞 JSON／供應者不可用時降級，word 仍已入庫）。</param>
/// <param name="Message">給呼叫端的訊息。</param>
public sealed record AiVocabularyResponseDto(
    VocabularyWordDto Card,
    bool Enriched,
    string Message);
