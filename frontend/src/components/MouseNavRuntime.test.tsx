// @vitest-environment jsdom
/**
 * MouseNavRuntime（VS 風格滑鼠側鍵錨點導航執行器）行為測試。
 *
 * 測試計畫（2026-08-10，經 tdd-guide sub-agent 審查後修訂版）：
 * R1 掛載即把目前位置記為第一個錨點
 * R2 左鍵 pointerdown → 下錨（深捲後點擊 → 堆疊多一筆）
 * R3 側鍵上一頁（button 3）可後退 → preventDefault＋容器捲動位置被還原到上一錨點；
 *    再按下一頁（button 4）→ 回到出發時的即時位置（live 同步）
 * R4 堆疊不可後退時按側鍵 → 不 preventDefault（放行瀏覽器原生歷史）
 * R5 保險絲生命週期：pointerup→mouseup→auxclick 完整序列——已處理時三者皆
 *    preventDefault；不可移動時三者皆放行（旗標不殘留誤判）
 * R6 跨 route back、confirmNavigation 拒絕 → 不 push、sessionStorage 位元組級不變
 * R7 跨 route back、confirmNavigation 放行 → router.push(target.route)
 * R8 我方導航抵達後（pendingRestore）→ 不重複下錨、捲動位置被還原
 * R9 同 pathname、不同 search → 視為路由變更、記錄新錨點
 * R10 跨 route 導航進行中（confirm 未 resolve）再按側鍵 → 吞掉（preventDefault
 *     但不重複執行），confirm 放行後 push 只發生一次
 * R11 confirmNavigation reject → in-flight 解除，之後的側鍵按壓恢復正常
 *     （對抗復審 HIGH：無 .catch 會讓側鍵整個 session 靜默失效）
 * R12 router.push 同步拋錯 → in-flight 解除（安全網不可排在 push 之後），
 *     之後的側鍵按壓仍可導航
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { MouseNavRuntime } from "./MouseNavRuntime";
import { MOUSE_NAV_STORAGE_KEY, loadState } from "@/lib/mouseNav";

/** 目前模擬的 pathname 與 search（各測試以 setRoute 設定；mock 的 hooks 讀這裡）。 */
let mockPath = "/";
let mockSearch = "";
const pushSpy = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => mockPath,
  useSearchParams: () => new URLSearchParams(mockSearch),
  useRouter: () => ({ push: pushSpy }),
}));

/** confirmNavigation 的可控 mock（預設放行）。 */
const confirmSpy = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
vi.mock("@/lib/navigationGuard", () => ({
  confirmNavigation: () => confirmSpy(),
}));

/** 同步 jsdom 的 window.location 與 mock hooks（兩者都是 runtime 的資訊來源）。 */
function setRoute(pathname: string, search = "") {
  mockPath = pathname;
  mockSearch = search;
  window.history.replaceState(null, "", pathname + (search ? `?${search}` : ""));
}

/** 建立全站捲動容器 .main-content（jsdom 可自由 get/set scrollTop）。 */
let container: HTMLDivElement;

/** 派發滑鼠事件到 window，回傳事件供斷言 defaultPrevented。 */
function dispatchMouse(type: string, button: number): MouseEvent {
  const evt = new MouseEvent(type, { button, bubbles: true, cancelable: true });
  act(() => {
    window.dispatchEvent(evt);
  });
  return evt;
}

/** 完整模擬一次左鍵點擊下錨。 */
function leftClick() {
  dispatchMouse("pointerdown", 0);
}

beforeEach(() => {
  sessionStorage.clear();
  pushSpy.mockClear();
  confirmSpy.mockClear();
  confirmSpy.mockResolvedValue(true);
  setRoute("/");
  container = document.createElement("div");
  container.className = "main-content";
  document.body.appendChild(container);
});

afterEach(() => {
  cleanup();
  container.remove();
  vi.useRealTimers();
});

