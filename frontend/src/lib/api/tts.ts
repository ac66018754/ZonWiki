/**
 * API 領域模組 — TTS（筆記朗讀 / Podcast v1）。
 *
 * 本檔為 TTS 前端（WP-B）與後端（WP-A，同波實作）之間的契約層，樣板照 `./vocabulary.ts`。
 * 後端端點（見 plan-tts-backend.md §1）：
 *   - POST /api/tts/notes/{noteId}/synthesize  → 觸發合成／命中快取（掛 AiPolicy 限流）
 *   - GET  /api/tts/audio/{id}/status          → 輪詢合成狀態
 *   - GET  /api/tts/audio/{id}                 → 授權供檔（HTTP Range；<audio> 播放用）
 *   - GET  /api/tts/voices                     → 30 聲清單
 *   - GET/PUT /api/me/tts-settings             → 使用者朗讀偏好
 *   - POST /api/tts/preview（對齊點 B，後端尚未提供）→ 短句試聽
 *
 * ⚠️ 欄名對齊（本層「同時容忍兩種欄名」以吸收兩份計畫的分歧；監工整合時核對）：
 *   A. 音檔主鍵：後端 DTO 為 `TtsSynthesizeResponseDto.Id` → JSON `data.id`；
 *      工作包契約卻寫 `ttsAudioId`。本層一律讀 `id ?? ttsAudioId`，對外統一暴露為 `ttsAudioId`，
 *      使後端無論用哪個欄名前端都不會拿到 undefined（避免 ttsAudioUrl(undefined) 全鏈崩潰）。
 *   B. 章節時間位移：後端 `ChapterDto.OffsetSeconds` → `offsetSeconds`；前端計畫用 `startSeconds`。
 *      本層讀 `offsetSeconds ?? startSeconds`，對外統一暴露為 `startSeconds`（播放器 audio.currentTime 用）。
 *   C. 聲音風格標籤：後端 `VoiceDto.StyleLabel` → `styleLabel`；前端舊欄名 `label`。
 *      本層兩者皆保留（`formatVoiceLabel` 優先 styleLabel、退 label）。
 *   D. 設定聲音欄：後端 `TtsSettingsDto.DefaultVoice` → `defaultVoice`；工作包契約寫 `voice`。
 *      GET 讀 `defaultVoice ?? voice`；PUT 兩個欄名都送（後端讀哪個都work）。
 *   E. 快取命中（設計 §5 驗收②「重播零成本」）：POST synthesize 命中時回 `{ status:"ready", id,
 *      durationSeconds, chapters }`——本層 `SynthesizeResult` 一併接收 chapters/durationSeconds，
 *      使快取命中路徑（不打 /status）仍拿得到章節列表（否則章節列表會空白）。
 *   F. 跨源音檔（dev 3000→5009）：<audio> 走 `crossOrigin="use-credentials"`＋Cookie 認證
 *      （PAT Bearer 無法用於 <audio>）；後端該端點需 allow-credentials＋Range＋
 *      `Access-Control-Expose-Headers` 含 Content-Range/Accept-Ranges/Content-Length。
 *
 * 容錯原則（照記帳/單字庫慣例）：
 *   - 打付費 TTS 的 synthesize/preview 可能回 429（fetchJson 會 throw）→ 一律 try/catch 收成
 *     `{ ok:false, rateLimited? }`，UI 顯示「請稍候再試」而非未捕捉 rejection。
 *   - GET 類失敗一律回空/null，讓 UI 顯示空狀態或降級，不崩。
 */

import { fetchJson } from "./client";
import { BROWSER_API_BASE } from "./client";

// ============================================================================
// 常數
// ============================================================================

/**
 * 系統預設聲音（後端未設定時的保底；recon 實打 cmn-TW 200 的女聲）。
 */
export const DEFAULT_TTS_VOICE = "Kore";

/**
 * 系統預設語言（cmn-TW 為 Preview，實聽定案前的保底）。
 */
export const DEFAULT_TTS_LANGUAGE = "cmn-TW";

/**
 * 系統預設音檔格式（MP3 保底、OGG_OPUS 進階）。
 */
export const DEFAULT_TTS_FORMAT = "MP3";

// ============================================================================
// 資料型別
// ============================================================================

/**
 * 合成狀態。
 */
export type TtsStatus = "processing" | "ready" | "failed";

/**
 * 朗讀模式（Phase 3）。
 * - `read`：單人朗讀（預設）。
 * - `dialogue`：雙主持人 Podcast 對談（成本較高，手動觸發、非預設）。
 */
