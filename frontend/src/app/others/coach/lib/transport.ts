/**
 * 可注入的傳輸／擷取縫（計畫 §5 審修-F2）——批次 3 前端驗收（Playwright 驅動狀態機）的前提。
 *
 * 把「WS 傳輸」與「音訊擷取」抽成介面，讓：
 *   - 正式模式：用真 WebSocket ＋ AudioRecorder。
 *   - e2e 模式（`?e2e=1` 或 window.__coachTestHarness）：用可程式化推事件的假造物件，
 *     stub getUserMedia／WebSocket，讓監工用 Playwright 推假事件驗狀態機/字幕/糾錯卡，
 *     **不需真麥克風、不需真 Vertex 連線、不需覆寫全域 window.WebSocket**（MCP 無 addInitScript）。
 */

import { AudioRecorder } from "@/lib/audio/audio-recorder";
import {
  parseServerMessage,
  type CoachClientMessage,
  type CoachServerEvent,
} from "@/lib/api/coach";
import { ensureCoachTestHarness } from "./testHarness";

/**
 * WS 傳輸介面（send/close ＋事件回呼）。
 */
export interface CoachTransport {
  /** 送一則封包給後端。 */
  send(message: CoachClientMessage): void;
  /** 主動關閉連線。 */
  close(): void;
  /** 連線是否已開啟。 */
  readonly isOpen: boolean;
  /** 連線開啟回呼。 */
  onOpen?: () => void;
  /** 收到（已正規化的）後端事件。 */
  onMessage?: (event: CoachServerEvent) => void;
  /** 連線關閉回呼（code＋是否乾淨關閉）。 */
  onClose?: (info: { code: number; wasClean: boolean }) => void;
  /** 傳輸錯誤回呼。 */
  onError?: () => void;
}

/**
 * 音訊擷取介面（麥克風）。
 */
export interface CoachRecorder {
  /** 開始擷取（需在使用者手勢後）。 */
  start(): Promise<void>;
  /** 停止並釋放。 */
  stop(): void;
  /** AudioContext 實際取樣率（iOS 驗證用；非 16k 代表已走重採樣補正）。 */
  readonly contextSampleRate: number;
  /** 收到一段 base64 PCM16 16k。 */
  onData?: (base64: string) => void;
  /** 麥克風音量（0..1）。 */
  onVolume?: (value: number) => void;
}

/**
 * 傳輸／擷取工廠（可注入）。
 */
export interface CoachFactories {
  /** 建立傳輸（傳入 WS URL）。 */
  createTransport(url: string): CoachTransport;
  /** 建立擷取器。 */
  createRecorder(): CoachRecorder;
  /** 是否為假造（e2e）模式——UI 據此提示「測試模式」並跳過真麥克風權限。 */
  readonly isMock: boolean;
}

/**
 * 真 WebSocket 傳輸：JSON 文字框；收訊經 parseServerMessage 正規化後往上送。
 */
class WebSocketTransport implements CoachTransport {
  private ws: WebSocket;
  private open = false;

  onOpen?: () => void;
  onMessage?: (event: CoachServerEvent) => void;
  onClose?: (info: { code: number; wasClean: boolean }) => void;
  onError?: () => void;

  /**
   * @param url ws(s):// URL。
   */
  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.onopen = () => {
      this.open = true;
      this.onOpen?.();
    };
    this.ws.onmessage = (ev: MessageEvent) => {
      let raw: unknown;
      try {
        raw = typeof ev.data === "string" ? JSON.parse(ev.data) : null;
      } catch {
        raw = null;
      }
      this.onMessage?.(parseServerMessage(raw));
    };
    this.ws.onclose = (ev: CloseEvent) => {
      this.open = false;
      this.onClose?.({ code: ev.code, wasClean: ev.wasClean });
    };
    this.ws.onerror = () => {
      this.onError?.();
    };
  }

  get isOpen(): boolean {
    return this.open && this.ws.readyState === WebSocket.OPEN;
  }

  send(message: CoachClientMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      // 忽略重複關閉。
    }
  }
}

/**
 * 真麥克風擷取（包裝 AudioRecorder）。
 */
class MicRecorder implements CoachRecorder {
  private recorder: AudioRecorder | null = null;

  onData?: (base64: string) => void;
  onVolume?: (value: number) => void;

  async start(): Promise<void> {
    const recorder = new AudioRecorder();
    recorder.on("data", (base64: string) => this.onData?.(base64));
    recorder.on("volume", (value: number) => this.onVolume?.(value));
    this.recorder = recorder;
    await recorder.start();
  }

  stop(): void {
    this.recorder?.removeAllListeners();
    this.recorder?.stop();
    this.recorder = null;
  }

  get contextSampleRate(): number {
    return this.recorder?.contextSampleRate ?? 16000;
  }
}

/** 正式（真 WS＋真麥克風）工廠。 */
const realFactories: CoachFactories = {
  createTransport: (url: string) => new WebSocketTransport(url),
  createRecorder: () => new MicRecorder(),
  isMock: false,
};

/**
 * 解析當前應使用的工廠：e2e 模式回假造工廠，否則回真工廠。
 * @returns 傳輸／擷取工廠。
 */
export function resolveCoachFactories(): CoachFactories {
  const harness = ensureCoachTestHarness();
  return harness ? harness.factories : realFactories;
}