/** 渲染執行器（先設路由再呼叫）。回傳 rerender 供模擬路由變更。 */
function renderRuntime() {
  const utils = render(<MouseNavRuntime />);
  return {
    /** 模擬 App Router 路由變更：更新 mock 與 location 後重繪。 */
    navigateTo(pathname: string, search = "") {
      setRoute(pathname, search);
      utils.rerender(<MouseNavRuntime />);
    },
  };
}

describe("R1 掛載即下錨", () => {
  it("目前位置成為第一個錨點", () => {
    setRoute("/notes/a");
    renderRuntime();
    const s = loadState();
    expect(s.entries.map((e) => e.route)).toEqual(["/notes/a"]);
    expect(s.index).toBe(0);
  });
});

describe("R2 左鍵下錨", () => {
  it("深捲後點擊 → 堆疊多一筆", () => {
    setRoute("/notes/a");
    renderRuntime();
    container.scrollTop = 500;
    leftClick();
    const s = loadState();
    expect(s.entries.map((e) => e.scrollTop)).toEqual([0, 500]);
    expect(s.index).toBe(1);
  });
});

describe("R3 側鍵在錨點間穿梭（同 route）", () => {
  it("上一頁還原到上一錨點、下一頁回到出發時的即時位置", () => {
    vi.useFakeTimers();
    setRoute("/notes/a");
    renderRuntime();
    // 堆疊：[a@0, a@500]
    container.scrollTop = 500;
    leftClick();
    // 使用者又捲到 800（未點擊）後按「上一頁」
    container.scrollTop = 800;
    const backEvt = dispatchMouse("pointerup", 3);
    expect(backEvt.defaultPrevented).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(container.scrollTop).toBe(0); // 回到第一個錨點
    // 「下一頁」→ 回到按上一頁當下的即時位置（live 同步，非 500）
    const fwdEvt = dispatchMouse("pointerup", 4);
    expect(fwdEvt.defaultPrevented).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(container.scrollTop).toBe(800);
  });
});

describe("R4 不可後退時放行瀏覽器", () => {
  it("堆疊只有一筆時按上一頁 → 不 preventDefault", () => {
    setRoute("/notes/a");
    renderRuntime();
    const evt = dispatchMouse("pointerup", 3);
    expect(evt.defaultPrevented).toBe(false);
  });
});

describe("R5 保險絲生命週期（pointerup→mouseup→auxclick 完整序列）", () => {
  it("已處理時三者皆 preventDefault；隨後不可移動的一次三者皆放行", () => {
    vi.useFakeTimers();
    setRoute("/notes/a");
    renderRuntime();
    container.scrollTop = 500;
    leftClick();
    // 第一次：可後退 → 三個事件皆被攔
    expect(dispatchMouse("pointerup", 3).defaultPrevented).toBe(true);
    expect(dispatchMouse("mouseup", 3).defaultPrevented).toBe(true);
    expect(dispatchMouse("auxclick", 3).defaultPrevented).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    // 第二次：已退到堆疊起點、不可再退 → 三者皆放行（旗標不得殘留上次的「已處理」）
    expect(dispatchMouse("pointerup", 3).defaultPrevented).toBe(false);
    expect(dispatchMouse("mouseup", 3).defaultPrevented).toBe(false);
    expect(dispatchMouse("auxclick", 3).defaultPrevented).toBe(false);
  });
});

describe("R6 跨 route back：守門拒絕", () => {
  it("不 push、sessionStorage 不變", async () => {
    confirmSpy.mockResolvedValue(false);
    setRoute("/notes/a");
    const { navigateTo } = renderRuntime();
    navigateTo("/tasks"); // 堆疊：[/notes/a@0, /tasks@0]
    const before = sessionStorage.getItem(MOUSE_NAV_STORAGE_KEY);
    dispatchMouse("pointerup", 3);
    await act(async () => {}); // 等 confirmNavigation promise 落定
    expect(pushSpy).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(MOUSE_NAV_STORAGE_KEY)).toBe(before);
  });
});

