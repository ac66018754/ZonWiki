// @vitest-environment jsdom
/**
 * mouseNav（VS 風格滑鼠側鍵錨點導航）純邏輯測試。
 *
 * 測試計畫（2026-08-10，經 tdd-guide sub-agent 審查後修訂版）：
 * A. recordAnchor（左鍵下錨／路由變更記錄）
 *   A1 空堆疊記錄第一個錨點 → entries=[a]、index=0
 *   A2 同 route、捲動差 ≤ 去重門檻 → 原地更新 scrollTop、長度不變
 *   A3 同 route、捲動差 > 門檻 → push 新錨點（同頁可下多個錨點，VS 語意）
 *   A4 不同 route → push
 *   A5 back 後（index 非末端）記錄新錨點 → 截斷 forward 分支
 *   A6 超過上限 → 丟最舊、index 指向最新
 *   A7 不可變性：輸入 state 與其 entries 不被就地修改
 *   A8 真實操作序列整合：進頁→點擊→深捲後點擊→跳頁→back→再下錨 的堆疊內容
 * B. goBack / goForward（審查重點：live 同步「永遠原地」、失敗操作零副作用）
 *   B1 空堆疊／單錨點 goBack → null
 *   B2 goBack 正常：index-1、target=前一錨點
 *   B3 goBack 把 live scrollTop 原地寫回 current——即使差距超過去重門檻也不 push、不砍 forward
 *   B4 back 後 goForward → 回到 B3 寫回的 live 位置
 *   B5 末端 goForward → null 且 entries 完全不變（失敗操作零副作用）
 *   B6 goBack 時 live.route ≠ current.route（脫鉤）→ target=current、state 不變
 *   B7 goForward 時 live.route ≠ current.route → null 且 state 不變
 *   B8 goBack 不可移動時即使 live 差很大 → null 且 entries 不變
 * C. 儲存（sessionStorage）
 *   C1 save→load round-trip
 *   C2 壞 JSON → 空 state
 *   C3 欄位缺漏／型別錯 → 空 state
 *   C4 index 越界 → 空 state
 *   C5 sessionStorage 拋例外 → 不炸、load 回空
 * D. 按鍵判定
 *   D1/D2 isBackButton（3）／isForwardButton（4）對 0~4 的判定
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MOUSE_NAV_STORAGE_KEY,
  MOUSE_NAV_MAX_ENTRIES,
  SCROLL_DEDUPE_PX,
  type MouseNavAnchor,
  type MouseNavState,
  emptyState,
  canGoBack,
  canGoForward,
  goBack,
  goForward,
  isBackButton,
  isForwardButton,
  loadState,
  recordAnchor,
  saveState,
} from "./mouseNav";

/** 便利建構：錨點。 */
const anchor = (route: string, scrollTop: number): MouseNavAnchor => ({ route, scrollTop });

