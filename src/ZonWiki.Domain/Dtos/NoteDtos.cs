namespace ZonWiki.Domain.Dtos;

/// <summary>
/// 標籤精簡參照（識別碼 + 名稱），用於內嵌在分類等其他物件內。
/// </summary>
/// <param name="Id">標籤識別碼。</param>
/// <param name="Name">標籤名稱。</param>
public sealed record TagRefDto(
    Guid Id,
    string Name);

/// <summary>
/// 分類資料傳輸物件（含該分類底下的有效筆記數與貼在此分類上的標籤）。
/// </summary>
/// <param name="Id">分類識別碼。</param>
/// <param name="ParentId">上層分類識別碼（最上層為 null）。</param>
/// <param name="Name">分類名稱。</param>
/// <param name="FolderPath">匯入來源資料夾路徑（網頁建立者為空字串）。</param>
/// <param name="NoteCount">此分類底下的有效筆記數。</param>
/// <param name="Tags">貼在此分類上的標籤。</param>
public sealed record CategoryDto(
    Guid Id,
    Guid? ParentId,
    string Name,
    string FolderPath,
    int NoteCount,
    List<TagRefDto> Tags);

/// <summary>
/// 建立筆記分類的請求。
/// </summary>
/// <param name="Name">分類名稱（必填）。</param>
/// <param name="ParentId">上層分類識別碼（最上層傳 null）。</param>
public sealed record CreateNoteCategoryRequest(
    string Name,
    Guid? ParentId);

/// <summary>
/// 更新筆記分類的請求（重新命名 + 變更上層）。
/// </summary>
/// <param name="Name">新分類名稱（必填）。</param>
/// <param name="ParentId">新的上層分類識別碼（最上層傳 null）。</param>
public sealed record UpdateNoteCategoryRequest(
    string Name,
    Guid? ParentId);

/// <summary>
/// 設定某分類「貼上哪些標籤」的請求（整組取代）。
/// </summary>
/// <param name="TagIds">完整的標籤識別碼清單（會整組取代既有關聯）。</param>
public sealed record SetCategoryTagsRequest(
    List<Guid> TagIds);

/// <summary>
/// 重新排序的請求（分類或標籤共用）。
/// 後端會依清單順序，將每個項目的 SortOrder 設為其在清單中的索引（0、1、2…）。
/// </summary>
/// <param name="OrderedIds">
/// 依新順序排列的識別碼清單。對分類而言，通常是「同一層級」內的兄弟分類；
/// 對標籤而言，是整份標籤清單的新順序。
/// </param>
public sealed record ReorderRequest(
    List<Guid> OrderedIds);

/// <summary>
/// 建立筆記標籤的請求。
/// </summary>
/// <param name="Name">標籤名稱（必填，同一使用者底下不重複）。</param>
public sealed record CreateNoteTagRequest(
    string Name);

/// <summary>
/// 更新筆記標籤的請求（重新命名）。
/// </summary>
/// <param name="Name">新標籤名稱（必填）。</param>
public sealed record UpdateNoteTagRequest(
    string Name);

/// <summary>
/// 筆記摘要資料傳輸物件（清單用）。
/// </summary>
/// <param name="Id">筆記識別碼。</param>
/// <param name="Title">標題。</param>
/// <param name="Slug">網址代稱。</param>
/// <param name="Kind">種類（note / journal）。</param>
/// <param name="IsDraft">是否為草稿。</param>
/// <param name="UpdatedDateTime">最後更新時間（UTC）。</param>
/// <param name="Categories">此筆記所屬的分類（清單批次操作的衝突判斷與顯示用）。</param>
/// <param name="Tags">此筆記貼上的標籤（清單批次操作判斷選取狀態用）。</param>
public sealed record NoteSummaryDto(
    Guid Id,
    string Title,
    string Slug,
    string Kind,
    bool IsDraft,
    DateTime UpdatedDateTime,
    List<TagRefDto>? Categories = null,
    List<TagRefDto>? Tags = null,
    DateTime CreatedDateTime = default,
    DateTime? LastOpenedDateTime = null);

