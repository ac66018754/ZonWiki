/**
 * TTS 迷你播放器的「純函式」核心（無 React、無 DOM 依賴）。
 *
 * 本檔集中所有可獨立驗證的邏輯：時間格式化、seek 夾限、當前章節計算、
 * 播放狀態機轉移、續聽位置／語速的 localStorage 讀寫（皆容錯），以及
 * 聲音顯示標籤格式化。抽成純函式的用意：
 *   1. 可用 scratchpad 的 node 腳本鎖死向量（TDD 的 RED→GREEN），不需啟動瀏覽器。
 *   2. React 元件只負責「接事件、呼叫這些純函式、把結果套到 <audio>」，降低耦合。
 *
 * localStorage 讀寫一律 try/catch＋`typeof window` 守衛：
 *   - SSR（無 window）不觸碰 storage；
 *   - 使用者停用 storage／配額滿／壞 JSON 一律靜默降級（回預設值），絕不讓整頁崩。
 *
 * 為了讓 node 測試腳本能在無 `window` 的環境驗證讀寫邏輯，
 * 所有 storage 相關函式都接受可選的 `storage` 參數（注入一個 Map 後端的假 storage），
 * 缺省時才落回瀏覽器的 `window.localStorage`。
 */

// ============================================================================
// 常數
// ============================================================================

/** 續聽位置（各 ttsAudioId → 秒數）的 localStorage 鍵。 */
export const TTS_PROGRESS_STORAGE_KEY = "zonwiki:tts:progress";

/** 播放語速（device 級偏好，跨筆記共用）的 localStorage 鍵。 */
export const TTS_RATE_STORAGE_KEY = "zonwiki:tts:rate";

/** ±快轉/倒轉的固定秒數。 */
export const TTS_SEEK_STEP_SECONDS = 15;

/** 可選語速清單（下拉用；1 為預設）。 */
export const TTS_RATE_OPTIONS: readonly number[] = [0.75, 1, 1.25, 1.5, 2] as const;

/** 預設語速。 */
export const TTS_DEFAULT_RATE = 1;

/** 輪詢合成狀態的間隔（毫秒）。 */
export const TTS_POLL_INTERVAL_MS = 1500;

/**
 * 輪詢的絕對安全上限（毫秒）。
 * 對齊後端合成硬預算（`Tts:SynthesisBudgetSeconds` 預設 600 秒）並外加緩衝——
 * 長筆記要切段→逐段 us/eu 往返→ffmpeg concat，5 分鐘音訊的筆記合成可能 >90 秒，
 * 故**不以固定 90 秒判死**（那會在後端仍正常進行時給使用者假失敗）。
 * 只要 `/status` 持續回 processing 就繼續輪詢，直到後端回 failed／超過此絕對上限／連線連續失敗過多。
 */
export const TTS_POLL_MAX_MS = 15 * 60 * 1000; // 15 分鐘，> 後端 600 秒預算

/** 連續幾次 `/status` 取不到（null）才判定失敗（容忍暫時性連線抖動）。 */
export const TTS_POLL_MAX_CONSECUTIVE_ERRORS = 8;

/** 續聽位置節流寫入的間隔（毫秒；timeupdate 高頻，不必每次都寫）。 */
export const TTS_PROGRESS_SAVE_THROTTLE_MS = 5000;

/**
 * 續聽套用的「結尾保護秒數」：存檔位置若落在 `duration - 這個值` 之後，
 * 視為「已聽到尾聲」而不還原（避免一開就跳到最後兩秒）。
 */
export const TTS_RESUME_END_GUARD_SECONDS = 2;

// ============================================================================
// 型別
// ============================================================================

/**
 * 播放器階段（player phase），對應設計 §6.3／計畫 §7.1 的狀態機。
 */
