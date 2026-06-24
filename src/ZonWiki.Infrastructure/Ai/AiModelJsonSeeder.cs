using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Infrastructure.Ai;

/// <summary>
/// 啟動時的「AI 模型設定檔」種子器（取代開問啦原本啟動讀 ai-models.json 的行為）。
///
/// 為什麼存在：本系統以「資料庫為唯一真相」，AI 模型存在 <see cref="AiModel"/> 表。
/// 但「全新 clone 下來的人」資料庫是空的、沒有任何模型，於是筆記排版/美化、開問啦節點對話等
/// AI 功能會「靜默失敗」。為了讓開源使用者能一鍵就有可用的「共用預設模型」，
/// 啟動時若存在 <c>ai-models.json</c>（已 gitignore、不含於公開 repo），就把其中的模型「補種」進 DB。
///
/// 設計重點（安全 / 冪等）：
/// - **檔案不存在 → 直接略過**（不是錯誤），對既有環境零影響。
/// - **以 (UserId, Key) 判斷是否已存在；已存在則「跳過、不覆寫」**——避免蓋掉使用者在「設定頁」手改的金鑰。
/// - <c>isDefault: true</c> 的模型以「系統身分」(<see cref="AiProviderFactory.SharedModelUserId"/>) 植入一份，
///   不屬於任何使用者、不出現在任何人的設定頁，只作為「所有人共用的預設模型」。
/// - 其餘模型掛到「第一位使用者」名下（通常是開發 seed 使用者）；若尚無使用者則略過。
/// - 金鑰一律以 Data Protection 加密存入 <see cref="AiModel.ApiKeyEncrypted"/>；
///   值可為 <c>${ENV_VAR}</c> 佔位，執行時由 <see cref="AiModelResolver"/> 以環境變數解析
///   （故 repo 內的範本可寫 <c>${GEMINI_API_KEY}</c>，金鑰本身不落地於檔案）。
/// - 任何解析/寫入錯誤都「記錄但不拋出」——設定檔壞掉不該讓整個 API 啟動失敗。
/// </summary>
public static class AiModelJsonSeeder
{
    /// <summary>
    /// 設定檔內單一模型的形狀（與 ai-models.example.json 對應；大小寫不敏感解析）。
    /// </summary>
    private sealed record SeedModel(
        string? Key,
        string? Label,
        string? Provider,
        string? Kind,
        string? ModelId,
        string? BaseUrl,
        string? ApiKey,
        bool? IsDefault,
        bool? Enabled,
        int? TimeoutSeconds,
        string? Notes);

    /// <summary>
    /// 設定檔根結構：<c>{ "models": [ … ] }</c>。
    /// </summary>
    private sealed record SeedFile(List<SeedModel>? Models);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
    };

    /// <summary>
    /// 從指定路徑的 <c>ai-models.json</c> 補種模型到 DB（冪等、安全）。
    /// </summary>
    /// <param name="db">資料庫內容。</param>
    /// <param name="protectionProvider">Data Protection 提供者（加密金鑰用）。</param>
    /// <param name="logger">記錄器。</param>
    /// <param name="filePath">設定檔絕對路徑（通常為 API 內容根目錄下的 ai-models.json）。</param>
    /// <param name="ct">取消權杖。</param>
    public static async Task SeedAsync(
        ZonWikiDbContext db,
        IDataProtectionProvider protectionProvider,
        ILogger logger,
        string filePath,
        CancellationToken ct = default)
    {
        try
        {
            if (!File.Exists(filePath))
            {
                logger.LogInformation(
                    "未找到 ai-models.json（{Path}）：略過 AI 模型種子。" +
                    "若要啟用共用預設模型，請複製 ai-models.example.json 為 ai-models.json 並填入金鑰，" +
                    "或登入後到「設定 → AI 模型管理」自行新增。",
                    filePath);
                return;
            }

            var json = await File.ReadAllTextAsync(filePath, ct);
            var parsed = JsonSerializer.Deserialize<SeedFile>(json, JsonOptions);
            var models = parsed?.Models;
            if (models is null || models.Count == 0)
            {
                logger.LogInformation("ai-models.json 內無模型項目：略過。");
                return;
            }

            var protector = protectionProvider.CreateProtector("ZonWiki.AiModel.ApiKey");

            // 非共用模型要掛到的擁有者（第一位使用者；通常是開發 seed 使用者）。
            var firstUserId = await db.User
                .OrderBy(u => u.CreatedDateTime)
                .Select(u => (Guid?)u.Id)
                .FirstOrDefaultAsync(ct);

            var seeded = 0;
            var skipped = 0;

            foreach (var model in models)
            {
                var key = (model.Key ?? "").Trim();
                if (string.IsNullOrEmpty(key))
                {
                    continue; // 無 Key 無法識別，跳過。
                }

                var isDefault = model.IsDefault ?? false;
                var ownerUserId = isDefault ? AiProviderFactory.SharedModelUserId : firstUserId;
                if (ownerUserId is null)
                {
                    // 非共用模型但尚無任何使用者可掛載 → 略過（不影響共用預設）。
                    logger.LogInformation("略過模型 {Key}：尚無使用者可作為擁有者。", key);
                    continue;
                }

                // 以 (UserId, Key) 判斷是否已存在（含軟刪除列；shared 列被全域過濾，必須 IgnoreQueryFilters）。
                var exists = await db.AiModel
                    .IgnoreQueryFilters()
                    .AnyAsync(m => m.UserId == ownerUserId.Value && m.Key == key, ct);
                if (exists)
                {
                    skipped++;
                    continue; // 已存在 → 不覆寫（避免蓋掉使用者在設定頁手改的金鑰）。
                }

                // 金鑰加密；允許空（如 ClaudeCli 免金鑰）。可為 ${ENV} 佔位（執行時由 resolver 取環境變數）。
                var apiKey = model.ApiKey;
                var apiKeyEncrypted = string.IsNullOrWhiteSpace(apiKey)
                    ? null
                    : protector.Protect(apiKey);

                db.AiModel.Add(new AiModel
                {
                    UserId = ownerUserId.Value,
                    Key = key,
                    Label = string.IsNullOrWhiteSpace(model.Label) ? key : model.Label.Trim(),
                    Provider = string.IsNullOrWhiteSpace(model.Provider) ? "OpenAiCompatible" : model.Provider.Trim(),
                    Kind = string.IsNullOrWhiteSpace(model.Kind) ? "chat" : model.Kind.Trim(),
                    ModelId = model.ModelId,
                    BaseUrl = model.BaseUrl,
                    ApiKeyEncrypted = apiKeyEncrypted,
                    Enabled = model.Enabled ?? true,
                    TimeoutSeconds = model.TimeoutSeconds ?? 300,
                    Notes = model.Notes,
                    CreatedUser = "system-seed",
                    UpdatedUser = "system-seed",
                });
                seeded++;
            }

            if (seeded > 0)
            {
                await db.SaveChangesAsync(ct);
            }

            logger.LogInformation(
                "AI 模型種子完成：新增 {Seeded} 筆、跳過（已存在）{Skipped} 筆。",
                seeded,
                skipped);
        }
        catch (Exception ex)
        {
            // 設定檔壞掉不該讓 API 起不來：記錄錯誤、繼續啟動。
            logger.LogError(ex, "讀取/種子 ai-models.json 失敗（{Path}）；已略過。", filePath);
        }
    }
}
