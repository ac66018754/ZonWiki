using System.Text;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Api.Services;

/// <summary>
/// 提示詞組合器：根據節點及其祖先脈絡組建傳給 AI 的完整 Prompt。
/// 支援三種提問情境：
/// 1. 節點提問：以該節點內容為問題，含祖先脈絡
/// 2. 追問：接續對話（類同節點提問）
/// 3. 選取片段提問：以被框選的文字與節點內容合成 Prompt
/// </summary>
public static class PromptAssembler
{
    /// <summary>
    /// 組建節點提問的 Prompt：由祖先脈絡構築上下文，最後一項為問題。
    /// 格式：
    /// 上下文脈絡：
    /// [祖先1內容]
    /// [祖先2內容]
    /// ...
    /// 提問：
    /// [該節點內容]
    /// </summary>
    /// <param name="ancestry">祖先鏈（不含問題節點本身；通常由 AncestryService.GetAncestorChainAsync 取得）。</param>
    /// <param name="question">提問節點內容（作為實際問題）。</param>
    /// <returns>組建後的 Prompt。</returns>
    public static string AssembleNodePrompt(List<Node> ancestry, string question)
    {
        var sb = new StringBuilder();

        if (ancestry.Count > 0)
        {
            sb.AppendLine("上下文脈絡：");
            sb.AppendLine();

            foreach (var node in ancestry)
            {
                if (!string.IsNullOrEmpty(node.Content))
                {
                    sb.AppendLine(node.Content);
                    sb.AppendLine();
                }
            }

            sb.AppendLine("---");
            sb.AppendLine();
            sb.AppendLine("提問：");
        }

        sb.Append(question);

        return sb.ToString();
    }

    /// <summary>
    /// 組建選取片段提問的 Prompt：整合節點內容與被框選文字及使用者提問。
    /// 格式：
    /// 節點內容：
    /// [整份節點內容]
    ///
    /// 焦點（框選文字）：
    /// [anchorText]
    ///
    /// 提問：
    /// [userQuestion]
    /// </summary>
    /// <param name="nodeContent">來源節點的完整內容。</param>
    /// <param name="anchorText">被框選的文字片段。</param>
    /// <param name="userQuestion">使用者輸入的追問。</param>
    /// <returns>組建後的 Prompt。</returns>
    public static string AssembleSelectionPrompt(string nodeContent, string anchorText, string userQuestion)
    {
        var sb = new StringBuilder();

        sb.AppendLine("節點內容：");
        sb.AppendLine();
        sb.AppendLine(nodeContent);
        sb.AppendLine();

        sb.AppendLine("---");
        sb.AppendLine();
        sb.AppendLine("焦點（框選文字）：");
        sb.AppendLine();
        sb.AppendLine(anchorText);
        sb.AppendLine();

        sb.AppendLine("---");
        sb.AppendLine();
        sb.AppendLine("提問：");
        sb.AppendLine();
        sb.Append(userQuestion);

        return sb.ToString();
    }

    /// <summary>
    /// 組建選取片段提問的 Prompt（含祖先脈絡版）：在原本「節點內容 + 框選文字 + 提問」之上，
    /// 再附上該節點的祖先脈絡，讓 AI 看到更完整的上下文（修正「框選提問上下文太少」）。
    /// 格式：
    /// 上下文脈絡：
    /// [祖先1內容]
    /// ...
    /// 節點內容：
    /// [整份節點內容]
    /// 焦點（框選文字）：
    /// [anchorText]
    /// 提問：
    /// [userQuestion]
    /// </summary>
    /// <param name="ancestry">祖先鏈（不含來源節點本身）。</param>
    /// <param name="nodeContent">來源節點的完整內容。</param>
    /// <param name="anchorText">被框選的文字片段。</param>
    /// <param name="userQuestion">使用者輸入的追問。</param>
    /// <returns>組建後的 Prompt。</returns>
    public static string AssembleSelectionPromptWithContext(
        List<Node> ancestry,
        string nodeContent,
        string anchorText,
        string userQuestion)
    {
        var sb = new StringBuilder();

        if (ancestry.Count > 0)
        {
            sb.AppendLine("上下文脈絡：");
            sb.AppendLine();
            foreach (var node in ancestry)
            {
                if (!string.IsNullOrEmpty(node.Content))
                {
                    sb.AppendLine(node.Content);
                    sb.AppendLine();
                }
            }
            sb.AppendLine("---");
            sb.AppendLine();
        }

        sb.AppendLine("節點內容：");
        sb.AppendLine();
        sb.AppendLine(nodeContent);
        sb.AppendLine();

        sb.AppendLine("---");
        sb.AppendLine();
        sb.AppendLine("焦點（框選文字）：");
        sb.AppendLine();
        sb.AppendLine(anchorText);
        sb.AppendLine();

        sb.AppendLine("---");
        sb.AppendLine();
        sb.AppendLine("提問：");
        sb.AppendLine();
        sb.Append(userQuestion);

        return sb.ToString();
    }

    /// <summary>
    /// 組建圖片生成的 Prompt：由祖先脈絡與節點內容組建，供生圖模型參考。
    /// 格式類同節點提問，但用於圖片模型。
    /// </summary>
    /// <param name="ancestry">祖先鏈（不含該節點；通常由 AncestryService.GetAncestorChainAsync 取得）。</param>
    /// <param name="nodePrompt">節點內容（用作生圖提示主題）。</param>
    /// <returns>組建後的 Prompt。</returns>
    public static string AssembleImagePrompt(List<Node> ancestry, string nodePrompt)
    {
        var sb = new StringBuilder();

        if (ancestry.Count > 0)
        {
            sb.AppendLine("上下文脈絡：");
            sb.AppendLine();

            foreach (var node in ancestry)
            {
                if (!string.IsNullOrEmpty(node.Content))
                {
                    sb.AppendLine(node.Content);
                    sb.AppendLine();
                }
            }

            sb.AppendLine("---");
            sb.AppendLine();
            sb.AppendLine("生圖主題：");
        }

        sb.Append(nodePrompt);

        return sb.ToString();
    }
}
