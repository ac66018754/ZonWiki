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
    contentRaw: z.string().describe('筆記內容（Markdown 格式）'),
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
    contentRaw: z.string().optional().describe('Markdown 內容'),
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
    contentRaw: z.string().optional().describe('新內容（Markdown，可空；若無傳則保留原值）'),
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
    groupId: z.string().optional().describe('任務群組 ID（可空）'),
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
    recurrenceRule,
  }: {
    title: string
    content?: string
    status?: string
    priority?: number
    plannedDateTime?: string
    dueDateTime?: string
    groupId?: string
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
  '更新現有任務卡片的狀態、優先級、日期或描述。',
  {
    taskId: z.string().describe('任務卡片 ID（UUID）'),
    title: z.string().optional().describe('新標題（可空）'),
    content: z.string().optional().describe('新描述（可空）'),
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
    plannedDateTime: z.string().optional().describe('新計劃日期時間（可空）'),
    dueDateTime: z.string().optional().describe('新截止日期時間（可空）'),
  },
  async ({
    taskId,
    title,
    content,
    status,
    priority,
    plannedDateTime,
    dueDateTime,
  }: {
    taskId: string
    title?: string
    content?: string
    status?: string
    priority?: number
    plannedDateTime?: string
    dueDateTime?: string
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
// 啟動 Server
// ============================================================================

const transport = new StdioServerTransport()
await server.connect(transport)
// stderr 不干擾 stdio 協定，可安全輸出啟動訊息。
console.error(`[zonwiki-mcp] 已連線，後端：${API_BASE}`)