/// <summary>
/// 筆記詳細資料傳輸物件（含渲染後 HTML 與原始 Markdown，供閱讀與編輯）。
/// </summary>
/// <param name="Id">筆記識別碼。</param>
/// <param name="Title">標題。</param>
/// <param name="Slug">網址代稱。</param>
/// <param name="ContentHtml">渲染後 HTML。</param>
/// <param name="ContentRaw">原始 Markdown（編輯用）。</param>
/// <param name="Kind">種類（note / journal）。</param>
/// <param name="IsDraft">是否為草稿。</param>
/// <param name="CreatedDateTime">建立時間（UTC）。</param>
/// <param name="UpdatedDateTime">最後更新時間（UTC）。</param>
/// <param name="CommentCount">有效留言數。</param>
/// <param name="Categories">此筆記所屬的分類（編輯時用以預選）。</param>
/// <param name="Tags">此筆記貼上的標籤（編輯時用以預選）。</param>
/// <param name="Version">
/// 樂觀鎖併發權杖（PostgreSQL xmin，#4/#34）。前端保存時原封帶回為 baseVersion，
/// 供後端偵測「載入後是否被其他來源改過」；0＝未知（不參與併發檢查）。
/// </param>
public sealed record NoteDetailDto(
    Guid Id,
    string Title,
    string Slug,
    string ContentHtml,
    string ContentRaw,
    string Kind,
    bool IsDraft,
    DateTime CreatedDateTime,
    DateTime UpdatedDateTime,
    int CommentCount,
    List<TagRefDto>? Categories = null,
    List<TagRefDto>? Tags = null,
    long Version = 0);

/// <summary>
/// 留言資料傳輸物件。
/// </summary>
/// <param name="Id">留言識別碼。</param>
/// <param name="NoteId">所屬筆記識別碼。</param>
/// <param name="UserId">留言者識別碼。</param>
/// <param name="AuthorName">留言者顯示名稱。</param>
/// <param name="AuthorAvatarUrl">留言者頭像 URL（可空）。</param>
/// <param name="Content">留言內容。</param>
/// <param name="CreatedDateTime">建立時間（UTC）。</param>
public sealed record CommentDto(
    Guid Id,
    Guid NoteId,
    Guid UserId,
    string AuthorName,
    string? AuthorAvatarUrl,
    string Content,
    DateTime CreatedDateTime);

/// <summary>
/// 建立留言的請求內容。
/// </summary>
/// <param name="Content">留言內容。</param>
public sealed record CreateCommentRequest(string Content);

/// <summary>
/// 建立筆記的請求內容。
/// </summary>
/// <param name="Title">筆記標題。</param>
/// <param name="ContentRaw">原始 Markdown 內容。</param>
/// <param name="Kind">筆記種類（預設 "note"；可選 "journal"）。</param>
/// <param name="IsDraft">是否為草稿（預設 false）。</param>
/// <param name="JournalDate">日記日期（若 Kind = "journal" 時需要；UTC 日期）。</param>
/// <param name="CategoryIds">分類識別碼清單（可空）。</param>
/// <param name="TagIds">標籤識別碼清單（可空；若標籤不存在則自動建立）。</param>
public sealed record CreateNoteRequest(
    string Title,
    string ContentRaw,
    string Kind = "note",
    bool IsDraft = false,
    DateTime? JournalDate = null,
    List<Guid>? CategoryIds = null,
    List<Guid>? TagIds = null);

/// <summary>
/// 更新筆記的請求內容。
/// </summary>
/// <param name="Title">筆記標題（可空；若無傳則保留原值）。</param>
/// <param name="ContentRaw">原始 Markdown 內容（可空；若無傳則保留原值）。</param>
/// <param name="IsDraft">是否為草稿（可空；若無傳則保留原值）。</param>
/// <param name="CategoryIds">分類識別碼清單（覆寫現有）。</param>
/// <param name="TagIds">標籤識別碼清單（覆寫現有；若標籤不存在則自動建立）。</param>
/// <param name="BaseVersion">
/// 樂觀鎖 baseVersion（前端載入筆記時記下的 Version；#4/#34）。
/// 帶值時後端以其比對 xmin，衝突回 409；null＝不做併發檢查（last-write-wins）。
/// </param>
public sealed record UpdateNoteRequest(
    string? Title = null,
    string? ContentRaw = null,
    bool? IsDraft = null,
    List<Guid>? CategoryIds = null,
    List<Guid>? TagIds = null,
    long? BaseVersion = null);

