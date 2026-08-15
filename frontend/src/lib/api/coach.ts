"use client";

/**
 * API 領域模組 — 英文教練（Phase 3，Vertex Live WS 代理）。
 *
 * 本檔為前端（批次 3）與後端（批次 1/2，並行實作）之間的**契約層**：定義前後端封包協定、
 * REST（開課/清單/取單場，仿 tts.ts＋fetchJson）、WS URL builder、SWR 快取鍵與 hooks。
 *
 * 【前端↔後端封包協定（權威：phase3-final-plan §5–§8）】
 * 前端→後端：
 *   - { type:"audio", data:<base64 PCM16 16k> }   逐段音訊
 *   - { type:"end" }                               手動 VAD 收尾（audioStreamEnd）
 *   - { type:"text", text }                        無麥克風時的文字回合
 *   - { type:"barge_in", approxCutChars }          插話打斷時回報近似截點（供後端落地 ApproxCutChars）
 * 後端→前端（一律容忍欄名分歧，parseServerMessage 正規化）：
 *   - { audio:<base64 PCM16 24k> }
 *   - { transcript, role:"assistant", final:false } AI 逐字
 *   - { transcript, role:"user" }                   使用者整句
 *   - { interrupted:true }                          barge-in
 *   - { type:"turn_end" }                           本回合 AI 講完（定案待定逐字為一則氣泡）
 *   - { state:"listening|thinking|speaking" }
 *   - { correction, ... }                           糾錯卡
 *   - { vocab_added, word }                         已加入單字本
 *   - { type:"rejected", reason }                   入站訊框被拒（超長文字／過大音訊）→ 前端撥回 listening＋提示
 *   - { type:"reconnecting" } / { type:"fatal", reason } / { type:"ended" }
 *
 * WS 路徑：`/ws/coach`（同源、Cookie 認證；跨埠 dev 3000→5009 由 BROWSER_API_BASE 導向）。
 */

import useSWR from "swr";
import { fetchJson, BROWSER_API_BASE } from "./client";

// ============================================================================
// 狀態機狀態
// ============================================================================

/**
 * 連線/對話狀態（useCoachConnection 狀態機）。
 * connecting → listening ⇄ thinking ⇄ speaking；reconnecting（非 fatal 斷線）；
 * ended（正常結束）；fatal（後端斷路器終態，不可重試）。
 */
export type CoachState =
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "reconnecting"
  | "ended"
  | "fatal";

/** 後端明確下發的三態（{state:...}）。 */
export type CoachServerState = "listening" | "thinking" | "speaking";

// ============================================================================
// 協定型別
// ============================================================================

/**
 * 前端送後端的封包。
 */
export type CoachClientMessage =
  | { type: "audio"; data: string }
  | { type: "end" }
  | { type: "text"; text: string }
  // barge-in 近似截點回報：使用者插話打斷 AI 時，前端依播放進度估算「已聽到幾個字」回報後端，
  // 供後端把該截點（ApproxCutChars）落地到被打斷的 assistant 訊息（設計意圖閉環，見 §7）。
  | { type: "barge_in"; approxCutChars: number };

/**
 * 糾錯卡內容（後端 show_correction → CorrectionJson）。
 * 前端對 original ↔ corrected 做逐字 diff（雙載體：顏色＋刪除線/底線＋圖示）。
 */
export interface CoachCorrection {
  /** 使用者原句（含錯誤）。 */
  original: string;
  /** 修正後句子。 */
  corrected: string;
  /** 中文說明（為何要這樣改）。 */
  explanationZh?: string | null;
  /** 更道地的講法（進階版，可空）。 */
  betterVersion?: string | null;
}

/**
 * 正規化後的「後端→前端」事件（app 層離散 union，吸收欄名分歧）。
 */
export type CoachServerEvent =
  | { kind: "audio"; data: string }
  | { kind: "assistantTranscript"; text: string; final: boolean }
  | { kind: "userTranscript"; text: string }
  | { kind: "interrupted" }
  | { kind: "turnEnd" }
  | { kind: "state"; state: CoachServerState }
  | { kind: "correction"; correction: CoachCorrection }
  | { kind: "vocabAdded"; word: string }
  | { kind: "rejected"; reason: string }
  | { kind: "reconnecting" }
  | { kind: "fatal"; reason: string }
  | { kind: "ended" }
  | { kind: "unknown"; raw: unknown };

// ============================================================================
// REST DTO
// ============================================================================

