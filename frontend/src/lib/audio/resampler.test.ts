/**
 * resampler.ts 單元測試（抗鋸齒下採樣 → 16kHz）。
 *
 * 執行：`pnpm exec tsx --test src/lib/audio/resampler.test.ts`
 *（或 `pnpm run test:unit`）。純運算、不需瀏覽器。
 *
 * 驗收重點（計畫 §5 審修-F5）：
 *  1. 輸出長度 ≈ 輸入 × 16000/sourceRate（48k 與 44.1k）。
 *  2. 通帶內低頻正弦（1kHz/3kHz）能量被保留。
 *  3. **抗鋸齒**：高於 8kHz 的正弦（12kHz@48k）若不濾波，下採樣會折回 4kHz；
 *     斷言輸出在 4kHz 的能量遠低於「真正的 4kHz 訊號」→ 證明混疊被有效抑制。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Resampler,
  resampleBuffer,
  needsResampling,
  TARGET_SAMPLE_RATE,
  float32ToInt16Buffer,
  int16BufferToFloat32,
} from "./resampler";

/**
 * 產生單頻正弦。
 * @param freq 頻率（Hz）。
 * @param rate 取樣率（Hz）。
 * @param seconds 長度（秒）。
 * @param amplitude 振幅（0..1）。
 * @returns Float32 樣本。
 */
function genSine(
  freq: number,
  rate: number,
  seconds: number,
  amplitude = 0.5,
): Float32Array {
  const n = Math.round(rate * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / rate);
  }
  return out;
}

/** 均方根（RMS）。 */
function rms(signal: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < signal.length; i++) sum += signal[i] * signal[i];
  return Math.sqrt(sum / signal.length);
}

/**
 * Goertzel：回傳訊號在頻率 f 的（未正規化）功率，用於比較同長度訊號的頻譜能量。
 * @param signal 樣本。
 * @param freq 目標頻率（Hz）。
 * @param rate 取樣率（Hz）。
 * @returns 該頻率的功率。
 */
function goertzelPower(signal: Float32Array, freq: number, rate: number): number {
  const omega = (2 * Math.PI * freq) / rate;
  const coeff = 2 * Math.cos(omega);
  let sPrev = 0;
  let sPrev2 = 0;
  for (let i = 0; i < signal.length; i++) {
    const s = signal[i] + coeff * sPrev - sPrev2;
    sPrev2 = sPrev;
    sPrev = s;
  }
  return sPrev2 * sPrev2 + sPrev * sPrev - coeff * sPrev * sPrev2;
}

test("needsResampling: 16000 不需要、其它需要", () => {
  assert.equal(needsResampling(16000), false);
  assert.equal(needsResampling(48000), true);
  assert.equal(needsResampling(44100), true);
  assert.equal(TARGET_SAMPLE_RATE, 16000);
});

test("48k→16k 輸出長度約為輸入的 1/3", () => {
  const input = genSine(1000, 48000, 1.0);
  const out = resampleBuffer(input, 48000);
  const expected = Math.round((input.length * TARGET_SAMPLE_RATE) / 48000);
  assert.ok(
    Math.abs(out.length - expected) < 64,
    `輸出 ${out.length} 應接近 ${expected}`,
  );
});

test("44.1k→16k 輸出長度約為輸入的 16/44.1", () => {
  const input = genSine(1000, 44100, 1.0);
  const out = resampleBuffer(input, 44100);
  const expected = Math.round((input.length * TARGET_SAMPLE_RATE) / 44100);
  assert.ok(
    Math.abs(out.length - expected) < 64,
    `輸出 ${out.length} 應接近 ${expected}`,
  );
});

test("通帶：1kHz@48k 能量被保留（RMS 相近、頻譜峰在 1kHz）", () => {
  const input = genSine(1000, 48000, 1.0, 0.5);
  const out = resampleBuffer(input, 48000);
  const ratio = rms(out) / rms(input);
  assert.ok(ratio > 0.7 && ratio < 1.3, `RMS 比 ${ratio.toFixed(3)} 應接近 1`);
  // 1kHz 應遠強於一個不存在的鄰近頻率（如 6kHz）。
  const p1k = goertzelPower(out, 1000, TARGET_SAMPLE_RATE);
  const p6k = goertzelPower(out, 6000, TARGET_SAMPLE_RATE);
  assert.ok(p1k > 100 * p6k, `1kHz 功率應遠大於 6kHz（${p1k.toFixed(1)} vs ${p6k.toFixed(1)}）`);
});

