/**
 * coach.ts 契約層單元測試（Phase 3 英文教練，對抗復審修正）。
 *
 * 執行：`pnpm exec tsx --test src/lib/api/coach.test.ts`（或 `pnpm run test:unit`）。純函式、不需瀏覽器。
 *
 * 覆蓋修正：
 *  - #4：parseServerMessage 認得 `{type:"turn_end"}` → { kind:"turnEnd" }（回合定案訊號）。
 *  - #6：parseCorrectionJson 支援 JSON 陣列（一則訊息多張糾錯卡）與單一物件（舊資料相容）。
 *  - #2：normalizeSessionDetail 讀巢狀信封 `{session,messages}`＋summaryText，並依 seqNo 排序訊息。
 */

import { test, expect } from "vitest";
import {
  parseServerMessage,
  parseCorrectionJson,
  normalizeSessionDetail,
  type CoachMessageDto,
} from "./coach";

// ── #4 turn_end ────────────────────────────────────────────────────────────

test("parseServerMessage：type=turn_end → kind=turnEnd（回合定案訊號）", () => {
  const event = parseServerMessage({ type: "turn_end" });
  expect(event.kind).toBe("turnEnd");
});

test("parseServerMessage：reconnecting/state/ended 仍正確（回歸保護）", () => {
  expect(parseServerMessage({ type: "reconnecting" }).kind).toBe("reconnecting");
  expect(parseServerMessage({ type: "ended" }).kind).toBe("ended");
  const state = parseServerMessage({ state: "listening" });
  expect(state.kind).toBe("state");
  expect(state.kind === "state" && state.state).toBe("listening");
});

// ── #8 入站被拒（rejected）→ 前端撥回 listening＋提示 ────────────────────────────

test("parseServerMessage：type=rejected → kind=rejected（帶 reason）", () => {
  const textEvent = parseServerMessage({ type: "rejected", reason: "text_too_long" });
  expect(textEvent.kind).toBe("rejected");
  expect(textEvent.kind === "rejected" && textEvent.reason).toBe("text_too_long");

  const audioEvent = parseServerMessage({ type: "rejected", reason: "audio_too_large" });
  expect(audioEvent.kind).toBe("rejected");
  expect(audioEvent.kind === "rejected" && audioEvent.reason).toBe("audio_too_large");

  // 缺 reason 時降級為 "unknown"（不炸）。
  const noReason = parseServerMessage({ type: "rejected" });
  expect(noReason.kind).toBe("rejected");
  expect(noReason.kind === "rejected" && noReason.reason).toBe("unknown");
});

// ── #6 糾錯卡陣列 ────────────────────────────────────────────────────────────

test("parseCorrectionJson：JSON 陣列 → 解出多張糾錯卡", () => {
  const message: CoachMessageDto = {
    id: "m1",
    role: "assistant",
    content: "(correction)",
    seqNo: 1,
    correctionJson: JSON.stringify([
      { original: "I has a apple", corrected: "I have an apple", explanation_zh: "主詞用 have" },
      { original: "he go", corrected: "he goes", explanationZh: "第三人稱單數" },
    ]),
  };
  const cards = parseCorrectionJson(message);
  expect(cards.length).toBe(2);
  expect(cards[0].original).toBe("I has a apple");
  expect(cards[0].corrected).toBe("I have an apple");
  expect(cards[0].explanationZh).toBe("主詞用 have");
  expect(cards[1].corrected).toBe("he goes");
});

test("parseCorrectionJson：單一物件（舊資料）→ 一張卡", () => {
  const message: CoachMessageDto = {
    id: "m2",
    role: "assistant",
    content: "x",
    seqNo: 1,
    correctionJson: JSON.stringify({ original: "a", corrected: "b" }),
  };
  const cards = parseCorrectionJson(message);
  expect(cards.length).toBe(1);
  expect(cards[0].corrected).toBe("b");
});

test("parseCorrectionJson：無/壞 JSON/缺欄 → 空陣列", () => {
  expect(parseCorrectionJson({ id: "a", role: "assistant", content: "", seqNo: 1 })).toEqual([]);
  expect(parseCorrectionJson({ id: "a", role: "assistant", content: "", seqNo: 1, correctionJson: "not json" })).toEqual([],);
  // 陣列內含無效元素（缺 corrected）→ 被濾除。
  expect(parseCorrectionJson({
      id: "a",
      role: "assistant",
      content: "",
      seqNo: 1,
      correctionJson: JSON.stringify([{ original: "only original" }]),
    })).toEqual([],);
});

// ── #2 巢狀信封 + summaryText ─────────────────────────────────────────────────

test("normalizeSessionDetail：巢狀 {session,messages} → 讀到 id/summaryText/依 seqNo 排序", () => {
  const detail = normalizeSessionDetail({
    session: {
      id: "s1",
      title: "口說練習",
      status: "ended",
      summaryText: "今天練了自我介紹",
      accumulatedSeconds: 120,
    },
    messages: [
      { id: "m2", role: "assistant", content: "hi", seqNo: 2 },
      { id: "m1", role: "user", content: "hello", seqNo: 1 },
    ],
  });
  expect(detail).not.toBe(null);
  expect(detail!.id).toBe("s1");
  expect(detail!.summaryText).toBe("今天練了自我介紹");
  expect(detail!.messages.length).toBe(2);
  // 依 seqNo 遞增排序。
  expect(detail!.messages[0].seqNo).toBe(1);
  expect(detail!.messages[1].seqNo).toBe(2);
});

test("normalizeSessionDetail：扁平信封（後備相容）也能讀 id", () => {
  const detail = normalizeSessionDetail({ id: "s2", title: "t", status: "ended", messages: [] });
  expect(detail).not.toBe(null);
  expect(detail!.id).toBe("s2");
});

test("normalizeSessionDetail：非物件/缺 id → null", () => {
  expect(normalizeSessionDetail(null)).toBe(null);
  expect(normalizeSessionDetail({ session: { title: "no id" } })).toBe(null);
});