/**
 * 教練場次摘要（清單用）。欄名採容忍式解析。
 */
export interface CoachSessionSummary {
  /** 場次 ID。 */
  id: string;
  /** 標題。 */
  title: string;
  /** 主題（可空）。 */
  topic?: string | null;
  /** 狀態（"active"/"ended"）。 */
  status: string;
  /** 課末摘要（可空；後端 GenerateSummaryAsync 生成）。 */
  summaryText?: string | null;
  /** 開場時間（UTC ISO，可空）。 */
  startedDateTime?: string | null;
  /** 結束時間（UTC ISO，可空）。 */
  endedDateTime?: string | null;
  /** 最後更新時間（UTC ISO，可空）。 */
  updatedDateTime?: string | null;
  /** 累計對話秒數（可空）。 */
  accumulatedSeconds?: number | null;
}

/**
 * 單則歷史訊息。
 */
export interface CoachMessageDto {
  /** 訊息 ID。 */
  id: string;
  /** 角色（"assistant"/"user"）。 */
  role: string;
  /** 逐字內容。 */
  content: string;
  /** 序號（連線內遞增）。 */
  seqNo: number;
  /** 糾錯卡 JSON（原字串，可空；由 detail 解析）。 */
  correctionJson?: string | null;
  /** 是否被打斷（barge-in）。 */
  interruptedFlag?: boolean | null;
  /** 近似截點字元數（barge-in 時）。 */
  approxCutChars?: number | null;
}

/**
 * 場次詳情（歷史逐字稿＋糾錯卡）。
 */
export interface CoachSessionDetail extends CoachSessionSummary {
  /** 訊息列（依 seqNo）。 */
  messages: CoachMessageDto[];
}

// ============================================================================
// 內部：容忍式取值
// ============================================================================

