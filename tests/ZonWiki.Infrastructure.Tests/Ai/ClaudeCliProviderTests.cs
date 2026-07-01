using System.Diagnostics;
using FluentAssertions;
using ZonWiki.Infrastructure.Ai;

namespace ZonWiki.Infrastructure.Tests.Ai;

/// <summary>
/// <see cref="ClaudeCliProvider"/> 的程序參數組裝測試（<c>CreateStartInfo</c>）。
///
/// 重點回歸守門：prompt 必須走 <b>positional 參數（argv）</b>、且 <b>不得重導 stdin</b>。
/// 這是根治 prod 死鎖的關鍵——正式環境長駐宿主 spawn claude 時，stdin pipe 的 write 端
/// 會洩漏而永不 EOF，若 prompt 走 stdin，claude 會卡在讀 stdin 的事件迴圈直到逾時。
/// 若日後有人把 prompt 改回 stdin，這些測試會失敗，提醒別回頭踩雷。
/// </summary>
public sealed class ClaudeCliProviderTests
{
    private static ClaudeCliOptions Options() => new() { BinaryPath = "/usr/bin/claude" };

    /// <summary>把 <see cref="ProcessStartInfo.ArgumentList"/> 轉成清單，便於斷言順序與內容。</summary>
    private static IReadOnlyList<string> Args(ProcessStartInfo psi) => psi.ArgumentList;

    [Fact]
    public void prompt_必須以_positional_參數傳遞_緊接在_dash_p_之後()
    {
        // Arrange
        const string prompt = "這是一段\n含換行與「引號」與 --看似旗標-- 的內容";

        // Act
        var psi = ClaudeCliProvider.CreateStartInfo(Options(), prompt, model: null, systemPrompt: null, resumeSessionId: null);

        // Assert：-p 之後緊接 prompt（整段當單一 argv 元素，特殊字元不需跳脫）。
        var args = Args(psi);
        var pIndex = args.ToList().IndexOf("-p");
        pIndex.Should().BeGreaterThanOrEqualTo(0, "應帶 -p 旗標");
        args[pIndex + 1].Should().Be(prompt, "prompt 應緊接在 -p 後、以單一 argv 元素完整傳入");
    }

    [Fact]
    public void 不得重導_stdin_但需重導_stdout_與_stderr()
    {
        // Act
        var psi = ClaudeCliProvider.CreateStartInfo(Options(), "問題", model: null, systemPrompt: null, resumeSessionId: null);

        // Assert：stdin 一律不重導（避免 stdin pipe EOF 洩漏死鎖）；stdout/stderr 需重導以串流解析。
        psi.RedirectStandardInput.Should().BeFalse("prompt 走 argv，claude 不讀 stdin，故不得建立 stdin pipe");
        psi.RedirectStandardOutput.Should().BeTrue();
        psi.RedirectStandardError.Should().BeTrue();
        psi.UseShellExecute.Should().BeFalse("需重導 stdio 且以 argv 直接傳參，不可經 shell");
    }

    [Fact]
    public void 帶了_model_才加_dash_dash_model_旗標()
    {
        // Act
        var withModel = ClaudeCliProvider.CreateStartInfo(Options(), "問題", model: "sonnet", systemPrompt: null, resumeSessionId: null);
        var noModel = ClaudeCliProvider.CreateStartInfo(Options(), "問題", model: null, systemPrompt: null, resumeSessionId: null);

        // Assert
        Args(withModel).Should().ContainInOrder("--model", "sonnet");
        Args(noModel).Should().NotContain("--model");
    }

    [Fact]
    public void 帶了_systemPrompt_才加_append_system_prompt_旗標()
    {
        // Act
        var withSys = ClaudeCliProvider.CreateStartInfo(Options(), "問題", model: null, systemPrompt: "你是排版助手", resumeSessionId: null);
        var noSys = ClaudeCliProvider.CreateStartInfo(Options(), "問題", model: null, systemPrompt: null, resumeSessionId: null);

        // Assert
        Args(withSys).Should().ContainInOrder("--append-system-prompt", "你是排版助手");
        Args(noSys).Should().NotContain("--append-system-prompt");
    }

    [Fact]
    public void 一律帶_stream_json_與_verbose_輸出旗標()
    {
        // Act
        var psi = ClaudeCliProvider.CreateStartInfo(Options(), "問題", model: null, systemPrompt: null, resumeSessionId: null);

        // Assert
        Args(psi).Should().ContainInOrder("--output-format", "stream-json");
        Args(psi).Should().Contain("--verbose");
    }
}