export type TtsMode = "read" | "dialogue";

/**
 * 一個可選聲音。對應後端 VoiceDto（欄名 camelCase）。
 */
export interface TtsVoice {
  /** 聲音代號（如 "Kore"）——合成時原樣送 voice。 */
  name: string;
  /** 性別（"male"/"female"/其他/空）。 */
  gender?: string | null;
  /** ⚠️對齊 C：後端風格標籤（如「女・清亮」；優先顯示）。 */
  styleLabel?: string | null;
  /** ⚠️對齊 C：舊欄名相容（部分回應可能用 `label`）。 */
  label?: string | null;
  /** 語言（如 "cmn-TW"）。 */
  language?: string | null;
  /** 風格/個性補述（可空）。 */
  description?: string | null;
}

/**
 * 一個章節（供章節列表與跳段）。
 * `startSeconds` 為統一後的欄名（來源可能是後端 `offsetSeconds`）。
 */
export interface TtsChapter {
  /** 章節標題。 */
  title: string;
  /** 章節起始時間位移（秒）。 */
  startSeconds: number;
}

/**
 * POST /synthesize 的正規化結果。
 * ⚠️對齊 A/E：`ttsAudioId` 統一自 `id ?? ttsAudioId`；快取命中時一併帶回 chapters/durationSeconds。
 */
export interface SynthesizeResult {
  /** 音檔 ID（統一欄名）。 */
  ttsAudioId: string;
  /** 目前狀態（processing＝背景合成中、ready＝快取命中或已就緒）。 */
  status: TtsStatus;
  /** 章節（快取命中時後端會帶；processing 時通常為空、待 ready 後補）。 */
  chapters?: TtsChapter[] | null;
  /** 總時長（秒，可空；快取命中時後端會帶）。 */
  durationSeconds?: number | null;
}

/**
 * GET /status 的正規化結果。
 */
export interface TtsStatusResult {
  /** 目前狀態。 */
  status: TtsStatus;
  /** 章節（ready 時應有；口語稿降級為純文字時為空）。 */
  chapters?: TtsChapter[] | null;
  /** 總時長（秒，可空；ffprobe 不可用時後端回 null，前端改靠 <audio>.duration）。 */
  durationSeconds?: number | null;
  /** 失敗訊息（status=failed 時）。 */
  error?: string | null;
  /** 進度：已完成段數（後端若提供則顯示 n/N）。 */
  segmentsDone?: number | null;
  /** 進度：總段數（後端若提供則顯示 n/N）。 */
  segmentsTotal?: number | null;
}

/**
 * 使用者朗讀偏好。對應後端 TtsSettingsDto。
 */
export interface TtsSettings {
  /** ⚠️對齊 D：預設聲音（統一自 `defaultVoice ?? voice`）。 */
  defaultVoice: string;
  /** 預設語言。 */
  language?: string | null;
  /** 預設音檔格式。 */
  format?: string | null;
}

/**
 * synthesize/preview 的統一回傳（容錯：429/連線一律收斂為 ok:false）。
 */
export interface SynthesizeCallResult {
  /** 是否成功取得結果。 */
  ok: boolean;
  /** 成功時的正規化結果。 */
  result?: SynthesizeResult;
  /** 是否因限流（429）被拒（UI 顯示「請稍候再試」）。 */
  rateLimited?: boolean;
  /** 錯誤訊息（供 UI 提示）。 */
  error?: string | null;
}

/**
 * previewVoice 的回傳（多一個 `available` 表示後端 preview 端點是否就緒）。
 */
export interface PreviewCallResult extends SynthesizeCallResult {
  /** 後端 preview 端點是否可用（404 → false，前端灰掉試聽鈕）。 */
  available: boolean;
}

// ============================================================================
// 內部：正規化（吸收欄名分歧）
// ============================================================================

/**
 * 從任意鍵取字串（容忍 null/undefined/非字串）。
 */
