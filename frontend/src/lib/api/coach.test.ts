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
  coachWsUrl,
  resolveSessionIdForStart,
  type CoachMessageDto,
} from "./coach";

// ── prod 連不上的兩個根因（回歸鎖）────────────────────────────────────────────
//
// ① WS 路徑必須掛在 /api 底下：prod 邊緣（cloudflared ingress）只把 `^/api/.*` 導到後端，
//    其餘一律落到 Next.js。舊路徑 /ws/coach 在 prod 被前端回 404 → 教練永遠連不上。
// ② 開場前必須先開課拿 sessionId：後端 /api/ws/coach 沒帶 sessionId 一律 400（IDOR 護欄），
//    前端過去從不呼叫 createCoachSession → 連線必被擋。

test("coachWsUrl：路徑掛在 /api 底下（prod 邊緣只路由 /api/*）", () => {
  const url = coachWsUrl(null);
  expect(url).toContain("/api/ws/coach");
  expect(url.startsWith("ws://") || url.startsWith("wss://")).toBe(true);
  // 絕不可退回舊路徑（prod 會被 Next.js 接走回 404）。
  expect(new URL(url).pathname).toBe("/api/ws/coach");
});

test("coachWsUrl：帶 sessionId → 以 query 傳遞且經過編碼", () => {
  const url = coachWsUrl("a b/c");
  expect(new URL(url).searchParams.get("sessionId")).toBe("a b/c");
});

/** 測試用：成功開課的假回應。 */
const okSession = (id: string) =>
  ({ ok: true, session: { id, title: "t", status: "active" } }) as const;

test("resolveSessionIdForStart：已有 sessionId → 沿用，不重複開課", async () => {
  let opened = 0;
  const resolution = await resolveSessionIdForStart({
    currentSessionId: "existing-id",
    isMock: false,
    openSession: async () => {
      opened += 1;
      return okSession("new-id");
    },
  });
  expect(resolution).toEqual({ ok: true, sessionId: "existing-id" });
  expect(opened).toBe(0);
});

test("resolveSessionIdForStart：沒有 sessionId → 開新場並回新 id", async () => {
  const resolution = await resolveSessionIdForStart({
    currentSessionId: null,
    isMock: false,
    openSession: async () => okSession("fresh-id"),
  });
  expect(resolution).toEqual({ ok: true, sessionId: "fresh-id" });
});

test("resolveSessionIdForStart：開課失敗 → 帶回原因碼（呼叫端據此進 fatal，不去連注定 400 的 WS）", async () => {
  const resolution = await resolveSessionIdForStart({
    currentSessionId: null,
    isMock: false,
    openSession: async () => ({ ok: false, reason: "session_open_failed" }),
  });
  expect(resolution).toEqual({ ok: false, reason: "session_open_failed" });
});

test("resolveSessionIdForStart：額度／登入失效的原因碼要能分辨（訊息才給得準）", async () => {
  const limited = await resolveSessionIdForStart({
    currentSessionId: null,
    isMock: false,
    openSession: async () => ({ ok: false, reason: "daily_limit_reached" }),
  });
  expect(limited).toEqual({ ok: false, reason: "daily_limit_reached" });

  const unauthorized = await resolveSessionIdForStart({
    currentSessionId: null,
    isMock: false,
    openSession: async () => ({ ok: false, reason: "unauthorized" }),
  });
  expect(unauthorized).toEqual({ ok: false, reason: "unauthorized" });
});

test("resolveSessionIdForStart：e2e 假造模式 → 不打後端", async () => {
  let opened = 0;
  const resolution = await resolveSessionIdForStart({
    currentSessionId: null,
    isMock: true,
    openSession: async () => {
      opened += 1;
      return okSession("should-not-happen");
    },
  });
  expect(resolution).toEqual({ ok: true, sessionId: null });
  expect(opened).toBe(0);
});

// ── #4 turn_end ────────────────────────────────────────────────────────────

test("parseServerMessage：type=turn_end → kind=turnEnd（回合定案訊號）", () => {
  const event = parseServerMessage({ type: "turn_end" });
  expect(event.kind).toBe("turnEnd");
});

test("parseServerMessage：type=ready → kind=ready（後端連上 Vertex 才送，UI 據此才開放輸入）", () => {
  // 沒認得 ready 的話，前端只能靠「WS open」自稱就緒，而後端此時還沒開始轉送——
  // prod（彰化→us-central1）那 2 秒空窗內送出的訊息會被靜默丟掉。
  expect(parseServerMessage({ type: "ready" }).kind).toBe("ready");
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
