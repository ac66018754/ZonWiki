/**
 * coachState.ts 狀態守門單元測試（【對抗復審-#1】重連死鎖修正）。
 *
 * 執行：`pnpm exec tsx --test src/app/others/coach/lib/coachState.test.ts`（或 `pnpm run test:unit`）。
 *
 * 核心迴歸：後端訊號式重連（GoAway 常態事件）成功後補送 state:listening／audio／transcript，
 * 前端若只用 isActiveState 守門（不含 reconnecting）會把這些事件吞掉、UI 永久卡「重連中」。
 * 修法讓 canReceiveServerUpdate 額外放行 reconnecting → 這裡以純函式斷言「reconnecting 能脫離、終態不受污染」。
 */

import { test, expect } from "vitest";
import { isActiveState, canReceiveServerUpdate } from "./coachState";

test("isActiveState：進行中狀態為 true、reconnecting/終態為 false", () => {
  expect(isActiveState("connecting")).toBe(true);
  expect(isActiveState("listening")).toBe(true);
  expect(isActiveState("thinking")).toBe(true);
  expect(isActiveState("speaking")).toBe(true);
  expect(isActiveState("reconnecting")).toBe(false);
  expect(isActiveState("ended")).toBe(false);
  expect(isActiveState("fatal")).toBe(false);
});

test("canReceiveServerUpdate：reconnecting 放行（重連成功後能回 listening/speaking），修死鎖", () => {
  // #1 關鍵：重連中收到後端 state:listening／audio 必須能轉移（否則永久卡死）。
  expect(canReceiveServerUpdate("reconnecting")).toBe(true);
});

test("canReceiveServerUpdate：進行中狀態放行", () => {
  expect(canReceiveServerUpdate("connecting")).toBe(true);
  expect(canReceiveServerUpdate("listening")).toBe(true);
  expect(canReceiveServerUpdate("thinking")).toBe(true);
  expect(canReceiveServerUpdate("speaking")).toBe(true);
});

test("canReceiveServerUpdate：終態不放行（避免收線後殘留訊框污染 ended/fatal）", () => {
  expect(canReceiveServerUpdate("ended")).toBe(false);
  expect(canReceiveServerUpdate("fatal")).toBe(false);
});
