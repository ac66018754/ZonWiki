using FluentAssertions;
using ZonWiki.Domain.Common;

namespace ZonWiki.Infrastructure.Tests.Domain;

public sealed class ApiResponseTests
{
    [Fact]
    public void Ok_wraps_data_with_success_true_and_200()
    {
        var response = ApiResponse<string>.Ok("hello");

        response.Success.Should().BeTrue();
        response.Data.Should().Be("hello");
        response.Error.Should().BeNull();
        response.StatusCode.Should().Be(200);
    }

    [Fact]
    public void Fail_returns_error_with_default_400()
    {
        var response = ApiResponse<string>.Fail("nope");

        response.Success.Should().BeFalse();
        response.Data.Should().BeNull();
        response.Error.Should().Be("nope");
        response.StatusCode.Should().Be(400);
    }

    [Fact]
    public void Fail_respects_explicit_status_code()
    {
        var response = ApiResponse<string>.Fail("forbidden", 403);
        response.StatusCode.Should().Be(403);
    }
}
