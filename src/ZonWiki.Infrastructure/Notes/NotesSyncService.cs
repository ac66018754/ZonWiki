using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Markdig;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Infrastructure.Notes;

/// <summary>
/// Scans the notes folder and syncs Categories + Articles into the DB.
/// File system is the source of truth; missing items are soft-deleted.
/// </summary>
public sealed partial class NotesSyncService(
    ZonWikiDbContext db,
    IOptions<NotesSyncOptions> options,
    ILogger<NotesSyncService> logger)
{
    private static readonly MarkdownPipeline Pipeline = new MarkdownPipelineBuilder()
        .UseAdvancedExtensions()
        .UseAutoLinks()
        .DisableHtml()
        .Build();

    [GeneratedRegex(@"\[\[([^\]\r\n]+)\]\]", RegexOptions.Compiled)]
    private static partial Regex WikiLinkRegex();

    [GeneratedRegex(@"^#\s+(.+)$", RegexOptions.Multiline | RegexOptions.Compiled)]
    private static partial Regex FirstHeadingRegex();

    private readonly NotesSyncOptions _options = options.Value;

    public async Task<NotesSyncResult> SyncAllAsync(CancellationToken cancellationToken)
    {
        var result = new NotesSyncResult();
        var rootPath = Path.GetFullPath(_options.RootPath);

        if (!Directory.Exists(rootPath))
        {
            logger.LogWarning("Notes root path does not exist: {Path}", rootPath);
            result.Skipped = true;
            return result;
        }

        logger.LogInformation("Starting notes sync from {Path}", rootPath);

        var seenArticleIds = new HashSet<Guid>();
        var seenCategoryIds = new HashSet<Guid>();

        await SyncDirectoryAsync(
            new DirectoryInfo(rootPath),
            relativePath: string.Empty,
            parentCategoryId: null,
            rootPath,
            seenCategoryIds,
            seenArticleIds,
            result,
            cancellationToken);

        await SoftDeleteMissingAsync(seenArticleIds, seenCategoryIds, result, cancellationToken);

        await db.SaveChangesAsync(cancellationToken);

        logger.LogInformation(
            "Notes sync done. Categories: {Cats} ({CatsNew} new). Articles: {Arts} ({ArtsNew} new, {ArtsUpd} updated, {ArtsDel} soft-deleted).",
            result.CategoriesSeen, result.CategoriesCreated,
            result.ArticlesSeen, result.ArticlesCreated, result.ArticlesUpdated, result.ArticlesSoftDeleted);

        return result;
    }

    private async Task SyncDirectoryAsync(
        DirectoryInfo directory,
        string relativePath,
        Guid? parentCategoryId,
        string rootPath,
        HashSet<Guid> seenCategoryIds,
        HashSet<Guid> seenArticleIds,
        NotesSyncResult result,
        CancellationToken cancellationToken)
    {
        Guid? currentCategoryId = parentCategoryId;

        if (!string.IsNullOrEmpty(relativePath))
        {
            var folderPath = relativePath.Replace('\\', '/');
            var category = await db.Category
                .FirstOrDefaultAsync(c => c.FolderPath == folderPath, cancellationToken);

            if (category is null)
            {
                category = new Category
                {
                    Name = directory.Name,
                    FolderPath = folderPath,
                    ParentId = parentCategoryId,
                };
                db.Category.Add(category);
                await db.SaveChangesAsync(cancellationToken);
                result.CategoriesCreated++;
            }
            else
            {
                if (category.Name != directory.Name) category.Name = directory.Name;
                if (category.ParentId != parentCategoryId) category.ParentId = parentCategoryId;
                if (!category.ValidFlag) category.ValidFlag = true;
            }

            seenCategoryIds.Add(category.Id);
            currentCategoryId = category.Id;
            result.CategoriesSeen++;
        }

        if (currentCategoryId.HasValue)
        {
            foreach (var file in directory.GetFiles("*.md", SearchOption.TopDirectoryOnly))
            {
                cancellationToken.ThrowIfCancellationRequested();
                await SyncArticleAsync(
                    file, currentCategoryId.Value, rootPath, seenArticleIds, result, cancellationToken);
            }
        }

        foreach (var subDirectory in directory.GetDirectories())
        {
            if (subDirectory.Name.StartsWith('.'))
            {
                continue;
            }
            if (Array.Exists(_options.ExcludedFolders,
                excluded => string.Equals(excluded, subDirectory.Name, StringComparison.OrdinalIgnoreCase)))
            {
                continue;
            }

            var subRelative = string.IsNullOrEmpty(relativePath)
                ? subDirectory.Name
                : Path.Combine(relativePath, subDirectory.Name);

            await SyncDirectoryAsync(
                subDirectory, subRelative, currentCategoryId, rootPath,
                seenCategoryIds, seenArticleIds, result, cancellationToken);
        }
    }

    private async Task SyncArticleAsync(
        FileInfo file,
        Guid categoryId,
        string rootPath,
        HashSet<Guid> seenArticleIds,
        NotesSyncResult result,
        CancellationToken cancellationToken)
    {
        var content = await File.ReadAllTextAsync(file.FullName, Encoding.UTF8, cancellationToken);
        var hash = ComputeHash(content);
        var relativePath = Path.GetRelativePath(rootPath, file.FullName).Replace('\\', '/');

        var article = await db.Article
            .FirstOrDefaultAsync(a => a.FilePath == relativePath, cancellationToken);

        result.ArticlesSeen++;

        if (article is not null && article.ContentHash == hash && article.ValidFlag)
        {
            seenArticleIds.Add(article.Id);
            return;
        }

        var (title, html) = RenderMarkdown(content, file);
        var slug = BuildSlug(relativePath);

        if (article is null)
        {
            article = new Article
            {
                CategoryId = categoryId,
                Title = title,
                Slug = slug,
                FilePath = relativePath,
                ContentHash = hash,
                ContentRaw = content,
                ContentHtml = html,
                PublishedFlag = true,
            };
            db.Article.Add(article);
            result.ArticlesCreated++;
        }
        else
        {
            article.CategoryId = categoryId;
            article.Title = title;
            article.Slug = slug;
            article.ContentHash = hash;
            article.ContentRaw = content;
            article.ContentHtml = html;
            article.ValidFlag = true;
            result.ArticlesUpdated++;
        }

        seenArticleIds.Add(article.Id);
    }

    private async Task SoftDeleteMissingAsync(
        HashSet<Guid> seenArticleIds,
        HashSet<Guid> seenCategoryIds,
        NotesSyncResult result,
        CancellationToken cancellationToken)
    {
        var orphanedArticles = await db.Article
            .Where(a => a.ValidFlag && !seenArticleIds.Contains(a.Id))
            .ToListAsync(cancellationToken);

        foreach (var a in orphanedArticles)
        {
            a.ValidFlag = false;
            result.ArticlesSoftDeleted++;
        }

        var orphanedCategories = await db.Category
            .Where(c => c.ValidFlag && !seenCategoryIds.Contains(c.Id))
            .ToListAsync(cancellationToken);

        foreach (var c in orphanedCategories)
        {
            c.ValidFlag = false;
            result.CategoriesSoftDeleted++;
        }
    }

    private static (string Title, string Html) RenderMarkdown(string content, FileInfo file)
    {
        var headingMatch = FirstHeadingRegex().Match(content);
        var title = headingMatch.Success
            ? headingMatch.Groups[1].Value.Trim()
            : Path.GetFileNameWithoutExtension(file.Name);

        var preprocessed = WikiLinkRegex().Replace(content, m =>
        {
            var name = m.Groups[1].Value.Trim();
            var slug = BuildSlugFromTitle(name);
            return $"[{name}](/a/{slug})";
        });

        var html = Markdown.ToHtml(preprocessed, Pipeline);
        return (title, html);
    }

    private static string BuildSlug(string relativePath)
    {
        var withoutExt = relativePath.EndsWith(".md", StringComparison.OrdinalIgnoreCase)
            ? relativePath[..^3]
            : relativePath;

        return withoutExt
            .Replace('\\', '/')
            .Replace(' ', '-')
            .ToLowerInvariant()
            .TrimEnd('/');
    }

    private static string BuildSlugFromTitle(string title)
    {
        return title
            .Trim()
            .Replace(' ', '-')
            .ToLowerInvariant();
    }

    private static string ComputeHash(string content)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(content));
        return Convert.ToHexString(bytes);
    }
}

public sealed class NotesSyncResult
{
    public bool Skipped { get; set; }
    public int CategoriesSeen { get; set; }
    public int CategoriesCreated { get; set; }
    public int CategoriesSoftDeleted { get; set; }
    public int ArticlesSeen { get; set; }
    public int ArticlesCreated { get; set; }
    public int ArticlesUpdated { get; set; }
    public int ArticlesSoftDeleted { get; set; }
}
