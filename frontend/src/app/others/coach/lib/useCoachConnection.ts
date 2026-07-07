"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { audioContext, base64ToArrayBuffer } from "@/lib/audio/utils";
import { AudioStreamer } from "@/lib/audio/audio-streamer";
import {
  coachWsUrl,
  type CoachCorrection,
  type CoachServerEvent,
  type CoachState,
} from "@/lib/api/coach";
import {
  resolveCoachFactories,
  type CoachRecorder,
  type CoachTransport,
} from "./transport";
import { canReceiveServerUpdate, isActiveState } from "./coachState";

// ============================================================================
// 常數（前端傳輸退避——僅處理「非 fatal 的瀏覽器↔後端斷線」）
// ============================================================================

/** 退避基數（毫秒）。 */
const RECONNECT_BASE_MS = 800;
/** 前端傳輸重連上限次數（耗盡→終態，不再自行重連）。 */
const MAX_RECONNECT_ATTEMPTS = 5;

// ============================================================================
// 型別
// ============================================================================

/** 麥克風模式。 */
export type MicMode = "handsfree" | "ptt";

/** 一則已定案的字幕回合。 */
export interface SubtitleTurn {
  /** 唯一 id（渲染 key）。 */
  id: number;
  /** 角色。 */
  role: "assistant" | "user";
  /** 內容。 */
  text: string;
  /** 是否被打斷（barge-in）。 */
  interrupted?: boolean;
}

/** 單字加入提示（VocabAddedToast）。 */
export interface VocabToast {
  /** 唯一 id。 */
  id: number;
  /** 單字。 */
  word: string;
}

/** useCoachConnection 對外回傳。 */
export interface CoachConnection {
  /** 狀態機狀態。 */
  state: CoachState;
  /** fatal 原因（state==="fatal" 時）。 */
  fatalReason: string | null;
  /** 是否假造（e2e）模式。 */
  isMock: boolean;
  /** 目前麥克風音量（0..1）。 */
  micVolume: number;
  /** 麥克風是否擷取中。 */
  micActive: boolean;
  /** 已定案的字幕回合（依序）。 */
  turns: SubtitleTurn[];
  /** AI 正在串流中的逐字（打字機效果由元件動畫）。 */
  liveAssistantText: string;
  /** 糾錯卡列。 */
  corrections: CoachCorrection[];
  /** 單字提示佇列。 */
  vocabToasts: VocabToast[];
  /** 一次性提示訊息（例如入站被後端拒絕）；null 表示目前無提示。 */
  notice: string | null;
  /** 目前重連嘗試次數。 */
  reconnectAttempt: number;
  /** 開始連線（使用者手勢後呼叫）。 */
  start: (mode: MicMode) => Promise<void>;
  /** 使用者主動結束（不重連）。 */
  stop: () => void;
  /** 回前景時恢復播放（AudioContext/streamer resume）。 */
  resume: () => Promise<void>;
  /** 開始麥克風擷取（PTT 按下）。 */
  startMic: () => Promise<void>;
  /** 停止麥克風擷取（PTT 放開，會一併送 end）。 */
  stopMic: () => void;
  /** 暫停麥克風擷取但不送 end（切到背景時用）。 */
  pauseMic: () => void;
  /** 送文字回合（無麥克風時）。 */
  sendText: (text: string) => void;
  /** 手動 VAD 收尾（送 {type:"end"}）。 */
  sendEnd: () => void;
  /** 關閉一則單字提示。 */
  dismissVocabToast: (id: number) => void;
  /** 關閉目前提示訊息（notice）。 */
  dismissNotice: () => void;
}

/** 內部：連線期一次性物件（掛在 ref，不觸發重繪）。 */
interface ConnectionRefs {
  transport: CoachTransport | null;
  recorder: CoachRecorder | null;
  streamer: AudioStreamer | null;
  playbackContext: AudioContext | null;
  reconnectTimer: number | null;
  /** 終態旗標：收到 fatal/ended 或使用者主動停止 → 一律不再重連。 */
  terminal: boolean;
  attempt: number;
  mode: MicMode;
  sessionId: string | null;
  /** 目前 AI 串流文字（在 ref 累積，finalize 時定案）。 */
  liveAssistant: string;
}

// ============================================================================
// hook
// ============================================================================

