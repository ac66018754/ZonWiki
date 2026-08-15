/**
 * 英文教練 e2e 測試縫（計畫 §5 審修-F2）。
 *
 * 監工用 Playwright 驗收狀態機/字幕/糾錯卡的方式（不需真麥克風、不需真 Vertex）：
 *   1. 導覽到 `/others/coach?e2e=1`（本模組於掛載時自動安裝 `window.__coachTestHarness`）。
 *   2. 點「開始對話」——元件偵測 e2e → 用假造傳輸/擷取；假傳輸會自動「開啟」。
 *   3. 用 `window.__coachTestHarness` 推假的「後端→前端」封包並檢查 DOM：
 *        h.server.emit({ state: "listening" })
 *        h.server.emit({ transcript: "Hello there", role: "assistant", final: false })
 *        h.server.emit({ transcript: "how are you", role: "user" })
 *        h.server.emit({ correction: { original: "I has a apple", corrected: "I have an apple",
 *                                      explanation_zh: "主詞用 have；apple 前用 an" } })
 *        h.server.emit({ vocab_added: true, word: "ubiquitous" })
 *        h.server.emit({ interrupted: true })
 *        h.server.emit({ type: "reconnecting" })
 *        h.server.emit({ type: "fatal", reason: "budget_exceeded" })
 *   4. 驗送出：`window.__coachTestHarness.sentToServer`（依序含 client→server 封包，如 text/end）。
 *      可用 `h.mic.data("<base64>")` 模擬麥克風產生一段音訊、`h.mic.volume(0.5)` 模擬音量。
 *
 * ⚠️ 只在 e2e 模式安裝；正式模式完全不介入（resolveCoachFactories 回真工廠）。
 */

import {
  parseServerMessage,
  type CoachClientMessage,
  type CoachServerEvent,
} from "@/lib/api/coach";
import type { CoachFactories, CoachRecorder, CoachTransport } from "./transport";

/**
 * e2e 控制 API（掛在 window.__coachTestHarness）。
 */
export interface CoachTestHarness {
  /** 標記已安裝。 */
  installed: true;
  /** 供元件取用的假造工廠。 */
  factories: CoachFactories;
  /** client→server 送出的封包（依序，供斷言）。 */
  sentToServer: CoachClientMessage[];
  /** 模擬「後端→前端」。 */
  server: {
    /** 推一則**原始**後端封包（會過 parseServerMessage，等同真後端）。 */
    emit(rawMessage: unknown): void;
    /** 強制開啟連線（假傳輸預設已自動開啟）。 */
    open(): void;
    /** 強制關閉連線（模擬非 fatal 傳輸斷線）。 */
    close(code?: number): void;
    /** 模擬傳輸錯誤。 */
    error(): void;
  };
  /** 模擬麥克風。 */
  mic: {
    /** 推一段 base64 PCM16（模擬擷取到音訊）。 */
    data(base64: string): void;
    /** 推一次音量事件（0..1）。 */
    volume(value: number): void;
  };
  /** 設定假擷取器回報的取樣率（測 iOS 重採樣偵測用；預設 16000）。 */
  setSampleRate(rate: number): void;
  /** 清空送出紀錄與狀態（重跑用）。 */
  reset(): void;
}

declare global {
  interface Window {
    /** e2e 測試控制縫（僅 e2e 模式存在）。 */
    __coachTestHarness?: CoachTestHarness;
  }
}

/**
 * 假傳輸：預設在下個 microtask 自動「開啟」（讓 happy path 直接可跑），可由 harness 控制推事件。
 */
class FakeTransport implements CoachTransport {
  private open = false;

  onOpen?: () => void;
  onMessage?: (event: CoachServerEvent) => void;
  onClose?: (info: { code: number; wasClean: boolean }) => void;
  onError?: () => void;

  /**
   * @param onSend 送出封包時的記錄回呼（存入 harness.sentToServer）。
   */
  constructor(private onSend: (message: CoachClientMessage) => void) {
    // 自動開啟，模擬快速連線成功；測試也可再以 server.open() 明確控制。
    queueMicrotask(() => this.forceOpen());
  }

