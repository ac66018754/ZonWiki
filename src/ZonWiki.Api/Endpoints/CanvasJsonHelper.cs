using System.Text.Json;
using System.Text.Json.Serialization;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// Canvas 端點專用的 JSON 序列化設定助手
/// 所有 Canvas 回應必須使用 PascalCase 欄位名稱（與前端期望一致）
/// </summary>
public static class CanvasJsonHelper
{
    /// <summary>
    /// 建立 Canvas 專用的 JSON 序列化選項（PascalCase，無命名策略）
    /// </summary>
    public static JsonSerializerOptions GetCanvasJsonOptions()
    {
        return new JsonSerializerOptions
        {
            PropertyNamingPolicy = null, // PascalCase（保留原始屬性名稱）
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
            WriteIndented = false,
        };
    }

    /// <summary>
    /// 用 Canvas 專用設定序列化 API 回應
    /// 確保所有欄位名稱都是 PascalCase（不套用任何命名策略）
    /// </summary>
    /// <typeparam name="T">回應資料型別</typeparam>
    /// <param name="response">API 回應物件</param>
    /// <returns>序列化結果，用於 Results.Json()</returns>
    public static IResult JsonOk<T>(T response, int statusCode = StatusCodes.Status200OK)
    {
        return Results.Json(
            response,
            options: GetCanvasJsonOptions(),
            statusCode: statusCode);
    }

    /// <summary>
    /// 用 Canvas 專用設定序列化錯誤回應
    /// </summary>
    public static IResult JsonError<T>(T response, int statusCode = StatusCodes.Status400BadRequest)
    {
        return Results.Json(
            response,
            options: GetCanvasJsonOptions(),
            statusCode: statusCode);
    }
}