describe("R7 跨 route back：守門放行", () => {
  it("router.push(目標 route)", async () => {
    setRoute("/notes/a");
    const { navigateTo } = renderRuntime();
    navigateTo("/tasks");
    dispatchMouse("pointerup", 3);
    await act(async () => {});
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).toHaveBeenCalledWith("/notes/a");
  });
});

describe("R8 我方導航抵達後不重複下錨、還原捲動", () => {
  it("pendingRestore 生效", async () => {
    vi.useFakeTimers();
    setRoute("/notes/a");
    const { navigateTo } = renderRuntime();
    // 在 /notes/a 深捲處下錨，跳到 /tasks
    container.scrollTop = 700;
    leftClick();
    navigateTo("/tasks");
    const lenBefore = loadState().entries.length; // [a@0, a@700, tasks@0]
    // 側鍵回 /notes/a@700
    dispatchMouse("pointerup", 3);
    await act(async () => {});
    expect(pushSpy).toHaveBeenCalledWith("/notes/a");
    // 模擬 App Router 完成導航
    container.scrollTop = 0;
    navigateTo("/notes/a");
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(container.scrollTop).toBe(700); // 還原到錨點位置
    expect(loadState().entries.length).toBe(lenBefore); // 抵達不重複下錨
  });
});

describe("R9 search 變更也視為路由變更", () => {
  it("同 pathname 不同 search → 新錨點", () => {
    setRoute("/tasks", "view=list");
    const { navigateTo } = renderRuntime();
    navigateTo("/tasks", "view=board");
    const s = loadState();
    expect(s.entries.map((e) => e.route)).toEqual(["/tasks?view=list", "/tasks?view=board"]);
  });
});

describe("R10 導航進行中吞掉連按", () => {
  it("confirm 未落定時再按 → preventDefault 但只 push 一次", async () => {
    setRoute("/notes/a");
    const { navigateTo } = renderRuntime();
    navigateTo("/tasks");
    // confirm 掛起：手動控制 resolve 時機
    let resolveConfirm: (v: boolean) => void = () => {};
    confirmSpy.mockImplementation(
      () => new Promise<boolean>((resolve) => (resolveConfirm = resolve)),
    );
    dispatchMouse("pointerup", 3);
    const second = dispatchMouse("pointerup", 3); // 導航進行中連按
    expect(second.defaultPrevented).toBe(true); // 仍要攔住瀏覽器
    await act(async () => {
      resolveConfirm(true);
    });
    expect(pushSpy).toHaveBeenCalledTimes(1);
  });
});

describe("R11 守門 reject 不可讓側鍵永久失效", () => {
  it("confirmNavigation reject → in-flight 解除，下一次按壓恢復正常", async () => {
    setRoute("/notes/a");
    const { navigateTo } = renderRuntime();
    navigateTo("/tasks");
    confirmSpy.mockRejectedValueOnce(new Error("guard exploded"));
    dispatchMouse("pointerup", 3);
    await act(async () => {});
    expect(pushSpy).not.toHaveBeenCalled(); // 失敗這次零副作用
    // 第二次按壓：不可被殘留的 in-flight 旗標吞掉
    dispatchMouse("pointerup", 3);
    await act(async () => {});
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).toHaveBeenCalledWith("/notes/a");
  });
});

describe("R12 router.push 拋錯不可讓側鍵永久失效", () => {
  it("push 同步拋錯 → in-flight 解除，下一次按壓仍可導航", async () => {
    setRoute("/notes/a");
    const { navigateTo } = renderRuntime();
    navigateTo("/tasks");
    pushSpy.mockImplementationOnce(() => {
      throw new Error("router exploded");
    });
    dispatchMouse("pointerup", 3);
    await act(async () => {});
    expect(pushSpy).toHaveBeenCalledTimes(1); // 有呼叫但拋錯
    // 第二次按壓：desync 防禦會把使用者帶回最後錨點，且不可被吞
    dispatchMouse("pointerup", 3);
    await act(async () => {});
    expect(pushSpy).toHaveBeenCalledTimes(2);
  });
});
