using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Infrastructure.Ai;

/// <summary>
/// 解析後的供應者：要用哪個 <see cref="IAiProvider"/>、要傳給它的模型代號、以及是否支援接續對話（resume）。
/// </summary>
/// <param name="Provider">實際串流的供應者實例。</param>
/// <param name="Model">傳給供應者的模型代號（ClaudeCli 作為 --model；OpenAiCompatible 忽略，因模型已綁在實例上）。</param>
/// <param name="SupportsResume">是否支援以 claude session 接續（僅本機 claude CLI 為 true）。</param>
public readonly record struct ResolvedProvider(IAiProvider Provider, string? Model, bool SupportsResume);

/// <summary>
/// 解析後的圖片生成器：實際呼叫的 <see cref="ImageGenerator"/> 與其模型鍵/代號。
/// </summary>
public readonly record struct ResolvedImage(ImageGenerator Generator, string ModelKey, string ModelId);

/// <summary>
/// 依「節點選用的模型鍵」與使用者 ID 解析出對應的 AI 供應者。
/// 從 DB 讀取使用者的 AiModel 設定，依 Provider 類型建立對應供應者。
/// 規則：①測試模式（注入的預設供應者為 <see cref="FakeAiProvider"/>）一律用 Fake，保持 E2E 可決定性；
/// ②找不到設定 / 空鍵 → 退回預設供應者（本機 claude CLI，免金鑰）；
/// ③ClaudeCli 設定項 → 用預設 claude 供應者並帶該項 ModelId 作為 --model；
/// ④OpenAiCompatible 設定項 → 以 BaseUrl/解析後金鑰/ModelId 建一個 HTTP 串流供應者。
/// </summary>
public sealed class AiProviderFactory
{
    /// <summary>
    /// 「全站共用模型」的擁有者 Id（系統身分，非任何真實使用者）。
    /// 以此 UserId 存放的 AiModel 為共用資源：金鑰只存一份、不屬於任何使用者，
    /// 因此不會出現在任何人的「設定頁(AI 模型管理)」或節點下拉具名清單，只作為「預設」被取用。
    /// 固定值（非隨機真實使用者 GUID，碰撞機率為零）。
    /// </summary>
    public static readonly Guid SharedModelUserId = new("00000000-0000-0000-0000-0000000000a1");

    private readonly IAiProvider _default;
    private readonly ZonWikiDbContext _db;
    private readonly AiModelResolver _resolver;
    private readonly IHttpClientFactory _httpClientFactory;

    /// <summary>
    /// 建立供應者工廠。
    /// </summary>
    public AiProviderFactory(
        IAiProvider defaultProvider,
        ZonWikiDbContext db,
        AiModelResolver resolver,
        IHttpClientFactory httpClientFactory)
    {
        _default = defaultProvider;
        _db = db;
        _resolver = resolver;
        _httpClientFactory = httpClientFactory;
    }

