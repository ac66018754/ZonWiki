using FluentAssertions;

namespace ZonWiki.Api.Tests.Smoke;

/// <summary>
/// Placeholder for Api integration tests. A full
/// WebApplicationFactory + Testcontainers.PostgreSql harness is tracked as
/// Phase 7 follow-up work.
/// </summary>
public sealed class BuildSmokeTests
{
    [Fact]
    public void Program_type_is_resolvable_from_test_project()
    {
        // Simply asserts the Api assembly is referenced and Program is reachable.
        // This keeps the build pipeline honest until WebApplicationFactory<Program>
        // is wired up.
        typeof(Program).Should().NotBeNull();
    }
}
