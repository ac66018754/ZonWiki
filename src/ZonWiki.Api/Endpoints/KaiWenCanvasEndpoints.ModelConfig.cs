using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 開問啦畫布端點——AI 模型：節點下拉可用模型清單、模型設定（含金鑰）CRUD、以及健檢 no-op。
/// </summary>
public static partial class KaiWenCanvasEndpoints
{
    /// <summary>
    /// 列出節點下拉可用的 AI 模型：本使用者已啟用的模型 ∪ 全站共用預設（後者標「（預設）」）。
    /// 共用列（<see cref="ZonWiki.Infrastructure.Ai.AiProviderFactory.SharedModelUserId"/>，…a1）會被全域查詢過濾器
    /// 擋掉，故用 IgnoreQueryFilters + 明確 UserId（與 AiProviderFactory.ResolveAsync 同理）。
    /// AiModelDto 不含金鑰欄位 → 共用列金鑰永不外洩；設定頁走 GetModelsConfig（只撈本人）→ 共用列不出現在設定頁、不可被誤刪。
    /// </summary>
    private static async Task<IResult> ListModels(
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<List<AiModelDto>>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        var sharedUserId = ZonWiki.Infrastructure.Ai.AiProviderFactory.SharedModelUserId;
        var rows = await db.AiModel
            .IgnoreQueryFilters()
            .Where(m => m.ValidFlag && m.Enabled
                && (m.UserId == currentUser.UserId || m.UserId == sharedUserId))
            .ToListAsync(ct);

        var models = rows
            .OrderByDescending(m => m.UserId == sharedUserId)   // 共用預設排最前
            .ThenBy(m => m.Label)
            .Select(m => new AiModelDto(
                m.Key,
                m.UserId == sharedUserId ? $"{m.Label}（預設）" : m.Label,
                m.Provider,
                m.Kind,
                m.ModelId,
                m.Notes))
            .ToList();

        return CanvasJsonHelper.JsonOk(ApiResponse<List<AiModelDto>>.Ok(models));
    }

    /// <summary>
    /// 取得目前使用者的所有 AI 模型設定（含停用的）。
    /// API 金鑰絕不回傳明碼：若存在回 "********"，否則 null。
    /// 依 Label 排序。
    /// </summary>
    private static async Task<IResult> GetModelsConfig(
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<List<AiModelConfigDto>>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        // 查詢該使用者的所有 AiModel（含停用的）
        var models = await db.AiModel
            .Where(m => m.UserId == currentUser.UserId && m.ValidFlag)
            .OrderBy(m => m.Label)
            .Select(m => new AiModelConfigDto(
                m.Key,
                m.Label,
                m.Provider,
                m.Kind,
                m.Enabled,
                m.ModelId,
                m.BaseUrl,
                // 金鑰遮罩：有值回 "********"，否則 null
                m.ApiKeyEncrypted != null ? "********" : null,
                m.TimeoutSeconds,
                m.Notes))
            .ToListAsync(ct);

        return CanvasJsonHelper.JsonOk(ApiResponse<List<AiModelConfigDto>>.Ok(models));
    }