  get isOpen(): boolean {
    return this.open;
  }

  send(message: CoachClientMessage): void {
    this.onSend(message);
  }

  close(): void {
    this.forceClose(1000);
  }

  /** harness：強制開啟。 */
  forceOpen(): void {
    if (this.open) return;
    this.open = true;
    this.onOpen?.();
  }

  /** harness：強制關閉（模擬傳輸斷線）。 */
  forceClose(code: number): void {
    if (!this.open) return;
    this.open = false;
    this.onClose?.({ code, wasClean: code === 1000 });
  }

  /** harness：推一則原始後端封包。 */
  emitRaw(raw: unknown): void {
    this.onMessage?.(parseServerMessage(raw));
  }
}

/**
 * 假擷取器：start/stop 立即完成，不碰真麥克風；音訊/音量由 harness 推。
 */
class FakeRecorder implements CoachRecorder {
  onData?: (base64: string) => void;
  onVolume?: (value: number) => void;

  /**
   * @param getSampleRate 取回報取樣率的函式（可被 harness 覆寫，測重採樣偵測）。
   */
  constructor(private getSampleRate: () => number) {}

  async start(): Promise<void> {
    // 無真麥克風：直接就緒。
  }

  stop(): void {
    // no-op。
  }

  get contextSampleRate(): number {
    return this.getSampleRate();
  }
}

/** 目前的單例 harness（同頁只安裝一次）。 */
let singleton: CoachTestHarness | null = null;

/**
 * 判斷是否為 e2e 模式：window.__coachTestHarness 已存在，或網址帶 `e2e=1`。
 * @returns 是 e2e 為 true。
 */
function isE2EMode(): boolean {
  if (typeof window === "undefined") return false;
  // prod 預設關閉：避免任何人在正式站加 `?e2e=1` 就讓自己的分頁進入假造模式（審修 M4）。
  // 開發（next dev）預設啟用；若要對「本機 production build」跑 e2e，build 時設 NEXT_PUBLIC_COACH_E2E=1。
  const enabled =
    process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_COACH_E2E === "1";
  if (!enabled) return false;
  if (window.__coachTestHarness) return true;
  try {
    return new URLSearchParams(window.location.search).get("e2e") === "1";
  } catch {
    return false;
  }
}

/**
 * 若處於 e2e 模式，安裝（或取回）測試 harness；否則回 null。
 * @returns harness 或 null。
 */
export function ensureCoachTestHarness(): CoachTestHarness | null {
  if (typeof window === "undefined") return null;
  if (singleton) return singleton;
  if (!isE2EMode()) return null;

  let activeTransport: FakeTransport | null = null;
  let activeRecorder: FakeRecorder | null = null;
  let sampleRate = 16000;

  const sentToServer: CoachClientMessage[] = [];

  const factories: CoachFactories = {
    createTransport: () => {
      const t = new FakeTransport((message) => sentToServer.push(message));
      activeTransport = t;
      return t;
    },
    createRecorder: () => {
      const r = new FakeRecorder(() => sampleRate);
      activeRecorder = r;
      return r;
    },
    isMock: true,
  };

  const harness: CoachTestHarness = {
    installed: true,
    factories,
    sentToServer,
    server: {
      emit: (raw) => activeTransport?.emitRaw(raw),
      open: () => activeTransport?.forceOpen(),
      close: (code = 1006) => activeTransport?.forceClose(code),
      error: () => activeTransport?.onError?.(),
    },
    mic: {
      data: (base64) => activeRecorder?.onData?.(base64),
      volume: (value) => activeRecorder?.onVolume?.(value),
    },
    setSampleRate: (rate) => {
      sampleRate = rate;
    },
    reset: () => {
      sentToServer.length = 0;
      activeTransport = null;
      activeRecorder = null;
      sampleRate = 16000;
    },
  };

  singleton = harness;
  window.__coachTestHarness = harness;
  return harness;
}
