namespace ZonWiki.Infrastructure.Ai;

/// <summary>
/// Vertex AI ADC（Application Default Credentials）存取權杖提供者。
///
/// 用途：VertexAdc 供應者需以「一小時過期的 OAuth access token」作為 Bearer 認證
/// （不是靜態金鑰）。此介面把「取得目前有效的 ADC access token」抽象出來，
/// 讓 <see cref="AiProviderFactory"/> 解析 VertexAdc 供應者時取一次 token 傳給
/// OpenAI 相容 provider；也讓測試能注入 stub、不相依真實 GCP 憑證。
/// </summary>
public interface IVertexAdcTokenProvider
{
    /// <summary>
    /// 取得目前有效的 ADC access token（底層具內建快取與自動刷新）。
    /// ADC 不可用時應拋出明確例外（訊息引導使用者跑 gcloud auth application-default login）。
    /// </summary>
    /// <param name="cancellationToken">取消權杖。</param>
    /// <returns>可作為 Bearer 認證使用的 access token 字串。</returns>
    Task<string> GetAccessTokenAsync(CancellationToken cancellationToken = default);
}
