namespace ZonWiki.Domain.Dtos;

/// <summary>
/// 使用者設定資料傳輸物件（顯示模式、時區、快捷鍵覆寫）。
/// </summary>
/// <param name="DisplayMode">顯示模式（"warmpaper"、"light"、"dark"、"night"）。</param>
/// <param name="TimeZone">IANA 時區名稱（例如 "Asia/Taipei"），空字串代表跟隨裝置預設。</param>
/// <param name="ShortcutsJson">快捷鍵自訂覆寫的 JSON 字串（{ "動作ID": "按鍵" }）；null 代表沿用預設。</param>
public sealed record UserSettingsDto(
    string DisplayMode,
    string TimeZone,
    string? ShortcutsJson);

/// <summary>
/// 使用者設定更新請求（欄位皆選擇性）。
/// </summary>
/// <param name="DisplayMode">新的顯示模式（可選）。</param>
/// <param name="TimeZone">新的時區（可選）。</param>
/// <param name="ShortcutsJson">新的快捷鍵覆寫 JSON（可選；傳空字串代表清除＝還原全部預設）。</param>
public sealed record UpdateUserSettingsRequest(
    string? DisplayMode,
    string? TimeZone,
    string? ShortcutsJson);

/// <summary>
/// 垃圾桶項目摘要資料傳輸物件（含型別、所屬模組、標題、內容預覽、刪除時間）。
/// </summary>
/// <param name="Id">項目識別碼。</param>
/// <param name="Type">項目型別（還原/永久刪除用，例如 "Note"、"TaskCard"、"Node" 等）。</param>
/// <param name="Group">所屬模組（垃圾桶分區標題，例如 "筆記"、"任務"、"開問啦・畫布"）。</param>
/// <param name="Title">項目標題或名稱。</param>
/// <param name="Preview">內容預覽片段（可空）。</param>
/// <param name="DeletedDateTime">刪除時間（UTC），前端依使用者時區顯示。</param>
/// <param name="Context">還原後會回到哪裡（例：「筆記《X》」「畫布《Y》」「排程於 6/24」）。可空。</param>
public sealed record TrashItemDto(
    Guid Id,
    string Type,
    string Group,
    string Title,
    string? Preview,
    DateTime DeletedDateTime,
    string? Context = null);