/// <summary>
/// AI 排版／美化的請求內容。對「編輯器目前的內容」做轉換（而非伺服器上的已存內容），
/// 以避免覆蓋使用者尚未儲存的編輯；轉換結果回傳給前端套用，由使用者自行決定是否儲存。
/// </summary>
/// <param name="ContentRaw">要轉換的目前 Markdown 內容。</param>
public sealed record AiTransformRequest(
    string ContentRaw);

/// <summary>
/// AI 排版／美化的回應內容（純轉換結果，後端不寫入資料庫）。
/// </summary>
/// <param name="ContentRaw">轉換後的 Markdown 原文。</param>
/// <param name="ContentHtml">轉換後渲染的 HTML（供預覽）。</param>
public sealed record AiTransformResultDto(
    string ContentRaw,
    string ContentHtml);

/// <summary>
/// 框選提問請求：針對筆記內一段選取文字提問，AI 回答後建立「答案筆記」並以錨點關聯回來。
/// </summary>
/// <param name="AnchorText">選取的文字。</param>
/// <param name="AnchorStart">起始位移。</param>
/// <param name="AnchorEnd">結束位移。</param>
/// <param name="AnchorPrefix">前文窗。</param>
/// <param name="AnchorSuffix">後文窗。</param>
/// <param name="Question">使用者的問題。</param>
public sealed record AskSelectionRequest(
    string AnchorText,
    int AnchorStart,
    int AnchorEnd,
    string AnchorPrefix,
    string AnchorSuffix,
    string Question);

/// <summary>
/// 框選提問的回應：新建的「答案筆記」與建立的關聯標註。
/// </summary>
/// <param name="AnswerNoteId">答案筆記識別碼。</param>
/// <param name="AnswerSlug">答案筆記 slug（供前端導航）。</param>
/// <param name="MarkId">建立的關聯標註（NoteMark link）識別碼。</param>
public sealed record AskSelectionResultDto(
    Guid AnswerNoteId,
    string AnswerSlug,
    Guid MarkId);

/// <summary>
/// 框選提問（便利貼模式）的回應：只回傳 AI 答案文字，由前端放進便利貼浮層，
/// 不另建答案筆記。AI 以「整篇筆記內容 + 框選文字」為上下文回答。
/// </summary>
/// <param name="Answer">AI 回答（Markdown）。</param>
public sealed record AskSelectionAnswerDto(string Answer);

/// <summary>
/// 提問佇列項目資料傳輸物件（展示一筆 AiSession 的佇列狀態）。
/// 含來源筆記與答案筆記的關聯資訊（佇列導航用）。
/// </summary>
/// <param name="SessionId">AiSession 識別碼。</param>
/// <param name="Status">狀態：Running / Completed / Failed。</param>
/// <param name="Kind">提問種類：node / floatingnote。</param>
/// <param name="QuestionText">使用者提問文字。</param>
/// <param name="AnchorText">框選文字（floatingnote 時有值）。</param>
/// <param name="NoteId">來源筆記識別碼（floatingnote 時有值；可空若筆記已刪）。</param>
/// <param name="NoteSlug">來源筆記 slug（供前端導航；null 若筆記不存）。</param>
/// <param name="NoteTitle">來源筆記標題（佇列顯示；null 若筆記不存）。</param>
/// <param name="AnswerNoteId">答案筆記識別碼（Completed 時有值；可空）。</param>
/// <param name="AnswerNoteSlug">答案筆記 slug（Completed 時供導航；null 若筆記已刪）。</param>
/// <param name="MarkId">NoteMark 識別碼（來源筆記上的錨點；可空）。</param>
/// <param name="CanvasId">所屬畫布識別碼（node 提問時有值；可空）。</param>
/// <param name="AskNodeId">提問來源節點識別碼（node 提問時有值；可空）。</param>
/// <param name="CreatedDateTime">建立時間（UTC；佇列排序用）。</param>
/// <param name="ErrorText">失敗訊息（Failed 時有值；可空）。</param>
/// <param name="CurrentProvider">Running 時：後援鏈目前正在嘗試的供應者（如「Claude CLI」「Google AI Studio」「banana」）；非 Running 為 null。供小窗即時顯示「目前：…」。</param>
public sealed record AskQueueItemDto(
    Guid SessionId,
    string Status,
    string Kind,
    string? QuestionText,
    string? AnchorText,
    Guid? NoteId,
    string? NoteSlug,
    string? NoteTitle,
    Guid? AnswerNoteId,
    string? AnswerNoteSlug,
    Guid? MarkId,
    Guid? CanvasId,
    Guid? AskNodeId,
    DateTime CreatedDateTime,
    string? ErrorText = null,
    string? CurrentProvider = null);