/** 便利建構：由錨點清單組 state（index 預設指向最後一個）。 */
const stateOf = (entries: MouseNavAnchor[], index = entries.length - 1): MouseNavState => ({
  entries,
  index,
});

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("A. recordAnchor", () => {
  it("A1 空堆疊記錄第一個錨點", () => {
    const next = recordAnchor(emptyState(), anchor("/notes/a", 0));
    expect(next.entries).toEqual([anchor("/notes/a", 0)]);
    expect(next.index).toBe(0);
  });

  it("A2 同 route、捲動差在去重門檻內 → 原地更新 current 的 scrollTop", () => {
    const s = stateOf([anchor("/notes/a", 100)]);
    const next = recordAnchor(s, anchor("/notes/a", 100 + SCROLL_DEDUPE_PX));
    expect(next.entries).toHaveLength(1);
    expect(next.entries[0].scrollTop).toBe(100 + SCROLL_DEDUPE_PX);
    expect(next.index).toBe(0);
  });

  it("A3 同 route、捲動差超過門檻 → push 新錨點（同頁多錨點）", () => {
    const s = stateOf([anchor("/notes/a", 0)]);
    const next = recordAnchor(s, anchor("/notes/a", SCROLL_DEDUPE_PX + 1));
    expect(next.entries).toHaveLength(2);
    expect(next.index).toBe(1);
    expect(next.entries[1]).toEqual(anchor("/notes/a", SCROLL_DEDUPE_PX + 1));
  });

  it("A4 不同 route → push", () => {
    const s = stateOf([anchor("/notes/a", 500)]);
    const next = recordAnchor(s, anchor("/tasks", 0));
    expect(next.entries).toHaveLength(2);
    expect(next.index).toBe(1);
  });

  it("A5 back 後記錄新錨點 → 截斷 forward 分支", () => {
    // 三個錨點、index 退回到 0（曾按兩次上一頁）
    const s = stateOf([anchor("/a", 0), anchor("/b", 0), anchor("/c", 0)], 0);
    const next = recordAnchor(s, anchor("/d", 0));
    expect(next.entries.map((e) => e.route)).toEqual(["/a", "/d"]);
    expect(next.index).toBe(1);
  });

  it("A6 超過上限 → 丟最舊、index 指向最新", () => {
    let s = emptyState();
    for (let i = 0; i < MOUSE_NAV_MAX_ENTRIES + 5; i++) {
      s = recordAnchor(s, anchor(`/page-${i}`, 0));
    }
    expect(s.entries).toHaveLength(MOUSE_NAV_MAX_ENTRIES);
    expect(s.entries[0].route).toBe("/page-5"); // 最舊的 5 個被丟掉
    expect(s.entries[s.entries.length - 1].route).toBe(`/page-${MOUSE_NAV_MAX_ENTRIES + 4}`);
    expect(s.index).toBe(MOUSE_NAV_MAX_ENTRIES - 1);
  });

  it("A7 不可變性：輸入 state 不被就地修改", () => {
    const original = stateOf([anchor("/a", 0)]);
    const entriesRef = original.entries;
    const firstRef = original.entries[0];
    recordAnchor(original, anchor("/a", 50)); // 原地更新分支
    recordAnchor(original, anchor("/b", 0)); // push 分支
    expect(original.entries).toBe(entriesRef);
    expect(original.entries).toHaveLength(1);
    expect(original.entries[0]).toBe(firstRef);
    expect(original.entries[0].scrollTop).toBe(0);
    expect(original.index).toBe(0);
  });

  it("A8 真實操作序列：堆疊內容符合預期", () => {
    let s = emptyState();
    // 進入 /notes/a（路由變更記錄）
    s = recordAnchor(s, anchor("/notes/a", 0));
    // 頁頂附近點了一下（去重 → 原地更新）
    s = recordAnchor(s, anchor("/notes/a", 30));
    // 深捲後點擊（> 門檻 → 新錨點）
    s = recordAnchor(s, anchor("/notes/a", 900));
    // 跳到 /tasks（路由變更記錄）
    s = recordAnchor(s, anchor("/tasks", 0));
    expect(s.entries.map((e) => [e.route, e.scrollTop])).toEqual([
      ["/notes/a", 30],
      ["/notes/a", 900],
      ["/tasks", 0],
    ]);
    // back 回 /notes/a@900
    const back = goBack(s, anchor("/tasks", 0));
    expect(back).not.toBeNull();
    expect(back!.target).toEqual(anchor("/notes/a", 900));
    // 在 /notes/a 頁頂點擊 → 截斷 forward（/tasks 分支消失）、在 a@900 之後接新錨點
    //（a@900 保留：再按上一頁仍可回到它——這正是「錨點堆疊」相對瀏覽器歷史的價值）
    s = recordAnchor(back!.state, anchor("/notes/a", 0));
    expect(s.entries.map((e) => [e.route, e.scrollTop])).toEqual([
      ["/notes/a", 30],
      ["/notes/a", 900],
      ["/notes/a", 0],
    ]);
    expect(s.index).toBe(2);
  });
});

