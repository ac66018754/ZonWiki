#!/usr/bin/env node
/**
 * ZonWiki MCP Server
 *
 * 用途：當你在 Claude Desktop、Claude Code 或其他支援 MCP 的助理聊天時，
 * 可透過這些工具直接讀寫 ZonWiki 知識庫的筆記、任務、畫布與快速捕捉項目。
 *
 * 所有寫入皆呼叫 ZonWiki 的 Web API（預設 http://localhost:5009）。
 * 設定環境變數 ZONWIKI_API_BASE 來指向自訂後端位置。
 *
 * 認證（ZonWiki 後端為 Cookie 認證、強制登入）：
 * - 設定 ZONWIKI_API_COOKIE＝瀏覽器登入後的完整 Cookie 字串（例如 "ZonWikiAuth=...."），
 *   呼叫時會以 Cookie 標頭帶上；這是本機 / 自架最常用的方式。
 * - 或設定 ZONWIKI_API_TOKEN＝Bearer token（若後端改採 token 認證時）。
 * 兩者皆未設定時，請求不帶認證——只適用於未開啟認證的後端，否則會收到 401。
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const API_BASE = process.env.ZONWIKI_API_BASE ?? 'http://localhost:5009'
const API_COOKIE = process.env.ZONWIKI_API_COOKIE
const API_TOKEN = process.env.ZONWIKI_API_TOKEN

/**
 * 摺疊區塊（Notion 式 toggle）寫法提示，接在「筆記內容」類參數說明之後，
 * 讓 AI 透過 MCP 寫筆記時也會主動善用摺疊、提升可讀性（渲染由後端負責）。
 */
const TOGGLE_HINT =
  '。可用「摺疊區塊」讓筆記更易讀：一行 :::toggle 摘要標題、內容、再一行 :::'
  + '（預設收合；:::toggle-open 為預設展開），把長證據/完整程式碼或指令/延伸補充/FAQ 答案'
  + '收進摺疊，但重點與結論留在外面、巢狀勿超過兩層、摺疊標題要能一眼看出內容'

/**
 * 組出每次請求要帶的標頭：Content-Type（有 body 時）+ 認證（Cookie 或 Bearer）。
 */
function buildHeaders(hasBody: boolean): Record<string, string> {
  const headers: Record<string, string> = {}
  if (hasBody) headers['Content-Type'] = 'application/json'
  if (API_COOKIE) headers['Cookie'] = API_COOKIE
  if (API_TOKEN) headers['Authorization'] = `Bearer ${API_TOKEN}`
  return headers
}

/**
 * 呼叫 ZonWiki API 的通用函式（GET/POST/PUT/DELETE）。
 *
 * @param method - HTTP 方法（GET / POST / PUT / DELETE）
 * @param path - API 路徑，含 /api 前綴（例如 /api/notes）
 * @param body - 請求內容（可選，GET 時不需）
 * @returns 已反序列化的響應資料（ApiResponse<T> 的 Data 欄位）
 * @throws 若 API 回傳 error，或 HTTP 狀態非 2xx，拋出 Error
 */
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: buildHeaders(body !== undefined),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  // 後端 ApiResponse 信封以 camelCase 序列化（success/data/error）；
  // 為穩健起見同時容忍 PascalCase（Success/Data/Error），兩者皆可解析。
  const json = (await res.json()) as {
    success?: boolean
    Success?: boolean
    data?: T
    Data?: T
    error?: string
    Error?: string
  }
  const success = json.success ?? json.Success ?? false
  const data = (json.data ?? json.Data) as T
  const error = json.error ?? json.Error
  if (!res.ok || !success) {
    throw new Error(error ?? `HTTP ${res.status}`)
  }
  return data
}

/**
 * 格式化成功回應（JSON 縮排輸出）。
 */
function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}

/**
 * 格式化錯誤回應。
 */
function fail(error: unknown) {
  return { isError: true, content: [{ type: 'text' as const, text: `錯誤：${String(error)}` }] }
}

const server = new McpServer({ name: 'zonwiki', version: '0.1.0' })

// ============================================================================
// 筆記工具（Notes）
// ============================================================================

/**
 * 列出所有筆記（含摘要資訊，可按分類篩選）。
 */
server.tool(
  'list_notes',
  '列出 ZonWiki 中的所有筆記（含標題、slug、更新時間等摘要資訊）。',
  {
    categoryId: z.string().optional().describe('可選：按分類 ID 篩選筆記'),
  },
  async ({ categoryId }: { categoryId?: string }) => {
    try {
      const path = categoryId ? `/api/notes?categoryId=${categoryId}` : '/api/notes'
      return ok(await call('GET', path))
    } catch (e) {
      return fail(e)
    }
  },
)

/**
 * 取得單篇筆記的完整內容（含原始 Markdown、渲染 HTML、留言數）。
 */