/// <summary>
/// AI 處理佇列「單筆完整明細」資料傳輸物件。
/// 供「AI 處理佇列」頁面查看單筆的完整輸入（PromptText）、結果、錯誤與逐則串流訊息（log），
/// 便於診斷失敗原因（dropdown 只顯示截斷摘要，看不到完整 log）。
/// </summary>
/// <param name="SessionId">工作階段識別碼。</param>
/// <param name="Status">狀態：Running / Completed / Failed。</param>
/// <param name="Kind">種類：node / floatingnote / beautify / reformat / refine。</param>
/// <param name="QuestionText">提問／標籤文字（佇列顯示用；可空）。</param>
/// <param name="AnchorText">框選文字（floatingnote 時有值；可空）。</param>
/// <param name="PromptText">實際送給 AI 的完整 prompt（除錯用）。</param>
/// <param name="ErrorText">失敗訊息（Failed 時有值；可空）。</param>
/// <param name="TokenUsageJson">token 用量 JSON 字串。</param>
/// <param name="AiProvider">這次實際使用的 AI 供應者（可空；例如 "Groq"、"共用預設（Gemini）"）。</param>
/// <param name="AiModelId">這次實際使用的模型代號（可空；例如 "llama-3.3-70b-versatile"）。</param>
/// <param name="NoteId">來源筆記識別碼（可空）。</param>
/// <param name="NoteSlug">來源筆記 slug（供導航；null 若不存）。</param>
/// <param name="NoteTitle">來源筆記標題（null 若不存）。</param>
/// <param name="AnswerNoteId">答案筆記識別碼（可空）。</param>
/// <param name="AnswerNoteSlug">答案筆記 slug（供導航；可空）。</param>
/// <param name="MarkId">來源筆記上的錨點識別碼（可空）。</param>
/// <param name="CanvasId">所屬畫布識別碼（node 提問時有值；可空）。</param>
/// <param name="AskNodeId">提問來源節點識別碼（可空）。</param>
/// <param name="CreatedDateTime">建立時間（UTC）。</param>
/// <param name="UpdatedDateTime">最後更新時間（UTC；完成／失敗時間）。</param>
/// <param name="Messages">逐則串流訊息（完整 log；依序號排序；node 提問才有，其餘多半為空）。</param>
public sealed record AskQueueDetailDto(
    Guid SessionId,
    string Status,
    string Kind,
    string? QuestionText,
    string? AnchorText,
    string PromptText,
    string? ErrorText,
    string TokenUsageJson,
    string? AiProvider,
    string? AiModelId,
    Guid? NoteId,
    string? NoteSlug,
    string? NoteTitle,
    Guid? AnswerNoteId,
    string? AnswerNoteSlug,
    Guid? MarkId,
    Guid? CanvasId,
    Guid? AskNodeId,
    DateTime CreatedDateTime,
    DateTime UpdatedDateTime,
    IReadOnlyList<AiQueueMessageDto> Messages,
    string? ResultText = null);

/// <summary>
/// AI 處理佇列明細中的「單則串流訊息」資料傳輸物件（完整 log 的一行）。
/// </summary>
/// <param name="SeqNo">串流序號（排序用）。</param>
/// <param name="Role">角色 / 事件型別（assistant / result / error 等）。</param>
/// <param name="Content">訊息文字內容。</param>
/// <param name="CreatedDateTime">建立時間（UTC）。</param>
public sealed record AiQueueMessageDto(
    int SeqNo,
    string Role,
    string Content,
    DateTime CreatedDateTime);

