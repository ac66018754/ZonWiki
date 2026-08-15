using System.Text;
using Microsoft.EntityFrameworkCore;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Coach;

/// <summary>
/// 英文教練 system prompt 組合器（其他功能群 Phase 3・批次 2，仿 <c>PromptAssembler</c>／<c>TtsScriptService</c>）。
///
/// 職責：組出 Vertex Live setup 的 <c>systemInstruction</c>——以「六要素英文骨架」（角色／語速／糾錯行為／
/// 生字行為／主題／延續脈絡）為基底，注入①到期單字 Top N（VocabularyService 到期佇列）②前次場次的
/// SummaryText（延續脈絡）。
///
/// 安全（【審修-S8】多租戶隔離）：所有 user-scoped 查詢一律 <c>IgnoreQueryFilters()</c> ＋<b>明確 userId</b>，
/// 不依賴 SetCurrentUserId 呼叫時機，行為在請求／背景／測試皆確定。
/// 【審修-S5】注入的到期單字與前次摘要皆<b>做長度上限</b>，防以歷史資料污染 systemInstruction。
/// </summary>
public sealed class CoachPromptAssembler
{
    /// <summary>注入的到期單字最大筆數（Top N；防塞爆 systemInstruction）。</summary>
    public const int MaxDueWords = 12;

    /// <summary>注入的前次摘要最大字元數（超過即截斷；防污染）。</summary>
    public const int MaxSummaryChars = 1500;

    /// <summary>主題字串注入的最大字元數（防污染）。</summary>
    public const int MaxTopicChars = 200;

    private readonly ZonWikiDbContext _db;

    /// <summary>
    /// 建立教練 system prompt 組合器。
    /// </summary>
    /// <param name="db">資料庫內容（Scoped；本組合器一律以明確 userId＋IgnoreQueryFilters 查詢）。</param>
    public CoachPromptAssembler(ZonWikiDbContext db)
    {
        _db = db;
    }

    /// <summary>
    /// 組出本場的英文教練 systemInstruction。
    /// </summary>
    /// <param name="userId">使用者識別碼（鎖多租戶）。</param>
    /// <param name="sessionId">本場 Id（用於排除「把本場自己的摘要當前次」）。</param>
    /// <param name="topic">本場主題（可空）。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    /// <returns>組好的 systemInstruction 純文字。</returns>
    public async Task<string> BuildSystemInstructionAsync(
        Guid userId,
        Guid sessionId,
        string? topic,
        CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;

        // ① 到期單字 Top N（明確 userId＋IgnoreQueryFilters；Due 升序）。
        var dueWords = await _db.VocabularyWord.IgnoreQueryFilters()
            .Where(v => v.UserId == userId && v.ValidFlag && v.Due <= now)
            .OrderBy(v => v.Due)
            .Take(MaxDueWords)
            .Select(v => v.Word)
            .ToListAsync(cancellationToken);

        // ② 前次場次摘要（本人、已結束、有摘要、非本場；取最近一場）。
        var previousSummary = await _db.CoachSession.IgnoreQueryFilters()
            .Where(s => s.UserId == userId
                && s.ValidFlag
                && s.Id != sessionId
                && s.SummaryText != null
                && s.SummaryText != "")
            .OrderByDescending(s => s.UpdatedDateTime)
            .Select(s => s.SummaryText)
            .FirstOrDefaultAsync(cancellationToken);

        return Compose(topic, dueWords, previousSummary);
    }

    /// <summary>
    /// 以六要素英文骨架組出 systemInstruction（純函式，供單元測試直接驗）。
    /// </summary>
    /// <param name="topic">主題（可空；超長截斷）。</param>
    /// <param name="dueWords">到期單字清單（已上限）。</param>
    /// <param name="previousSummary">前次摘要（可空；超長截斷）。</param>
    /// <returns>systemInstruction 純文字。</returns>
    public static string Compose(string? topic, IReadOnlyList<string> dueWords, string? previousSummary)
    {
        var builder = new StringBuilder();

        // 要素 1：角色與人設。
        builder.AppendLine(
            "You are a warm, encouraging English speaking coach for a Traditional-Chinese-speaking learner. "
            + "Your goal is to help them practice natural spoken English through friendly conversation.");

        // 要素 2：語速與清晰度。
        builder.AppendLine(
            "Speak clearly at a natural but slightly slower pace. Keep your turns fairly short so the learner "
            + "gets to speak most of the time. Ask one question at a time and wait for their reply.");

        // 要素 3：糾錯行為（用 show_correction 工具）。
        builder.AppendLine(
            "When the learner makes a grammar or wording mistake, gently correct it: briefly say the natural way "
            + "to phrase it, then continue the conversation. Whenever you correct them, ALSO call the "
            + "show_correction function with the original phrasing, the corrected phrasing, a short Traditional "
            + "Chinese explanation, and optionally a more natural version. Do not over-correct minor slips.");

        // 要素 4：生字行為（用 add_vocabulary 工具）。
        builder.AppendLine(
            "When the learner asks to remember a word, or when you introduce a genuinely useful new word, call the "
            + "add_vocabulary function with that word and a short example sentence. Only save words that matter; "
            + "do not save many words at once.");

        // 要素 5：主題。
        var safeTopic = Clip(topic, MaxTopicChars);
        builder.AppendLine(string.IsNullOrWhiteSpace(safeTopic)
            ? "Start by greeting the learner and asking what they would like to talk about today."
            : $"Today's conversation topic is: {safeTopic}. Steer the conversation around this topic, but stay flexible.");

        // 要素 6：延續脈絡（前次摘要＋到期單字）。
        var safeSummary = Clip(previousSummary, MaxSummaryChars);
        if (!string.IsNullOrWhiteSpace(safeSummary))
        {
            builder.AppendLine(
                "Here is a short summary of your previous session with this learner (for continuity; do not read it "
                + $"aloud verbatim): {safeSummary}");
        }

        if (dueWords.Count > 0)
        {
            var wordList = string.Join(", ", dueWords);
            builder.AppendLine(
                "The learner is currently reviewing these words; try to naturally weave a few of them into the "
                + $"conversation when it fits: {wordList}.");
        }

        return builder.ToString();
    }

    /// <summary>把字串裁到上限字元數（null／空白回 null；超長取前 N 字元）。</summary>
    private static string? Clip(string? value, int maxChars)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var trimmed = value.Trim();
        return trimmed.Length <= maxChars ? trimmed : trimmed[..maxChars];
    }
}