server.tool(
  'get_note',
  '取得單篇筆記的完整內容，包括原始 Markdown、渲染後的 HTML 與留言數。',
  {
    slug: z.string().describe('筆記的 URL slug（例如 "python/decorator"）'),
  },
  async ({ slug }: { slug: string }) => {
    try {
      return ok(await call('GET', `/api/notes/${slug}`))
    } catch (e) {
      return fail(e)
    }
  },
)

/**
 * 建立新筆記。
 */
server.tool(
  'create_note',
  '在 ZonWiki 中建立新筆記（低階：分類與標籤須以「既有 ID（GUID）」指定）。'
    + '若你只有分類/標籤的「名稱」、想自動建立巢狀分類，請改用 create_classified_note。',
  {
    title: z.string().describe('筆記標題'),
    contentRaw: z.string().describe('筆記內容（Markdown 格式）' + TOGGLE_HINT),
    kind: z
      .enum(['note', 'journal'])
      .optional()
      .describe('筆記種類，預設 "note"；若為 "journal" 須指定 journalDate'),
    isDraft: z.boolean().optional().describe('是否為草稿，預設 false'),
    journalDate: z.string().optional().describe('日記日期（若 kind = "journal" 時需要，ISO 8601 格式）'),
    categoryIds: z
      .array(z.string())
      .optional()
      .describe('分類 ID（GUID）清單；須為既有分類（可先用 list_categories 取得）。可空。'),
    tagIds: z
      .array(z.string())
      .optional()
      .describe('標籤 ID（GUID）清單；須為既有標籤。可空。'),
  },
  async ({
    title,
    contentRaw,
    kind,
    isDraft,
    journalDate,
    categoryIds,
    tagIds,
  }: {
    title: string
    contentRaw: string
    kind?: string
    isDraft?: boolean
    journalDate?: string
    categoryIds?: string[]
    tagIds?: string[]
  }) => {
    try {
      const journalDateObj = journalDate ? new Date(journalDate) : undefined
      const response = await call('POST', '/api/notes', {
        Title: title,
        ContentRaw: contentRaw,
        Kind: kind ?? 'note',
        IsDraft: isDraft ?? false,
        JournalDate: journalDateObj,
        CategoryIds: categoryIds,
        TagIds: tagIds,
      })
      return ok(response)
    } catch (e) {
      return fail(e)
    }
  },
)

/**
 * 建立並「自動歸類」一篇筆記（推薦給 AI 助理使用）。
 * 分類以「名稱路徑」指定、找不到自動建立巢狀分類；標籤以「名稱」指定、找不到自動建立。
 */
server.tool(
  'create_classified_note',
  '把整理好的內容寫成一篇筆記並自動歸類（推薦）。'
    + 'categoryPath 用「分類名稱路徑」（由上而下，找不到會自動建立巢狀分類），'
    + 'tags 用「標籤名稱」（找不到自動建立）。最適合「幫我把這篇文章/這個目錄整理進某分類」。',
  {
    title: z.string().describe('筆記標題（整理本機檔案時用檔名）'),
    contentRaw: z.string().optional().describe('Markdown 內容' + TOGGLE_HINT),
    categoryPath: z
      .array(z.string())
      .optional()
      .describe('分類名稱路徑（由上而下），例如 ["學習","Python"]；對應資料夾階層'),
    tags: z.array(z.string()).optional().describe('標籤名稱清單（找不到自動建立）'),
    upsert: z
      .boolean()
      .optional()
      .describe('true＝同分類同標題就更新而非新增（避免反覆匯入產生重複）。預設 false'),
  },
  async ({
    title,
    contentRaw,
    categoryPath,
    tags,
    upsert,
  }: {
    title: string
    contentRaw?: string
    categoryPath?: string[]
    tags?: string[]
    upsert?: boolean
  }) => {
    try {
      return ok(
        await call('POST', '/api/ai/notes', {
          Title: title,
          ContentRaw: contentRaw ?? '',
          CategoryPath: categoryPath,
          Tags: tags,
          Upsert: upsert ?? false,
        }),
      )
    } catch (e) {
      return fail(e)
    }
  },
)

/**
 * 更新現有筆記。
 */
server.tool(
  'update_note',
  '更新現有筆記的標題、內容、分類或標籤。',
  {
    noteId: z.string().describe('筆記 ID（UUID）'),
    title: z.string().optional().describe('新標題（可空；若無傳則保留原值）'),
    contentRaw: z.string().optional().describe('新內容（Markdown，可空；若無傳則保留原值）' + TOGGLE_HINT),
    isDraft: z
      .boolean()
      .optional()
      .describe('新的草稿狀態（可空；若無傳則保留原值）'),
    categoryIds: z
      .array(z.string())
      .optional()
      .describe('新分類 ID 清單（覆寫現有）'),
    tags: z
      .array(z.string())
      .optional()
      .describe('新標籤名稱清單（覆寫現有；若標籤不存在則自動建立）'),
  },
  async ({
    noteId,
    title,
    contentRaw,
    isDraft,
    categoryIds,
    tags,
  }: {
    noteId: string
    title?: string
    contentRaw?: string
    isDraft?: boolean
    categoryIds?: string[]
    tags?: string[]
  }) => {
    try {
      return ok(
        await call('PUT', `/api/notes/${noteId}`, {
          Title: title,
          ContentRaw: contentRaw,
          IsDraft: isDraft,
          CategoryIds: categoryIds,
          Tags: tags,
        }),
      )
    } catch (e) {
      return fail(e)
    }
  },
)

