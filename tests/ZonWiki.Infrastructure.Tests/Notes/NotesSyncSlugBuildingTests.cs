using System.Reflection;
using FluentAssertions;
using ZonWiki.Infrastructure.Notes;

namespace ZonWiki.Infrastructure.Tests.Notes;

/// <summary>
/// Smoke tests for slug + wiki-link helpers inside <see cref="NotesSyncService"/>.
/// These exercise the private helpers via reflection so we can pin behaviour
/// without spinning up Postgres + the file watcher.
///
/// A full integration test that drives <c>SyncAllAsync</c> against a real
/// Postgres (Testcontainers) is tracked as Phase 7 follow-up work.
/// </summary>
public sealed class NotesSyncSlugBuildingTests
{
    [Theory]
    [InlineData("AI/MCP.md", "ai/mcp")]
    [InlineData("Programming/CICD/GitHub Action.md", "programming/cicd/github-action")]
    [InlineData("Programming/環境變數.md", "programming/環境變數")]
    [InlineData("raw/突然想到的問題們.md", "raw/突然想到的問題們")]
    public void BuildSlug_strips_md_extension_and_lowercases_ascii(string relativePath, string expected)
    {
        var slug = InvokePrivateStatic<string>("BuildSlug", relativePath);
        slug.Should().Be(expected);
    }

    [Theory]
    [InlineData("Hello World", "hello-world")]
    [InlineData("中文標題", "中文標題")]
    public void BuildSlugFromTitle_lowers_ascii_and_keeps_cjk(string title, string expected)
    {
        var slug = InvokePrivateStatic<string>("BuildSlugFromTitle", title);
        slug.Should().Be(expected);
    }

    private static T InvokePrivateStatic<T>(string methodName, params object?[] args)
    {
        var method = typeof(NotesSyncService)
            .GetMethod(methodName, BindingFlags.NonPublic | BindingFlags.Static)
            ?? throw new MissingMethodException(nameof(NotesSyncService), methodName);
        var result = method.Invoke(null, args)
            ?? throw new InvalidOperationException($"{methodName} returned null");
        return (T)result;
    }
}
