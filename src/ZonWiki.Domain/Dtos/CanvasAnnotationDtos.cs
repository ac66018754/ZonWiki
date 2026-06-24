namespace ZonWiki.Domain.Dtos;

/// <summary>
/// 畫布標註資料傳輸物件（清單與詳情用）。
/// 欄位名稱遵循 {Table}_{Field} 命名規範，對應前端期望的 PascalCase（PropertyNamingPolicy=null 序列化）。
/// </summary>
/// <param name="CanvasAnnotation_Id">標註識別碼。</param>
/// <param name="CanvasAnnotation_Kind">型別：sticky / drawing / slide。</param>
/// <param name="CanvasAnnotation_X">左上 X（畫布座標）。</param>
/// <param name="CanvasAnnotation_Y">左上 Y（畫布座標）。</param>
/// <param name="CanvasAnnotation_Width">寬度（畫布座標單位）。</param>
/// <param name="CanvasAnnotation_Height">高度（畫布座標單位）。</param>
/// <param name="CanvasAnnotation_ZIndex">疊放順序。</param>
/// <param name="CanvasAnnotation_Color">便利貼底色（可選）。</param>
/// <param name="CanvasAnnotation_Text">便利貼文字（可選）。</param>
/// <param name="CanvasAnnotation_DataJson">型別專屬資料 JSON（drawing→筆畫；slide→圖片清單）。</param>
public sealed record CanvasAnnotationDto(
    string CanvasAnnotation_Id,
    string CanvasAnnotation_Kind,
    double CanvasAnnotation_X,
    double CanvasAnnotation_Y,
    double CanvasAnnotation_Width,
    double CanvasAnnotation_Height,
    int CanvasAnnotation_ZIndex,
    string? CanvasAnnotation_Color,
    string? CanvasAnnotation_Text,
    string? CanvasAnnotation_DataJson);

/// <summary>
/// 建立畫布標註的請求。座標為畫布座標 (flow coordinates)。
/// </summary>
/// <param name="Kind">型別：sticky / drawing / slide。</param>
/// <param name="X">左上 X。</param>
/// <param name="Y">左上 Y。</param>
/// <param name="Width">寬度。</param>
/// <param name="Height">高度。</param>
/// <param name="ZIndex">疊放順序。</param>
/// <param name="Color">便利貼底色（可選）。</param>
/// <param name="Text">便利貼文字（可選）。</param>
/// <param name="DataJson">型別專屬資料 JSON（可選）。</param>
public sealed record CreateCanvasAnnotationRequest(
    string Kind,
    double X,
    double Y,
    double Width,
    double Height,
    int ZIndex,
    string? Color = null,
    string? Text = null,
    string? DataJson = null);

/// <summary>
/// 更新畫布標註的請求（部分更新；null 欄位代表不變動）。
/// </summary>
/// <param name="X">左上 X。</param>
/// <param name="Y">左上 Y。</param>
/// <param name="Width">寬度。</param>
/// <param name="Height">高度。</param>
/// <param name="ZIndex">疊放順序。</param>
/// <param name="Color">便利貼底色。</param>
/// <param name="Text">便利貼文字。</param>
/// <param name="DataJson">型別專屬資料 JSON。</param>
public sealed record UpdateCanvasAnnotationRequest(
    double? X = null,
    double? Y = null,
    double? Width = null,
    double? Height = null,
    int? ZIndex = null,
    string? Color = null,
    string? Text = null,
    string? DataJson = null);