/**
 * 搜尋筆記（依標題或內容的關鍵字）。
 */
server.tool(
  'search_notes',
  '搜尋筆記：在標題與內容中以關鍵字查詢符合的筆記。',
  {
    query: z.string().describe('搜尋關鍵字'),
    limit: z.number().optional().describe('回傳結果的上限筆數，預設 20'),
  },
  async ({ query, limit }: { query: string; limit?: number }) => {
    try {
      // 全站搜尋端點為 /api/search?q=...（參數名是 q）；回傳混合型別，這裡只留筆記。
      const params = new URLSearchParams({ q: query, limit: String(limit ?? 20) })
      const results = await call<Array<{ type?: string }>>('GET', `/api/search?${params}`)
      const notes = Array.isArray(results)
        ? results.filter((r) => r?.type === 'note')
        : results
      return ok(notes)
    } catch (e) {
      return fail(e)
    }
  },
)

// ============================================================================
// 分類工具（Categories）
// ============================================================================

/**
 * 列出所有分類（含階層 parentId 與每個分類的有效筆記數）。
 */
server.tool(
  'list_categories',
  '列出 ZonWiki 的所有分類（含上層 parentId 與每個分類的筆記數）。'
    + '建立筆記前可先看一遍，盡量沿用既有分類名稱、避免語意重複。',
  {},
  async () => {
    try {
      return ok(await call('GET', '/api/categories'))
    } catch (e) {
      return fail(e)
    }
  },
)

/**
 * 建立一個新分類（可指定 parentId 形成巢狀分類）。
 */
server.tool(
  'create_category',
  '建立一個新分類（可指定 parentId 形成巢狀分類）。'
    + '若只是要「邊建分類邊建筆記」，用 create_classified_note 更省事（會自動建分類）。',
  {
    name: z.string().describe('分類名稱'),
    parentId: z.string().optional().describe('上層分類 ID（GUID）；不填＝最上層'),
  },
  async ({ name, parentId }: { name: string; parentId?: string }) => {
    try {
      return ok(
        await call('POST', '/api/categories', {
          Name: name,
          ParentId: parentId ?? null,
        }),
      )
    } catch (e) {
      return fail(e)
    }
  },
)

// ============================================================================
// 任務工具（Tasks）
// ============================================================================

/**
 * 列出所有任務卡片。
 */
server.tool(
  'list_tasks',
  '列出目前使用者的所有任務卡片（支援依狀態篩選與排序）。',
  {
    view: z
      .enum(['list', 'board', 'calendar'])
      .optional()
      .describe('視圖類型，預設 "list"；"board" 依狀態分組，"calendar" 依日期範圍'),
    sort: z
      .enum(['plannedDate', 'dueDate', 'createdDate', 'priority'])
      .optional()
      .describe('排序方式，預設 "createdDate"'),
    from: z.string().optional().describe('日期範圍起點（calendar 視圖時用，ISO 8601 格式）'),
    to: z.string().optional().describe('日期範圍終點（calendar 視圖時用，ISO 8601 格式）'),
  },
  async ({
    view,
    sort,
    from,
    to,
  }: {
    view?: string
    sort?: string
    from?: string
    to?: string
  }) => {
    try {
      const params = new URLSearchParams({
        view: view ?? 'list',
        sort: sort ?? 'createdDate',
      })
      if (from) params.append('from', from)
      if (to) params.append('to', to)
      return ok(await call('GET', `/api/tasks?${params}`))
    } catch (e) {
      return fail(e)
    }
  },
)

/**
 * 建立新任務卡片。
 */
server.tool(
  'create_task',
  '在 ZonWiki 中建立新任務卡片（支援優先級、日期、群組等）。',
  {
    title: z.string().describe('任務標題'),
    content: z.string().optional().describe('任務描述（Markdown，可空）'),
    status: z
      .enum(['todo', 'doing', 'done'])
      .optional()
      .describe('任務狀態，預設 "todo"'),
    priority: z
      .number()
      .int()
      .min(0)
      .max(3)
      .optional()
      .describe('優先級（0-3），預設 0'),
    plannedDateTime: z.string().optional().describe('計劃日期時間（ISO 8601，可空）'),
    dueDateTime: z.string().optional().describe('截止日期時間（ISO 8601，可空）'),
    groupId: z.string().optional().describe('任務群組 ID（任務的「分類」；可用 list_task_groups 取得或 create_task_group 建立）'),
    parentId: z.string().optional().describe('父任務 ID（GUID）；填了就是該任務的子任務'),
    recurrenceRule: z
      .string()
      .optional()
      .describe('重複規則（iCal RRULE 格式，可空）'),
  },
  async ({
    title,
    content,
    status,
    priority,
    plannedDateTime,
    dueDateTime,
    groupId,
    parentId,
    recurrenceRule,
  }: {
    title: string
    content?: string
    status?: string
    priority?: number
    plannedDateTime?: string
    dueDateTime?: string
    groupId?: string
    parentId?: string
    recurrenceRule?: string
  }) => {
    try {
      return ok(
        await call('POST', '/api/tasks', {
          Title: title,
          Content: content,
          Status: status ?? 'todo',
          Priority: priority ?? 0,
          PlannedDateTime: plannedDateTime ? new Date(plannedDateTime) : undefined,
          DueDateTime: dueDateTime ? new Date(dueDateTime) : undefined,
          GroupId: groupId,
          ParentId: parentId,
          RecurrenceRule: recurrenceRule,
        }),
      )
    } catch (e) {
      return fail(e)
    }
  },
)

