/**
 * API 領域模組 — AI 提問佇列（Ask Queue）。
 *
 * 對應後端 AiSession：查詢佇列清單與單筆完整明細（含 prompt、逐則串流 log）。
 */

import { fetchJson } from "./client";

// ============================================================================
// API 方法 — Ask Queue (提問佇列)
// ============================================================================

/**
 * 提問佇列項目（來自 AiSession）
 *
 * 注意：後端使用 .NET System.Text.Json 預設的 camelCase 命名（PascalCase property 轉 camelCase JSON）。
 * 因此 JSON 中是 camelCase，但 TypeScript interface 仍使用 camelCase 以符合習慣。
 */
/** AI 處理佇列的工作種類。 */
export type AskQueueKind = 'floatingnote' | 'node' | 'beautify' | 'reformat' | 'refine' | 'notequestion';

/** AI 處理佇列的狀態。 */
export type AskQueueStatus = 'Running' | 'Completed' | 'Failed';

export interface AskQueueItemDto {
  /** 工作階段 ID */
  sessionId: string;
  /** 狀態："Running" | "Completed" | "Failed" */
  status: AskQueueStatus;
  /** 提問種類 */
  kind: AskQueueKind;
  /** 提問文字（來源框選提問內容） */
  questionText: string | null;
  /** 框選片段文字 */
  anchorText: string | null;
  /** 來源筆記 ID */
  noteId?: string | null;
  /** 來源筆記 slug（用於導航；筆記被刪時為 null） */
  noteSlug?: string | null;
  /** 來源筆記標題（用於顯示；筆記被刪時為 null） */
  noteTitle?: string | null;
  /** 答案筆記 ID（Completed 才有） */
  answerNoteId?: string | null;
  /** 答案筆記 slug（用於「看答案」連結；筆記被刪時為 null） */
  answerNoteSlug?: string | null;
  /** 來源筆記上的錨點 mark ID（用於跳轉到框選位置） */
  markId?: string | null;
  /** 畫布 ID（node 提問用） */
  canvasId?: string | null;
  /** 畫布上的 ask 節點 ID（node 提問用，用於聚焦） */
  askNodeId?: string | null;
  /** 建立時間 (UTC ISO 字串) */
  createdDateTime: string;
  /** 失敗錯誤訊息（Failed 狀態時） */
  errorText?: string | null;
  /** Running 時：後援鏈目前正在嘗試的供應者（如「Claude CLI」「Google AI Studio」「banana」）；其餘為 null。 */
  currentProvider?: string | null;
}

/**
 * 取得提問佇列（已認證使用者的 AiSession 記錄）
 * @param status 狀態篩選（可選："Running" | "Completed" | "Failed"）
 * @param kind 種類篩選（可選："floatingnote" | "node"）
 * @param limit 返回筆數（預設 50，上限 200）
 */
export async function getAskQueue(params?: {
  status?: AskQueueStatus;
  kind?: AskQueueKind;
  limit?: number;
}): Promise<AskQueueItemDto[]> {
  const query = new URLSearchParams();
  if (params?.status) query.append('status', params.status);
  if (params?.kind) query.append('kind', params.kind);
  if (params?.limit) query.append('limit', String(params.limit));

  const path = `/api/ask-queue${query.toString() ? `?${query.toString()}` : ''}`;
  const r = await fetchJson<AskQueueItemDto[]>(path);
  return r.success ? r.data ?? [] : [];
}

/**
 * AI 處理佇列明細中的「單則串流訊息」（完整 log 的一行）。
 */
export interface AiQueueMessageDto {
  /** 串流序號（排序用） */
  seqNo: number;
  /** 角色 / 事件型別（assistant / result / error 等） */
  role: string;
  /** 訊息文字內容 */
  content: string;
  /** 建立時間 (UTC ISO 字串) */
  createdDateTime: string;
}

/**
 * AI 處理佇列「單筆完整明細」（含完整 prompt、錯誤與逐則 log）。
 */
export interface AskQueueDetailDto {
  sessionId: string;
  status: AskQueueStatus;
  kind: AskQueueKind;
  questionText: string | null;
  anchorText: string | null;
  /** 實際送給 AI 的完整 prompt（除錯用） */
  promptText: string;
  /** 失敗訊息（Failed 時有值） */
  errorText: string | null;
  /** token 用量 JSON 字串 */
  tokenUsageJson: string;
  /** 這次實際使用的 AI 供應者（例如 "Groq"、"共用預設（Gemini）"） */
  aiProvider?: string | null;
  /** 這次實際使用的模型代號（例如 "llama-3.3-70b-versatile"） */
  aiModelId?: string | null;
  noteId?: string | null;
  noteSlug?: string | null;
  noteTitle?: string | null;
  answerNoteId?: string | null;
  answerNoteSlug?: string | null;
  markId?: string | null;
  canvasId?: string | null;
  askNodeId?: string | null;
  /** 建立時間 (UTC ISO 字串) */
  createdDateTime: string;
  /** 最後更新時間 (UTC ISO 字串；完成／失敗時間) */
  updatedDateTime: string;
  /** 逐則串流訊息（完整 log；依序號排序） */
  messages: AiQueueMessageDto[];
  /** AI 文字結果（非同步排版/美化/便利貼完成時有值；前端輪詢後取回套用到編輯器） */
  resultText?: string | null;
}

/**
 * 取得單筆 AI 處理佇列的完整明細（含完整 log，供「AI 處理佇列」頁診斷）。
 * @param sessionId 工作階段 ID
 * @returns 明細；找不到（或非本人）時為 null。
 */
export async function getAskQueueDetail(sessionId: string): Promise<AskQueueDetailDto | null> {
  const r = await fetchJson<AskQueueDetailDto>(`/api/ask-queue/${encodeURIComponent(sessionId)}`);
  return r.success ? r.data ?? null : null;
}

/**
 * 共用：啟動一個「非同步 AI 工作」後，輪詢佇列直到 Completed（回傳明細）或 Failed（拋錯）。
 *
 * 為什麼非同步輪詢：claude -p 在小機器冷啟動可達數十秒，同步等待會超過反向代理(Cloudflare)的
 * ~100 秒逾時 → 502。改成：端點 POST 立即回 sessionId（<1 秒）→ 之後用「每次 <1 秒的 GET」
 * 輪詢佇列狀態，背景跑完才取回結果，全程不觸發逾時。
 *
 * @param sessionId 由非同步端點回傳的 AiSession id。
 * @returns 完成時的佇列明細（含 resultText / answerNoteId 等）；Failed 或逾時拋例外。
 */
export async function pollAskQueueUntilDone(sessionId: string): Promise<AskQueueDetailDto> {
  const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
  // 前端輪詢上限需大於後端背景總預算(1800s)，否則前端會先喊逾時；給 31 分鐘。
  const deadlineAt = Date.now() + 1860 * 1000;
  while (Date.now() < deadlineAt) {
    const detail = await getAskQueueDetail(sessionId);
    if (detail) {
      if (detail.status === 'Completed') return detail;
      if (detail.status === 'Failed') {
        throw new Error(detail.errorText || 'AI 處理失敗，請稍後重試。');
      }
    }
    await sleep(2000); // Running / 尚未建立 → 稍候再查
  }
  throw new Error('AI 處理逾時，請稍後到「AI 處理佇列」查看。');
}