/// <summary>
/// 非同步 AI 動作「已受理」回應：立即回傳追蹤用的 sessionId，前端再輪詢 <c>/api/ask-queue/{sessionId}</c> 取狀態與結果。
/// 用於排版／美化等可能耗時較久（claude 冷啟動）的動作，避免同步等待超過反向代理逾時。
/// </summary>
/// <param name="SessionId">追蹤此次 AI 工作的 AiSession 識別碼。</param>
public sealed record AiAsyncStartedDto(Guid SessionId);

/// <summary>
/// 筆記文字標註資料傳輸物件（重點 / 關聯 / 備註）。
/// </summary>
/// <param name="Id">標註識別碼。</param>
/// <param name="Kind">種類："highlight" / "link" / "annotation"。</param>
/// <param name="AnchorText">錨點文字。</param>
/// <param name="AnchorStart">起始位移。</param>
/// <param name="AnchorEnd">結束位移。</param>
/// <param name="AnchorPrefix">前文窗。</param>
/// <param name="AnchorSuffix">後文窗。</param>
/// <param name="Detached">錨點是否已失效（找不到）。</param>
/// <param name="Color">重點顏色（highlight 用）。</param>
/// <param name="TargetType">關聯目標型別（link 用："note"/"taskcard"/"node"/"url"）。</param>
/// <param name="TargetId">關聯目標實體識別碼（link 用）。</param>
/// <param name="TargetUrl">外部網址（link 用，TargetType="url"）。</param>
/// <param name="TargetTitle">關聯目標顯示名稱（伺服器解析；供 hover 浮窗顯示）。</param>
/// <param name="TargetSlug">關聯目標（筆記）slug，供前端導航（僅 note）。</param>
/// <param name="Text">備註文字（annotation 用）。</param>
public sealed record NoteMarkDto(
    Guid Id,
    string Kind,
    string AnchorText,
    int AnchorStart,
    int AnchorEnd,
    string AnchorPrefix,
    string AnchorSuffix,
    bool Detached,
    string? Color,
    string? TargetType,
    Guid? TargetId,
    string? TargetUrl,
    string? TargetTitle,
    string? TargetSlug,
    string? Text);

/// <summary>
/// 建立筆記文字標註的請求。依 Kind 帶對應欄位。
/// </summary>
/// <param name="Kind">種類："highlight" / "link" / "annotation"。</param>
/// <param name="AnchorText">錨點文字。</param>
/// <param name="AnchorStart">起始位移。</param>
/// <param name="AnchorEnd">結束位移。</param>
/// <param name="AnchorPrefix">前文窗。</param>
/// <param name="AnchorSuffix">後文窗。</param>
/// <param name="Color">重點顏色（highlight 用）。</param>
/// <param name="TargetType">關聯目標型別（link 用）。</param>
/// <param name="TargetId">關聯目標實體識別碼（link 用）。</param>
/// <param name="TargetUrl">外部網址（link 用）。</param>
/// <param name="Text">備註文字（annotation 用）。</param>
public sealed record CreateNoteMarkRequest(
    string Kind,
    string AnchorText,
    int AnchorStart,
    int AnchorEnd,
    string AnchorPrefix,
    string AnchorSuffix,
    string? Color = null,
    string? TargetType = null,
    Guid? TargetId = null,
    string? TargetUrl = null,
    string? Text = null);

/// <summary>
/// 更新筆記文字標註的請求（編輯備註文字或重點顏色）。
/// </summary>
/// <param name="Text">新的備註文字（可空＝不改）。</param>
/// <param name="Color">新的重點顏色（可空＝不改）。</param>
public sealed record UpdateNoteMarkRequest(
    string? Text = null,
    string? Color = null);