/**
 * 更新現有任務卡片。
 */
server.tool(
  'update_task',
  '更新現有任務卡片的狀態、優先級、日期、描述、群組(分類)或父任務。只傳要改的欄位。',
  {
    taskId: z.string().describe('任務卡片 ID（UUID）'),
    title: z.string().optional().describe('新標題（可空）'),
    content: z.string().optional().describe('新描述（Markdown，可空）'),
    status: z
      .enum(['todo', 'doing', 'done'])
      .optional()
      .describe('新狀態（可空）'),
    priority: z
      .number()
      .int()
      .min(0)
      .max(3)
      .optional()
      .describe('新優先級（可空）'),
    plannedDateTime: z.string().optional().describe('新計劃日期時間（ISO 8601，可空）'),
    dueDateTime: z.string().optional().describe('新截止日期時間（ISO 8601，可空）'),
    groupId: z.string().optional().describe('改到哪個群組(分類) ID（可空）'),
    parentId: z.string().optional().describe('改父任務 ID（可空）'),
    clearPlannedDateTime: z.boolean().optional().describe('true＝清空計劃日期'),
    clearDueDateTime: z.boolean().optional().describe('true＝清空截止日期'),
    clearGroupId: z.boolean().optional().describe('true＝移出群組(分類)'),
    clearParentId: z.boolean().optional().describe('true＝解除父任務（變回頂層任務）'),
  },
  async ({
    taskId,
    title,
    content,
    status,
    priority,
    plannedDateTime,
    dueDateTime,
    groupId,
    parentId,
    clearPlannedDateTime,
    clearDueDateTime,
    clearGroupId,
    clearParentId,
  }: {
    taskId: string
    title?: string
    content?: string
    status?: string
    priority?: number
    plannedDateTime?: string
    dueDateTime?: string
    groupId?: string
    parentId?: string
    clearPlannedDateTime?: boolean
    clearDueDateTime?: boolean
    clearGroupId?: boolean
    clearParentId?: boolean
  }) => {
    try {
      return ok(
        await call('PUT', `/api/tasks/${taskId}`, {
          Title: title,
          Content: content,
          Status: status,
          Priority: priority,
          PlannedDateTime: plannedDateTime ? new Date(plannedDateTime) : undefined,
          DueDateTime: dueDateTime ? new Date(dueDateTime) : undefined,
          GroupId: groupId,
          ParentId: parentId,
          ClearPlannedDateTime: clearPlannedDateTime ?? false,
          ClearDueDateTime: clearDueDateTime ?? false,
          ClearGroupId: clearGroupId ?? false,
          ClearParentId: clearParentId ?? false,
        }),
      )
    } catch (e) {
      return fail(e)
    }
  },
)

// ============================================================================
// 快速捕捉工具（Captures）
// ============================================================================

/**
 * 列出快速捕捉項目（Inbox）。
 */
server.tool(
  'list_captures',
  '列出快速捕捉項目（Inbox）；可依狀態篩選。',
  {
    status: z
      .enum(['inbox', 'filed', 'all'])
      .optional()
      .describe('篩選狀態，預設 "inbox"（未分流的項目）'),
  },
  async ({ status }: { status?: string }) => {
    try {
      const params = new URLSearchParams({ status: status ?? 'inbox' })
      return ok(await call('GET', `/api/captures?${params}`))
    } catch (e) {
      return fail(e)
    }
  },
)

/**
 * 建立快速捕捉項目。
 */
server.tool(
  'create_capture',
  '快速捕捉想法、文字或語音轉文字到 Inbox（待後續分流至筆記或任務）。',
  {
    source: z
      .enum(['web', 'voice', 'text'])
      .describe('來源類型（web：網頁剪貼，voice：語音轉文字，text：直接輸入文字）'),
    rawContent: z.string().describe('捕捉的原始內容（文字或語音轉文字後的結果）'),
    audioPath: z.string().optional().describe('若 source = voice，可提供錄音檔案路徑（可空）'),
  },
  async ({
    source,
    rawContent,
    audioPath,
  }: {
    source: string
    rawContent: string
    audioPath?: string
  }) => {
    try {
      return ok(
        await call('POST', '/api/captures', {
          Source: source,
          RawContent: rawContent,
          AudioPath: audioPath,
        }),
      )
    } catch (e) {
      return fail(e)
    }
  },
)

