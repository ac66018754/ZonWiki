using Google.Apis.Auth.OAuth2;

namespace ZonWiki.Infrastructure.Ai;

/// <summary>
/// 以 ADC（Application Default Credentials）取得 Vertex AI 的 access token。
///
/// 設計：
/// - 以 <see cref="GoogleCredential.GetApplicationDefaultAsync()"/> 解析一次「環境憑證」
///   （GOOGLE_APPLICATION_CREDENTIALS ／ gcloud auth application-default login ／ VM metadata server），
///   加上 cloud-platform scope，之後長期持有。
/// - 真正的 access token 由 <see cref="GoogleCredential"/> 內建快取與自動刷新機制管理
///   （token 約一小時過期，底層會在需要時自動換新），故本類別註冊為 singleton、持有 credential 即可跨請求刷新。
/// - ADC 不可用（本機沒跑過 gcloud、VM 未附掛具 aiplatform.user 的服務帳戶）→ 拋出「訊息含 gcloud 引導」的
///   明確例外，讓上層（記帳解析）走保底路（改建 CaptureItem 回「已暫存」）。
/// </summary>
public sealed class VertexAdcTokenProvider : IVertexAdcTokenProvider
{
    /// <summary>Vertex AI 需要的 OAuth scope。</summary>
    private const string CloudPlatformScope = "https://www.googleapis.com/auth/cloud-platform";

    /// <summary>ADC 不可用時的引導訊息（含解法）。</summary>
    private const string AdcUnavailableMessage =
        "ADC 憑證不可用，無法取得 Vertex AI access token。" +
        "請先在本機跑 `gcloud auth application-default login`，" +
        "或在 VM 附掛具 roles/aiplatform.user 的服務帳戶（access scope 需含 cloud-platform）。";

    /// <summary>保護 credential 首次解析的閘門（避免並發重複解析）。</summary>
    private readonly SemaphoreSlim _resolveGate = new(1, 1);

    /// <summary>已解析並加上 scope 的憑證（首次成功後快取；解析失敗不快取，允許下次重試）。</summary>
    private volatile GoogleCredential? _scopedCredential;

    /// <inheritdoc />
    public async Task<string> GetAccessTokenAsync(CancellationToken cancellationToken = default)
    {
        var credential = await GetScopedCredentialAsync(cancellationToken);

        // GoogleCredential 以「明確介面實作」提供 ITokenAccess.GetAccessTokenForRequestAsync；
        // 底層 token 具內建快取與自動刷新，過期前會自動換新，故需轉型為介面才能呼叫。
        ITokenAccess tokenAccess = credential;
        return await tokenAccess.GetAccessTokenForRequestAsync(cancellationToken: cancellationToken);
    }

    /// <summary>
    /// 取得（並快取）已加上 cloud-platform scope 的 ADC 憑證。首次解析以閘門序列化，避免並發重複解析；
    /// 解析失敗不快取，讓下次呼叫可重試（例如使用者補跑 gcloud 後即可恢復）。
    /// </summary>
    private async Task<GoogleCredential> GetScopedCredentialAsync(CancellationToken cancellationToken)
    {
        var cached = _scopedCredential;
        if (cached is not null)
        {
            return cached;
        }

        await _resolveGate.WaitAsync(cancellationToken);
        try
        {
            if (_scopedCredential is not null)
            {
                return _scopedCredential;
            }

            GoogleCredential baseCredential;
            try
            {
                baseCredential = await GoogleCredential.GetApplicationDefaultAsync(cancellationToken);
            }
            catch (Exception ex)
            {
                // 把「ADC 不可用」包成帶引導的明確例外（保留原始例外供除錯）。
                throw new InvalidOperationException(AdcUnavailableMessage, ex);
            }

            var scoped = baseCredential.CreateScoped(CloudPlatformScope);
            _scopedCredential = scoped;
            return scoped;
        }
        finally
        {
            _resolveGate.Release();
        }
    }
}