    /// <summary>
    /// 依模型鍵與使用者 ID 解析供應者。請在提問開始時呼叫一次並沿用結果（避免設定中途熱載造成不一致）。
    /// </summary>
    public async Task<ResolvedProvider> ResolveAsync(Guid userId, string? modelKey, CancellationToken cancellationToken = default)
    {
        // 測試模式：固定用 Fake，忽略設定，確保 E2E 穩定。
        if (_default is FakeAiProvider)
        {
            return new ResolvedProvider(_default, null, true);
        }

        // 用 IgnoreQueryFilters + 明確 UserId：背景提問流程的全域過濾以 CurrentUserId 為準，
        // 這裡明確指定 userId / 系統共用 Id 才不會被濾掉（也可查到不屬於當前使用者的系統共用列）。
        var entry = string.IsNullOrWhiteSpace(modelKey)
            ? null
            : await _db.AiModel.IgnoreQueryFilters()
                .FirstOrDefaultAsync(m => m.UserId == userId && m.Enabled && m.Key == modelKey, cancellationToken);

        // 未指定模型（「預設」），或指定的鍵找不到/已停用 → 改用「全站共用預設模型」
        // （系統擁有、設定頁隱藏、金鑰只存一份）。讓所有人免設定即可使用預設。
        if (entry is null)
        {
            entry = await _db.AiModel.IgnoreQueryFilters()
                .FirstOrDefaultAsync(m => m.UserId == SharedModelUserId && m.Enabled, cancellationToken);
        }

        // 連共用預設都沒設 → 退回本機 claude CLI（免金鑰）。
        if (entry is null)
        {
            return new ResolvedProvider(_default, null, true);
        }

        if (string.Equals(entry.Provider, "OpenAiCompatible", StringComparison.OrdinalIgnoreCase))
        {
            // SSRF 防護：驗證 BaseUrl 指向的是公開網際網路端點，不是內部/本機服務。
            var baseUrl = entry.BaseUrl?.Trim() ?? "";
            if (string.IsNullOrEmpty(baseUrl) || !IsBaseUrlSafe(baseUrl))
            {
                throw new InvalidOperationException(
                    $"無效或不安全的 BaseUrl：'{baseUrl}'。必須是公開網際網路的 https:// 端點（不允許本機、私有 IP、或內部網路）。");
            }

            var apiKey = _resolver.ResolveApiKey(entry.ApiKeyEncrypted);
            var http = _httpClientFactory.CreateClient("ai");
            var provider = new OpenAiCompatibleStreamingProvider(
                http, baseUrl, apiKey ?? "", entry.ModelId ?? "", entry.TimeoutSeconds);
            return new ResolvedProvider(provider, entry.ModelId, SupportsResume: false);
        }

        // ClaudeCli（或未知類型）→ 用預設 claude 供應者，帶該項 ModelId 作為 --model。
        var claudeModel = string.IsNullOrWhiteSpace(entry.ModelId) ? null : entry.ModelId;
        return new ResolvedProvider(_default, claudeModel, SupportsResume: true);
    }

    /// <summary>
    /// SSRF 防護：檢查 BaseUrl 是否安全（不指向內部/本機服務、只允許公開網際網路的 HTTPS 端點）。
    /// </summary>
    private static bool IsBaseUrlSafe(string baseUrl)
    {
        if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var uri))
        {
            return false;
        }

        // 強制 HTTPS（生產環境安全要求）；開發時可改為 http 也允許，但默認只允許 https。
        if (uri.Scheme != "https")
        {
            return false;
        }

        var host = uri.Host.ToLowerInvariant();

        // 阻止本機與私有 IP 範圍。
        if (host == "localhost"
            || host == "127.0.0.1"
            || host.StartsWith("192.168.")
            || host.StartsWith("10.")
            || host.StartsWith("172.")  // 172.16.0.0/12
            || host == "::1"             // IPv6 loopback
            || host == "[::1]"
            || host.EndsWith(".local", StringComparison.OrdinalIgnoreCase)
            || host.EndsWith(".localhost", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        // 阻止 AWS 與 GCP 的元資料端點。
        if (host == "169.254.169.254" || host == "metadata.google.internal")
        {
            return false;
        }

        return true;
    }

    /// <summary>
    /// 解析要用的圖片生成器：取使用者啟用且 Kind=image 的 OpenAiCompatible 模型（可指定偏好鍵，否則取第一個）。
    /// 沒有設定任何圖片模型時回 null。
    /// </summary>
    public async Task<ResolvedImage?> ResolveImageGeneratorAsync(Guid userId, string? preferredKey = null, CancellationToken cancellationToken = default)
    {
        var imageModels = await _db.AiModel
            .Where(m => m.UserId == userId
                && m.Enabled
                && m.Kind == "image"
                && m.Provider == "OpenAiCompatible")
            .ToListAsync(cancellationToken);

        if (imageModels.Count == 0)
        {
            return null;
        }

        var entry = (!string.IsNullOrWhiteSpace(preferredKey)
            ? imageModels.FirstOrDefault(m => m.Key == preferredKey)
            : null) ?? imageModels[0];

        var apiKey = _resolver.ResolveApiKey(entry.ApiKeyEncrypted);
        var http = _httpClientFactory.CreateClient("ai");
        var generator = new ImageGenerator(http, entry.BaseUrl ?? "", apiKey ?? "", entry.ModelId ?? "", entry.TimeoutSeconds);
        return new ResolvedImage(generator, entry.Key, entry.ModelId ?? "");
    }
}