/**
 * 歸檔捕捉項目（轉換為筆記或任務）。
 */
server.tool(
  'archive_capture',
  '將捕捉項目歸檔：轉換為筆記或任務卡片，標記為已分流。',
  {
    captureId: z.string().describe('捕捉項目 ID（UUID）'),
    targetType: z
      .enum(['note', 'taskcard'])
      .describe('目標類型：轉換為 "note" 還是 "taskcard"'),
    targetId: z.string().describe('目標實體 ID（已存在的筆記或任務卡片 UUID）'),
  },
  async ({
    captureId,
    targetType,
    targetId,
  }: {
    captureId: string
    targetType: string
    targetId: string
  }) => {
    try {
      return ok(
        await call('PUT', `/api/captures/${captureId}/file`, {
          FiledTargetType: targetType,
          FiledTargetId: targetId,
        }),
      )
    } catch (e) {
      return fail(e)
    }
  },
)

// ============================================================================
// 開問啦畫布工具（Canvas）
// ============================================================================

/**
 * 列出所有畫布。
 */
server.tool(
  'list_canvases',
  '列出所有「開問啦」畫布（取得 Canvas ID 以便後續操作）。',
  {},
  async () => {
    try {
      return ok(await call('GET', '/api/canvases'))
    } catch (e) {
      return fail(e)
    }
  },
)

/**
 * 建立新畫布。
 */
server.tool(
  'create_canvas',
  '建立一張新的「開問啦」畫布，回傳含 Canvas_Id 的畫布物件。',
  {
    title: z.string().describe('畫布標題'),
    description: z.string().optional().describe('畫布描述（可空）'),
  },
  async ({ title, description }: { title: string; description?: string }) => {
    try {
      return ok(
        await call('POST', '/api/canvases', {
          Title: title,
          Description: description,
        }),
      )
    } catch (e) {
      return fail(e)
    }
  },
)

/**
 * 取得單張畫布上的所有節點與連線。
 */
server.tool(
  'get_canvas',
  '取得某畫布上的所有節點（框框）與連線，回傳整張圖的完整結構。',
  {
    canvasId: z.string().describe('畫布 ID'),
  },
  async ({ canvasId }: { canvasId: string }) => {
    try {
      return ok(await call('GET', `/api/canvases/${canvasId}`))
    } catch (e) {
      return fail(e)
    }
  },
)

/**
 * 在畫布上建立節點。
 */
server.tool(
  'create_canvas_node',
  '在畫布上建立一個框框（筆記 / 問題 / 回答等）。提供 parentNodeId 時會自動連線到父節點。常用於把目前對話內容存成筆記。',
  {
    canvasId: z.string().describe('畫布 ID'),
    content: z.string().describe('框框內容（Markdown / 純文字）'),
    title: z.string().optional().describe('框框標題（可選）'),
    kind: z
      .enum(['question', 'answer', 'note'])
      .optional()
      .describe('框框種類，預設 "note"'),
    parentNodeId: z
      .string()
      .optional()
      .describe('父節點 ID；提供則自動建立連線'),
    x: z.number().optional().describe('X 座標（可選，預設 0）'),
    y: z.number().optional().describe('Y 座標（可選，預設 0）'),
  },
  async ({
    canvasId,
    content,
    title,
    kind,
    parentNodeId,
    x,
    y,
  }: {
    canvasId: string
    content: string
    title?: string
    kind?: string
    parentNodeId?: string
    x?: number
    y?: number
  }) => {
    try {
      const node = await call<{ Node_Id: string }>('POST', `/api/canvases/${canvasId}/nodes`, {
        Kind: kind ?? 'note',
        Title: title ?? '',
        Content: content,
        ParentId: parentNodeId ?? null,
        X: x ?? 0,
        Y: y ?? 0,
      })
      if (parentNodeId) {
        await call('POST', `/api/canvases/${canvasId}/edges`, {
          SourceNodeId: parentNodeId,
          TargetNodeId: node.Node_Id,
        })
      }
      return ok(node)
    } catch (e) {
      return fail(e)
    }
  },
)

/**
 * 搜尋畫布內的節點。
 */
server.tool(
  'search_canvas_nodes',
  '在某畫布內以關鍵字搜尋節點（標題或內容包含關鍵字）。',
  {
    canvasId: z.string().describe('畫布 ID'),
    query: z.string().describe('搜尋關鍵字'),
  },
  async ({ canvasId, query }: { canvasId: string; query: string }) => {
    try {
      return ok(
        await call('GET', `/api/canvases/${canvasId}/search?query=${encodeURIComponent(query)}`),
      )
    } catch (e) {
      return fail(e)
    }
  },
)

// ============================================================================
// 任務：取得 / 刪除 / 子任務 / 群組(分類)
// ============================================================================

