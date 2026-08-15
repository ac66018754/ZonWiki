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
 * 來源出處（Apache-2.0）：google-gemini/live-api-web-console，`src/lib/audio-streamer.ts`。
 * 排程／無縫播放演算法原樣保留（delicate，勿改）。ZonWiki 移植調整（Phase 3，計畫 §5）：
 *   1. barge-in 近似截點：新增「本回合已排程總時長 / 已播放時長」計量（playbackProgress()），
 *      供前端在收到 interrupted 時估算 AI 實際講到哪、標「（被打斷）」並回報 ApproxCutChars。
 *   2. 型別/lint 清理：移除 any 與 as unknown as number；修正 createWorketFromSrc 拼字。
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  createWorkletFromSrc,
  registeredWorklets,
} from "./audioworklet-registry";

/**
 * 本回合播放進度（供 barge-in 近似截點估算）。
 */
export interface PlaybackProgress {
  /** 本回合已「聽到」的秒數（clamp 到 scheduledSeconds）。 */
  playedSeconds: number;
  /** 本回合已排程的音訊總秒數。 */
  scheduledSeconds: number;
  /** playedSeconds / scheduledSeconds（0..1；無排程時為 0）。 */
  fraction: number;
}

/**
 * 下行 24kHz PCM16 無縫播放器：收 chunk → Web Audio 排程播放；barge-in 時 stop() 清佇列淡出。
 */
export class AudioStreamer {
  /** 下行固定取樣率。 */
  private sampleRate: number = 24000;
  /** 單一 AudioBuffer 的最大樣本數（超過則切段入佇列）。 */
  private bufferSize: number = 7680;
  /** 待播放的 Float32 緩衝佇列。 */
  private audioQueue: Float32Array[] = [];
  /** 是否播放中。 */
  private isPlaying: boolean = false;
  /** 串流是否已結束（例如被打斷）。 */
  private isStreamComplete: boolean = false;
  /** 佇列見底時的輪詢計時器 id。 */
  private checkInterval: number | null = null;
  /** 下一段音訊的排程開始時間（context 時鐘）。 */
  private scheduledTime: number = 0;
  /** 起始緩衝時間（100ms）。 */
  private initialBufferTime: number = 0.1;

  /** 音訊圖：source → gain → destination。 */
  public gainNode: GainNode;
  /** 佔位 source（相容原始建構）。 */
  public source: AudioBufferSourceNode;
  /** 佇列尾端的 source（用來偵測播放結束）。 */
  private endOfQueueAudioSource: AudioBufferSourceNode | null = null;

  /** 本回合已排程的音訊總秒數（barge-in 估算用；每回合起始歸零）。 */
  private turnScheduledSeconds: number = 0;
  /** 本回合播放起算的 context 時間（isPlaying false→true 時設定）。 */
  private turnBaselineTime: number = 0;

  /** 播放自然結束（佇列播完）回呼。 */
  public onComplete: () => void = () => {};

  /**
   * @param context 已建立的 AudioContext（由使用者手勢後建立）。
   */
  constructor(public context: AudioContext) {
    this.gainNode = this.context.createGain();
    this.source = this.context.createBufferSource();
    this.gainNode.connect(this.context.destination);
    this.addPCM16 = this.addPCM16.bind(this);
  }

  /**
   * 掛一個額外處理 worklet 到輸出圖（如視覺化）；coach 流程未使用，保留以維持相容。
   * @param workletName worklet 名稱。
   * @param workletSrc worklet 原始碼字串。
   * @param handler 訊息處理器。
   * @returns this。
   */
  async addWorklet(
    workletName: string,
    workletSrc: string,
    handler: (this: MessagePort, ev: MessageEvent) => void,
  ): Promise<this> {
    let workletsRecord = registeredWorklets.get(this.context);
    if (workletsRecord && workletsRecord[workletName]) {
      workletsRecord[workletName].handlers.push(handler);
      return this;
    }

    if (!workletsRecord) {
      registeredWorklets.set(this.context, {});
      workletsRecord = registeredWorklets.get(this.context)!;
    }

    workletsRecord[workletName] = { handlers: [handler] };

    const src = createWorkletFromSrc(workletName, workletSrc);
    await this.context.audioWorklet.addModule(src);
    const worklet = new AudioWorkletNode(this.context, workletName);
    workletsRecord[workletName].node = worklet;
    return this;
  }

  /**
   * Uint8Array(PCM16) → Float32Array（-1..1），little-endian。
   * @param chunk PCM16 位元組。
   * @returns Float32 樣本。
   */
  private _processPCM16Chunk(chunk: Uint8Array): Float32Array {
    const float32Array = new Float32Array(chunk.length / 2);
    const dataView = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    for (let i = 0; i < chunk.length / 2; i++) {
      const int16 = dataView.getInt16(i * 2, true);
      float32Array[i] = int16 / 32768;
    }
    return float32Array;
  }

