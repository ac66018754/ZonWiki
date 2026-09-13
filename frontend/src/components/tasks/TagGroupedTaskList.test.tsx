// @vitest-environment jsdom
/**
 * 側欄「依標籤分組＋每組可收合」清單（TagGroupedTaskList）的元件測試。
 *
 * 對應需求（2026-09-14）：Todo 左側欄的「置頂的任務」與「今日任務」要依標籤分組，
 * 且每個標籤群組各自可以收合、收合狀態下次打開仍保留。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TaskCard } from "@/lib/api";
import { TagGroupedTaskList } from "./TagGroupedTaskList";

/** 產生一張測試用任務卡片（只填分組會用到的欄位）。 */
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

/** 測試共用的渲染函式：把任務畫成一顆帶標題的按鈕。 */
const renderTask = (task: TaskCard) => <button type="button">{task.title}</button>;

const TAG_SHORT = { id: "g1", name: "短影音" };
const TAG_SHOPEE = { id: "g2", name: "蝦皮" };

beforeEach(() => {
    window.localStorage.clear();
});

afterEach(() => {
    cleanup();
    window.localStorage.clear();
});

describe("依標籤分組顯示", () => {
    it("每個標籤各一個群組，標題顯示標籤名稱與任務數量", () => {
        render(
            <TagGroupedTaskList
                storageKey="pinned"
                tasks={[
                    makeTask("t1", "短影音工具", [TAG_SHORT]),
                    makeTask("t2", "短影音規劃", [TAG_SHORT]),
                    makeTask("t3", "蝦皮特價", [TAG_SHOPEE]),
                ]}
                renderTask={renderTask}
            />
        );

        expect(screen.getByRole("button", { name: /短影音\D*2/ })).toBeTruthy();
        expect(screen.getByRole("button", { name: /蝦皮\D*1/ })).toBeTruthy();
    });

    it("預設全部展開，所有任務都看得到", () => {
        render(
            <TagGroupedTaskList
                storageKey="pinned"
                tasks={[makeTask("t1", "短影音工具", [TAG_SHORT])]}
                renderTask={renderTask}
            />
        );

        expect(screen.queryByText("短影音工具")).not.toBeNull();
        expect(screen.getByTestId("tag-group-toggle-g1").getAttribute("aria-expanded")).toBe("true");
    });

    it("沒有任何標籤時，顯示「怎麼讓它分組」的提示", () => {
        render(
            <TagGroupedTaskList
                storageKey="pinned"
                tasks={[makeTask("t1", "沒貼標籤的任務")]}
                renderTask={renderTask}
            />
        );

        expect(screen.queryByTestId("tag-group-empty-hint")).not.toBeNull();
    });

    it("已經有標籤群組時，不顯示那段提示（避免多餘雜訊）", () => {
        render(
            <TagGroupedTaskList
                storageKey="pinned"
                tasks={[makeTask("t1", "短影音工具", [TAG_SHORT]), makeTask("t2", "沒貼標籤的")]}
                renderTask={renderTask}
            />
        );

        expect(screen.queryByTestId("tag-group-empty-hint")).toBeNull();
    });
});

describe("收合", () => {
    it("點群組標題 → 該組任務隱藏；再點一次 → 回來", () => {
        render(
            <TagGroupedTaskList
                storageKey="pinned"
                tasks={[makeTask("t1", "短影音工具", [TAG_SHORT])]}
                renderTask={renderTask}
            />
        );
        const toggle = screen.getByTestId("tag-group-toggle-g1");

        fireEvent.click(toggle);
        expect(screen.queryByText("短影音工具")).toBeNull();
        expect(toggle.getAttribute("aria-expanded")).toBe("false");

        fireEvent.click(toggle);
        expect(screen.queryByText("短影音工具")).not.toBeNull();
        expect(toggle.getAttribute("aria-expanded")).toBe("true");
    });

    it("各群組獨立收合：收合甲組不會影響乙組", () => {
        render(
            <TagGroupedTaskList
                storageKey="pinned"
                tasks={[
                    makeTask("t1", "短影音工具", [TAG_SHORT]),
                    makeTask("t3", "蝦皮特價", [TAG_SHOPEE]),
                ]}
                renderTask={renderTask}
            />
        );

        fireEvent.click(screen.getByTestId("tag-group-toggle-g1"));

        expect(screen.queryByText("短影音工具")).toBeNull();
        expect(screen.queryByText("蝦皮特價")).not.toBeNull();
    });

    it("收合狀態會留下來：重新掛載同一份清單仍是收合的", () => {
        const tasks = [makeTask("t1", "短影音工具", [TAG_SHORT])];
        const { unmount } = render(
            <TagGroupedTaskList storageKey="pinned" tasks={tasks} renderTask={renderTask} />
        );
        fireEvent.click(screen.getByTestId("tag-group-toggle-g1"));
        unmount();

        render(<TagGroupedTaskList storageKey="pinned" tasks={tasks} renderTask={renderTask} />);

        expect(screen.queryByText("短影音工具")).toBeNull();
        expect(screen.getByTestId("tag-group-toggle-g1").getAttribute("aria-expanded")).toBe("false");
    });

    it("兩個清單的收合狀態互不干擾（置頂收合不影響今日）", () => {
        const tasks = [makeTask("t1", "短影音工具", [TAG_SHORT])];
        const { unmount } = render(
            <TagGroupedTaskList storageKey="pinned" tasks={tasks} renderTask={renderTask} />
        );
        fireEvent.click(screen.getByTestId("tag-group-toggle-g1"));
        unmount();

        render(<TagGroupedTaskList storageKey="today" tasks={tasks} renderTask={renderTask} />);

        expect(screen.queryByText("短影音工具")).not.toBeNull();
    });

    it("「未標籤」群組同樣可以收合", () => {
        render(
            <TagGroupedTaskList
                storageKey="pinned"
                tasks={[makeTask("t1", "沒貼標籤的任務")]}
                renderTask={renderTask}
            />
        );

        fireEvent.click(screen.getByTestId("tag-group-toggle-__untagged__"));

        expect(screen.queryByText("沒貼標籤的任務")).toBeNull();
    });
});
