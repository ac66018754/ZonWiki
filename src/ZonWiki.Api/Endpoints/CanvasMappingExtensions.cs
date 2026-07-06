using ZonWiki.Domain.Dtos;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 開問啦畫布實體 → DTO 的集中映射（擴充方法）。
/// 過去 NodeDto / EdgeDto / InlineLinkDto / HighlightDto / CanvasDto 在各端點手動 new，
/// 同一份欄位對應散落 10+ 處、極易在改欄位時漏改一處造成不一致（審查 #32）。
/// 集中於此後，「已材質化實體 → DTO」只有唯一一份真相。
///
/// 注意：本檔僅供「已從資料庫材質化的實體」使用；EF Core 的 <c>Select</c> 投影
/// （會被翻譯成 SQL，例如載入整張畫布圖譜、清單查詢）不可改用這些擴充方法，
/// 否則 EF 無法翻譯、執行期會丟例外——那些投影維持原地內嵌建構。
/// </summary>
public static class CanvasMappingExtensions
{
    /// <summary>
    /// 將已材質化的 <see cref="Node"/> 實體轉為 <see cref="NodeDto"/>。
    /// </summary>
    /// <param name="node">已材質化的節點實體。</param>
    /// <param name="version">
    /// 樂觀鎖併發權杖（PostgreSQL xmin，#4/#34）。由呼叫端於存檔後以
    /// <c>db.Entry(node).GetConcurrencyVersion()</c> 取得後傳入。
    /// </param>
    /// <returns>對應的節點 DTO。</returns>
    public static NodeDto ToDto(this Node node, long version) =>
        new(
            node.Id.ToString(),
            node.CanvasId.ToString(),
            node.Title,
            node.Content,
            node.ParentId.HasValue ? node.ParentId.Value.ToString() : null,
            node.X,
            node.Y,
            node.Width,
            node.Height,
            node.ZIndex,
            node.Color,
            node.Model,
            node.Origin,
            node.AiSessionId.HasValue ? node.AiSessionId.Value.ToString() : null,
            node.CreatedDateTime.ToString("O"),
            node.UpdatedDateTime.ToString("O"),
            version);

    /// <summary>
    /// 將已材質化的 <see cref="Edge"/> 實體轉為 <see cref="EdgeDto"/>。
    /// </summary>
    /// <param name="edge">已材質化的邊實體。</param>
    /// <returns>對應的邊 DTO。</returns>
    public static EdgeDto ToDto(this Edge edge) =>
        new(
            edge.Id.ToString(),
            edge.CanvasId.ToString(),
            edge.SourceNodeId.ToString(),
            edge.TargetNodeId.ToString(),
            edge.Kind,
            edge.Label,
            edge.SourceHandle,
            edge.TargetHandle,
            edge.CreatedDateTime.ToString("O"));

    /// <summary>
    /// 將已材質化的 <see cref="InlineLink"/> 實體轉為 <see cref="InlineLinkDto"/>。
    /// </summary>
    /// <param name="inlineLink">已材質化的行內連結實體。</param>
    /// <returns>對應的行內連結 DTO。</returns>
    public static InlineLinkDto ToDto(this InlineLink inlineLink) =>
        new(
            inlineLink.Id.ToString(),
            inlineLink.CanvasId.ToString(),
            inlineLink.SourceNodeId.ToString(),
            inlineLink.AnchorText,
            inlineLink.AnchorStart,
            inlineLink.AnchorEnd,
            inlineLink.AnchorPrefix,
            inlineLink.AnchorSuffix,
            inlineLink.TargetNodeId.ToString(),
            inlineLink.Detached);

    /// <summary>
    /// 將已材質化的 <see cref="Highlight"/> 實體轉為 <see cref="HighlightDto"/>。
    /// </summary>
    /// <param name="highlight">已材質化的重點標記實體。</param>
    /// <returns>對應的重點 DTO。</returns>
    public static HighlightDto ToDto(this Highlight highlight) =>
        new(
            highlight.Id.ToString(),
            highlight.NodeId.ToString(),
            highlight.AnchorText,
            highlight.Start,
            highlight.End,
            highlight.AnchorPrefix,
            highlight.AnchorSuffix,
            highlight.Color,
            highlight.Detached);

    /// <summary>
    /// 將已材質化的 <see cref="Canvas"/> 實體轉為 <see cref="CanvasDto"/>。
    /// </summary>
    /// <param name="canvas">已材質化的畫布實體。</param>
    /// <returns>對應的畫布 DTO。</returns>
    public static CanvasDto ToDto(this Canvas canvas) =>
        new(
            canvas.Id.ToString(),
            canvas.Title,
            canvas.Description,
            canvas.StateJson);
}
