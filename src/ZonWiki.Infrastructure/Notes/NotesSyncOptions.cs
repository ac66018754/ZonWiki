namespace ZonWiki.Infrastructure.Notes;

public sealed class NotesSyncOptions
{
    public const string SectionName = "NotesSync";

    /// <summary>
    /// Absolute or working-directory-relative path to the notes root (e.g. "筆記區").
    /// </summary>
    public required string RootPath { get; init; }

    /// <summary>
    /// How often the background service triggers a full re-scan.
    /// </summary>
    public TimeSpan ScanInterval { get; init; } = TimeSpan.FromMinutes(5);

    /// <summary>
    /// Folder names (relative segments) to skip when scanning.
    /// </summary>
    public string[] ExcludedFolders { get; init; } = [".git", "node_modules", "obj", "bin"];
}
