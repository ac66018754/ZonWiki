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
 * 來源出處（Apache-2.0）：google-gemini/live-api-web-console，
 * `src/lib/audioworklet-registry.ts`。原樣移植（未改邏輯）。
 * 把 worklet 原始碼「字串」包成 Blob URL 註冊；以 `Map<AudioContext, ...>` 去重。
 * ⚠️ Blob worklet 需 CSP 放行 `blob:`（本機無 CSP；prod 交接清單須確認 script-src/worker-src）。
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * 依 AudioContext 記錄已掛載的 worklet（節點＋訊息 handler 陣列）。
 * 任何用到 `audioContext.audioWorklet.addModule(` 的模組都應在此登記，避免重複註冊。
 */
export type WorkletGraph = {
  /** 已建立的 worklet 節點（尚未建立時為 undefined）。 */
  node?: AudioWorkletNode;
  /** 該 worklet 的 message handler 集合。 */
  handlers: Array<(this: MessagePort, ev: MessageEvent) => void>;
};

/** 全域註冊表：AudioContext → { workletName → WorkletGraph }。 */
export const registeredWorklets: Map<
  AudioContext,
  Record<string, WorkletGraph>
> = new Map();

/**
 * 把 worklet 原始碼字串包成可 addModule 的 Blob URL。
 * @param workletName 註冊給 `registerProcessor` 的名稱。
 * @param workletSrc worklet 類別的原始碼字串（如 audio-processing / vol-meter）。
 * @returns Blob object URL（傳給 `audioWorklet.addModule`）。
 */
export const createWorkletFromSrc = (
  workletName: string,
  workletSrc: string,
): string => {
  const script = new Blob(
    [`registerProcessor("${workletName}", ${workletSrc})`],
    { type: "application/javascript" },
  );
  return URL.createObjectURL(script);
};