    /// <summary>
    /// 儲存 AI 模型設定（upsert by Key + 刪除不在清單內的模型）。
    /// 金鑰規則：若傳入 ApiKey 非空白「且」不等於 "********" → 加密寫入；
    /// 若為 "********" 或空 → 保留原 ApiKeyEncrypted 不動；
    /// 若完全刪除（傳入空物件）→ 設為 null。
    /// 該使用者不在傳入清單 Key 的 AiModel 視為軟刪除（ValidFlag = false）。
    /// 最後重新查詢並回傳最新設定。
    /// </summary>
    private static async Task<IResult> SaveModelsConfig(
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        SaveModelsConfigRequest req,
        IDataProtectionProvider protectionProvider,
        ILoggerFactory loggerFactory,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<List<AiModelConfigDto>>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        if (req.Models == null)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<List<AiModelConfigDto>>.Fail("Models list is required"),
                StatusCodes.Status400BadRequest);
        }

        // 建立加密工具
        var protector = protectionProvider.CreateProtector("ZonWiki.AiModel.ApiKey");

        try
        {
            // 蒐集傳入的 Key 集合
            var incomingKeys = new HashSet<string>(req.Models.Select(m => m.Key));

            // Step 1: 處理現有模型與新增模型（upsert）
            foreach (var configDto in req.Models)
            {
                // 驗證必填欄位
                if (string.IsNullOrWhiteSpace(configDto.Key) || string.IsNullOrWhiteSpace(configDto.Label))
                {
                    return CanvasJsonHelper.JsonError(
                        ApiResponse<List<AiModelConfigDto>>.Fail("Key and Label are required for all models"),
                        StatusCodes.Status400BadRequest);
                }

                // 伺服器端 Provider 白名單（安全鐵則）：使用者只能設定 OpenAiCompatible／ClaudeCli。
                // VertexAdc 會以真實 GCP ADC token 當 Bearer（見 AiProviderFactory 的 VertexAdc 分支），
                // 若讓使用者自建即可把系統憑證導向自控端點竊取，故一律只由系統（ai-models.json 種子、
                // 以共用身分）設定；收到 "VertexAdc" 或任何未知值一律 400，且此檢查在任何 SaveChanges 之前
                // 就 return（DbContext 為請求範圍、未存檔的追蹤變更會隨之丟棄，不會有半套寫入）。
                if (!IsUserSettableProvider(configDto.Provider))
                {
                    return CanvasJsonHelper.JsonError(
                        ApiResponse<List<AiModelConfigDto>>.Fail(
                            $"不支援的供應者類型：'{configDto.Provider}'。" +
                            "此供應者類型僅能由系統設定（合法值：OpenAiCompatible／ClaudeCli）。"),
                        StatusCodes.Status400BadRequest);
                }

                // 以 (UserId, Key) 查找既有記錄。用 IgnoreQueryFilters 才能找到「曾被軟刪除」的同 Key 列
                // 以便復活——否則全域過濾(ValidFlag==true)看不到它 → 誤走新增 → 撞 (UserId,Key) 唯一索引(23505)。
                var existingModel = await db.AiModel.IgnoreQueryFilters()
                    .FirstOrDefaultAsync(
                        m => m.UserId == currentUser.UserId && m.Key == configDto.Key,
                        ct);

                string? encryptedApiKey = null;

                if (existingModel == null)
                {
                    // 新增模型
                    // 處理 API 金鑰加密
                    if (!string.IsNullOrWhiteSpace(configDto.ApiKey) && configDto.ApiKey != "********")
                    {
                        encryptedApiKey = protector.Protect(configDto.ApiKey);
                    }

                    var newModel = new AiModel
                    {
                        Id = Guid.NewGuid(),
                        UserId = currentUser.UserId,
                        Key = configDto.Key,
                        Label = configDto.Label,
                        Provider = configDto.Provider,
                        Kind = configDto.Kind,
                        Enabled = configDto.Enabled,
                        ModelId = configDto.ModelId,
                        BaseUrl = configDto.BaseUrl,
                        ApiKeyEncrypted = encryptedApiKey,
                        TimeoutSeconds = configDto.TimeoutSeconds,
                        Notes = configDto.Notes,
                    };
                    db.AiModel.Add(newModel);
                }
                else
                {
                    // 編輯既有模型（若曾被軟刪除則一併復活）
                    existingModel.ValidFlag = true;
                    existingModel.DeletedDateTime = null;
                    existingModel.Label = configDto.Label;
                    existingModel.Provider = configDto.Provider;
                    existingModel.Kind = configDto.Kind;
                    existingModel.Enabled = configDto.Enabled;
                    existingModel.ModelId = configDto.ModelId;
                    existingModel.BaseUrl = configDto.BaseUrl;
                    existingModel.TimeoutSeconds = configDto.TimeoutSeconds;
                    existingModel.Notes = configDto.Notes;

                    // 處理 API 金鑰更新邏輯
                    if (!string.IsNullOrWhiteSpace(configDto.ApiKey))
                    {
                        if (configDto.ApiKey != "********")
                        {
                            // 傳入新金鑰 → 加密更新
                            encryptedApiKey = protector.Protect(configDto.ApiKey);
                            existingModel.ApiKeyEncrypted = encryptedApiKey;
                        }
                        // 若為 "********" → 保留原值，不動 ApiKeyEncrypted
                    }
                    else
                    {
                        // 傳入空 → 清空金鑰
                        existingModel.ApiKeyEncrypted = null;
                    }

                    db.AiModel.Update(existingModel);
                }
            }

            // Step 2: 軟刪除不在清單內的模型
            var modelsToDelete = await db.AiModel
                .Where(m => m.UserId == currentUser.UserId && m.ValidFlag && !incomingKeys.Contains(m.Key))
                .ToListAsync(ct);

            foreach (var model in modelsToDelete)
            {
                model.ValidFlag = false;
                model.DeletedDateTime = DateTime.UtcNow;
                db.AiModel.Update(model);
            }

            // 保存所有變更
            await db.SaveChangesAsync(ct);

            // Step 3: 重新查詢並回傳最新設定
            var updatedModels = await db.AiModel
                .Where(m => m.UserId == currentUser.UserId && m.ValidFlag)
                .OrderBy(m => m.Label)
                .Select(m => new AiModelConfigDto(
                    m.Key,
                    m.Label,
                    m.Provider,
                    m.Kind,
                    m.Enabled,
                    m.ModelId,
                    m.BaseUrl,
                    m.ApiKeyEncrypted != null ? "********" : null,
                    m.TimeoutSeconds,
                    m.Notes))
                .ToListAsync(ct);

            return CanvasJsonHelper.JsonOk(ApiResponse<List<AiModelConfigDto>>.Ok(updatedModels));
        }
        catch (Exception ex)
        {
            // 安全：完整例外只記在 server 端（可能含 SQL 片段/約束名等內部細節），
            // 對前端只回固定友善訊息＋500（內部失敗非使用者輸入錯誤，不應回 400）。
            loggerFactory.CreateLogger("SaveModelsConfig")
                .LogError(ex, "儲存 AI 模型設定失敗（UserId={UserId}）", currentUser.UserId);
            return CanvasJsonHelper.JsonError(
                ApiResponse<List<AiModelConfigDto>>.Fail("儲存 AI 模型設定失敗，請稍後再試。"),
                StatusCodes.Status500InternalServerError);
        }
    }

    /// <summary>
    /// 使用者可自行設定（PUT /models-config）的 AI 供應者白名單：僅 <c>OpenAiCompatible</c> 與 <c>ClaudeCli</c>。
    /// 「以系統憑證認證」的供應者（如 VertexAdc 用 ADC token）不在此列，只能由系統以共用身分設定，
    /// 避免使用者自建後把系統憑證導向自控端點（見 <see cref="ZonWiki.Infrastructure.Ai.AiProviderFactory"/> 的 VertexAdc 分支）。
    /// </summary>
    /// <param name="provider">請求傳入的供應者字串（可空）。</param>
    /// <returns>屬於使用者可設定的白名單時為 true；空／未知／VertexAdc 皆為 false。</returns>
    private static bool IsUserSettableProvider(string? provider)
        => string.Equals(provider, "OpenAiCompatible", StringComparison.OrdinalIgnoreCase)
            || string.Equals(provider, "ClaudeCli", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// 取得 AI 模型健檢狀態。本版不執行真實連線檢查，回傳安全預設值以避免前端 404。
    /// 返回 { Enabled: false, Results: [] }。
    /// </summary>
    private static async Task<IResult> GetHealth(
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<HealthStateDto>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        // 本版不做真實檢查，回傳安全預設值
        var healthState = new HealthStateDto(
            Enabled: false,
            Results: new List<ModelHealthDto>());

        return CanvasJsonHelper.JsonOk(ApiResponse<HealthStateDto>.Ok(healthState));
    }

    /// <summary>
    /// 設定 AI 模型健檢的啟用狀態。本版不持久化，echo 回傳請求值以避免前端 404。
    /// </summary>
    private static async Task<IResult> SetHealthEnabled(
        ICurrentUser currentUser,
        SetHealthEnabledRequest req,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<object>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        // 本版不持久化，只 echo 回傳
        return CanvasJsonHelper.JsonOk(ApiResponse<object>.Ok(new { Enabled = req.Enabled }));
    }

    /// <summary>
    /// 執行 AI 模型健檢。本版不實際檢查，回傳 Ok no-op 以避免前端 404。
    /// </summary>
    private static async Task<IResult> CheckHealth(
        ICurrentUser currentUser,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<object>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        // 本版不做真實檢查，只回 Ok
        return CanvasJsonHelper.JsonOk(ApiResponse<object>.Ok(new { }));
    }
}
