using ZonWiki.Domain.Entities;

namespace ZonWiki.Infrastructure.Services;

/// <summary>
/// 垃圾桶項目型別對應表：維護「型別字串」與「實體型別」的雙向映射，
/// 以及各型別如何取得標題摘要的邏輯。
/// 可維護、易擴充：新增實體時只需在此註冊。
///
/// 只包含實作 IUserOwned 的實體（即擁有 UserId 欄位的表）。
/// </summary>
public static class TrashTypeRegistry
{
    /// <summary>
    /// 型別字串 → 實體類型的映射。只包含實作 IUserOwned 的實體。
    /// </summary>
    private static readonly Dictionary<string, Type> TypeMap = new(StringComparer.Ordinal)
    {
        // --- 筆記相關 ---
        { "Note", typeof(Note) },
        { "Category", typeof(Category) },
        { "Tag", typeof(Tag) },
        { "NoteRevision", typeof(NoteRevision) },
        { "NoteCategory", typeof(NoteCategory) },
        { "NoteTag", typeof(NoteTag) },
        { "NoteLink", typeof(NoteLink) },

        // --- 任務相關 ---
        { "TaskCard", typeof(TaskCard) },
        { "TaskGroup", typeof(TaskGroup) },
        { "TaskRelation", typeof(TaskRelation) },
        { "NoteTaskLink", typeof(NoteTaskLink) },

        // --- 首頁相關 ---
        { "QuickLink", typeof(QuickLink) },
        { "CaptureItem", typeof(CaptureItem) },

        // --- 記帳相關 ---
        { "Expense", typeof(Expense) },
        { "ExpenseCategory", typeof(ExpenseCategory) },

        // --- 單字庫相關 ---
        { "VocabularyWord", typeof(VocabularyWord) },

        // --- 開問啦相關（IUserOwned 的實體） ---
        { "Canvas", typeof(Canvas) },
        { "SystemPrompt", typeof(SystemPrompt) },
        { "CanvasCat", typeof(CanvasCat) },
        { "AiSession", typeof(AiSession) },
        { "AiModel", typeof(AiModel) },
    };

    /// <summary>
    /// 取得給定型別字串對應的實體類型（若存在）。
    /// </summary>
    /// <param name="typeString">型別字串（例如 "Note"）。</param>
    /// <returns>對應的實體類型，或 null（若型別不存在或不支援垃圾桶）。</returns>
    public static Type? GetEntityType(string typeString)
    {
        return TypeMap.TryGetValue(typeString, out var type) ? type : null;
    }

    /// <summary>
    /// 取得實體的標題摘要字串（供垃圾桶列表顯示）。
    /// </summary>
    /// <param name="entity">實體物件。</param>
    /// <returns>標題摘要；若實體型別無法取得標題，返回 "(無標題)"。</returns>
    public static string GetTitle(object entity)
    {
        return entity switch
        {
            // --- 筆記相關 ---
            Note n => n.Title,
            Category c => c.Name,
            Tag t => t.Name,
            NoteRevision nr => $"修訂 {nr.Note?.Title ?? "(已刪除的筆記)"}",
            NoteCategory => "(筆記分類關聯)",
            NoteTag => "(筆記標籤關聯)",
            NoteLink nl => $"{nl.SourceNote?.Title ?? "(來源)"} → {nl.TargetNote?.Title ?? "(目標)"}",

            // --- 任務相關 ---
            TaskCard tc => tc.Title,
            TaskGroup tg => tg.Name,
            TaskRelation => "(任務關聯)",
            NoteTaskLink => "(筆記-任務關聯)",

            // --- 首頁相關 ---
            QuickLink ql => ql.Title,
            CaptureItem ci => ci.RawContent.Length > 50 ? ci.RawContent[..50] + "..." : ci.RawContent,

            // --- 記帳相關 ---
            Expense e => ExpenseTitle(e),
            ExpenseCategory ec => ec.Name,

            // --- 單字庫相關 ---
            VocabularyWord v => v.Word,

            // --- 開問啦相關 ---
            Canvas canvas => canvas.Title,
            SystemPrompt sp => sp.Title,
            CanvasCat cc => cc.Name,
            AiSession ai => $"AI 對話 ({ai.Kind})",
            AiModel am => am.Label,

            _ => "(無標題)"
        };
    }

    /// <summary>
    /// 取得消費紀錄的標題摘要：優先用商家名稱，否則取原始文字前 50 字。
    /// </summary>
    /// <param name="expense">消費紀錄實體。</param>
    /// <returns>供垃圾桶列表顯示的標題摘要。</returns>
    private static string ExpenseTitle(Expense expense)
    {
        if (!string.IsNullOrWhiteSpace(expense.Merchant))
        {
            return expense.Merchant!;
        }

        var raw = expense.RawText ?? string.Empty;
        return raw.Length > 50 ? raw[..50] + "..." : raw;
    }

    /// <summary>
    /// 列舉所有支援的型別字串（用於前端下拉選單或文件）。
    /// </summary>
    /// <returns>所有已註冊的型別字串。</returns>
    public static IEnumerable<string> GetAllSupportedTypes() => TypeMap.Keys;
}
