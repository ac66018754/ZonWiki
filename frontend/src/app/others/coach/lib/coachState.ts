/**
 * 教練連線狀態機的純函式守門邏輯（抽出以便單元測試，無 React／瀏覽器相依）。
 *
 * 背景（【對抗復審-#1 重連死鎖】）：後端做 Vertex 訊號式重連時會下發 `{type:"reconnecting"}`，
 * 前端進入 `state="reconnecting"`。重連成功後後端補送 `{type:"state",state:"listening"}` 及後續
 * audio/transcript；若所有轉移都只用 {@link isActiveState} 守門（不含 reconnecting），這些事件會被吞掉、
 * UI 永久卡「重連中」。GoAway 是 Vertex Live 常態事件，任何超過單條連線壽命的正常對話都會確定性卡死。
 * 修法：媒體／狀態類事件的守門改用 {@link canReceiveServerUpdate}（額外放行 reconnecting → 可脫離）。
 */

import type { CoachState } from "@/lib/api/coach";

/**
 * 是否為「對話進行中」的狀態（可自由切換 listening/thinking/speaking）。
 * 不含 reconnecting（傳輸／訊號式重連中）與終態 ended/fatal。
 * @param s 目前狀態。
 * @returns 進行中為 true。
 */
export function isActiveState(s: CoachState): boolean {
  return s === "connecting" || s === "listening" || s === "thinking" || s === "speaking";
}

/**
 * 是否可接收後端媒體／狀態事件並據以轉移狀態。
 * 在 {@link isActiveState} 之外<b>額外放行 reconnecting</b>——後端訊號式重連成功後送來的
 * `state:listening`／audio／transcript 必須能讓前端脫離「重連中」，否則會永久卡死（【對抗復審-#1】）。
 * 終態（ended/fatal）仍不放行（避免收線後的殘留訊框污染終態）。
 * @param s 目前狀態。
 * @returns 可接收並轉移為 true。
 */
export function canReceiveServerUpdate(s: CoachState): boolean {
  return isActiveState(s) || s === "reconnecting";
}