server.tool(
  'get_task',
  '取得單一任務的完整資訊（含子任務與標籤）。',
  { taskId: z.string().describe('任務 ID（GUID）') },
  async ({ taskId }: { taskId: string }) => {
    try {
      return ok(await call('GET', `/api/tasks/${taskId}`))
    } catch (e) {
      return fail(e)
    }
  },
)

server.tool(
  'delete_task',
  '刪除一個任務（軟刪除，進垃圾桶可還原）。會連同其子任務一併刪除。',
  { taskId: z.string().describe('任務 ID（GUID）') },
  async ({ taskId }: { taskId: string }) => {
    try {
      return ok(await call('DELETE', `/api/tasks/${taskId}`))
    } catch (e) {
      return fail(e)
    }
  },
)

server.tool(
  'list_subtasks',
  '列出某任務底下的子任務。',
  { taskId: z.string().describe('父任務 ID（GUID）') },
  async ({ taskId }: { taskId: string }) => {
    try {
      return ok(await call('GET', `/api/tasks/${taskId}/subtasks`))
    } catch (e) {
      return fail(e)
    }
  },
)

server.tool(
  'create_subtask',
  '在某任務底下新增一個子任務。',
  {
    taskId: z.string().describe('父任務 ID（GUID）'),
    title: z.string().describe('子任務標題'),
  },
  async ({ taskId, title }: { taskId: string; title: string }) => {
    try {
      return ok(await call('POST', `/api/tasks/${taskId}/subtasks`, { Title: title }))
    } catch (e) {
      return fail(e)
    }
  },
)

server.tool(
  'update_subtask',
  '更新子任務（改標題或標記完成/未完成）。',
  {
    subtaskId: z.string().describe('子任務 ID（GUID）'),
    title: z.string().optional().describe('新標題（可空）'),
    isDone: z.boolean().optional().describe('是否完成（可空）'),
  },
  async ({ subtaskId, title, isDone }: { subtaskId: string; title?: string; isDone?: boolean }) => {
    try {
      return ok(await call('PUT', `/api/subtasks/${subtaskId}`, { Title: title, IsDone: isDone }))
    } catch (e) {
      return fail(e)
    }
  },
)

server.tool(
  'delete_subtask',
  '刪除一個子任務。',
  { subtaskId: z.string().describe('子任務 ID（GUID）') },
  async ({ subtaskId }: { subtaskId: string }) => {
    try {
      return ok(await call('DELETE', `/api/subtasks/${subtaskId}`))
    } catch (e) {
      return fail(e)
    }
  },
)

server.tool(
  'list_task_groups',
  '列出任務群組（任務的「分類」）。',
  {},
  async () => {
    try {
      return ok(await call('GET', '/api/task-groups'))
    } catch (e) {
      return fail(e)
    }
  },
)

server.tool(
  'create_task_group',
  '建立任務群組（任務的「分類」），可指定顏色。',
  {
    name: z.string().describe('群組名稱'),
    color: z.string().optional().describe('顏色（hex，可空）'),
  },
  async ({ name, color }: { name: string; color?: string }) => {
    try {
      return ok(await call('POST', '/api/task-groups', { Name: name, Color: color }))
    } catch (e) {
      return fail(e)
    }
  },
)

// ============================================================================
// 行事曆（Calendar）— 行事曆即任務的日期視圖；建立/改事件＝建/改帶日期的任務
// ============================================================================

server.tool(
  'get_calendar',
  '查某段時間區間內的行事曆項目（帶有計劃/截止日期的任務、以及日記）。要新增/修改行事曆事件，請用 create_task / update_task 並帶 plannedDateTime / dueDateTime。',
  {
    from: z.string().describe('區間起點（ISO 8601，例如 2026-06-01T00:00:00Z）'),
    to: z.string().describe('區間終點（ISO 8601）'),
  },
  async ({ from, to }: { from: string; to: string }) => {
    try {
      const params = new URLSearchParams({ from, to })
      return ok(await call('GET', `/api/calendar?${params}`))
    } catch (e) {
      return fail(e)
    }
  },
)

// ============================================================================
// 筆記：刪除 / 重新歸類 / 反向連結（補齊 CRUD）
// ============================================================================

server.tool(
  'delete_note',
  '刪除一篇筆記（軟刪除，進垃圾桶可還原）。',
  { noteId: z.string().describe('筆記 ID（GUID）') },
  async ({ noteId }: { noteId: string }) => {
    try {
      return ok(await call('DELETE', `/api/notes/${noteId}`))
    } catch (e) {
      return fail(e)
    }
  },
)

server.tool(
  'set_note_categories',
  '重新設定一篇筆記所屬的分類（整組取代；傳入分類 ID 清單）。傳空陣列＝清空分類。',
  {
    noteId: z.string().describe('筆記 ID（GUID）'),
    categoryIds: z.array(z.string()).describe('分類 ID（GUID）清單；整組取代既有分類'),
  },
  async ({ noteId, categoryIds }: { noteId: string; categoryIds: string[] }) => {
    try {
      // 此端點 body 為「GUID 陣列」本身（非物件）。
      return ok(await call('PUT', `/api/notes/${noteId}/categories`, categoryIds))
    } catch (e) {
      return fail(e)
    }
  },
)