  /**
   * 加入一段下行 PCM16，必要時起播。
   * @param chunk PCM16 位元組（24kHz）。
   */
  addPCM16(chunk: Uint8Array): void {
    this.isStreamComplete = false;
    let processingBuffer = this._processPCM16Chunk(chunk);
    while (processingBuffer.length >= this.bufferSize) {
      const buffer = processingBuffer.slice(0, this.bufferSize);
      this.audioQueue.push(buffer);
      processingBuffer = processingBuffer.slice(this.bufferSize);
    }
    if (processingBuffer.length > 0) {
      this.audioQueue.push(processingBuffer);
    }
    if (!this.isPlaying) {
      this.isPlaying = true;
      this.scheduledTime = this.context.currentTime + this.initialBufferTime;
      // 新回合起播：歸零本回合排程計量、記錄基準時間（barge-in 估算用）。
      this.turnScheduledSeconds = 0;
      this.turnBaselineTime = this.scheduledTime;
      this.scheduleNextBuffer();
    }
  }

  /**
   * Float32 → AudioBuffer（單聲道，24kHz）。
   * @param audioData Float32 樣本。
   * @returns AudioBuffer。
   */
  private createAudioBuffer(audioData: Float32Array): AudioBuffer {
    const audioBuffer = this.context.createBuffer(1, audioData.length, this.sampleRate);
    audioBuffer.getChannelData(0).set(audioData);
    return audioBuffer;
  }

  /**
   * 排程接下來可播的緩衝（維持 scheduledTime 無縫）。演算法原樣保留。
   */
  private scheduleNextBuffer(): void {
    const SCHEDULE_AHEAD_TIME = 0.2;

    while (
      this.audioQueue.length > 0 &&
      this.scheduledTime < this.context.currentTime + SCHEDULE_AHEAD_TIME
    ) {
      const audioData = this.audioQueue.shift()!;
      const audioBuffer = this.createAudioBuffer(audioData);
      const source = this.context.createBufferSource();

      if (this.audioQueue.length === 0) {
        if (this.endOfQueueAudioSource) {
          this.endOfQueueAudioSource.onended = null;
        }
        this.endOfQueueAudioSource = source;
        source.onended = () => {
          if (!this.audioQueue.length && this.endOfQueueAudioSource === source) {
            this.endOfQueueAudioSource = null;
            this.onComplete();
          }
        };
      }

      source.buffer = audioBuffer;
      source.connect(this.gainNode);

      const worklets = registeredWorklets.get(this.context);
      if (worklets) {
        Object.entries(worklets).forEach(([, graph]) => {
          const { node, handlers } = graph;
          if (node) {
            source.connect(node);
            node.port.onmessage = function (ev: MessageEvent) {
              handlers.forEach((handler) => {
                handler.call(node.port, ev);
              });
            };
            node.connect(this.context.destination);
          }
        });
      }

      const startTime = Math.max(this.scheduledTime, this.context.currentTime);
      source.start(startTime);
      this.scheduledTime = startTime + audioBuffer.duration;
      // barge-in 估算：累計本回合已排程的音訊時長。
      this.turnScheduledSeconds += audioBuffer.duration;
    }

    if (this.audioQueue.length === 0) {
      if (this.isStreamComplete) {
        this.isPlaying = false;
        if (this.checkInterval) {
          clearInterval(this.checkInterval);
          this.checkInterval = null;
        }
      } else if (!this.checkInterval) {
        this.checkInterval = window.setInterval(() => {
          if (this.audioQueue.length > 0) {
            this.scheduleNextBuffer();
          }
        }, 100);
      }
    } else {
      const nextCheckTime = (this.scheduledTime - this.context.currentTime) * 1000;
      setTimeout(() => this.scheduleNextBuffer(), Math.max(0, nextCheckTime - 50));
    }
  }

  /**
   * 目前回合的播放進度（供 barge-in 前讀取以估算截點）。
   * @returns 已播/已排程秒數與比例。
   */
  playbackProgress(): PlaybackProgress {
    const scheduledSeconds = this.turnScheduledSeconds;
    if (scheduledSeconds <= 0) {
      return { playedSeconds: 0, scheduledSeconds: 0, fraction: 0 };
    }
    const elapsed = this.context.currentTime - this.turnBaselineTime;
    const playedSeconds = Math.max(0, Math.min(elapsed, scheduledSeconds));
    return {
      playedSeconds,
      scheduledSeconds,
      fraction: playedSeconds / scheduledSeconds,
    };
  }

  /**
   * 立刻停止播放並清佇列（barge-in）：淡出 100ms、200ms 後重建 gainNode。
   */
  stop(): void {
    this.isPlaying = false;
    this.isStreamComplete = true;
    this.audioQueue = [];
    this.scheduledTime = this.context.currentTime;

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    this.gainNode.gain.linearRampToValueAtTime(0, this.context.currentTime + 0.1);

    setTimeout(() => {
      this.gainNode.disconnect();
      this.gainNode = this.context.createGain();
      this.gainNode.connect(this.context.destination);
    }, 200);
  }

  /**
   * 由 suspended 恢復播放（PWA 切前景）。
   */
  async resume(): Promise<void> {
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
    this.isStreamComplete = false;
    this.scheduledTime = this.context.currentTime + this.initialBufferTime;
    this.gainNode.gain.setValueAtTime(1, this.context.currentTime);
  }

  /**
   * 標記串流結束（讓佇列播完後觸發 onComplete）。
   */
  complete(): void {
    this.isStreamComplete = true;
    this.onComplete();
  }
}
