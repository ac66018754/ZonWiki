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
 * 來源出處（Apache-2.0）：google-gemini/live-api-web-console，`src/lib/utils.ts`。
 * ZonWiki 移植調整（Phase 3 英文教練，計畫 §5 / live-spec §9.4）：
 *   1. SSR 破口：原檔在 module-level IIFE 直接呼叫 `window.addEventListener`，
 *      SSR/prerender 於 Node 端求值會 `window is not defined`。此處以 `typeof window`
 *      守住監聽器註冊（雖然整個工作區已用 dynamic(ssr:false) 載入，仍加此縱深防禦）。
 *   2. base64 helper 集中：把 `arrayBufferToBase64`（原在 audio-recorder.ts）一併搬到此，
 *      供 recorder 與 iOS 重採樣路徑共用（DRY）。
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * `audioContext()` 工廠的選項——沿用 Web Audio 的 `AudioContextOptions`，額外加一個
 * `id`：傳入相同 id 會復用同一個 AudioContext（避免 React StrictMode 重複建立）。
 */
export type GetAudioContextOptions = AudioContextOptions & {
  id?: string;
};

/** 依 id 復用 AudioContext 的快取表。 */
const contextMap: Map<string, AudioContext> = new Map();

/**
 * 「使用者已互動」的 Promise：autoplay policy 要求音訊必須在使用者手勢後才能啟動。
 * SSR（無 window）時直接以已解析的 Promise 取代，import 期不觸碰 window。
 */
const didInteract: Promise<unknown> =
  typeof window === "undefined"
    ? Promise.resolve()
    : new Promise((resolve) => {
        window.addEventListener("pointerdown", resolve, { once: true });
        window.addEventListener("keydown", resolve, { once: true });
      });

/**
 * 建立（或依 id 復用）一個 AudioContext。
 *
 * iOS 解鎖 hack（務必保留，live-spec §9.5）：先嘗試播放一段 base64 靜音 WAV 解鎖音訊；
 * 失敗（尚未有使用者手勢）則 await `didInteract` 後再建。
 * @param options AudioContext 選項（可含 `id` 以復用、`sampleRate` 指定取樣率）。
 * @returns 已就緒的 AudioContext。
 */
export async function audioContext(
  options?: GetAudioContextOptions,
): Promise<AudioContext> {
  const getCached = (): AudioContext | null => {
    if (options?.id && contextMap.has(options.id)) {
      const cached = contextMap.get(options.id);
      // 已關閉的 context 不可重用（在其上 createGain 等會丟 InvalidStateError）；移除後改建新的。
      if (cached && cached.state !== "closed") return cached;
      if (options.id) contextMap.delete(options.id);
    }
    return null;
  };

  const createAndCache = (): AudioContext => {
    const ctx = new AudioContext(options);
    if (options?.id) contextMap.set(options.id, ctx);
    return ctx;
  };

  try {
    // 嘗試以靜音 WAV 解鎖（iOS Safari 需要）。
    const silentAudio = new Audio();
    silentAudio.src =
      "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";
    await silentAudio.play();
    return getCached() ?? createAndCache();
  } catch {
    // 尚未有使用者手勢 → 等到第一個 pointerdown/keydown 再建。
    await didInteract;
    return getCached() ?? createAndCache();
  }
}

/**
 * base64 → ArrayBuffer（下行 24kHz PCM16 解碼用）。
 * @param base64 base64 字串。
 * @returns 位元組緩衝。
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * ArrayBuffer → base64（上行 16kHz PCM16 編碼用）。
 * @param buffer 位元組緩衝。
 * @returns base64 字串。
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
