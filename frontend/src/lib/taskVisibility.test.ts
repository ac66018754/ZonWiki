import { describe, expect, it } from "vitest";
import { isTaskHiddenByDoneFilter } from "./taskVisibility";

/**
 * isTaskHiddenByDoneFilter（Todo 清單「顯示已完成」過濾）單元測試——feature/todo-show-done 包5。
 *
 * 規格：清單（list）視圖預設隱藏 status="done" 的任務；「顯示已完成」開啟後全部顯示。
 * 只作用於 list——看板的「已完成」欄與行事曆不受影響（filteredTasks 為 list/board 共用，
 * 過濾必須 gate 在 view）。
 */
describe("isTaskHiddenByDoneFilter", () => {
  it("list＋未開顯示已完成＋done → 隱藏", () => {
    expect(isTaskHiddenByDoneFilter("list", false, "done")).toBe(true);
  });

  it("list＋開啟顯示已完成＋done → 顯示；todo/doing 一律顯示", () => {
    expect(isTaskHiddenByDoneFilter("list", true, "done")).toBe(false);
    expect(isTaskHiddenByDoneFilter("list", false, "todo")).toBe(false);
    expect(isTaskHiddenByDoneFilter("list", false, "doing")).toBe(false);
  });

  it("board／calendar 視圖不受過濾（看板已完成欄維持現狀）", () => {
    expect(isTaskHiddenByDoneFilter("board", false, "done")).toBe(false);
    expect(isTaskHiddenByDoneFilter("calendar", false, "done")).toBe(false);
  });

  it("status undefined（防禦邊界）→ 不隱藏", () => {
    expect(isTaskHiddenByDoneFilter("list", false, undefined)).toBe(false);
  });
});