/// <summary>
/// 筆記浮層元件資料傳輸物件（便利貼 / 塗鴉 / 圖片輪播）。
/// </summary>
/// <param name="Id">元件識別碼。</param>
/// <param name="Kind">型別："sticky" / "drawing" / "slide"。</param>
/// <param name="X">左上 X（相對內文容器，像素）。</param>
/// <param name="Y">左上 Y。</param>
/// <param name="Width">寬。</param>
/// <param name="Height">高。</param>
/// <param name="ZIndex">疊放順序。</param>
/// <param name="Color">便利貼底色（sticky 用）。</param>
/// <param name="Text">便利貼文字（sticky 用）。</param>
/// <param name="DataJson">型別專屬資料 JSON（drawing 筆畫 / slide 圖片網址）。</param>
/// <param name="IsQuestion">是否被標記為「問題」（僅 sticky / text 適用）。</param>
/// <param name="QuestionAnswer">問題的回答內容（可空；空字串／null 皆視為未作答）。</param>
public sealed record NoteOverlayItemDto(
    Guid Id,
    string Kind,
    double X,
    double Y,
    double Width,
    double Height,
    int ZIndex,
    string? Color,
    string? Text,
    string? DataJson,
    bool IsQuestion,
    string? QuestionAnswer);

/// <summary>
/// 建立筆記浮層元件的請求。
/// </summary>
public sealed record CreateNoteOverlayItemRequest(
    string Kind,
    double X,
    double Y,
    double Width,
    double Height,
    int ZIndex,
    string? Color = null,
    string? Text = null,
    string? DataJson = null);

/// <summary>
/// 更新筆記浮層元件的請求（欄位皆選擇性；null 表不改）。
/// 註：<see cref="QuestionAnswer"/> 遵循 patch 慣例「!= null 才套用（含空字串）」，
/// 故傳空字串代表「清空回答」，傳 null 代表「不更動回答」。
/// </summary>
public sealed record UpdateNoteOverlayItemRequest(
    double? X = null,
    double? Y = null,
    double? Width = null,
    double? Height = null,
    int? ZIndex = null,
    string? Color = null,
    string? Text = null,
    string? DataJson = null,
    bool? IsQuestion = null,
    string? QuestionAnswer = null);

/// <summary>
/// 問題清單項目資料傳輸物件（供筆記頁與分類問題清單頁集中檢視「被標記為問題的浮層元件」）。
/// </summary>
/// <param name="ItemId">浮層元件（問題）識別碼。</param>
/// <param name="NoteId">所屬筆記識別碼。</param>
/// <param name="NoteTitle">所屬筆記標題。</param>
/// <param name="NoteSlug">所屬筆記 slug（供前端導航到該筆記 + ?overlay 定位）。</param>
/// <param name="Kind">浮層型別："sticky"（便利貼）/ "text"（T 文字框）。</param>
/// <param name="QuestionTitle">問題顯示標題（sticky 優先取 DataJson.title；否則取文字前段；再無則預設字樣）。</param>
/// <param name="QuestionText">問題完整文字（浮層的 Text）。</param>
/// <param name="QuestionAnswer">問題的回答內容（可空）。</param>
/// <param name="HasAnswer">是否已作答（回答非空字串且非 null）。</param>
/// <param name="CategoryIds">所屬筆記的分類識別碼陣列（供前端做分類篩選；可為空＝未分類）。</param>
/// <param name="CreatedDateTime">問題（浮層元件）建立時間（UTC）。</param>
public sealed record NoteQuestionListItemDto(
    Guid ItemId,
    Guid NoteId,
    string NoteTitle,
    string NoteSlug,
    string Kind,
    string QuestionTitle,
    string QuestionText,
    string? QuestionAnswer,
    bool HasAnswer,
    IReadOnlyList<Guid> CategoryIds,
    DateTime CreatedDateTime);

/// <summary>
/// 對「一則問題」請 AI 回答的請求（以整篇筆記內容為脈絡，只回文字不落地）。
/// </summary>
/// <param name="Question">問題文字（trim 後必填、長度上限 4000 字元）。</param>
public sealed record AskNoteQuestionRequest(string Question);

/// <summary>
/// 筆記修訂（版本）資料傳輸物件。
/// </summary>
/// <param name="Id">版本識別碼。</param>
/// <param name="RevisionNo">版本序號。</param>
/// <param name="ChangeKind">變更種類（create / update / delete）。</param>
/// <param name="Title">當時的標題快照。</param>
/// <param name="ContentRaw">當時的原始內容快照。</param>
/// <param name="CreatedDateTime">變更時間（UTC）。</param>
/// <param name="CreatedUser">變更者。</param>
public sealed record NoteRevisionDto(
    Guid Id,
    int RevisionNo,
    string ChangeKind,
    string Title,
    string ContentRaw,
    DateTime CreatedDateTime,
    string CreatedUser);

