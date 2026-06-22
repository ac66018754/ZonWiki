namespace ZonWiki.Domain.Common;

public sealed record ApiResponse<T>(
    bool Success,
    T? Data = default,
    string? Error = null,
    int StatusCode = 200,
    object? Meta = null)
{
    public static ApiResponse<T> Ok(T data, object? meta = null) =>
        new(true, data, null, 200, meta);

    public static ApiResponse<T> Fail(string error, int statusCode = 400) =>
        new(false, default, error, statusCode);
}
