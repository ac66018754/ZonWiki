/**
 * iOS Safari 取樣率補正——帶抗鋸齒的下採樣重採樣器（→ 16kHz）。
 *
 * 【為什麼需要（計畫 §5 審修-F5、live-spec §9.5）】
 * Safari（尤其 iOS）會**忽略** `new AudioContext({ sampleRate: 16000 })`，強制以硬體率
 *（通常 44100 / 48000 Hz）運行整條音訊圖。此時錄音 worklet 送出的 int16 其實是 44.1k/48k，
 * 卻被標成 16k 餵給 Vertex，等於送出「混疊（aliasing）的假 16k」，ASR 準確度大幅下降。
 *
 * 【本模組做什麼】
 * 提供一個「先低通抗鋸齒、再重採樣」的重採樣器：以視窗化 sinc（windowed-sinc, Blackman 窗）
 * 為卷積核，截止頻率設在目標奈奎斯特（16k 的一半＝8kHz），一步完成「低通濾波＋分數位置插值」。
 * 高於 8kHz 的成分會在下採樣**之前**被濾掉，避免它們折回可聽帶造成混疊。
 *
 * 【設計取捨】
 * - 採「以卷積核在分數位置取樣」的任意比率重採樣（arbitrary-ratio / polyphase 思路），
 *   同時處理抗鋸齒與插值，品質優於單純線性插值。
 * - 有狀態（Resampler 類別）以支援串流：跨 chunk 保留左右文脈，避免每個 128-sample 邊界產生喀噠聲。
 * - 純運算、不碰 DOM／window → 可獨立單元測試（resampler.test.ts）。
 */

/** Vertex Live 上行固定取樣率（Hz）。 */
export const TARGET_SAMPLE_RATE = 16000;

/** 卷積核每側涵蓋的 sinc 零交越數（越大→過渡帶越窄、阻帶衰減越好、成本越高）。 */
const ZERO_CROSSINGS_PER_SIDE = 8;

/**
 * 是否需要重採樣：AudioContext 實際取樣率不等於 16000 就需要（iOS 忽略指定率的情況）。
 * @param actualSampleRate AudioContext 實際運行的取樣率。
 * @returns 需要重採樣為 true。
 */
export function needsResampling(actualSampleRate: number): boolean {
  return Math.round(actualSampleRate) !== TARGET_SAMPLE_RATE;
}

/**
 * 正規化 sinc：sinc(x) = sin(πx) / (πx)，且 sinc(0)=1。
 * @param x 引數。
 * @returns sinc 值。
 */
function sinc(x: number): number {
  if (x === 0) return 1;
  const pix = Math.PI * x;
  return Math.sin(pix) / pix;
}

/**
 * Blackman 窗（a ∈ [0,1]，中心 a=0.5 值為 1）。用來把無限長 sinc 截斷成有限長、壓低旁瓣。
 * @param a 正規化位置 [0,1]。
 * @returns 窗值。
 */
function blackman(a: number): number {
  return 0.42 - 0.5 * Math.cos(2 * Math.PI * a) + 0.08 * Math.cos(4 * Math.PI * a);
}

/**
 * 帶抗鋸齒的重採樣器（source → 16kHz）。有狀態，支援串流逐 chunk 餵入。
 *
 * 用法：
 *   const rs = new Resampler(48000);
 *   const out1 = rs.process(chunkA);   // Float32Array @16k
 *   const out2 = rs.process(chunkB);
 *   const tail = rs.flush();           // 收尾（右側補零產生殘餘輸出）
 */
export class Resampler {
  /** 來源取樣率（Hz）。 */
  private readonly sourceRate: number;
  /** 目標取樣率（Hz）。 */
  private readonly targetRate: number;
  /** 每輸出樣本對應的來源樣本步進（sourceRate / targetRate）。 */
  private readonly step: number;
  /** 正規化截止頻率（cycles/來源樣本，≤0.5）。 */
  private readonly cutoff: number;
  /** 卷積核半寬（以來源樣本為單位）。 */
  private readonly halfWidth: number;

  /** 尚未完全消化的輸入緩衝（已含左側文脈）。 */
  private buffer: Float32Array;
  /** buffer[0] 對應的「絕對來源樣本索引」（起始為負，代表前置補零文脈）。 */
  private bufferStartIndex: number;
  /** 下一個要輸出的「絕對輸出樣本索引」n。 */
  private nextOutputIndex: number;
  /** 是否已收尾（flush 後不可再 process）。 */
  private finished: boolean;

  /**
   * @param sourceRate 來源取樣率（AudioContext 實際率）。
   * @param targetRate 目標取樣率（預設 16000）。
   */
  constructor(sourceRate: number, targetRate: number = TARGET_SAMPLE_RATE) {
    if (!(sourceRate > 0) || !(targetRate > 0)) {
      throw new Error("Resampler: sampleRate must be positive");
    }
    this.sourceRate = sourceRate;
    this.targetRate = targetRate;
    this.step = sourceRate / targetRate;
    // 截止設在「來源與目標奈奎斯特中的較小者」；下採樣時＝目標奈奎斯特。
    this.cutoff = 0.5 * Math.min(1, targetRate / sourceRate);
    // 每側零交越間距＝1/(2*cutoff) 個來源樣本；半寬＝零交越數 × 間距。
    this.halfWidth = Math.ceil(ZERO_CROSSINGS_PER_SIDE / (2 * this.cutoff));

    // 前置補零：讓第 0 個輸出也有對稱左側文脈（等同「串流開始前為靜音」，物理正確）。
    const pad = this.halfWidth;
    this.buffer = new Float32Array(pad);
    this.bufferStartIndex = -pad;
    this.nextOutputIndex = 0;
    this.finished = false;
  }

