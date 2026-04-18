namespace ZonWiki.Domain.Dtos;

public sealed record CategoryDto(
    Guid Id,
    Guid? ParentId,
    string Name,
    string FolderPath,
    int ArticleCount);

public sealed record ArticleSummaryDto(
    Guid Id,
    Guid CategoryId,
    string Title,
    string Slug,
    string FilePath,
    DateTime UpdatedDateTime);

public sealed record ArticleDetailDto(
    Guid Id,
    Guid CategoryId,
    string CategoryName,
    string Title,
    string Slug,
    string FilePath,
    string ContentHtml,
    DateTime CreatedDateTime,
    DateTime UpdatedDateTime,
    int CommentCount);

public sealed record CommentDto(
    Guid Id,
    Guid ArticleId,
    Guid UserId,
    string AuthorName,
    string? AuthorAvatarUrl,
    string Content,
    DateTime CreatedDateTime);

public sealed record CreateCommentRequest(string Content);
