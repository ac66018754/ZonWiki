/**
 * 標籤分組純函式（groupTasksByTag）的單元測試。
 *
 * 對應需求（2026-09-14）：Todo 側欄的「置頂的任務」與「今日任務」要依標籤分組、每組可收合。
 * 這裡只測「怎麼分組」這件純邏輯；收合與畫面行為在 TagGroupedTaskList.test.tsx。
 */
import { describe, expect, it } from "vitest";
import type { TaskCard } from "@/lib/api";
import { UNTAGGED_GROUP_ID, UNTAGGED_GROUP_NAME, groupTasksByTag } from "./tagGrouping";

/**
 * 產生一張測試用的任務卡片（只填分組會用到的欄位，其餘給合理預設）。
 *
 * @param id 任務識別碼。
 * @param title 任務標題。
 * @param tags 貼在這張卡片上的標籤。
 */
function makeTask(
    id: string,
    title: string,
    tags: { id: string; name: string }[] = []
): TaskCard {
    return {
        id,
        title,
        status: "todo",
        priority: 0,
        sortOrder: 0,
        createdDateTime: "2026-09-14T00:00:00Z",
        tags,
    } as TaskCard;
}

describe("groupTasksByTag", () => {
    it("空清單回傳空陣列（不會生出一個空的「未標籤」群組）", () => {
        expect(groupTasksByTag([])).toEqual([]);
    });

    it("全部沒有標籤時，全落在「未標籤」單一群組", () => {
        const tasks = [makeTask("t1", "短影音工具"), makeTask("t2", "短影音規劃")];

        const groups = groupTasksByTag(tasks);

        expect(groups).toHaveLength(1);
        expect(groups[0].id).toBe(UNTAGGED_GROUP_ID);
        expect(groups[0].name).toBe(UNTAGGED_GROUP_NAME);
        expect(groups[0].tasks.map((t) => t.id)).toEqual(["t1", "t2"]);
    });

    it("依標籤分組，群組名稱取自標籤名稱", () => {
        const tasks = [
            makeTask("t1", "短影音工具", [{ id: "g1", name: "短影音" }]),
            makeTask("t2", "蝦皮特價", [{ id: "g2", name: "蝦皮" }]),
        ];

        const groups = groupTasksByTag(tasks);

        expect(groups).toHaveLength(2);
        expect(groups.find((g) => g.id === "g1")!.name).toBe("短影音");
        expect(groups.find((g) => g.id === "g1")!.tasks.map((t) => t.id)).toEqual(["t1"]);
        expect(groups.find((g) => g.id === "g2")!.name).toBe("蝦皮");
        expect(groups.find((g) => g.id === "g2")!.tasks.map((t) => t.id)).toEqual(["t2"]);
    });

    // 排序這條刻意用「不分語系都一樣」的名稱來驗：中文之間的先後由執行環境的語系資料
    // （ICU）決定，不同 Node 版本可能不同，寫死中文順序會變成脆弱且沒有意義的測試。
    it("標籤群組依名稱排序（與傳入順序無關）", () => {
        const tasks = [
            makeTask("t1", "C 開頭的標籤", [{ id: "g3", name: "Charlie" }]),
            makeTask("t2", "A 開頭的標籤", [{ id: "g1", name: "Alpha" }]),
            makeTask("t3", "B 開頭的標籤", [{ id: "g2", name: "Bravo" }]),
        ];

        const groups = groupTasksByTag(tasks);

        expect(groups.map((g) => g.name)).toEqual(["Alpha", "Bravo", "Charlie"]);
    });

    it("一個任務有多個標籤時，會在每個群組底下各出現一次", () => {
        const tasks = [
            makeTask("t1", "營銷號+蝦皮+酷澎分潤", [
                { id: "g2", name: "蝦皮" },
                { id: "g3", name: "分潤" },
            ]),
        ];

        const groups = groupTasksByTag(tasks);

        expect(groups).toHaveLength(2);
        expect(groups.find((g) => g.id === "g2")!.tasks.map((t) => t.id)).toEqual(["t1"]);
        expect(groups.find((g) => g.id === "g3")!.tasks.map((t) => t.id)).toEqual(["t1"]);
    });

    it("「未標籤」群組永遠排在所有標籤群組之後", () => {
        const tasks = [
            makeTask("t0", "沒貼標籤的"),
            // 用開頭排序在最前面的名稱，確保不是靠「剛好的插入順序」通過。
            makeTask("t1", "有標籤的", [{ id: "g1", name: "AAA" }]),
        ];

        const groups = groupTasksByTag(tasks);

        expect(groups.map((g) => g.id)).toEqual(["g1", UNTAGGED_GROUP_ID]);
    });

    it("群組內順序完全保留傳入順序（不自行重排）", () => {
        const tag = { id: "g1", name: "短影音" };
        const tasks = [
            makeTask("t3", "第三個", [tag]),
            makeTask("t1", "第一個", [tag]),
            makeTask("t2", "第二個", [tag]),
        ];

        const groups = groupTasksByTag(tasks);

        expect(groups[0].tasks.map((t) => t.id)).toEqual(["t3", "t1", "t2"]);
    });

    it("同名但不同 Id 的標籤視為兩個群組（依 Id 分組，不依名稱合併）", () => {
        const tasks = [
            makeTask("t1", "A", [{ id: "g1", name: "工作" }]),
            makeTask("t2", "B", [{ id: "g2", name: "工作" }]),
        ];

        const groups = groupTasksByTag(tasks);

        expect(groups).toHaveLength(2);
        expect(groups.map((g) => g.id).sort()).toEqual(["g1", "g2"]);
    });
});
