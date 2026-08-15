using System;
using System.Linq.Expressions;
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
    /// 目前請求的操作來源："web"（人類在瀏覽器以 Cookie 操作）或 API 權杖名稱（外部 AI）。
    /// 供活動紀錄攔截器標示「是誰/哪個 AI 做的」。無 HttpContext（背景/遷移）時為 "web"。
    /// </summary>
    public string CurrentSource => _currentUser?.Source ?? "web";

    /// <summary>
    /// 是否為「背景流程冒用使用者」的脈絡（曾呼叫 <see cref="SetCurrentUserId"/>）。
    /// 供 NoteRevisionInterceptor 的時間窗合併判定：<see cref="CurrentUserId"/> 非空
    /// 「不代表」有 HTTP 請求脈絡——所有背景 AI 流程都會冒用使用者 Id 以通過隔離過濾，
    /// 若只看 CurrentUserId，背景覆寫仍會併掉使用者手動版本的救援點（對抗復審 HIGH）。
    /// </summary>
    public bool IsUserContextOverridden => _userIdOverride is not null;

    /// <summary>
    /// 設定背景工作的「目前使用者」覆寫。
    /// 必須在此 DbContext 的「第一次查詢之前」呼叫——因為使用者隔離過濾的 UserId 會在
    /// 模型首次建立時以常數烤進模型、並依此值快取，呼叫太晚將無效。
    /// </summary>
    /// <param name="userId">背景流程要冒用的使用者 Id。</param>
    public void SetCurrentUserId(Guid userId) => _userIdOverride = userId;

    /// <summary>
    /// 儲存變更（同步）——並把「使用者層級的唯一索引併發衝突」轉譯為併發衝突例外。
    /// 例如：兩併發請求對同一筆記取到同一版本序號（撞 UX_NoteRevision_NoteId_RevisionNo）、
    /// 或把不同筆記改名到同一標題而搶同一活 slug（撞 UX_Note_UserId_Slug）——這些在語意上都是
    /// 「同時寫入互相搶名額」，統一轉為 <see cref="DbUpdateConcurrencyException"/>，讓各端點既有的
    /// 409 處理一體適用（而非外洩成裸 500）。判定範圍見 <see cref="UserFacingConcurrencyIndexes"/>。
    /// </summary>
    /// <param name="acceptAllChangesOnSuccess">成功後是否接受所有變更。</param>
    /// <returns>寫入的列數。</returns>
    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        try
        {
            return base.SaveChanges(acceptAllChangesOnSuccess);
        }
        catch (DbUpdateException ex) when (IsUserFacingUniqueViolation(ex))
        {
            throw AsConcurrencyConflict(ex);
        }
    }

    /// <summary>
    /// 儲存變更（非同步）——同 <see cref="SaveChanges(bool)"/> 的唯一索引衝突轉譯。
    /// </summary>
    /// <param name="acceptAllChangesOnSuccess">成功後是否接受所有變更。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    /// <returns>寫入的列數。</returns>
    public override async Task<int> SaveChangesAsync(
        bool acceptAllChangesOnSuccess,
        CancellationToken cancellationToken = default)
    {
        try
        {
            return await base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
        }
        catch (DbUpdateException ex) when (IsUserFacingUniqueViolation(ex))
        {
            throw AsConcurrencyConflict(ex);
        }
    }

    /// <summary>
    /// 「使用者層級併發寫入衝突」的唯一索引名單——這些索引被撞（PostgreSQL 23505）在語意上就是
    /// 「同一位使用者的兩個併發請求互相搶同一個名額」，屬併發衝突（應轉 409），而非資料錯誤：
    /// <list type="bullet">
    ///   <item>UX_NoteRevision_NoteId_RevisionNo：兩併發請求對同一筆記取到同一個版本序號。</item>
    ///   <item>UX_Note_UserId_Slug：兩併發請求把「不同筆記」改名到同一標題、搶同一個活 slug（對抗式復審 CRITICAL #1）。</item>
    ///   <item>UX_NoteSlugAlias_UserId_Slug_NoteId：併發改名時搶同一個 (slug, 筆記) 別名名額。</item>
    /// </list>
    /// 其他唯一索引（例如 AiModel 的 Key、ApiToken 的雜湊）被撞是真正的資料重複錯誤，
    /// <b>不得</b>被誤轉成 409——那會把「你送了重複的東西」偽裝成「別人剛好同時改」，掩蓋真 bug。
    /// </summary>
    private static readonly HashSet<string> UserFacingConcurrencyIndexes = new(StringComparer.Ordinal)
    {
        "UX_NoteRevision_NoteId_RevisionNo",
        "UX_Note_UserId_Slug",
        "UX_NoteSlugAlias_UserId_Slug_NoteId",
    };

    /// <summary>
    /// 判定「被撞的唯一索引名稱」是否屬於使用者層級的併發寫入衝突（見 <see cref="UserFacingConcurrencyIndexes"/>）。
    /// 純函式、公開靜態，供單元測試直接鎖定轉譯範圍（不必真的觸發資料庫例外）。
    /// </summary>
    /// <param name="constraintName">撞到的唯一索引名稱（可能為 null，例如非唯一索引違反或缺名）。</param>
    /// <returns>屬併發衝突名單則為 true；null／空字串／其他索引皆為 false。</returns>
    public static bool IsUserFacingUniqueCollision(string? constraintName) =>
        constraintName is not null && UserFacingConcurrencyIndexes.Contains(constraintName);

    /// <summary>
    /// 判定 EF 儲存例外是否為「使用者層級併發唯一索引衝突」（PostgreSQL 23505 且撞的是名單內索引）。
    /// </summary>
    /// <param name="ex">EF 儲存例外。</param>
    /// <returns>是否應轉譯為併發衝突（409）。</returns>
    private static bool IsUserFacingUniqueViolation(DbUpdateException ex) =>
        ex.InnerException is Npgsql.PostgresException pg
        && pg.SqlState == Npgsql.PostgresErrorCodes.UniqueViolation
        && IsUserFacingUniqueCollision(pg.ConstraintName);

    /// <summary>
    /// 把使用者層級的唯一索引併發衝突包裝成併發衝突例外（保留原例外供診斷）。
    /// </summary>
    /// <param name="ex">原始儲存例外。</param>
    /// <returns>可被各端點 409 處理接住的併發衝突例外。</returns>
    private static DbUpdateConcurrencyException AsConcurrencyConflict(DbUpdateException ex) =>
        new("此項目已被其他來源同時修改（唯一索引併發衝突）。", ex);

    /// <summary>
    /// 若需忽略全域查詢過濾（例如管理員/匯入端點）：
    /// 使用 EF Core 內建的 DbSet.IgnoreQueryFilters() 方法。
    /// 範例：var allNotes = await db.Note.IgnoreQueryFilters().ToListAsync();
    /// </summary>

    // --- 身分（資料以 {Table}_UserId 切分，每位使用者只見自己的資料）-----------
    public DbSet<User> User => Set<User>();

    // --- API 個人存取權杖（PAT；供外部 AI 助理以 Bearer 權杖呼叫 API）-----------
    public DbSet<ApiToken> ApiToken => Set<ApiToken>();

    // --- 筆記（含日記；分類/標籤皆為多對多）-----------------------------------
    public DbSet<Note> Note => Set<Note>();
    public DbSet<Category> Category => Set<Category>();
    public DbSet<Tag> Tag => Set<Tag>();
    public DbSet<NoteCategory> NoteCategory => Set<NoteCategory>();
    public DbSet<NoteTag> NoteTag => Set<NoteTag>();
    public DbSet<CategoryTag> CategoryTag => Set<CategoryTag>();
    public DbSet<NoteLink> NoteLink => Set<NoteLink>();
    public DbSet<NoteRevision> NoteRevision => Set<NoteRevision>();
    public DbSet<NoteSlugAlias> NoteSlugAlias => Set<NoteSlugAlias>();
    public DbSet<NoteOverlaySnapshot> NoteOverlaySnapshot => Set<NoteOverlaySnapshot>();
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

    // --- 筆記附件（貼上/上傳的圖片；檔案存磁碟、此處存中繼資料）-------------------
    public DbSet<NoteAttachment> NoteAttachment => Set<NoteAttachment>();

    // --- 首頁元件 -------------------------------------------------------------
    public DbSet<QuickLink> QuickLink => Set<QuickLink>();
    public DbSet<QuickLinkTag> QuickLinkTag => Set<QuickLinkTag>();
    public DbSet<CaptureItem> CaptureItem => Set<CaptureItem>();
    public DbSet<CaptureLink> CaptureLink => Set<CaptureLink>();

    // --- 時間追蹤（記錄每天把時間花在什麼上面；EndedDateTime 為 null = 計時中）-------
    public DbSet<TimeEntry> TimeEntry => Set<TimeEntry>();

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

    // --- 記帳（其他功能群；一句話記帳＋分類）-------------------------------------
    public DbSet<ExpenseCategory> ExpenseCategory => Set<ExpenseCategory>();
    public DbSet<Expense> Expense => Set<Expense>();

    // --- 單字庫（其他功能群 Phase 2；SM-2 複習排程）--------------------------------
    public DbSet<VocabularyWord> VocabularyWord => Set<VocabularyWord>();

    // --- 筆記朗讀語音快取（其他功能群 Phase 2；TTS 子系統）--------------------------
    public DbSet<TtsAudio> TtsAudio => Set<TtsAudio>();

    // --- 英文教練（其他功能群 Phase 3；Vertex Live 對話＋逐字稿＋全站花費計量）------------
    public DbSet<CoachSession> CoachSession => Set<CoachSession>();
    public DbSet<CoachMessage> CoachMessage => Set<CoachMessage>();
    public DbSet<CoachBudgetLedger> CoachBudgetLedger => Set<CoachBudgetLedger>();

    // --- 通用實體關聯（任務/子任務/筆記/節點 互連）---------------------------------
    public DbSet<EntityLink> EntityLink => Set<EntityLink>();

    // --- 活動紀錄（自動記錄各實體的新增/編輯/刪除/還原）-----------------------------
    public DbSet<ActivityLog> ActivityLog => Set<ActivityLog>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.ApplyConfigurationsFromAssembly(typeof(ZonWikiDbContext).Assembly);
        modelBuilder.ApplyZonWikiNamingConventions();

        // 全站搜尋效能：啟用 pg_trgm 擴充並對「會被搜尋的文字欄位」建立 GIN trigram 索引。
        // 讓 SearchEndpoints 的 ILIKE '%關鍵字%'（子字串、大小寫不敏感）能走索引，
        // 而不是每次都對整張表做順序掃描（弱核 VM 上資料一多就明顯變慢）。
        ConfigureSearchTrigramIndexes(modelBuilder);

        // 套用使用者隔離過濾：有登入使用者（或背景覆寫）時，對所有 IUserOwned 實體加過濾。
        // 注意傳入的是「值」(CurrentUserId)，會同時反映背景覆寫；遷移/設計階段兩者皆無 → 不加過濾。
        if (_currentUser != null || _userIdOverride.HasValue)
        {
            modelBuilder.ApplyUserIsolationFilters(CurrentUserId);
        }
    }

    /// <summary>
    /// 設定全站搜尋用的 pg_trgm 擴充與 GIN trigram 索引。
    /// 只針對 <c>SearchEndpoints</c> 實際會以 ILIKE 子字串搜尋的文字欄位建立索引，
    /// 避免對其它欄位建立無謂的索引而增加寫入/維護成本。
    /// </summary>
    /// <param name="modelBuilder">EF Core 模型建構器。</param>
    private static void ConfigureSearchTrigramIndexes(ModelBuilder modelBuilder)
    {
        // pg_trgm：提供 trigram 比對與「LIKE/ILIKE 可用 GIN 索引」的運算子類別 gin_trgm_ops。
        modelBuilder.HasPostgresExtension("pg_trgm");

        // 區域工具：為單一文字欄位建立一個 GIN trigram 索引（索引名稱顯式指定，方便辨識與維護）。
        static void Trigram<TEntity>(
            ModelBuilder builder,
            Expression<Func<TEntity, object?>> column,
            string indexName)
            where TEntity : class =>
            builder
                .Entity<TEntity>()
                .HasIndex(column)
                .HasDatabaseName(indexName)
                .HasMethod("gin")
                .HasOperators("gin_trgm_ops");

        // 筆記：標題 + 原始 Markdown 內容
        Trigram<Note>(modelBuilder, note => note.Title, "IX_Note_Title_Trgm");
        Trigram<Note>(modelBuilder, note => note.ContentRaw, "IX_Note_ContentRaw_Trgm");

        // 任務卡片：標題 + 內容
        Trigram<TaskCard>(modelBuilder, task => task.Title, "IX_TaskCard_Title_Trgm");
        Trigram<TaskCard>(modelBuilder, task => task.Content, "IX_TaskCard_Content_Trgm");

        // 畫布：標題
        Trigram<Canvas>(modelBuilder, canvas => canvas.Title, "IX_Canvas_Title_Trgm");

        // 開問啦節點：標題 + 內容
        Trigram<Node>(modelBuilder, node => node.Title, "IX_Node_Title_Trgm");
        Trigram<Node>(modelBuilder, node => node.Content, "IX_Node_Content_Trgm");

        // 標籤：名稱（全站搜尋 #20 納入標籤範圍）
        Trigram<Tag>(modelBuilder, tag => tag.Name, "IX_Tag_Name_Trgm");

        // 分類：名稱（全站搜尋 #20 納入分類範圍）
        Trigram<Category>(modelBuilder, category => category.Name, "IX_Category_Name_Trgm");

        // 快速捕捉（Inbox 收件匣）：原始內容（全站搜尋 #20 納入快速捕捉範圍）
        Trigram<CaptureItem>(modelBuilder, capture => capture.RawContent, "IX_CaptureItem_RawContent_Trgm");

        // 筆記浮層（T 文字框 / 便利貼）：文字內容（全站搜尋納入 overlay-text / overlay-sticky 範圍）。
        // 只對 Text 建索引；便利貼標題存 DataJson.title、以整欄 ILIKE 比對（量小、可接受 seq scan，不另建索引）。
        Trigram<NoteOverlayItem>(modelBuilder, item => item.Text, "IX_NoteOverlayItem_Text_Trgm");
    }
}