/**
 * 教練連線狀態機（計畫 §6 審修-F3）。
 *
 * 關鍵不變式：
 *  - 收 {type:"fatal"} → 進 fatal 終態，**禁止自身退避再開 /ws/coach**（不繞過後端斷路器）。
 *  - 退避只處理「非 fatal 的瀏覽器↔後端傳輸斷線」，且先確認未收 fatal/ended。
 *  - 事件處理器只讀 ref＋呼叫穩定 setState；直接指派 transport.onMessage / recorder.onData，
 *    **不以 useEffect 訂閱**，因此不受函式識別變動影響、無重訂閱迴圈。
 *
 * @param sessionId 續接的既有場次（可空＝開新場）。
 * @returns 連線與對話狀態＋控制方法。
 */
export function useCoachConnection(sessionId: string | null = null): CoachConnection {
  const [state, setState] = useState<CoachState>("connecting");
  const [fatalReason, setFatalReason] = useState<string | null>(null);
  const [micVolume, setMicVolume] = useState(0);
  const [micActive, setMicActive] = useState(false);
  const [turns, setTurns] = useState<SubtitleTurn[]>([]);
  const [liveAssistantText, setLiveAssistantText] = useState("");
  const [corrections, setCorrections] = useState<CoachCorrection[]>([]);
  const [vocabToasts, setVocabToasts] = useState<VocabToast[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [isMock, setIsMock] = useState(false);

  const refs = useRef<ConnectionRefs>({
    transport: null,
    recorder: null,
    streamer: null,
    playbackContext: null,
    reconnectTimer: null,
    terminal: false,
    attempt: 0,
    mode: "handsfree",
    sessionId,
    liveAssistant: "",
  });

  const nextId = useRef(1);

  // 以下皆為「函式宣告」（每次渲染重建無妨）：只讀 refs.current 與穩定 setState，
  // 不進任何 hook 的相依陣列，故無 exhaustive-deps 問題、無 TDZ（宣告會被提升）。

  /** 遞增 id 產生器（回合/提示 key）。 */
  function genId(): number {
    return nextId.current++;
  }

  /** 把目前 AI 串流文字定案為一則 assistant 回合。 */
  function finalizeAssistant(interrupted: boolean): void {
    const text = refs.current.liveAssistant.trim();
    refs.current.liveAssistant = "";
    setLiveAssistantText("");
    if (!text) return;
    setTurns((prev) => [...prev, { id: genId(), role: "assistant", text, interrupted }]);
  }

  /** 處理一則正規化後的後端事件。 */
  function handleServerEvent(event: CoachServerEvent): void {
    switch (event.kind) {
      case "audio": {
        const streamer = refs.current.streamer;
        if (streamer) {
          streamer.addPCM16(new Uint8Array(base64ToArrayBuffer(event.data)));
        }
        // 放行 reconnecting → speaking：後端訊號式重連成功後補送的 audio 必須能讓 UI 脫離「重連中」（#1）。
        setState((s) => (canReceiveServerUpdate(s) ? "speaking" : s));
        break;
      }
      case "assistantTranscript": {
        refs.current.liveAssistant += event.text;
        setLiveAssistantText(refs.current.liveAssistant);
        setState((s) => (canReceiveServerUpdate(s) ? "speaking" : s));
        if (event.final) finalizeAssistant(false);
        break;
      }
      case "userTranscript": {
        // 使用者新回合 → 先定案任何待定 AI 文字，再加使用者氣泡。
        finalizeAssistant(false);
        const text = event.text.trim();
        if (text) setTurns((prev) => [...prev, { id: genId(), role: "user", text }]);
        setState((s) => (isActiveState(s) ? "listening" : s));
        break;
      }
      case "interrupted": {
        // 依 audio-streamer 實際排程進度估算截點，標「（被打斷）」。
        const streamer = refs.current.streamer;
        let cutFraction = 1;
        if (streamer) {
          cutFraction = streamer.playbackProgress().fraction || 0;
          streamer.stop();
        }
        const full = refs.current.liveAssistant;
        const cutChars = Math.max(0, Math.round(full.length * cutFraction));
        // 回報近似截點給後端（best-effort；供 barge-in 落地記錄 ApproxCutChars，閉合設計意圖，#7）。
        refs.current.transport?.send({ type: "barge_in", approxCutChars: cutChars });
        // 只保留實際講到的部分（近似），其餘丟棄；標記中斷。
        refs.current.liveAssistant = full.slice(0, cutChars);
        finalizeAssistant(true);
        setState((s) => (isActiveState(s) ? "listening" : s));
        break;
      }
      case "turnEnd": {
        // 後端明確的回合定案訊號（turnComplete）：把待定的 AI 逐字定案成一則氣泡。
        // 文字／無麥克風模式多回合分泡的關鍵；語音模式已於 userTranscript 定案，重複呼叫為 no-op（#4）。
        finalizeAssistant(false);
        break;
      }
      case "state": {
        // 放行 reconnecting：訊號式重連成功後的 state:listening 必須能讓 UI 脫離「重連中」（#1）。
        setState((s) => (canReceiveServerUpdate(s) ? event.state : s));
        break;
      }
      case "correction": {
        setCorrections((prev) => [...prev, event.correction]);
        break;
      }
      case "vocabAdded": {
        setVocabToasts((prev) => [...prev, { id: genId(), word: event.word }]);
        break;
      }
      case "rejected": {
        // 入站訊框被後端拒絕（超長文字／過大音訊）：撥回 listening（避免永久卡 thinking／speaking）並提示使用者。
        // sendText 送出當下已樂觀轉 thinking，若無此撥回與提示，AI 永不回覆且使用者無從得知（#8）。
        const message =
          event.reason === "text_too_long"
            ? "訊息過長，請縮短後再試。"
            : event.reason === "audio_too_large"
              ? "音訊片段過大，已略過該段。"
              : "訊息無法送出，請再試一次。";
        setNotice(message);
        setState((s) =>
          s === "thinking" || s === "speaking" || s === "listening" ? "listening" : s,
        );
        break;
      }
      case "reconnecting": {
        // 後端在做 Vertex 端重連（帶 handle）——前端只呈現，不自行重連。
        setState("reconnecting");
        break;
      }
      case "fatal": {
        refs.current.terminal = true;
        setFatalReason(event.reason);
        setState("fatal");
        teardown(refs.current);
        break;
      }
      case "ended": {
        refs.current.terminal = true;
        setState("ended");
        teardown(refs.current);
        break;
      }
      case "unknown":
      default:
        break;
    }
  }

  /** 為新 transport 綁定回呼（含非 fatal 斷線→退避重連）。 */
  function wireTransport(transport: CoachTransport): void {
    transport.onOpen = () => {
      refs.current.attempt = 0;
      setReconnectAttempt(0);
      setState((s) => (s === "connecting" || s === "reconnecting" ? "listening" : s));
    };
    transport.onMessage = handleServerEvent;
    transport.onError = () => {
      // 錯誤本身不立即重連；等 onClose 決定（避免 error+close 雙觸發）。
    };
    transport.onClose = (info) => {
      if (info.wasClean || refs.current.terminal) return; // 乾淨關閉/已終態：不重連。
      scheduleReconnect();
    };
  }

  /** 建立 transport 並綁定。 */
  function connectTransport(): void {
    const factories = resolveCoachFactories();
    const transport = factories.createTransport(coachWsUrl(refs.current.sessionId));
    refs.current.transport = transport;
    wireTransport(transport);
  }

  /** 排程一次退避重連（僅非 fatal、未終態）。 */
  function scheduleReconnect(): void {
    if (refs.current.terminal) return;
    if (refs.current.reconnectTimer != null) return; // 已排程
    const attempt = refs.current.attempt + 1;
    refs.current.attempt = attempt;
    setReconnectAttempt(attempt);

    if (attempt > MAX_RECONNECT_ATTEMPTS) {
      // 前端傳輸重連耗盡 → 終態（非後端 fatal，但同樣不再嘗試）。
      refs.current.terminal = true;
      setFatalReason("connection_lost");
      setState("fatal");
      teardown(refs.current);
      return;
    }

    setState("reconnecting");
    const delay = RECONNECT_BASE_MS * Math.pow(2, attempt - 1);
    refs.current.reconnectTimer = window.setTimeout(() => {
      refs.current.reconnectTimer = null;
      if (refs.current.terminal) return;
      refs.current.transport = null; // 丟舊建新（後端負責 Vertex 端 resumption）。
      connectTransport();
    }, delay);
  }

  /** 開始麥克風擷取。 */
  async function startMicImpl(): Promise<void> {
    if (refs.current.recorder) return; // 已在擷取
    const factories = resolveCoachFactories();
    const recorder = factories.createRecorder();
    recorder.onData = (base64: string) => {
      refs.current.transport?.send({ type: "audio", data: base64 });
    };
    recorder.onVolume = (v: number) => setMicVolume(v);
    refs.current.recorder = recorder;
    try {
      await recorder.start();
      setMicActive(true);
      setState((s) => (isActiveState(s) ? "listening" : s));
    } catch {
      // 麥克風權限被拒/無裝置：停用麥克風，改文字模式（不視為 fatal）。
      refs.current.recorder = null;
      setMicActive(false);
    }
  }

  /** 停止麥克風擷取並送 end（PTT 放開/免持靜音——代表使用者主動結束一段話）。 */
  function stopMicImpl(): void {
    const recorder = refs.current.recorder;
    if (!recorder) return;
    recorder.stop();
    refs.current.recorder = null;
    setMicActive(false);
    setMicVolume(0);
    // 僅在連線就緒時送 end，並據此切 thinking（未就緒不假裝在等回應）。
    if (refs.current.transport?.isOpen) {
      refs.current.transport.send({ type: "end" });
      setState((s) => (isActiveState(s) ? "thinking" : s));
    }
  }

  /** 暫停麥克風擷取但**不送 end**（切到背景時用；審修 H7，避免背景持續錄音上傳）。 */
  function pauseMicImpl(): void {
    const recorder = refs.current.recorder;
    if (!recorder) return;
    recorder.stop();
    refs.current.recorder = null;
    setMicActive(false);
    setMicVolume(0);
  }

  /** 開始連線。 */
  async function startImpl(mode: MicMode): Promise<void> {
    const factories = resolveCoachFactories();
    setIsMock(factories.isMock);
    refs.current.mode = mode;
    refs.current.terminal = false;
    refs.current.attempt = 0;
    setReconnectAttempt(0);
    setFatalReason(null);
    setNotice(null); // 清掉上一場殘留的提示。
    setState("connecting");

    try {
      // 播放用 AudioContext（手勢後建立；預設率即可，24k buffer 會自動重採樣播放）。
      const ctx = await audioContext({ id: "coach-playback" });
      refs.current.playbackContext = ctx;
      const streamer = new AudioStreamer(ctx);
      streamer.onComplete = () => {
        // 僅做「佇列播完 → 回聆聽」的軟過場；**不在此 finalize**：buffer drain ≠ 這輪講完，
        // 網路/生成抖動會讓佇列提早見底。真正定案交給 {final:true}／使用者新回合／interrupted，
        // 避免把一句話拆成多個氣泡（審修 H5）。
        setState((s) => (s === "speaking" ? "listening" : s));
      };
      refs.current.streamer = streamer;

      connectTransport();

      if (mode === "handsfree") await startMicImpl();
    } catch {
      // 建立音訊/連線失敗：進 fatal 終態並清理，避免卡在「連線中」轉圈（審修 H2）。
      refs.current.terminal = true;
      setFatalReason("start_failed");
      setState("fatal");
      teardown(refs.current);
    }
  }

  /** 使用者主動結束。 */
  function stopImpl(): void {
    refs.current.terminal = true;
    teardown(refs.current);
    setMicActive(false);
    setMicVolume(0);
    setState("ended");
  }

  /** 回前景時恢復播放（AudioContext/streamer 可能被 OS 暫停）。 */
  async function resumeImpl(): Promise<void> {
    const ctx = refs.current.playbackContext;
    if (ctx && ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        /* 忽略 */
      }
    }
    try {
      await refs.current.streamer?.resume();
    } catch {
      /* 忽略 */
    }
  }

  /** 送文字回合。連線未就緒時 no-op（不顯示假的「已送出」氣泡，審修 H3）。 */
  function sendTextImpl(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (!refs.current.transport?.isOpen) return;
    // 送新回合前先定案上一回合待定的 AI 逐字，避免 turn_end 尚未到達時 delta 串接、泡泡未分（#4）。
    // 標 interrupted：此保險 finalize 只在「AI 仍在串流（liveAssistant 有值）時使用者搶送」才產生氣泡——
    // 那正是使用者打斷了 AI 這一輪，標記中斷讓 UI 可分辨（避免半句被當成一則正常完成的氣泡，#8）。
    finalizeAssistant(true);
    refs.current.transport.send({ type: "text", text: trimmed });
    setTurns((prev) => [...prev, { id: genId(), role: "user", text: trimmed }]);
    setState((s) => (isActiveState(s) ? "thinking" : s));
  }

  /** 手動 VAD 收尾。連線未就緒時 no-op。 */
  function sendEndImpl(): void {
    if (!refs.current.transport?.isOpen) return;
    // 收尾一段話前先定案任何待定的 AI 逐字（多回合分泡的保險，#4）。標 interrupted：同 sendText，
    // 只在「AI 仍在串流時使用者搶送 end」才產生氣泡＝使用者打斷了這一輪，標記中斷讓 UI 可分辨（#8）。
    finalizeAssistant(true);
    refs.current.transport.send({ type: "end" });
    setState((s) => (isActiveState(s) ? "thinking" : s));
  }

  /** 關閉一則單字提示。 */
  function dismissVocabToastImpl(id: number): void {
    setVocabToasts((prev) => prev.filter((t) => t.id !== id));
  }

  /** 關閉目前提示訊息（notice）。 */
  function dismissNoticeImpl(): void {
    setNotice(null);
  }

  // 對外方法穩定化（identity 不隨渲染變動）：上述 impl 每次渲染重建，但只讀 ref＋穩定 setState，
  // 任一版本行為皆等價。這裡把最新 impl 寫進 implRef，對外只回傳 useCallback([]) 的穩定包裝——
  // 讓子元件的 effect（如 VocabAddedToast 的自動關閉計時器）不因回呼參考變動而反覆重置（審修 H6/L3），
  // 並讓子元件 React.memo 生效（審修 M2）。
  const implRef = useRef({
    start: startImpl,
    stop: stopImpl,
    resume: resumeImpl,
    startMic: startMicImpl,
    stopMic: stopMicImpl,
    pauseMic: pauseMicImpl,
    sendText: sendTextImpl,
    sendEnd: sendEndImpl,
    dismissVocabToast: dismissVocabToastImpl,
    dismissNotice: dismissNoticeImpl,
  });
  // 每次渲染後把最新 impl 寫入 ref（在 effect 內更新，避免「渲染期改 ref」；事件在 effect 後才觸發，故永遠取到最新版）。
  useEffect(() => {
    implRef.current = {
      start: startImpl,
      stop: stopImpl,
      resume: resumeImpl,
      startMic: startMicImpl,
      stopMic: stopMicImpl,
      pauseMic: pauseMicImpl,
      sendText: sendTextImpl,
      sendEnd: sendEndImpl,
      dismissVocabToast: dismissVocabToastImpl,
      dismissNotice: dismissNoticeImpl,
    };
  });

  const start = useCallback((mode: MicMode) => implRef.current.start(mode), []);
  const stop = useCallback(() => implRef.current.stop(), []);
  const resume = useCallback(() => implRef.current.resume(), []);
  const startMic = useCallback(() => implRef.current.startMic(), []);
  const stopMic = useCallback(() => implRef.current.stopMic(), []);
  const pauseMic = useCallback(() => implRef.current.pauseMic(), []);
  const sendText = useCallback((text: string) => implRef.current.sendText(text), []);
  const sendEnd = useCallback(() => implRef.current.sendEnd(), []);
  const dismissVocabToast = useCallback(
    (id: number) => implRef.current.dismissVocabToast(id),
    [],
  );
  const dismissNotice = useCallback(() => implRef.current.dismissNotice(), []);

  // 卸載清理（唯一的 effect；empty deps）。
  // refs.current 是 useRef 一次建立、之後只就地變更的同一物件，於掛載時擷取即等同卸載時的物件。
  useEffect(() => {
    const connection = refs.current;
    return () => {
      connection.terminal = true;
      teardown(connection);
    };
  }, []);

  return {
    state,
    fatalReason,
    isMock,
    micVolume,
    micActive,
    turns,
    liveAssistantText,
    corrections,
    vocabToasts,
    notice,
    reconnectAttempt,
    start,
    stop,
    resume,
    startMic,
    stopMic,
    pauseMic,
    sendText,
    sendEnd,
    dismissVocabToast,
    dismissNotice,
  };
}

// ============================================================================
// 內部工具
// ============================================================================

/**
 * 拆除連線期資源（傳輸/麥克風/播放器/計時器）。冪等。
 * @param c 連線期物件（refs.current）。
 */
function teardown(c: ConnectionRefs): void {
  if (c.reconnectTimer != null) {
    clearTimeout(c.reconnectTimer);
    c.reconnectTimer = null;
  }
  try {
    c.recorder?.stop();
  } catch {
    /* 忽略 */
  }
  c.recorder = null;
  try {
    c.streamer?.stop();
  } catch {
    /* 忽略 */
  }
  c.streamer = null;
  try {
    c.transport?.close();
  } catch {
    /* 忽略 */
  }
  c.transport = null;
  if (c.playbackContext) {
    const ctx = c.playbackContext;
    c.playbackContext = null;
    void ctx.close().catch(() => undefined);
  }
}