/// <summary>
/// 反向連結資料傳輸物件。
/// </summary>
/// <param name="Id">連結識別碼。</param>
/// <param name="SourceNoteId">來源筆記識別碼。</param>
/// <param name="SourceNoteTitle">來源筆記標題。</param>
/// <param name="SourceNoteSlug">來源筆記 slug。</param>
/// <param name="AnchorText">連結文字。</param>
public sealed record BacklinkDto(
    Guid Id,
    Guid SourceNoteId,
    string SourceNoteTitle,
    string SourceNoteSlug,
    string AnchorText);

/// <summary>
/// 知識圖譜節點資料傳輸物件。
/// </summary>
/// <param name="Id">筆記識別碼。</param>
/// <param name="Title">筆記標題。</param>
/// <param name="Slug">筆記 slug。</param>
/// <param name="Kind">筆記種類。</param>
public sealed record GraphNodeDto(
    Guid Id,
    string Title,
    string Slug,
    string Kind);

/// <summary>
/// 知識圖譜邊資料傳輸物件。
/// </summary>
/// <param name="SourceNoteId">來源筆記識別碼。</param>
/// <param name="TargetNoteId">目標筆記識別碼（可能為 null）。</param>
/// <param name="AnchorText">連結文字。</param>
public sealed record GraphEdgeDto(
    Guid SourceNoteId,
    Guid? TargetNoteId,
    string AnchorText);

/// <summary>
/// 知識圖譜資料傳輸物件。
/// </summary>
/// <param name="Nodes">圖譜節點清單。</param>
/// <param name="Edges">圖譜邊清單。</param>
public sealed record KnowledgeGraphDto(
    List<GraphNodeDto> Nodes,
    List<GraphEdgeDto> Edges);

/// <summary>
/// 筆記標籤資料傳輸物件。
/// </summary>
/// <param name="Id">標籤識別碼。</param>
/// <param name="Name">標籤名稱。</param>
/// <param name="NoteCount">此標籤底下的有效筆記數。</param>
public sealed record NoteTagDto(
    Guid Id,
    string Name,
    int NoteCount);

/// <summary>
/// 全站搜尋結果資料傳輸物件。
/// 支援搜尋筆記、任務卡片、畫布、節點、標籤、分類、快速捕捉，
/// 以及筆記浮層的 T 文字框（overlay-text）與便利貼（overlay-sticky）。
///
/// 脈絡強化欄位（<see cref="Categories"/> / <see cref="Tags"/> / <see cref="UpdatedAt"/> / <see cref="ParentTitle"/>）
/// 皆為選擇性，僅在適用的結果型別上填值（例如分類/標籤只對筆記填、所屬筆記標題只對浮層填），
/// 讓下拉與進階搜尋頁能區分同名筆記、依更新時間排序、標示浮層文字位於哪篇筆記。
/// </summary>
/// <param name="Type">結果類型（note / task / canvas / node / tag / category / capture / overlay-text / overlay-sticky）。</param>
/// <param name="Id">結果識別碼。</param>
/// <param name="Title">結果標題。</param>
/// <param name="Snippet">結果內容摘要（搜尋片段、節點開頭部分，可空）。</param>
/// <param name="Url">結果對應的路由 URL。</param>
/// <param name="Categories">（僅筆記）所屬分類的完整路徑清單，如 <c>學習 / 併發</c>；無分類為空陣列、非筆記為 null。</param>
/// <param name="Tags">（僅筆記）標籤名稱清單；無標籤為空陣列、非筆記為 null。</param>
/// <param name="UpdatedAt">結果實體的更新時間（UTC，供依更新時間排序；可空）。</param>
/// <param name="ParentTitle">（僅浮層）所屬筆記的標題；非浮層為 null。</param>
public sealed record SearchResultDto(
    string Type,
    string Id,
    string Title,
    string? Snippet,
    string Url,
    IReadOnlyList<string>? Categories = null,
    IReadOnlyList<string>? Tags = null,
    DateTime? UpdatedAt = null,
    string? ParentTitle = null);