/** 從物件取字串（容忍多欄名）。 */
function pickStr(source: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const v = source[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

/** 從物件取數字（容忍字串數字）。 */
function pickNum(source: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const v = source[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/** 從物件取布林（容忍 "true"/1）。 */
function pickBool(source: Record<string, unknown>, ...keys: string[]): boolean | null {
  for (const key of keys) {
    const v = source[key];
    if (typeof v === "boolean") return v;
    if (v === "true" || v === 1) return true;
    if (v === "false" || v === 0) return false;
  }
  return null;
}

/**
 * 正規化糾錯卡（吸收 snake_case / camelCase 欄名）。
 * @param raw 任意形狀（可能是頂層或 {correction:{...}} 內層）。
 * @returns CoachCorrection 或 null（缺 original/corrected 視為無效）。
 */
function normalizeCorrection(raw: unknown): CoachCorrection | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const original = pickStr(rec, "original", "original_text", "originalText");
  const corrected = pickStr(rec, "corrected", "corrected_text", "correctedText");
  if (original == null || corrected == null) return null;
  return {
    original,
    corrected,
    explanationZh: pickStr(rec, "explanationZh", "explanation_zh", "explanation"),
    betterVersion: pickStr(rec, "betterVersion", "better_version", "better"),
  };
}

// ============================================================================
// 協定解析
// ============================================================================

/**
 * 把後端 WS 原始訊息（已 JSON.parse）正規化為離散事件。容忍欄名分歧與未知型別。
 * @param raw 已解析的 JSON 物件。
 * @returns 正規化事件（未知回 { kind:"unknown" }）。
 */
export function parseServerMessage(raw: unknown): CoachServerEvent {
  if (!raw || typeof raw !== "object") return { kind: "unknown", raw };
  const rec = raw as Record<string, unknown>;

  // 終端/傳輸控制（type 標記優先）。
  const type = pickStr(rec, "type");
  if (type === "fatal") {
    return { kind: "fatal", reason: pickStr(rec, "reason") ?? "unknown" };
  }
  if (type === "ended") return { kind: "ended" };
  if (type === "reconnecting") return { kind: "reconnecting" };
  // 入站訊框被後端拒絕（超長文字／過大音訊）：前端據此撥回 listening 並提示使用者（不可靜默丟棄）。
  if (type === "rejected") {
    return { kind: "rejected", reason: pickStr(rec, "reason") ?? "unknown" };
  }
  // 回合定案訊號（後端於 turnComplete 送出）：前端據此把待定的 AI 逐字定案成一則氣泡。
  if (type === "turn_end") return { kind: "turnEnd" };

  // 音訊（下行 24k base64）。後端實際送 { type:"audio", data:<base64> }；亦容忍舊形狀 { audio:<base64> }。
  const audio = pickStr(rec, "audio", "data");
  if (audio) return { kind: "audio", data: audio };

  // barge-in。後端送 { type:"interrupted" }（無布林欄）；亦容忍 { interrupted:true }。
  if (type === "interrupted" || pickBool(rec, "interrupted")) return { kind: "interrupted" };

  // 狀態。
  const state = pickStr(rec, "state");
  if (state === "listening" || state === "thinking" || state === "speaking") {
    return { kind: "state", state };
  }

  // 糾錯卡（{correction:{...}} 或頂層欄位）。
  if ("correction" in rec) {
    const correction = normalizeCorrection(rec["correction"]) ?? normalizeCorrection(rec);
    if (correction) return { kind: "correction", correction };
  }

  // 已加入單字本。後端送 { type:"vocab_added", word }（vocab_added 是 type 值非鍵）；亦容忍 { vocab_added:"字" } 舊形狀。
  if (type === "vocab_added" || "vocab_added" in rec || "vocabAdded" in rec) {
    const word = pickStr(rec, "word", "vocab_added", "vocabAdded");
    if (word) return { kind: "vocabAdded", word };
  }

  // 逐字稿。
  const transcript = pickStr(rec, "transcript", "text");
  const role = pickStr(rec, "role");
  if (transcript != null && role === "assistant") {
    return {
      kind: "assistantTranscript",
      text: transcript,
      final: pickBool(rec, "final") ?? false,
    };
  }
  if (transcript != null && role === "user") {
    return { kind: "userTranscript", text: transcript };
  }

  return { kind: "unknown", raw };
}

// ============================================================================
// WS URL
// ============================================================================

/**
 * 組出 /ws/coach 的 WebSocket URL（同源、Cookie 認證；http→ws、https→wss）。
 * ⚠️ resumption handle 不由前端帶（由後端從 DB 取，防跨使用者盜用，計畫 §3/§4）；
 *    這裡只帶 sessionId 供後端驗擁有權後續用該場歷史。
 * @param sessionId 既有場次 ID（續接歷史時帶；開新場不帶）。
 * @returns 絕對 ws(s):// URL。
 */
export function coachWsUrl(sessionId?: string | null): string {
  const wsBase = BROWSER_API_BASE.replace(/^http/i, "ws");
  const qs = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
  return `${wsBase}/ws/coach${qs}`;
}

// ============================================================================
// REST
// ============================================================================

/** 正規化場次摘要。 */
function normalizeSession(raw: unknown): CoachSessionSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const id = pickStr(rec, "id", "coachSessionId");
  if (!id) return null;
  return {
    id,
    title: pickStr(rec, "title") ?? "未命名對話",
    topic: pickStr(rec, "topic"),
    status: pickStr(rec, "status") ?? "ended",
    summaryText: pickStr(rec, "summaryText", "summary"),
    startedDateTime: pickStr(rec, "startedDateTime", "started"),
    endedDateTime: pickStr(rec, "endedDateTime", "ended"),
    updatedDateTime: pickStr(rec, "updatedDateTime", "updated"),
    accumulatedSeconds: pickNum(rec, "accumulatedSeconds"),
  };
}

/** 正規化訊息。 */
function normalizeMessage(raw: unknown): CoachMessageDto | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const id = pickStr(rec, "id", "coachMessageId");
  const role = pickStr(rec, "role");
  if (!id || !role) return null;
  return {
    id,
    role,
    content: pickStr(rec, "content") ?? "",
    seqNo: pickNum(rec, "seqNo") ?? 0,
    correctionJson: pickStr(rec, "correctionJson"),
    interruptedFlag: pickBool(rec, "interruptedFlag"),
    approxCutChars: pickNum(rec, "approxCutChars"),
  };
}

/**
 * 開新課（POST /api/coach/sessions）。
 * @param opts 標題/主題（皆可選，後端可自動命名）。
 * @returns 建立的場次摘要；失敗回 null。
 */
export async function createCoachSession(opts?: {
  title?: string | null;
  topic?: string | null;
}): Promise<CoachSessionSummary | null> {
  try {
    const body: Record<string, string> = {};
    if (opts?.title) body.title = opts.title;
    if (opts?.topic) body.topic = opts.topic;
    const r = await fetchJson<unknown>("/api/coach/sessions", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!r.success || !r.data) return null;
    return normalizeSession(r.data);
  } catch {
    return null;
  }
}

/**
 * 場次清單（GET /api/coach/sessions）。
 * @returns 場次摘要陣列；失敗回空陣列（UI 顯示空狀態）。
 */
export async function listCoachSessions(): Promise<CoachSessionSummary[]> {
  try {
    const r = await fetchJson<unknown>("/api/coach/sessions");
    if (!r.success || !Array.isArray(r.data)) return [];
    const out: CoachSessionSummary[] = [];
    for (const item of r.data) {
      const s = normalizeSession(item);
      if (s) out.push(s);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * 正規化單場詳情信封。
 *
 * 後端回傳<b>巢狀</b>信封 `{ session:{...}, messages:[...] }`（CoachSessionDetailDto）；
 * 過去前端誤把 `r.data` 當扁平物件讀 id，導致 normalizeSession 永遠讀不到 id 而回 null（歷史頁全掛）。
 * 這裡優先讀 `data.session`，並容忍未來若後端改為扁平時直接讀 `data`；messages 一律取頂層 `data.messages`。
 * @param data API 回傳的 `data`（單場詳情信封）。
 * @returns 詳情（含依 seqNo 排序的訊息列）；無效回 null。
 */
export function normalizeSessionDetail(data: unknown): CoachSessionDetail | null {
  if (!data || typeof data !== "object") return null;
  const rec = data as Record<string, unknown>;
  // 巢狀信封優先；扁平為後備（容忍後端日後可能攤平）。
  const summary = normalizeSession(rec["session"]) ?? normalizeSession(rec);
  if (!summary) return null;
  const rawMessages = Array.isArray(rec["messages"]) ? (rec["messages"] as unknown[]) : [];
  const messages: CoachMessageDto[] = [];
  for (const m of rawMessages) {
    const dto = normalizeMessage(m);
    if (dto) messages.push(dto);
  }
  messages.sort((a, b) => a.seqNo - b.seqNo);
  return { ...summary, messages };
}

/**
 * 取單場詳情（GET /api/coach/sessions/{id}）。
 * @param id 場次 ID。
 * @returns 詳情（含訊息列）；失敗/404 回 null。
 */
export async function getCoachSession(id: string): Promise<CoachSessionDetail | null> {
  try {
    const r = await fetchJson<unknown>(`/api/coach/sessions/${encodeURIComponent(id)}`);
    if (!r.success) return null;
    return normalizeSessionDetail(r.data);
  } catch {
    return null;
  }
}

/**
 * 解析單則訊息內嵌的糾錯卡（correctionJson → CoachCorrection[]）。
 *
 * 後端把一回合的多張糾錯卡以 `List<object>` 序列化成 JSON<b>陣列</b>寫入 CorrectionJson，
 * 過去前端假設是單一物件、對陣列取不到 original/corrected 而整批解不出。這裡同時支援陣列與
 * 單一物件（舊資料相容），回傳 0..N 張卡，讓歷史 UI 能在一則訊息下顯示多張糾錯卡。
 * @param message 歷史訊息。
 * @returns 糾錯卡陣列（無／解析失敗回空陣列）。
 */
export function parseCorrectionJson(message: CoachMessageDto): CoachCorrection[] {
  if (!message.correctionJson) return [];
  try {
    const parsed: unknown = JSON.parse(message.correctionJson);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    const out: CoachCorrection[] = [];
    for (const item of items) {
      const correction = normalizeCorrection(item);
      if (correction) out.push(correction);
    }
    return out;
  } catch {
    return [];
  }
}

// ============================================================================
// SWR
// ============================================================================

/** 教練 SWR 快取鍵。 */
export const coachSwrKeys = {
  /** 場次清單。 */
  sessions: "coach-sessions",
  /**
   * 單場詳情。
   * @param id 場次 ID。
   */
  session: (id: string) => ["coach-session", id] as const,
} as const;

/**
 * 教練場次清單（客戶端快取）。
 */
export function useCoachSessions() {
  return useSWR<CoachSessionSummary[]>(coachSwrKeys.sessions, () => listCoachSessions());
}

/**
 * 單場詳情（客戶端快取）。id 為空時不發請求。
 * @param id 場次 ID（可空）。
 */
export function useCoachSession(id: string | null) {
  return useSWR<CoachSessionDetail | null>(
    id ? coachSwrKeys.session(id) : null,
    () => (id ? getCoachSession(id) : Promise.resolve(null)),
  );
}
