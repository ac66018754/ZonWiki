/**
 * coachState.ts 狀態守門單元測試（【對抗復審-#1】重連死鎖修正）。
 *
 * 執行：`pnpm exec tsx --test src/app/others/coach/lib/coachState.test.ts`（或 `pnpm run test:unit`）。
 *
 * 核心迴歸：後端訊號式重連（GoAway 常態事件）成功後補送 state:listening／audio／transcript，
 * 前端若只用 isActiveState 守門（不含 reconnecting）會把這些事件吞掉、UI 永久卡「重連中」。
 * 修法讓 canReceiveServerUpdate 額外放行 reconnecting → 這裡以純函式斷言「reconnecting 能脫離、終態不受污染」。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { isActiveState, canReceiveServerUpdate } from "./coachState";

test("isActiveState：進行中狀態為 true、reconnecting/終態為 false", () => {
  assert.equal(isActiveState("connecting"), true);
  assert.equal(isActiveState("listening"), true);
  assert.equal(isActiveState("thinking"), true);
  assert.equal(isActiveState("speaking"), true);
  assert.equal(isActiveState("reconnecting"), false);
  assert.equal(isActiveState("ended"), false);
  assert.equal(isActiveState("fatal"), false);
});

test("canReceiveServerUpdate：reconnecting 放行（重連成功後能回 listening/speaking），修死鎖", () => {
  // #1 關鍵：重連中收到後端 state:listening／audio 必須能轉移（否則永久卡死）。
  assert.equal(canReceiveServerUpdate("reconnecting"), true);
});

test("canReceiveServerUpdate：進行中狀態放行", () => {
  assert.equal(canReceiveServerUpdate("connecting"), true);
  assert.equal(canReceiveServerUpdate("listening"), true);
  assert.equal(canReceiveServerUpdate("thinking"), true);
  assert.equal(canReceiveServerUpdate("speaking"), true);
});

test("canReceiveServerUpdate：終態不放行（避免收線後殘留訊框污染 ended/fatal）", () => {
  assert.equal(canReceiveServerUpdate("ended"), false);
  assert.equal(canReceiveServerUpdate("fatal"), false);
});