test("通帶：3kHz@44.1k 能量被保留", () => {
  const input = genSine(3000, 44100, 1.0, 0.5);
  const out = resampleBuffer(input, 44100);
  const ratio = rms(out) / rms(input);
  assert.ok(ratio > 0.6 && ratio < 1.3, `RMS 比 ${ratio.toFixed(3)} 應接近 1`);
});

test("抗鋸齒：12kHz@48k 幾乎被濾除（整體能量大幅下降）", () => {
  const input = genSine(12000, 48000, 1.0, 0.5);
  const out = resampleBuffer(input, 48000);
  const ratio = rms(out) / rms(input);
  // 若無抗鋸齒，12kHz 會以近乎全振幅折回 4kHz（ratio≈1）；濾波後應大幅衰減。
  assert.ok(ratio < 0.25, `阻帶訊號 RMS 比應 <0.25，實得 ${ratio.toFixed(3)}`);
});

test("抗鋸齒：12kHz 折疊到 4kHz 的能量遠低於真正的 4kHz 訊號（>20dB）", () => {
  const aliasSource = genSine(12000, 48000, 1.0, 0.5); // 無濾波會折回 4kHz
  const realSource = genSine(4000, 48000, 1.0, 0.5); // 真正的 4kHz（通帶內）
  const aliasOut = resampleBuffer(aliasSource, 48000);
  const realOut = resampleBuffer(realSource, 48000);
  const pAlias = goertzelPower(aliasOut, 4000, TARGET_SAMPLE_RATE);
  const pReal = goertzelPower(realOut, 4000, TARGET_SAMPLE_RATE);
  assert.ok(
    pAlias < 0.01 * pReal,
    `折疊到 4kHz 的能量（${pAlias.toFixed(2)}）應 <1% 的真 4kHz 能量（${pReal.toFixed(2)}）`,
  );
});

test("串流分段處理與一次性處理結果一致", () => {
  const input = genSine(2000, 48000, 0.5, 0.5);
  const oneShot = resampleBuffer(input, 48000);

  const rs = new Resampler(48000);
  const parts: number[] = [];
  const chunkSize = 2048;
  for (let i = 0; i < input.length; i += chunkSize) {
    const chunk = input.subarray(i, Math.min(i + chunkSize, input.length));
    const outChunk = rs.process(chunk);
    for (let j = 0; j < outChunk.length; j++) parts.push(outChunk[j]);
  }
  const tail = rs.flush();
  for (let j = 0; j < tail.length; j++) parts.push(tail[j]);

  assert.equal(parts.length, oneShot.length, "串流與一次性輸出長度應一致");
  let maxDiff = 0;
  for (let i = 0; i < oneShot.length; i++) {
    maxDiff = Math.max(maxDiff, Math.abs(parts[i] - oneShot[i]));
  }
  assert.ok(maxDiff < 1e-6, `串流與一次性樣本差異應可忽略，最大差 ${maxDiff}`);
});

test("int16 ↔ float32 轉換往返近似無損", () => {
  const input = genSine(1000, 16000, 0.1, 0.5);
  const roundTrip = int16BufferToFloat32(float32ToInt16Buffer(input));
  assert.equal(roundTrip.length, input.length);
  let maxDiff = 0;
  for (let i = 0; i < input.length; i++) {
    maxDiff = Math.max(maxDiff, Math.abs(roundTrip[i] - input[i]));
  }
  // int16 量化誤差上限約 1/32768。
  assert.ok(maxDiff < 1e-3, `往返誤差 ${maxDiff} 應在量化精度內`);
});

test("flush 後再 process 應丟例外", () => {
  const rs = new Resampler(48000);
  rs.process(genSine(1000, 48000, 0.05));
  rs.flush();
  assert.throws(() => rs.process(new Float32Array(10)));
});