export type TtsPlayerPhase =
  | "idle" // 尚未觸發（播放器未開）
  | "requesting" // 已按聆聽、synthesize 請求飛行中
  | "processing" // 後端合成中 → 輪詢 status
  | "ready" // 音檔就緒、src 已設、等使用者手勢播放（不自動播）
  | "playing" // 使用者已按播放，audio 播放中
  | "paused" // 播放中暫停
  | "failed"; // 合成失敗 / 音檔載入失敗 / 逾時

/**
 * 驅動狀態機的事件。
 */
export type TtsPlayerEvent =
  | "listen" // 使用者按 🎧 聆聽
  | "synthProcessing" // synthesize 回 processing
  | "synthReady" // synthesize 回 ready（快取命中）
  | "synthFailed" // synthesize 失敗 / 429 / failed
  | "pollReady" // 輪詢得 ready
  | "pollFailed" // 輪詢得 failed / 逾時
  | "play" // 使用者按 ▶
  | "pause" // 使用者按 ⏸
  | "ended" // 播放結束
  | "loadError" // <audio> error 事件
  | "retry" // 失敗後重試
  | "close"; // 關閉播放器

/**
 * 章節（供播放器章節列表與跳段）。
 * `startSeconds` 為該章節在音檔中的起始時間位移（秒）。
 */
export interface TtsChapterVector {
  /** 章節標題。 */
  title: string;
  /** 章節起始時間位移（秒）。 */
  startSeconds: number;
}

/**
 * 聲音顯示標籤格式化的輸入（僅取用需要的欄位）。
 */
export interface VoiceLabelInput {
  /** 聲音代號（如 "Kore"）。 */
  name: string;
  /** 性別（"male"/"female"/其他/空）。 */
  gender?: string | null;
  /** 後端提供的風格標籤（如「女・清亮」；優先顯示）。 */
  styleLabel?: string | null;
  /** 舊欄名相容：部分回應可能用 `label`。 */
  label?: string | null;
}

/**
 * 最小化的 storage 介面（供測試注入 Map 後端的假 storage）。
 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

// ============================================================================
// 內部：安全取得 storage
// ============================================================================

/**
 * 取得可用的 storage：優先用傳入的（測試注入），否則落回瀏覽器 localStorage。
 * SSR（無 window）或存取被拒 → 回 null，呼叫端據此靜默降級。
 * @param injected 測試注入的假 storage（可選）。
 * @returns 可用的 storage 或 null。
 */
function resolveStorage(injected?: StorageLike | null): StorageLike | null {
  if (injected) return injected;
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // 某些隱私模式存取 localStorage 會直接丟例外。
    return null;
  }
}

// ============================================================================
// 時間格式化與 seek
// ============================================================================

/**
 * 把秒數格式化成 `m:ss`（未滿一小時）或 `h:mm:ss`（滿一小時）。
 * 非法輸入（NaN／負數／Infinity）一律回 `"0:00"`。
 * @param totalSeconds 秒數。
 * @returns 人類可讀的時間字串。
 */
export function formatDuration(totalSeconds: number): string {
  if (
    typeof totalSeconds !== "number" ||
    !Number.isFinite(totalSeconds) ||
    totalSeconds < 0
  ) {
    return "0:00";
  }
  const total = Math.floor(totalSeconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) {
    const mm = String(minutes).padStart(2, "0");
    return `${hours}:${mm}:${ss}`;
  }
  return `${minutes}:${ss}`;
}

/**
 * 把目標播放秒數夾限到合法範圍。
 * 下限一律 0；上限只有在 `duration` 為有限正數時才套用（未知時長時不做上限夾限）。
 * @param target 目標秒數（可能來自 ±15 或拖曳）。
 * @param duration 音檔總時長（可能為 NaN／未知）。
 * @returns 夾限後的秒數。
 */
export function clampSeek(target: number, duration: number): number {
  const t =
    typeof target === "number" && Number.isFinite(target) ? target : 0;
  const lowerClamped = Math.max(0, t);
  if (typeof duration === "number" && Number.isFinite(duration) && duration > 0) {
    return Math.min(lowerClamped, duration);
  }
  return lowerClamped;
}

