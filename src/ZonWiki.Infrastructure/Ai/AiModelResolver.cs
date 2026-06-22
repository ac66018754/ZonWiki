using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Infrastructure.Ai;

/// <summary>
/// AI 模型解析器：從 DB 讀取使用者設定的 AI 模型，解析 API 金鑰（含加密/環境變數替換）。
/// </summary>
public sealed class AiModelResolver
{
    private readonly ZonWikiDbContext _db;
    private readonly IDataProtectionProvider _protectionProvider;
    private readonly ILogger<AiModelResolver> _logger;

    /// <summary>
    /// 建立模型解析器。
    /// </summary>
    public AiModelResolver(
        ZonWikiDbContext db,
        IDataProtectionProvider protectionProvider,
        ILogger<AiModelResolver> logger)
    {
        _db = db;
        _protectionProvider = protectionProvider;
        _logger = logger;
    }

    /// <summary>
    /// 解析 API 金鑰：若為加密值則解密、若為環境變數佔位（${NAME}）則替換、否則直接回傳。
    /// 若加密值無法解密（可能是金鑰輪換、損壞資料或錯誤的 Data Protection 金鑰），記錄錯誤並回傳 null。
    /// </summary>
    public string? ResolveApiKey(string? encryptedOrPlain)
    {
        if (string.IsNullOrWhiteSpace(encryptedOrPlain))
        {
            return null;
        }

        string decrypted;
        try
        {
            var protector = _protectionProvider.CreateProtector("ZonWiki.AiModel.ApiKey");
            decrypted = protector.Unprotect(encryptedOrPlain);
        }
        catch (Exception ex)
        {
            // 解密失敗：區分是明碼或真的加密失敗。
            // 若值看起來像加密過的（長度 > 50, 包含非 ASCII），記錄失敗；
            // 否則當作明碼處理（向下相容舊設定）。
            if (encryptedOrPlain.Length > 50 || encryptedOrPlain.Any(c => c > 127))
            {
                _logger.LogError(
                    ex,
                    "Failed to decrypt API key: possible key rotation, corrupted data, or Data Protection key mismatch");
                return null;
            }

            // 短字串且都是 ASCII 字元，可能是未加密的明碼，嘗試繼續。
            _logger.LogDebug("Decryption failed but value looks like plain text, treating as unencrypted");
            decrypted = encryptedOrPlain;
        }

        // 支援環境變數佔位：${ENV_VAR_NAME}。
        if (decrypted.StartsWith("${") && decrypted.EndsWith("}"))
        {
            var varName = decrypted[2..^1];
            var envValue = Environment.GetEnvironmentVariable(varName);
            if (string.IsNullOrEmpty(envValue))
            {
                _logger.LogWarning(
                    "Environment variable '{VariableName}' referenced in API key config but not set",
                    varName);
                return null; // 環境變數不存在，回傳 null 而非佔位符本身
            }
            return envValue;
        }

        return decrypted;
    }

    /// <summary>
    /// 加密 API 金鑰以存入 DB（可逆加密，非雜湊）。
    /// </summary>
    public string EncryptApiKey(string plainApiKey)
    {
        if (string.IsNullOrWhiteSpace(plainApiKey))
        {
            return string.Empty;
        }

        var protector = _protectionProvider.CreateProtector("ZonWiki.AiModel.ApiKey");
        return protector.Protect(plainApiKey);
    }
}