server.tool(
  'get_backlinks',
  '取得指向某篇筆記的反向連結（有哪些筆記用 [[ ]] 連到它）。',
  { noteId: z.string().describe('筆記 ID（GUID）') },
  async ({ noteId }: { noteId: string }) => {
    try {
      return ok(await call('GET', `/api/notes/${noteId}/backlinks`))
    } catch (e) {
      return fail(e)
    }
  },
)

// ============================================================================
// 分類：更新（改名/搬移）/ 刪除（補齊 CRUD）
// ============================================================================

server.tool(
  'update_category',
  '更新分類：改名稱或變更上層分類（搬移）。',
  {
    categoryId: z.string().describe('分類 ID（GUID）'),
    name: z.string().describe('新名稱'),
    parentId: z.string().optional().describe('新的上層分類 ID（GUID）；不填＝移到最上層'),
  },
  async ({ categoryId, name, parentId }: { categoryId: string; name: string; parentId?: string }) => {
    try {
      return ok(await call('PUT', `/api/categories/${categoryId}`, { Name: name, ParentId: parentId ?? null }))
    } catch (e) {
      return fail(e)
    }
  },
)

server.tool(
  'delete_category',
  '刪除分類（軟刪除）。若該分類底下還有子分類或筆記，後端會擋下並要求先清空。',
  { categoryId: z.string().describe('分類 ID（GUID）') },
  async ({ categoryId }: { categoryId: string }) => {
    try {
      return ok(await call('DELETE', `/api/categories/${categoryId}`))
    } catch (e) {
      return fail(e)
    }
  },
)

// ============================================================================
// 關聯 / 反向關聯（跨模組：任務 / 子任務 / 筆記 / 開問啦節點 互連）
// ============================================================================

server.tool(
  'list_links',
  '列出某個項目的所有關聯（雙向）。',
  {
    type: z.enum(['note', 'taskcard', 'subtask', 'node']).describe('項目型別'),
    id: z.string().describe('項目 ID（GUID）'),
  },
  async ({ type, id }: { type: string; id: string }) => {
    try {
      const params = new URLSearchParams({ type, id })
      return ok(await call('GET', `/api/links?${params}`))
    } catch (e) {
      return fail(e)
    }
  },
)

server.tool(
  'get_link_candidates',
  '搜尋「可關聯的對象」候選（依來源型別決定可連的目標；已關聯者會標示）。',
  {
    sourceType: z.enum(['note', 'taskcard', 'subtask', 'node']).describe('來源項目型別'),
    sourceId: z.string().describe('來源項目 ID（GUID）'),
    query: z.string().optional().describe('關鍵字（可空）'),
  },
  async ({ sourceType, sourceId, query }: { sourceType: string; sourceId: string; query?: string }) => {
    try {
      const params = new URLSearchParams({ sourceType, sourceId })
      if (query) params.append('q', query)
      return ok(await call('GET', `/api/links/candidates?${params}`))
    } catch (e) {
      return fail(e)
    }
  },
)

server.tool(
  'create_link',
  '建立兩個項目之間的雙向關聯（任務/子任務/筆記/節點任兩者互連）。',
  {
    sourceType: z.enum(['note', 'taskcard', 'subtask', 'node']).describe('來源型別'),
    sourceId: z.string().describe('來源 ID（GUID）'),
    targetType: z.enum(['note', 'taskcard', 'subtask', 'node']).describe('目標型別'),
    targetId: z.string().describe('目標 ID（GUID）'),
  },
  async ({
    sourceType,
    sourceId,
    targetType,
    targetId,
  }: {
    sourceType: string
    sourceId: string
    targetType: string
    targetId: string
  }) => {
    try {
      return ok(
        await call('POST', '/api/links', {
          SourceType: sourceType,
          SourceId: sourceId,
          TargetType: targetType,
          TargetId: targetId,
        }),
      )
    } catch (e) {
      return fail(e)
    }
  },
)

server.tool(
  'delete_link',
  '解除一個關聯。',
  { linkId: z.string().describe('關聯 ID（GUID；可由 list_links 取得）') },
  async ({ linkId }: { linkId: string }) => {
    try {
      return ok(await call('DELETE', `/api/links/${linkId}`))
    } catch (e) {
      return fail(e)
    }
  },
)

// ============================================================================
// 標籤（Tags）CRUD
// ============================================================================

server.tool(
  'list_tags',
  '列出所有標籤（含每個標籤的筆記數）。',
  {},
  async () => {
    try {
      return ok(await call('GET', '/api/notes/tags'))
    } catch (e) {
      return fail(e)
    }
  },
)

server.tool(
  'create_tag',
  '建立一個標籤（同名已存在則回傳既有的）。',
  { name: z.string().describe('標籤名稱') },
  async ({ name }: { name: string }) => {
    try {
      return ok(await call('POST', '/api/notes/tags', { Name: name }))
    } catch (e) {
      return fail(e)
    }
  },
)