/**
 * 依目前播放時間，算出「當前章節」的索引。
 * 規則：回傳「起始位移 ≤ 目前時間」中最晚的那一章。
 *   - 空章節 → -1。
 *   - 目前時間早於第一章起始（理論上不會，因第一章通常為 0；防呆用）→ 0。
 * @param chapters 章節清單（依 startSeconds 遞增）。
 * @param currentSeconds 目前播放秒數。
 * @returns 當前章節索引；無章節時 -1。
 */
export function currentChapterIndex(
  chapters: readonly TtsChapterVector[] | null | undefined,
  currentSeconds: number,
): number {
  if (!chapters || chapters.length === 0) return -1;
  const t =
    typeof currentSeconds === "number" && Number.isFinite(currentSeconds)
      ? currentSeconds
      : 0;
  let index = -1;
  for (let i = 0; i < chapters.length; i += 1) {
    const start = chapters[i]?.startSeconds;
    if (typeof start === "number" && Number.isFinite(start) && start <= t) {
      index = i;
    }
  }
  // t 早於所有章節起始（防呆）→ 視為在第一章。
  return index === -1 ? 0 : index;
}

// ============================================================================
// 播放狀態機（純轉移）
// ============================================================================

/**
 * 播放狀態機的單步轉移（純函式）。對照計畫 §7.2 的轉移表逐條實作。
 * 遇到「當前階段不接受的事件」一律回原階段（不轉移），避免非法跳轉。
 * @param phase 目前階段。
 * @param event 收到的事件。
 * @returns 下一個階段。
 */
export function nextPhase(
  phase: TtsPlayerPhase,
  event: TtsPlayerEvent,
): TtsPlayerPhase {
  // close／retry 為全域事件（任何階段皆可）。
  if (event === "close") return "idle";
  if (event === "retry") return "requesting";

  switch (phase) {
    case "idle":
      return event === "listen" ? "requesting" : phase;
    case "requesting":
      if (event === "synthProcessing") return "processing";
      if (event === "synthReady") return "ready";
      if (event === "synthFailed") return "failed";
      return phase;
    case "processing":
      if (event === "pollReady") return "ready";
      if (event === "pollFailed") return "failed";
      if (event === "loadError") return "failed";
      return phase;
    case "ready":
      if (event === "play") return "playing";
      if (event === "loadError") return "failed";
      return phase;
    case "playing":
      if (event === "pause") return "paused";
      if (event === "ended") return "paused";
      if (event === "loadError") return "failed";
      return phase;
    case "paused":
      if (event === "play") return "playing";
      if (event === "loadError") return "failed";
      return phase;
    case "failed":
      // 僅 retry/close（已於上方處理）能離開 failed。
      return phase;
    default:
      return phase;
  }
}

// ============================================================================
// 續聽位置（localStorage，容錯）
// ============================================================================

/**
 * 讀取所有續聽位置對照表（內部用；壞 JSON／不可用一律回空物件）。
 * @param storage 注入的 storage（可選）。
 * @returns `{ [ttsAudioId]: seconds }`。
 */
