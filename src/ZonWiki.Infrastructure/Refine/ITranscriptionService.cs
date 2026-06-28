namespace ZonWiki.Infrastructure.Refine;

/// <summary>
/// 語音轉文字（轉錄）服務抽象：把音訊檔轉成逐字稿文字。
/// </summary>
public interface ITranscriptionService
{
    /// <summary>
    /// 將音訊檔轉錄成文字。
    /// </summary>
    /// <param name="audioFilePath">本機音訊檔路徑（mp3/m4a/wav…）。</param>
    /// <param name="baseUrl">OpenAI 相容端點基底（例如 https://api.groq.com/openai/v1）。</param>
    /// <param name="apiKey">API 金鑰（Bearer）。</param>
    /// <param name="model">轉錄模型（例如 whisper-large-v3-turbo）。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    /// <returns>轉錄後的純文字。</returns>
    Task<string> TranscribeAsync(
        string audioFilePath,
        string baseUrl,
        string apiKey,
        string model,
        CancellationToken cancellationToken);
}
