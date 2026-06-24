using Microsoft.EntityFrameworkCore;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Infrastructure.Persistence;

public sealed class ZonWikiDbContext(
    DbContextOptions<ZonWikiDbContext> options,
    ICurrentUser? currentUser = null) : DbContext(options)
{
    /// <summary>
    /// 目前登入使用者（可能為 null，例如匯入/遷移情境）。
    /// 用於在 OnModelCreating 時套用使用者隔離的全域查詢過濾。
    /// </summary>
    private readonly ICurrentUser? _currentUser = currentUser;

    /// <summary>
    /// 背景工作用的「目前使用者」覆寫值。
    /// 背景流程（例如 AI 提問的 fire-and-forget Task）沒有 HttpContext，
    /// 此時 <see cref="ICurrentUser"/> 會回傳 Guid.Empty，導致使用者隔離全域過濾把所有資料濾掉。
    /// 由背景流程在第一次查詢前呼叫 <see cref="SetCurrentUserId"/> 設定，讓全域過濾與模型快取鍵
    /// 都用正確的使用者 Id（避免「提問靜默無回應」這類問題）。
    /// </summary>
    private Guid? _userIdOverride;

    /// <summary>
    /// 目前登入使用者的 Id（未登入或匯入/遷移情境為 Guid.Empty）。
    /// 優先採用背景覆寫值；其次才是 HttpContext 來源的 <see cref="ICurrentUser"/>。
    /// 供使用者隔離的全域查詢過濾與 <see cref="UserModelCacheKeyFactory"/> 取用。
    /// </summary>
    public Guid CurrentUserId => _userIdOverride ?? _currentUser?.UserId ?? Guid.Empty;

    /// <summary>
    /// 設定背景工作的「目前使用者」覆寫。
    /// 必須在此 DbContext 的「第一次查詢之前」呼叫——因為使用者隔離過濾的 UserId 會在
    /// 模型首次建立時以常數烤進模型、並依此值快取，呼叫太晚將無效。
    /// </summary>
    /// <param name="userId">背景流程要冒用的使用者 Id。</param>
    public void SetCurrentUserId(Guid userId) => _userIdOverride = userId;

    /// <summary>
    /// 若需忽略全域查詢過濾（例如管理員/匯入端點）：
    /// 使用 EF Core 內建的 DbSet.IgnoreQueryFilters() 方法。
    /// 範例：var allNotes = await db.Note.IgnoreQueryFilters().ToListAsync();
    /// </summary>

    // --- 身分（資料以 {Table}_UserId 切分，每位使用者只見自己的資料）-----------
    public DbSet<User> User => Set<User>();

    // --- 筆記（含日記；分類/標籤皆為多對多）-----------------------------------
    public DbSet<Note> Note => Set<Note>();
    public DbSet<Category> Category => Set<Category>();
    public DbSet<Tag> Tag => Set<Tag>();
    public DbSet<NoteCategory> NoteCategory => Set<NoteCategory>();
    public DbSet<NoteTag> NoteTag => Set<NoteTag>();
    public DbSet<CategoryTag> CategoryTag => Set<CategoryTag>();
    public DbSet<NoteLink> NoteLink => Set<NoteLink>();
    public DbSet<NoteRevision> NoteRevision => Set<NoteRevision>();
    public DbSet<Comment> Comment => Set<Comment>();

    // --- 任務（日程規劃 / Todo）-----------------------------------------------
    public DbSet<TaskGroup> TaskGroup => Set<TaskGroup>();
    public DbSet<TaskCard> TaskCard => Set<TaskCard>();
    public DbSet<SubTask> SubTask => Set<SubTask>();
    public DbSet<TaskTag> TaskTag => Set<TaskTag>();
    public DbSet<TaskRelation> TaskRelation => Set<TaskRelation>();
    public DbSet<NoteTaskLink> NoteTaskLink => Set<NoteTaskLink>();

    // --- 筆記文字標註（畫重點 / 做關聯 / 寫備註）---------------------------------
    public DbSet<NoteMark> NoteMark => Set<NoteMark>();

    // --- 筆記浮層元件（便利貼 / 塗鴉 / 圖片輪播；疊在內文最上層）------------------
    public DbSet<NoteOverlayItem> NoteOverlayItem => Set<NoteOverlayItem>();

    // --- 首頁元件 -------------------------------------------------------------
    public DbSet<QuickLink> QuickLink => Set<QuickLink>();
    public DbSet<QuickLinkTag> QuickLinkTag => Set<QuickLinkTag>();
    public DbSet<CaptureItem> CaptureItem => Set<CaptureItem>();
    public DbSet<CaptureLink> CaptureLink => Set<CaptureLink>();

    // --- AI 設定（金鑰入 DB）--------------------------------------------------
    public DbSet<AiModel> AiModel => Set<AiModel>();

    // --- 開問啦（畫布、節點、連線、AI 記錄等） ------------------------------------
    public DbSet<Canvas> Canvas => Set<Canvas>();
    public DbSet<Node> Node => Set<Node>();
    public DbSet<Edge> Edge => Set<Edge>();
    public DbSet<InlineLink> InlineLink => Set<InlineLink>();
    public DbSet<Highlight> Highlight => Set<Highlight>();
    public DbSet<NodeImage> NodeImage => Set<NodeImage>();
    public DbSet<NodeRevision> NodeRevision => Set<NodeRevision>();
    public DbSet<SystemPrompt> SystemPrompt => Set<SystemPrompt>();
    public DbSet<CanvasCat> CanvasCat => Set<CanvasCat>();
    public DbSet<CanvasCategory> CanvasCategory => Set<CanvasCategory>();
    public DbSet<CategorySystemPrompt> CategorySystemPrompt => Set<CategorySystemPrompt>();
    public DbSet<CanvasSystemPrompt> CanvasSystemPrompt => Set<CanvasSystemPrompt>();
    public DbSet<AiSession> AiSession => Set<AiSession>();
    public DbSet<AiMessage> AiMessage => Set<AiMessage>();
    public DbSet<CanvasAnnotation> CanvasAnnotation => Set<CanvasAnnotation>();

    // --- 通用實體關聯（任務/子任務/筆記/節點 互連）---------------------------------
    public DbSet<EntityLink> EntityLink => Set<EntityLink>();

    // --- 活動紀錄（自動記錄各實體的新增/編輯/刪除/還原）-----------------------------
    public DbSet<ActivityLog> ActivityLog => Set<ActivityLog>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.ApplyConfigurationsFromAssembly(typeof(ZonWikiDbContext).Assembly);
        modelBuilder.ApplyZonWikiNamingConventions();

        // 套用使用者隔離過濾：有登入使用者（或背景覆寫）時，對所有 IUserOwned 實體加過濾。
        // 注意傳入的是「值」(CurrentUserId)，會同時反映背景覆寫；遷移/設計階段兩者皆無 → 不加過濾。
        if (_currentUser != null || _userIdOverride.HasValue)
        {
            modelBuilder.ApplyUserIsolationFilters(CurrentUserId);
        }
    }
}