function readProgressMap(storage?: StorageLike | null): Record<string, number> {
  const store = resolveStorage(storage);
  if (!store) return {};
  try {
    const raw = store.getItem(TTS_PROGRESS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, number>;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * 讀取某音檔的續聽位置（秒）。
 * @param ttsAudioId 音檔 ID。
 * @param storage 注入的 storage（可選）。
 * @returns 續聽秒數；無紀錄／不合法／不可用時回 null。
 */
export function loadProgress(
  ttsAudioId: string,
  storage?: StorageLike | null,
): number | null {
  if (!ttsAudioId) return null;
  const map = readProgressMap(storage);
  const value = map[ttsAudioId];
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

/**
 * 寫入某音檔的續聽位置（秒）。失敗（不可用／配額滿）靜默降級。
 * @param ttsAudioId 音檔 ID。
 * @param seconds 續聽秒數。
 * @param storage 注入的 storage（可選）。
 */
export function saveProgress(
  ttsAudioId: string,
  seconds: number,
  storage?: StorageLike | null,
): void {
  if (!ttsAudioId) return;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) {
    return;
  }
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    const map = readProgressMap(storage);
    map[ttsAudioId] = seconds;
    store.setItem(TTS_PROGRESS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // 配額滿／被拒 → 靜默降級。
  }
}

/**
 * 清除某音檔的續聽位置（播放結束時呼叫）。失敗靜默。
 * @param ttsAudioId 音檔 ID。
 * @param storage 注入的 storage（可選）。
 */
export function clearProgress(
  ttsAudioId: string,
  storage?: StorageLike | null,
): void {
  if (!ttsAudioId) return;
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    const map = readProgressMap(storage);
    if (ttsAudioId in map) {
      delete map[ttsAudioId];
      store.setItem(TTS_PROGRESS_STORAGE_KEY, JSON.stringify(map));
    }
  } catch {
    // 靜默降級。
  }
}

/**
 * 判斷某個存檔續聽位置是否值得還原（避免落在結尾）。
 * @param saved 存檔秒數。
 * @param duration 音檔總時長（秒）。
 * @returns 是否應還原到 saved。
 */
export function shouldResume(saved: number | null, duration: number): boolean {
  if (saved == null || !Number.isFinite(saved) || saved <= 0) return false;
  if (!Number.isFinite(duration) || duration <= 0) {
    // 不知道時長時，只要 saved>0 就還原（保守，多還原一次無害）。
    return true;
  }
  return saved < duration - TTS_RESUME_END_GUARD_SECONDS;
}

// ============================================================================
// 語速（localStorage，容錯）
// ============================================================================

/**
 * 讀取偏好語速。非法／不可用時回預設 1。
 * @param storage 注入的 storage（可選）。
 * @returns 語速（正有限數；缺省 1）。
 */
export function loadRate(storage?: StorageLike | null): number {
  const store = resolveStorage(storage);
  if (!store) return TTS_DEFAULT_RATE;
  try {
    const raw = store.getItem(TTS_RATE_STORAGE_KEY);
    if (!raw) return TTS_DEFAULT_RATE;
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0 && value <= 4) return value;
    return TTS_DEFAULT_RATE;
  } catch {
    return TTS_DEFAULT_RATE;
  }
}

/**
 * 寫入偏好語速。非法值不寫；失敗靜默降級。
 * @param rate 語速。
 * @param storage 注入的 storage（可選）。
 */
export function saveRate(rate: number, storage?: StorageLike | null): void {
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0 || rate > 4) {
    return;
  }
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.setItem(TTS_RATE_STORAGE_KEY, String(rate));
  } catch {
    // 靜默降級。
  }
}

// ============================================================================
// 聲音顯示標籤
// ============================================================================

/**
 * 把性別代碼轉成中文單字（供組標籤）。
 * @param gender 性別字串。
 * @returns "男"／"女"／null（未知）。
 */
function genderToZh(gender?: string | null): string | null {
  if (!gender) return null;
  const g = gender.trim().toLowerCase();
  if (g === "female" || g === "f" || g === "女") return "女";
  if (g === "male" || g === "m" || g === "男") return "男";
  return null;
}

/**
 * 產生聲音下拉的顯示標籤。
 * 優先序：後端 `styleLabel` → 舊欄名 `label` → `性別・name`（如「女・Kore」）→ 只有 `name`。
 * @param voice 聲音（僅需 name/gender/styleLabel/label）。
 * @returns 顯示字串。
 */
export function formatVoiceLabel(voice: VoiceLabelInput): string {
  const style = voice.styleLabel?.trim() || voice.label?.trim();
  if (style) return style;
  const genderZh = genderToZh(voice.gender);
  if (genderZh) return `${genderZh}・${voice.name}`;
  return voice.name;
}
