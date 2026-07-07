/**
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 來源出處（Apache-2.0）：google-gemini/live-api-web-console，`src/lib/audio-recorder.ts`。
 * ZonWiki 移植調整（Phase 3 英文教練，計畫 §5）：
 *   1. iOS 取樣率補正：偵測 AudioContext 實際率 ≠ 16000 時，把 worklet 輸出的 int16 轉回
 *      float32、以 resampler.ts 抗鋸齒重採樣到 16k 再送出（避免混疊假 16k）。
 *   2. 型別化事件（eventemitter3 泛型）：`data`(base64) / `volume`(number)。
 *   3. 去除 async Promise executor（eslint no-async-promise-executor），保留「start 未完成即 stop」語意。
 *   4. 修正上游拼字：createWorketFromSrc → createWorkletFromSrc。
 * ─────────────────────────────────────────────────────────────────────────────
 */

import EventEmitter from "eventemitter3";

import { audioContext, arrayBufferToBase64 } from "./utils";
import AudioRecordingWorklet from "./worklets/audio-processing";
import VolMeterWorket from "./worklets/vol-meter";
import { createWorkletFromSrc } from "./audioworklet-registry";
import {
  Resampler,
  needsResampling,
  int16BufferToFloat32,
  float32ToInt16Buffer,
  TARGET_SAMPLE_RATE,
} from "./resampler";

/**
 * AudioRecorder 對外事件型別。
 * - `data`：一段 base64 編碼的 PCM16 16kHz（餵 Vertex realtimeInput.audio）。
 * - `volume`：麥克風 RMS 音量（0..1，供 StateIndicator 脈動）。
 */
export type AudioRecorderEvents = {
  data: (base64: string) => void;
  volume: (value: number) => void;
};

/** worklet postMessage 的資料形狀（只取需要的欄位）。 */
interface RecordingWorkletMessage {
  data?: { int16arrayBuffer?: ArrayBuffer };
}

/**
 * 麥克風擷取器：getUserMedia → 16k AudioContext →錄音 worklet（float32→int16）→ base64 →emit "data"。
 * 另掛 vol-meter worklet 發 "volume"。iOS 取樣率被強制時以 resampler 補正到 16k。
 */
export class AudioRecorder extends EventEmitter<AudioRecorderEvents> {
  /** 麥克風媒體串流。 */
  stream: MediaStream | undefined;
  /** 音訊上下文。 */
  audioContext: AudioContext | undefined;
  /** 媒體串流來源節點。 */
  source: MediaStreamAudioSourceNode | undefined;
  /** 是否錄音中。 */
  recording: boolean = false;
  /** 錄音 worklet 節點。 */
  recordingWorklet: AudioWorkletNode | undefined;
  /** 音量表 worklet 節點。 */
  vuWorklet: AudioWorkletNode | undefined;

  /** start() 尚未完成時的 promise（供「start 未完成即 stop」時序保護）。 */
  private starting: Promise<void> | null = null;
  /** iOS 取樣率補正用重採樣器（實際率＝16k 時為 null）。 */
  private resampler: Resampler | null = null;
  /** AudioContext 實際運行的取樣率（供執行期驗證與交接檢查）。 */
  private actualSampleRate: number = TARGET_SAMPLE_RATE;

  /**
   * @param sampleRate 期望取樣率（預設 16000；iOS 可能被忽略，屆時走 resampler 補正）。
   */
  constructor(public sampleRate: number = TARGET_SAMPLE_RATE) {
    super();
  }

  /**
   * 實際運行取樣率（交接清單用：iPhone 實機須確認送出確為 16k；若此值 ≠16k 代表走了重採樣補正）。
   * @returns 取樣率（Hz）。
   */
  get contextSampleRate(): number {
    return this.actualSampleRate;
  }

  /**
   * 建立麥克風管線並開始擷取。必須在使用者手勢後呼叫（autoplay policy）。
   * @returns 於管線就緒時 resolve。
   */
  start(): Promise<void> {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.reject(new Error("無法取得麥克風（此環境不支援 getUserMedia）"));
    }

    const startImpl = async (): Promise<void> => {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioContext = await audioContext({ sampleRate: this.sampleRate });
      this.source = this.audioContext.createMediaStreamSource(this.stream);

      // iOS 取樣率陷阱：若實際率被強制成非 16k，建立抗鋸齒重採樣器。
      this.actualSampleRate = this.audioContext.sampleRate;
      this.resampler = needsResampling(this.actualSampleRate)
        ? new Resampler(this.actualSampleRate, TARGET_SAMPLE_RATE)
        : null;

      const workletName = "audio-recorder-worklet";
      const src = createWorkletFromSrc(workletName, AudioRecordingWorklet);
      await this.audioContext.audioWorklet.addModule(src);
      this.recordingWorklet = new AudioWorkletNode(this.audioContext, workletName);

      this.recordingWorklet.port.onmessage = (ev: MessageEvent) => {
        const payload = ev.data as RecordingWorkletMessage;
        const arrayBuffer = payload?.data?.int16arrayBuffer;
        if (!arrayBuffer) return;
        this.emitPcmChunk(arrayBuffer);
      };
      this.source.connect(this.recordingWorklet);

      // 音量表 worklet。
      const vuWorkletName = "vu-meter";
      await this.audioContext.audioWorklet.addModule(
        createWorkletFromSrc(vuWorkletName, VolMeterWorket),
      );
      this.vuWorklet = new AudioWorkletNode(this.audioContext, vuWorkletName);
      this.vuWorklet.port.onmessage = (ev: MessageEvent) => {
        const volume = (ev.data as { volume?: number })?.volume;
        if (typeof volume === "number") this.emit("volume", volume);
      };
      this.source.connect(this.vuWorklet);

      this.recording = true;
    };

    this.starting = startImpl().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  /**
   * 處理一段 worklet 送來的 int16 buffer：必要時重採樣到 16k，再 base64 發 "data"。
   * @param int16Buffer worklet 輸出的 int16 ArrayBuffer（取樣率＝AudioContext 實際率）。
   */
  private emitPcmChunk(int16Buffer: ArrayBuffer): void {
    if (!this.resampler) {
      // 已是 16k，直接送。
      this.emit("data", arrayBufferToBase64(int16Buffer));
      return;
    }
    // 非 16k：int16 → float32 → 抗鋸齒重採樣 → int16 → base64。
    const float32 = int16BufferToFloat32(int16Buffer);
    const resampled = this.resampler.process(float32);
    if (resampled.length === 0) return; // 仍在累積文脈
    this.emit("data", arrayBufferToBase64(float32ToInt16Buffer(resampled)));
  }

  /**
   * 停止擷取並釋放資源。可能在 start() 完成前被呼叫（WS 立即斷線時）。
   */
  stop(): void {
    const handleStop = () => {
      this.source?.disconnect();
      this.stream?.getTracks().forEach((track) => track.stop());
      this.stream = undefined;
      this.recordingWorklet = undefined;
      this.vuWorklet = undefined;
      this.resampler = null;
      this.recording = false;
    };
    if (this.starting) {
      // start 未完成即 stop：無論該次 start 成功或失敗都要清理，且不可留下未捕捉的 rejection。
      this.starting.then(handleStop, handleStop);
      return;
    }
    handleStop();
  }
}