function pickString(source: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

/**
 * 從任意鍵取數字（容忍 null/undefined/字串數字）。
 */
function pickNumber(source: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/**
 * 正規化章節陣列（⚠️對齊 B：offsetSeconds ↔ startSeconds）。
 * @param raw 後端回的章節陣列（任意形狀）。
 * @returns 正規化章節；缺省/非陣列回 null。
 */
function normalizeChapters(raw: unknown): TtsChapter[] | null {
  if (!Array.isArray(raw)) return null;
  const chapters: TtsChapter[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const start = pickNumber(rec, "offsetSeconds", "startSeconds");
    if (start == null) continue; // 沒有可用時間位移的章節略過（跳段會失效）
    const title = pickString(rec, "title") ?? "";
    chapters.push({ title, startSeconds: start });
  }
  return chapters.length > 0 ? chapters : null;
}

/**
 * 正規化單一聲音（保留 styleLabel 與 label 兩欄名）。
 */
function normalizeVoice(raw: unknown): TtsVoice | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const name = pickString(rec, "name");
  if (!name) return null;
  return {
    name,
    gender: pickString(rec, "gender"),
    styleLabel: pickString(rec, "styleLabel"),
    label: pickString(rec, "label"),
    language: pickString(rec, "language"),
    description: pickString(rec, "description"),
  };
}

/**
 * 正規化設定（⚠️對齊 D：defaultVoice ↔ voice）。
 */
function normalizeSettings(raw: unknown): TtsSettings | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const voice = pickString(rec, "defaultVoice", "voice");
  return {
    defaultVoice: voice ?? DEFAULT_TTS_VOICE,
    language: pickString(rec, "language"),
    format: pickString(rec, "format"),
  };
}

/**
 * 正規化 synthesize/status 回應的音檔主鍵＋狀態（⚠️對齊 A）。
 */
function normalizeSynthesizeResult(raw: unknown): SynthesizeResult | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const id = pickString(rec, "id", "ttsAudioId");
  const status = pickString(rec, "status");
  if (!id || !status) return null;
  return {
    ttsAudioId: id,
    status: status as TtsStatus,
    chapters: normalizeChapters(rec["chapters"]),
    durationSeconds: pickNumber(rec, "durationSeconds"),
  };
}

/**
 * 判斷丟出的錯誤是否為限流（429）。
 */
function isRateLimitError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /\b429\b/.test(message);
}

// ============================================================================
// API 方法
// ============================================================================

/**
 * 觸發某筆記的 TTS 合成（或命中既有快取）。
 *
 * 成功回 `{ ok:true, result }`；result.status 可能是 processing（要輪詢）或 ready（快取命中，直接播）。
 * 429/連線錯誤一律收斂為 `{ ok:false, rateLimited? }`（fetchJson 對 429 會 throw，這裡 try/catch）。
 * @param noteId 筆記 ID。
 * @param opts 聲音/語言/格式（皆可選，缺省後端回退 tts-settings→系統預設）。
 * @returns 統一回傳。
 */
export async function synthesizeNote(
  noteId: string,
  opts?: {
    voice?: string | null;
    language?: string | null;
    format?: string | null;
    /** 朗讀模式（Phase 3）："read"＝單人朗讀（預設）／"dialogue"＝雙主持人 Podcast 對談。 */
    mode?: TtsMode | null;
  },
): Promise<SynthesizeCallResult> {
  try {
    const body: Record<string, string> = {};
    if (opts?.voice) body.voice = opts.voice;
    if (opts?.language) body.language = opts.language;
    if (opts?.format) body.format = opts.format;
    if (opts?.mode) body.mode = opts.mode;
    const r = await fetchJson<unknown>(
      `/api/tts/notes/${encodeURIComponent(noteId)}/synthesize`,
      { method: "POST", body: JSON.stringify(body) },
    );
    if (!r.success || !r.data) {
      return { ok: false, error: r.error ?? "合成請求失敗" };
    }
    const result = normalizeSynthesizeResult(r.data);
    if (!result) return { ok: false, error: "合成回應格式不符" };
    return { ok: true, result };
  } catch (err) {
    return {
      ok: false,
      rateLimited: isRateLimitError(err),
      error: isRateLimitError(err) ? "請求太頻繁，請稍候再試" : "合成請求失敗",
    };
  }
}

/**
 * 輪詢合成狀態。
 * @param ttsAudioId 音檔 ID。
 * @returns 正規化狀態；連線/解析失敗回 null（輪詢層據此重試/放棄）。
 */