server.tool(
  'delete_tag',
  '刪除一個標籤（軟刪除）。',
  { tagId: z.string().describe('標籤 ID（GUID）') },
  async ({ tagId }: { tagId: string }) => {
    try {
      return ok(await call('DELETE', `/api/notes/tags/${tagId}`))
    } catch (e) {
      return fail(e)
    }
  },
)

// ============================================================================
// 額外：操作軌跡 / 垃圾桶 / 帳號
// ============================================================================

server.tool(
  'get_activity',
  '查詢操作軌跡（誰/哪個 AI、何時、對哪個項目做了什麼）。可用來回顧「AI 最近做了什麼」。預設只看 AI 的操作；source="all" 含人類網頁操作。',
  {
    source: z
      .string()
      .optional()
      .describe('來源篩選：留空＝只看 AI；"all"＝含人類網頁；或指定來源名（例如 "Claude Code"）'),
    entityType: z
      .enum(['note', 'taskcard', 'subtask', 'node', 'capture', 'quicklink', 'prompt', 'aimodel'])
      .optional()
      .describe('只看某種項目型別（可空）'),
    action: z
      .enum(['created', 'updated', 'deleted', 'restored'])
      .optional()
      .describe('只看某種動作（可空）'),
    query: z.string().optional().describe('在標題中搜尋關鍵字（可空）'),
    days: z.number().optional().describe('往前幾天（預設 30，1-365）'),
    take: z.number().optional().describe('回傳筆數上限（預設 50，1-200）'),
    skip: z.number().optional().describe('略過前幾筆（分頁用，預設 0）'),
  },
  async ({
    source,
    entityType,
    action,
    query,
    days,
    take,
    skip,
  }: {
    source?: string
    entityType?: string
    action?: string
    query?: string
    days?: number
    take?: number
    skip?: number
  }) => {
    try {
      const params = new URLSearchParams()
      if (source) params.append('source', source)
      if (entityType) params.append('entityType', entityType)
      if (action) params.append('action', action)
      if (query) params.append('q', query)
      if (days != null) params.append('days', String(days))
      if (take != null) params.append('take', String(take))
      if (skip != null) params.append('skip', String(skip))
      return ok(await call('GET', `/api/home/ai-activity?${params}`))
    } catch (e) {
      return fail(e)
    }
  },
)

server.tool(
  'list_trash',
  '列出垃圾桶內的軟刪除項目（跨模組：筆記/分類/標籤/任務/節點…）。',
  {},
  async () => {
    try {
      return ok(await call('GET', '/api/trash'))
    } catch (e) {
      return fail(e)
    }
  },
)

server.tool(
  'restore_item',
  '從垃圾桶還原一個項目。type 用後端的型別字串（PascalCase），可由 list_trash 的分區鍵取得。',
  {
    type: z
      .enum([
        'Note',
        'Category',
        'Tag',
        'TaskCard',
        'TaskGroup',
        'CaptureItem',
        'QuickLink',
        'Canvas',
        'Node',
      ])
      .describe('項目型別（PascalCase，例如 Note / TaskCard / Category / Tag；可由 list_trash 取得）'),
    id: z.string().describe('項目 ID（GUID；可由 list_trash 取得）'),
  },
  async ({ type, id }: { type: string; id: string }) => {
    try {
      return ok(await call('POST', `/api/trash/${type}/${id}/restore`))
    } catch (e) {
      return fail(e)
    }
  },
)

server.tool(
  'whoami',
  '回報目前是哪個帳號在操作（確認權杖接的是對的帳號/環境）。',
  {},
  async () => {
    try {
      return ok(await call('GET', '/api/me'))
    } catch (e) {
      return fail(e)
    }
  },
)

// ============================================================================
// 精煉成筆記（給一個 URL，後端抓字幕/音訊轉錄後整理成分類筆記）
// ============================================================================

server.tool(
  'refine_url',
  '把一個連結（YouTube / podcast / 文章…）「精煉成筆記」：後端會抓字幕或音訊轉錄，再用 AI 整理成分類筆記。'
    + '此為非同步：立即回傳 sessionId，實際處理在背景進行（進度在 ZonWiki 的「AI 處理中」佇列）。'
    + '注意：沒字幕的音訊需要使用者在個人頁把轉錄引擎設為 Groq 並填金鑰。',
  {
    url: z.string().describe('內容連結（http/https）'),
  },
  async ({ url }: { url: string }) => {
    try {
      return ok(await call('POST', '/api/refine', { Url: url }))
    } catch (e) {
      return fail(e)
    }
  },
)

// ============================================================================
// 啟動 Server
// ============================================================================

const transport = new StdioServerTransport()
await server.connect(transport)
// stderr 不干擾 stdio 協定，可安全輸出啟動訊息。
console.error(`[zonwiki-mcp] 已連線，後端：${API_BASE}`)