  /**
   * 評估卷積核在偏移 t（來源樣本單位）的權重。
   * 未做 2*cutoff 增益補償——最終以權重和正規化（sum/wsum）保證 DC 增益恰為 1。
   * @param t 偏移（srcPos - k）。
   * @returns 核權重。
   */
  private kernel(t: number): number {
    if (t < -this.halfWidth || t > this.halfWidth) return 0;
    const windowPos = (t + this.halfWidth) / (2 * this.halfWidth);
    return sinc(2 * this.cutoff * t) * blackman(windowPos);
  }

  /**
   * 把新輸入接到現有緩衝尾端。
   * @param chunk 來源取樣率的 Float32 PCM（-1..1）。
   */
  private append(chunk: Float32Array): void {
    const merged = new Float32Array(this.buffer.length + chunk.length);
    merged.set(this.buffer, 0);
    merged.set(chunk, this.buffer.length);
    this.buffer = merged;
  }

  /**
   * 在「右側文脈足夠」的前提下盡量產出輸出樣本，並丟棄不再需要的左側緩衝。
   * @param allowPartialRightContext 收尾時允許右側文脈不足（等同右側補零）。
   * @returns 本次產出的 16k Float32 樣本。
   */
  private emit(allowPartialRightContext: boolean): Float32Array {
    const outputs: number[] = [];
    const lastAbsIndex = this.bufferStartIndex + this.buffer.length - 1;

    for (;;) {
      const srcPos = this.nextOutputIndex * this.step;
      const rightEdge = srcPos + this.halfWidth;
      // 右側文脈不足且不允許部分文脈 → 等下一個 chunk。
      if (!allowPartialRightContext && rightEdge > lastAbsIndex) break;
      // 收尾時：連中心都超出資料就停止（沒有可用資料）。
      if (allowPartialRightContext && srcPos > lastAbsIndex) break;

      const kStart = Math.ceil(srcPos - this.halfWidth);
      const kEnd = Math.floor(srcPos + this.halfWidth);
      let sum = 0;
      let wsum = 0;
      for (let k = kStart; k <= kEnd; k++) {
        const j = k - this.bufferStartIndex;
        if (j < 0 || j >= this.buffer.length) continue;
        const w = this.kernel(srcPos - k);
        sum += this.buffer[j] * w;
        wsum += w;
      }
      outputs.push(wsum !== 0 ? sum / wsum : 0);
      this.nextOutputIndex++;
    }

    // 丟棄左側不再需要的樣本（下一個輸出的最左需求）。
    const nextSrcPos = this.nextOutputIndex * this.step;
    const dropBefore = Math.floor(nextSrcPos - this.halfWidth);
    if (dropBefore > this.bufferStartIndex) {
      const shift = Math.min(dropBefore - this.bufferStartIndex, this.buffer.length);
      this.buffer = this.buffer.slice(shift);
      this.bufferStartIndex += shift;
    }

    return Float32Array.from(outputs);
  }

  /**
   * 餵入一段來源取樣率的 Float32 PCM，回傳目前可產出的 16k Float32 PCM。
   * @param chunk 來源率 Float32（-1..1）。
   * @returns 16k Float32（可能為空，代表還在累積文脈）。
   */
  process(chunk: Float32Array): Float32Array {
    if (this.finished) {
      throw new Error("Resampler: cannot process after flush()");
    }
    if (chunk.length === 0) return new Float32Array(0);
    this.append(chunk);
    return this.emit(false);
  }

  /**
   * 收尾：右側補零，產出殘餘輸出。呼叫後本實例不可再 process。
   * @returns 最後一段 16k Float32。
   */
  flush(): Float32Array {
    if (this.finished) return new Float32Array(0);
    // 右側補零，讓尾端輸出也有文脈。
    this.append(new Float32Array(this.halfWidth));
    const out = this.emit(true);
    this.finished = true;
    return out;
  }
}

/**
 * 一次性重採樣整段 Float32 PCM 到 16kHz（供測試與非串流用途）。
 * @param input 來源率 Float32（-1..1）。
 * @param sourceRate 來源取樣率。
 * @param targetRate 目標取樣率（預設 16000）。
 * @returns 16k Float32。
 */
export function resampleBuffer(
  input: Float32Array,
  sourceRate: number,
  targetRate: number = TARGET_SAMPLE_RATE,
): Float32Array {
  const rs = new Resampler(sourceRate, targetRate);
  const head = rs.process(input);
  const tail = rs.flush();
  const out = new Float32Array(head.length + tail.length);
  out.set(head, 0);
  out.set(tail, head.length);
  return out;
}

/**
 * Float32 PCM（-1..1）→ Int16 PCM（LE）ArrayBuffer。
 * 沿用參考實作的 `* 32768` 慣例（float=1.0 時溢位到 -32768，可聞影響極小）。
 * @param float32 Float32 樣本。
 * @returns Int16 的底層 ArrayBuffer（可直接 base64 送出）。
 */
export function float32ToInt16Buffer(float32: Float32Array): ArrayBuffer {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    let s = float32[i] * 32768;
    if (s > 32767) s = 32767;
    else if (s < -32768) s = -32768;
    int16[i] = s;
  }
  return int16.buffer;
}

/**
 * Int16 PCM（LE）ArrayBuffer → Float32 PCM（-1..1）。
 * 供「worklet 已輸出 int16、需回到 float 做重採樣」的路徑用。
 * @param buffer Int16 的底層 ArrayBuffer。
 * @returns Float32 樣本。
 */
export function int16BufferToFloat32(buffer: ArrayBuffer): Float32Array {
  const int16 = new Int16Array(buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768;
  }
  return float32;
}