describe("B. goBack / goForward", () => {
  it("B1 空堆疊／單錨點 goBack → null", () => {
    expect(goBack(emptyState(), anchor("/a", 0))).toBeNull();
    expect(goBack(stateOf([anchor("/a", 0)]), anchor("/a", 10))).toBeNull();
  });

  it("B2 goBack 正常：index-1、target=前一錨點", () => {
    const s = stateOf([anchor("/a", 100), anchor("/b", 200)]);
    const result = goBack(s, anchor("/b", 200));
    expect(result).not.toBeNull();
    expect(result!.state.index).toBe(0);
    expect(result!.target).toEqual(anchor("/a", 100));
  });

  it("B3 goBack 把 live 位置原地寫回 current——即使差距超過門檻也不 push、不砍 forward", () => {
    // 這是審查抓到的核心洞的回歸鎖：live 同步「永遠原地」，
    // 不可重用 recordAnchor 的 push 判斷（否則深捲後按上一頁會變成「回同頁頂端＋砍前進歷史」）。
    const s = stateOf([anchor("/a", 0), anchor("/b", 0), anchor("/c", 0)], 1);
    const live = anchor("/b", SCROLL_DEDUPE_PX * 5); // 深捲，遠超門檻
    const result = goBack(s, live);
    expect(result).not.toBeNull();
    expect(result!.state.entries).toHaveLength(3); // 沒 push
    expect(result!.state.entries[2].route).toBe("/c"); // forward 分支健在
    expect(result!.state.entries[1].scrollTop).toBe(live.scrollTop); // 原地同步
    expect(result!.state.index).toBe(0);
    expect(result!.target).toEqual(anchor("/a", 0));
  });

  it("B4 back 後 goForward → 回到 B3 寫回的 live 位置", () => {
    const s = stateOf([anchor("/a", 0), anchor("/b", 100)]);
    const backResult = goBack(s, anchor("/b", 999))!;
    const fwdResult = goForward(backResult.state, anchor("/a", 0));
    expect(fwdResult).not.toBeNull();
    expect(fwdResult!.target).toEqual(anchor("/b", 999));
    expect(fwdResult!.state.index).toBe(1);
  });

  it("B5 末端 goForward → null 且 entries 完全不變（零副作用）", () => {
    const s = stateOf([anchor("/a", 0), anchor("/b", 0)]);
    const before = JSON.stringify(s);
    expect(goForward(s, anchor("/b", 500))).toBeNull();
    expect(JSON.stringify(s)).toBe(before);
  });

  it("B6 goBack 時 live.route 與 current 脫鉤 → target=current、state 不變", () => {
    const s = stateOf([anchor("/a", 0), anchor("/b", 300)]);
    const before = JSON.stringify(s);
    const result = goBack(s, anchor("/somewhere-else", 50));
    expect(result).not.toBeNull();
    expect(result!.target).toEqual(anchor("/b", 300)); // 回到最後錨點
    expect(JSON.stringify(result!.state)).toBe(before);
  });

  it("B7 goForward 時 live.route 與 current 脫鉤 → null 且 state 不變", () => {
    const s = stateOf([anchor("/a", 0), anchor("/b", 0)], 0);
    const before = JSON.stringify(s);
    expect(goForward(s, anchor("/somewhere-else", 0))).toBeNull();
    expect(JSON.stringify(s)).toBe(before);
  });

  it("B8 goBack 不可移動時即使 live 差很大 → null 且 entries 不變", () => {
    const s = stateOf([anchor("/a", 0)]);
    const before = JSON.stringify(s);
    expect(goBack(s, anchor("/a", 5000))).toBeNull();
    expect(JSON.stringify(s)).toBe(before);
  });

  it("canGoBack / canGoForward 判定", () => {
    expect(canGoBack(emptyState())).toBe(false);
    expect(canGoBack(stateOf([anchor("/a", 0)]))).toBe(false);
    expect(canGoBack(stateOf([anchor("/a", 0), anchor("/b", 0)]))).toBe(true);
    expect(canGoForward(stateOf([anchor("/a", 0), anchor("/b", 0)]))).toBe(false);
    expect(canGoForward(stateOf([anchor("/a", 0), anchor("/b", 0)], 0))).toBe(true);
  });
});

describe("C. 儲存", () => {
  it("C1 save→load round-trip", () => {
    const s = stateOf([anchor("/a", 10), anchor("/b", 20)], 0);
    saveState(s);
    expect(loadState()).toEqual(s);
  });

  it("C2 壞 JSON → 空 state", () => {
    sessionStorage.setItem(MOUSE_NAV_STORAGE_KEY, "{not-json");
    expect(loadState()).toEqual(emptyState());
  });

  it("C3 欄位缺漏／型別錯 → 空 state", () => {
    sessionStorage.setItem(MOUSE_NAV_STORAGE_KEY, JSON.stringify({ entries: "nope", index: 0 }));
    expect(loadState()).toEqual(emptyState());
    sessionStorage.setItem(
      MOUSE_NAV_STORAGE_KEY,
      JSON.stringify({ entries: [{ route: "/a", scrollTop: "high" }], index: 0 }),
    );
    expect(loadState()).toEqual(emptyState());
    sessionStorage.setItem(MOUSE_NAV_STORAGE_KEY, JSON.stringify([1, 2, 3]));
    expect(loadState()).toEqual(emptyState());
  });

  it("C4 index 越界 → 空 state", () => {
    sessionStorage.setItem(
      MOUSE_NAV_STORAGE_KEY,
      JSON.stringify({ entries: [{ route: "/a", scrollTop: 0 }], index: 5 }),
    );
    expect(loadState()).toEqual(emptyState());
    sessionStorage.setItem(
      MOUSE_NAV_STORAGE_KEY,
      JSON.stringify({ entries: [{ route: "/a", scrollTop: 0 }], index: -2 }),
    );
    expect(loadState()).toEqual(emptyState());
  });

  it("C5 sessionStorage 拋例外 → 不炸、load 回空", () => {
    const getSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const setSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(loadState()).toEqual(emptyState());
    expect(() => saveState(stateOf([anchor("/a", 0)]))).not.toThrow();
    getSpy.mockRestore();
    setSpy.mockRestore();
  });
});

describe("D. 按鍵判定", () => {
  it("D1 isBackButton：只有 button 3 為真", () => {
    expect(isBackButton({ button: 3 })).toBe(true);
    for (const b of [0, 1, 2, 4]) expect(isBackButton({ button: b })).toBe(false);
  });

  it("D2 isForwardButton：只有 button 4 為真", () => {
    expect(isForwardButton({ button: 4 })).toBe(true);
    for (const b of [0, 1, 2, 3]) expect(isForwardButton({ button: b })).toBe(false);
  });
});
