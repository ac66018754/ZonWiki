namespace ZonWiki.Domain.Entities;

/// <summary>
/// API 個人存取權杖（Personal Access Token, PAT）。
///
/// 用途：讓「外部 AI 助理 / 自動化程式」（Claude Code、Hermes、ChatGPT 的 Custom GPT Action…）
/// 以「某位使用者的身分」呼叫 ZonWiki 的 Web API，而不必使用瀏覽器登入 Cookie。
/// 使用者在個人頁產生權杖（可命名、可隨時撤銷），把權杖字串貼進 AI 客戶端設定；
/// 客戶端之後以 HTTP 標頭 <c>Authorization: Bearer &lt;token&gt;</c> 帶上，後端據此辨識使用者。
///
/// 安全設計（與密碼同等敏感）：
/// 1. <b>絕不存明碼</b>：只存權杖字串的 SHA-256 雜湊（<see cref="TokenHash"/>）。明碼僅在「產生當下」回傳一次，
///    之後任何人（含 DBA）都無法從資料庫還原。權杖是高熵亂數，故用 SHA-256 即足夠（不需密碼用的慢雜湊 KDF）。
/// 2. <b>可撤銷</b>：撤銷＝軟刪除（ValidFlag=false），驗證時只接受 ValidFlag=true 者。一把外洩即撤那把、不影響其它。
/// 3. <b>可命名 + 顯示前綴</b>：以 <see cref="Name"/> 與 <see cref="TokenPrefix"/> 讓使用者辨識「這是哪一把」，
///    而不需保存完整明碼。
/// 4. <b>可選到期</b>：<see cref="ExpiresDateTime"/> 為 null＝永不過期；有值則過期後驗證失敗。
/// </summary>
public class ApiToken : AuditableEntity, IUserOwned
{
    /// <summary>
    /// 擁有此權杖的使用者識別碼。權杖驗證成功後，請求即以此使用者身分執行。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 權杖名稱（由使用者自訂，用於辨識用途，例如 "Claude Code"、"ChatGPT"、"Hermes"）。
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// 權杖字串的 SHA-256 雜湊（十六進位、64 字元）。資料庫只存雜湊、不存明碼。
    /// 驗證時把外部帶入的權杖即時雜湊後比對此欄。
    /// </summary>
    public string TokenHash { get; set; } = string.Empty;

    /// <summary>
    /// 權杖顯示前綴（明碼開頭數字元，例如 "zwk_Ab12cd…"）。供清單畫面辨識「這是哪一把」，
    /// 不足以反推完整權杖（安全）。
    /// </summary>
    public string TokenPrefix { get; set; } = string.Empty;

    /// <summary>
    /// 最後使用時間（UTC，nullable）。每次以此權杖成功驗證時更新（節流：太頻繁不重複寫）。
    /// 供使用者判斷「這把還有沒有在用、可不可以撤銷」。
    /// </summary>
    public DateTime? LastUsedDateTime { get; set; }

    /// <summary>
    /// 到期時間（UTC，nullable）。null＝永不過期；有值且已過期則驗證失敗。
    /// </summary>
    public DateTime? ExpiresDateTime { get; set; }

    /// <summary>
    /// 權限範圍（逗號分隔，資訊性欄位）。目前權杖一律以「該使用者完整身分」運作（等同登入後的權限），
    /// 此欄保留供日後做「逐端點細分權限」用，預設記錄常見用途以利稽核。
    /// </summary>
    public string Scopes { get; set; } = "notes,categories,tasks";
}
