using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ZonWiki.Domain.Entities;
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

    /// <summary>
    /// 全站共用「banana」Gemini relay 模型的穩定鍵。作為後援鏈第 3 棒，也是「單一共用預設」（非鏈路徑的退路）。
    /// </summary>
    public const string SharedDefaultModelKey = "banana-gemini-lite";

    /// <summary>
    /// 全站共用「Google AI Studio（Gemini 直連，lite）」模型的穩定鍵。作為後援鏈第 2 棒。
    /// </summary>
    public const string SharedAiStudioModelKey = "google-aistudio-lite";

    /// <summary>
    /// 後援鏈第 1 棒：本機 claude CLI 的顯示名稱。
    /// </summary>
    public const string ClaudeLinkLabel = "Claude CLI";

    private readonly IAiProvider _default;
    private readonly ZonWikiDbContext _db;
    private readonly AiModelResolver _resolver;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IVertexAdcTokenProvider? _vertexTokenProvider;

    /// <summary>
    /// 建立供應者工廠。
    /// </summary>
    /// <param name="defaultProvider">預設供應者（正式為本機 claude CLI；測試為 <see cref="FakeAiProvider"/>）。</param>
    /// <param name="db">資料庫內容（讀取使用者 AiModel 設定）。</param>
    /// <param name="resolver">金鑰解析器（解密／環境變數替換）。</param>
    /// <param name="httpClientFactory">HTTP 用戶端工廠（建立 OpenAI 相容 provider）。</param>
    /// <param name="vertexTokenProvider">
    /// VertexAdc 的 ADC access token 提供者（選填）。DI 有註冊則自動注入；
    /// 選填設計是為了不破壞既有 <c>new AiProviderFactory(a,b,c,d)</c> 的測試呼叫。
    /// 解析 VertexAdc 供應者卻未提供時，會退回一個預設實例（以真實 ADC 取 token）。
    /// </param>
    public AiProviderFactory(
        IAiProvider defaultProvider,
        ZonWikiDbContext db,
        AiModelResolver resolver,
        IHttpClientFactory httpClientFactory,
        IVertexAdcTokenProvider? vertexTokenProvider = null)
    {
        _default = defaultProvider;
        _db = db;
        _resolver = resolver;
        _httpClientFactory = httpClientFactory;
        _vertexTokenProvider = vertexTokenProvider;
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
        //
        // 查找範圍同時涵蓋「呼叫者自己的列」與「系統共用身分（SharedModelUserId）的列」：
        // - 必要性：VertexAdc 這種「系統專屬供應者」的列只存在於 SharedModelUserId 名下
        //   （見 SaveModelsConfig 白名單擋掉使用者自建 VertexAdc），故指定 modelKey（如記帳的
        //   Expense:VertexModelKey）時必須能讀到共用列，否則記帳解析永遠找不到 Vertex 列。
        // - 安全性：查詢仍鎖在 (userId 或 SharedModelUserId)，只「讀」系統共用列，不會把某使用者的
        //   私有列洩漏給另一使用者（每個呼叫只帶自己的 userId）。
        // - 決定性：以「呼叫者自己的列優先於共用列」排序後取第一筆，避免 FirstOrDefault 在
        //   同鍵的自有列與共用列之間非決定性漂移（例如攻擊者刻意用共用鍵在自己名下建列時，
        //   必定先命中自有列 → 後續 VertexAdc 分支據 UserId 判定並擋下）。
        var entry = string.IsNullOrWhiteSpace(modelKey)
            ? null
            : await _db.AiModel.IgnoreQueryFilters()
                .Where(m => (m.UserId == userId || m.UserId == SharedModelUserId)
                    && m.Enabled
                    && m.Key == modelKey)
                .OrderByDescending(m => m.UserId == userId)
                .FirstOrDefaultAsync(cancellationToken);

        // 未指定模型（「預設」），或指定的鍵找不到/已停用 → 改用「全站共用預設模型」
        // （系統擁有、設定頁隱藏、金鑰只存一份）。讓所有人免設定即可使用預設。
        // 明確優先 banana 鍵：自從加入 Google AI Studio 共用列後，SharedModelUserId 底下可能有多筆，
        // 不能用非決定性的「取第一筆」，否則此單一退路會在 banana / AI Studio 間漂移。
        if (entry is null)
        {
            entry = await _db.AiModel.IgnoreQueryFilters()
                .FirstOrDefaultAsync(m => m.UserId == SharedModelUserId && m.Enabled && m.Key == SharedDefaultModelKey, cancellationToken)
                ?? await _db.AiModel.IgnoreQueryFilters()
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

        if (string.Equals(entry.Provider, "VertexAdc", StringComparison.OrdinalIgnoreCase))
        {
            // 安全鐵則（防 ADC token 外流）：VertexAdc 分支會以「真實 GCP ADC access token」
            //（cloud-platform scope、可存取整個專案）當 Bearer 送到 BaseUrl。若允許任何登入者在自己名下
            // 建 VertexAdc 列，攻擊者即可把這顆系統 token 導向自控端點竊取。
            // 故此分支「只允許系統共用身分（SharedModelUserId）名下的列」；一般使用者名下的 VertexAdc 列
            // 一律拒絕（且 SaveModelsConfig 已於伺服器端擋掉使用者建立 VertexAdc，此為第二道防線）。
            if (entry.UserId != SharedModelUserId)
            {
                throw new InvalidOperationException(
                    "VertexAdc 供應者僅能由系統共用身分設定，" +
                    "不接受一般使用者名下的 VertexAdc 列（安全限制：避免 ADC token 被導向外部端點竊取）。");
            }

            // VertexAdc 專屬 BaseUrl 白名單：不只沿用一般 IsBaseUrlSafe（那只擋私網／metadata，仍放行任意公網域）。
            // 這裡帶的是系統憑證，故必須嚴格限定為 Vertex AI 官方端點（aiplatform.googleapis.com 或帶
            // region 前綴的 *-aiplatform.googleapis.com），且 scheme=https；否則拋錯。
            var baseUrl = entry.BaseUrl?.Trim() ?? "";
            if (!IsVertexBaseUrlAllowed(baseUrl))
            {
                throw new InvalidOperationException(
                    $"無效或不安全的 VertexAdc BaseUrl：'{baseUrl}'。" +
                    "必須是 Vertex AI 官方端點（https://aiplatform.googleapis.com 或 https://<region>-aiplatform.googleapis.com）。");
            }

            // 差異僅「靜態金鑰 vs 一小時過期的 ADC token」：取一次 ADC token 當作 Bearer 傳給
            // 既有 OpenAI 相容 provider（provider 本體零改動）。ADC 不可用時 token provider 會拋
            // 明確例外（引導跑 gcloud auth application-default login），交由上層走保底路。
            var tokenProvider = _vertexTokenProvider ?? new VertexAdcTokenProvider();
            var accessToken = await tokenProvider.GetAccessTokenAsync(cancellationToken);

            var http = _httpClientFactory.CreateClient("ai");
            var provider = new OpenAiCompatibleStreamingProvider(
                http, baseUrl, accessToken, entry.ModelId ?? "", entry.TimeoutSeconds);
            return new ResolvedProvider(provider, entry.ModelId, SupportsResume: false);
        }

        if (string.Equals(entry.Provider, "ClaudeCli", StringComparison.OrdinalIgnoreCase))
        {
            // ClaudeCli → 用預設 claude 供應者，帶該項 ModelId 作為 --model。
            var claudeModel = string.IsNullOrWhiteSpace(entry.ModelId) ? null : entry.ModelId;
            return new ResolvedProvider(_default, claudeModel, SupportsResume: true);
        }

        // 未知 Provider 類型：一律拋錯，「不得靜默退回預設 Claude」（設計書 §1.2）——
        // 否則 DB 設定打錯字或漏接分支，會整批靜默走 Claude CLI（不吃 credits 也無人察覺）。
        throw new InvalidOperationException(
            $"未知的 AI 供應者類型：'{entry.Provider}'（合法值：ClaudeCli／OpenAiCompatible／VertexAdc）。");
    }

    /// <summary>
    /// 解析「全站共用」的後援鏈（所有使用者一致）：①Claude CLI ②Google AI Studio lite ③banana。
    /// 用於「會走共用預設」的所有路徑（筆記問答/美化/排版、精煉 note-gen、開問啦未選模型）；
    /// 「明確選定特定模型」的路徑仍用 <see cref="ResolveAsync"/>（單一供應者、不走鏈）。
    /// 任一家缺設定/金鑰/不安全 → 自動略過該家（鏈自動縮短，不報錯）；至少會有 Claude 一棒。
    /// </summary>
    /// <param name="claudeModel">
    /// 指定 claude CLI（第 1 棒）要用的模型（如 "sonnet"／"haiku"，對應 --model）。
    /// null 表示用 settings.json 的預設（目前 sonnet）。保留「不同功能可傳不同值」的彈性
    /// （目前排版/美化/問答皆傳 sonnet）。只影響 claude 這一棒；後面 Google AI Studio／banana 仍用各自 DB 設定的模型。
    /// </param>
    /// <param name="cancellationToken">取消權杖。</param>
    /// <returns>以 <see cref="FallbackChainProvider"/> 包裝的有序鏈；測試模式回單一 Fake。</returns>
    public async Task<ResolvedProvider> ResolveChainAsync(
        string? claudeModel = null,
        CancellationToken cancellationToken = default)
    {
        // 測試模式：固定用 Fake，忽略鏈，確保 E2E 穩定。
        if (_default is FakeAiProvider)
        {
            return new ResolvedProvider(_default, null, SupportsResume: true);
        }

        var links = new List<ChainLink>
        {
            // 第 1 棒：本機 claude CLI。claudeModel=null → 用 settings.json 預設（sonnet）；
            // 傳入 "haiku"/"sonnet" 則以 --model 覆寫（依功能分派，見參數說明）。
            new(ClaudeLinkLabel, _default, string.IsNullOrWhiteSpace(claudeModel) ? null : claudeModel),
        };

        // 第 2 棒：Google AI Studio（Gemini 直連，lite）共用列。
        var aiStudio = await _db.AiModel.IgnoreQueryFilters()
            .FirstOrDefaultAsync(
                m => m.UserId == SharedModelUserId && m.Enabled && m.Key == SharedAiStudioModelKey,
                cancellationToken);
        if (aiStudio is not null
            && string.Equals(aiStudio.Provider, "OpenAiCompatible", StringComparison.OrdinalIgnoreCase))
        {
            var provider = TryBuildOpenAiCompatible(aiStudio);
            if (provider is not null)
            {
                links.Add(new ChainLink("Google AI Studio", provider, aiStudio.ModelId));
            }
        }

        // 第 3 棒：banana（既有共用預設 Gemini relay）。
        var banana = await _db.AiModel.IgnoreQueryFilters()
            .FirstOrDefaultAsync(
                m => m.UserId == SharedModelUserId && m.Enabled && m.Key == SharedDefaultModelKey,
                cancellationToken);
        if (banana is not null
            && string.Equals(banana.Provider, "OpenAiCompatible", StringComparison.OrdinalIgnoreCase))
        {
            var provider = TryBuildOpenAiCompatible(banana);
            if (provider is not null)
            {
                links.Add(new ChainLink("banana", provider, banana.ModelId));
            }
        }

        var chain = new FallbackChainProvider(links);
        return new ResolvedProvider(chain, null, SupportsResume: false);
    }

    /// <summary>
    /// 嘗試以一筆 OpenAiCompatible 的 <see cref="AiModel"/> 設定建立串流供應者。
    /// 與 <see cref="ResolveAsync"/> 不同：不安全 / 缺金鑰時「回 null」（讓後援鏈略過該家）而非拋例外。
    /// </summary>
    /// <param name="entry">OpenAiCompatible 模型設定。</param>
    /// <returns>建好的供應者；BaseUrl 不安全或金鑰無法解析時為 null。</returns>
    private OpenAiCompatibleStreamingProvider? TryBuildOpenAiCompatible(AiModel entry)
    {
        var baseUrl = entry.BaseUrl?.Trim() ?? "";
        if (string.IsNullOrEmpty(baseUrl) || !IsBaseUrlSafe(baseUrl))
        {
            return null;
        }

        var apiKey = _resolver.ResolveApiKey(entry.ApiKeyEncrypted);
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            // 金鑰無法解析（未設環境變數 / 解密失敗）→ 略過該家，由後援鏈換下一棒。
            return null;
        }

        var http = _httpClientFactory.CreateClient("ai");
        return new OpenAiCompatibleStreamingProvider(
            http, baseUrl, apiKey, entry.ModelId ?? "", entry.TimeoutSeconds);
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

    /// <summary>Vertex AI 官方 OpenAI 相容端點的主機名（全域）。</summary>
    private const string VertexOfficialHost = "aiplatform.googleapis.com";

    /// <summary>
    /// VertexAdc 專屬 BaseUrl 白名單檢查（比 <see cref="IsBaseUrlSafe"/> 更嚴）：
    /// 只允許 Vertex AI 官方端點且 scheme=https。host 必須等於 <c>aiplatform.googleapis.com</c>，
    /// 或匹配 <c>&lt;region&gt;-aiplatform.googleapis.com</c>（region 前綴，如 us-central1-aiplatform.googleapis.com）。
    /// 之所以更嚴：此路徑帶的是可存取整個 GCP 專案的 ADC token，不能像一般供應者那樣放行任意公網域。
    /// 由於官方主機皆位於 Google 掌控的 googleapis.com 之下，攻擊者無法註冊符合此白名單的主機。
    /// </summary>
    /// <param name="baseUrl">待檢查的 BaseUrl。</param>
    /// <returns>是 Vertex AI 官方 https 端點時為 true。</returns>
    private static bool IsVertexBaseUrlAllowed(string baseUrl)
    {
        if (string.IsNullOrEmpty(baseUrl) || !Uri.TryCreate(baseUrl, UriKind.Absolute, out var uri))
        {
            return false;
        }

        if (uri.Scheme != "https")
        {
            return false;
        }

        var host = uri.Host.ToLowerInvariant();

        // 全域端點：aiplatform.googleapis.com；區域端點：<region>-aiplatform.googleapis.com。
        // 要求 region 前綴後必接「-aiplatform.googleapis.com」，可擋掉如 aiplatform.googleapis.com.evil.com
        //（結尾為 .evil.com，兩條件皆不成立）與無 dash 分隔的混淆主機。
        return host == VertexOfficialHost
            || host.EndsWith("-" + VertexOfficialHost, StringComparison.Ordinal);
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