export async function getTtsStatus(ttsAudioId: string): Promise<TtsStatusResult | null> {
  try {
    const r = await fetchJson<unknown>(
      `/api/tts/audio/${encodeURIComponent(ttsAudioId)}/status`,
    );
    if (!r.success || !r.data || typeof r.data !== "object") return null;
    const rec = r.data as Record<string, unknown>;
    const status = pickString(rec, "status");
    if (!status) return null;
    return {
      status: status as TtsStatus,
      chapters: normalizeChapters(rec["chapters"]),
      durationSeconds: pickNumber(rec, "durationSeconds"),
      error: pickString(rec, "error"),
      segmentsDone: pickNumber(rec, "segmentsDone"),
      segmentsTotal: pickNumber(rec, "segmentsTotal"),
    };
  } catch {
    return null;
  }
}

/**
 * 產生 <audio> 用的音檔 URL（⚠️對齊 F：搭配 `crossOrigin="use-credentials"`）。
 * @param ttsAudioId 音檔 ID。
 * @returns 絕對 URL（指向後端，供跨源播放）。
 */
export function ttsAudioUrl(ttsAudioId: string): string {
  return `${BROWSER_API_BASE}/api/tts/audio/${encodeURIComponent(ttsAudioId)}`;
}

/**
 * 取得 30 聲清單。
 * @returns 正規化聲音陣列；失敗回空陣列（UI 顯示「聲音清單載入失敗」）。
 */
export async function listTtsVoices(): Promise<TtsVoice[]> {
  try {
    const r = await fetchJson<unknown>("/api/tts/voices");
    if (!r.success || !Array.isArray(r.data)) return [];
    const voices: TtsVoice[] = [];
    for (const item of r.data) {
      const voice = normalizeVoice(item);
      if (voice) voices.push(voice);
    }
    return voices;
  } catch {
    return [];
  }
}

/**
 * 取得使用者朗讀偏好。
 * @returns 正規化設定；404（端點未就緒）/失敗回 null（降級用系統預設）。
 */
export async function getTtsSettings(): Promise<TtsSettings | null> {
  try {
    const r = await fetchJson<unknown>("/api/me/tts-settings");
    if (!r.success || !r.data) return null;
    return normalizeSettings(r.data);
  } catch {
    return null;
  }
}

/**
 * 更新使用者朗讀偏好（⚠️對齊 D：defaultVoice 與 voice 兩欄名都送）。
 * @param patch 欲更新的欄位。
 * @returns 更新後設定；失敗回 null（toast 提示但不阻斷）。
 */
export async function updateTtsSettings(patch: {
  voice?: string | null;
  language?: string | null;
  format?: string | null;
}): Promise<TtsSettings | null> {
  try {
    const body: Record<string, string> = {};
    if (patch.voice) {
      // 兩個欄名都送：後端無論讀 defaultVoice 或 voice 都能吃到。
      body.defaultVoice = patch.voice;
      body.voice = patch.voice;
    }
    if (patch.language) body.language = patch.language;
    if (patch.format) body.format = patch.format;
    const r = await fetchJson<unknown>("/api/me/tts-settings", {
      method: "PUT",
      body: JSON.stringify(body),
    });
    if (!r.success || !r.data) return null;
    return normalizeSettings(r.data);
  } catch {
    return null;
  }
}

/**
 * 試聽某聲音（合成短句）。對齊點 B：後端 preview 端點尚未提供。
 *
 * 命中 404（端點未就緒）→ `{ ok:false, available:false }`（前端灰掉試聽鈕）。
 * 端點就緒且成功 → `{ ok:true, available:true, result }`（前端用暫態 Audio 播放試聽）。
 * @param voice 聲音代號。
 * @param text 試聽短句（可空，後端可用預設句）。
 * @returns 試聽結果。
 */
export async function previewVoice(
  voice: string,
  text?: string,
): Promise<PreviewCallResult> {
  try {
    const body: Record<string, string> = { voice };
    if (text) body.text = text;
    const r = await fetchJson<unknown>("/api/tts/preview", {
      method: "POST",
      body: JSON.stringify(body),
    });
    // 404＝端點未就緒（fetchJson 不 throw、回帶 statusCode 的失敗信封）。
    if (r.statusCode === 404) {
      return { ok: false, available: false, error: "試聽端點未就緒" };
    }
    if (!r.success || !r.data) {
      return { ok: false, available: true, error: r.error ?? "試聽失敗" };
    }
    const result = normalizeSynthesizeResult(r.data);
    if (!result) return { ok: false, available: true, error: "試聽回應格式不符" };
    return { ok: true, available: true, result };
  } catch (err) {
    return {
      ok: false,
      available: true,
      rateLimited: isRateLimitError(err),
      error: isRateLimitError(err) ? "請求太頻繁，請稍候再試" : "試聽失敗",
    };
  }
}
