/**
 * 任務清單可見性判斷工具。
 *
 * 目前僅一項規則：Todo & Planning 頁「顯示已完成」切換。
 */

/**
 * 判斷某任務是否應被「顯示已完成」過濾器隱藏。
 *
 * 規則：只有在「清單（list）視圖」且「未開啟顯示已完成」且「該任務狀態為 done」三者同時成立時，才隱藏。
 *
 * 為何要 gate 在 view === "list"：
 * filteredTasks 為 list 與 board 兩個視圖共用同一份陣列。看板（board）依狀態分欄，
 * 其中就有一欄專門放「已完成」；若在這裡不分視圖地把 done 任務濾掉，看板的「已完成」欄
 * 會被整欄清空、看起來像壞掉。因此過濾只作用於清單，看板與行事曆一律不受影響。
 *
 * @param view 目前視圖（"list" / "board" / "calendar"）
 * @param showDone 使用者是否已開啟「顯示已完成」
 * @param status 任務狀態（"todo" / "doing" / "done"；可能為 undefined，視為不隱藏）
 * @returns true＝應隱藏；false＝應顯示
 */
export function isTaskHiddenByDoneFilter(
  view: string,
  showDone: boolean,
  status: string | undefined
): boolean {
  return view === "list" && !showDone && status === "done";
}
