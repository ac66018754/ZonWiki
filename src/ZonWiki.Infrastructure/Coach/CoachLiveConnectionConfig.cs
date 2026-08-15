namespace ZonWiki.Infrastructure.Coach;

/// <summary>
/// <see cref="CoachLiveClient"/> 建立連線與組 setup 所需的靜態設定（region／project／model／voice 等）。
///
/// 為何獨立於 Api 的 <c>CoachOptions</c>：Infrastructure 不得反向相依 Api。故由 Api 的 Program.cs 在
/// 註冊 <see cref="CoachLiveClientFactory"/> 時，從 <c>CoachOptions</c> 讀出這幾個「連線目標」欄位並填入本 record，
/// 交給位於 Infrastructure 的工廠與 client 使用（快照於啟動時取，設定變更需重啟——與其它連線設定慣例一致）。
/// </summary>
/// <param name="Region">Vertex 區域（如 us-central1）。組 WS URL 與 model 資源路徑用。</param>
/// <param name="Project">GCP 專案識別碼（組 model 完整資源路徑用）。</param>
/// <param name="Model">Live 模型代號（設定值化，退役時只換此值）。</param>
/// <param name="Voice">Live 預設語音（prebuiltVoiceConfig.voiceName）。</param>
/// <param name="LanguageCode">Live speechConfig.languageCode。</param>
/// <param name="TriggerTokens">內容窗壓縮觸發 token 數（string(int64)）。</param>
public sealed record CoachLiveConnectionConfig(
    string Region,
    string Project,
    string Model,
    string Voice,
    string LanguageCode,
    string TriggerTokens);
