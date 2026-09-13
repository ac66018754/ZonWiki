import type { TaskCard } from "@/lib/api";

/**
 * 「未標籤」群組的哨兵識別碼。
 *
 * 用一個不可能與真實標籤 GUID 相撞的字串當作群組鍵，讓「沒有任何標籤的任務」
 * 也能走同一條分組邏輯（而不是另外開一條特例路徑）。
 */
export const UNTAGGED_GROUP_ID = "__untagged__";

/**
 * 「未標籤」群組顯示在畫面上的名稱。
 */
export const UNTAGGED_GROUP_NAME = "未標籤";

/**
 * 依標籤分組後的一個群組。
 */
export interface TaskTagGroup {
    /** 群組識別碼：真實標籤的 Id，或 <see cref="UNTAGGED_GROUP_ID"/>。 */
    id: string;
    /** 群組顯示名稱：標籤名稱，或「未標籤」。 */
    name: string;
    /** 這個群組底下的任務（維持傳入順序，不重新排序）。 */
    tasks: TaskCard[];
}

/**
 * 把任務清單依「標籤」分組。
 *
 * 重點行為（刻意的設計，不是副作用）：
 * - **一個任務有幾個標籤，就會在幾個群組底下各出現一次**。標籤是多對多，
 *   不像「分類」那樣一個任務只能屬於一個群組，所以不做「只歸第一個標籤」這種取捨
 *   ——那會讓使用者貼了標籤卻看不到任務出現在預期的群組裡。
 * - 沒有任何標籤的任務會落在「未標籤」群組，且該群組**固定排在最後**
 *   （未整理的東西不該擋在已整理的東西前面）。
 * - 群組本身依標籤名稱排序（繁體中文語系比較）；**群組內的順序完全保留傳入順序**，
 *   由呼叫端決定（置頂清單＝後端給的順序；今日清單＝未完成優先再依時間）。
 * - 依標籤的 Id 分組而非名稱：同名但不同 Id 的兩個標籤視為不同群組（資料上它們本來就是兩個標籤）。
 *
 * @param tasks 要分組的任務清單（順序即為組內順序）。
 * @returns 分組結果；空清單回傳空陣列（不會硬生出一個空的「未標籤」群組）。
 */
export function groupTasksByTag(tasks: readonly TaskCard[]): TaskTagGroup[] {
    // 用 Map 保留「第一次遇到該標籤」時的名稱，並累積其任務。
    const taggedGroups = new Map<string, TaskTagGroup>();
    const untaggedTasks: TaskCard[] = [];

    for (const task of tasks) {
        const tags = task.tags ?? [];
        if (tags.length === 0) {
            untaggedTasks.push(task);
            continue;
        }
        // 同一張卡片理論上不會重複貼同一個標籤，但資料面若出現重複關聯列，
        // 這裡不先去重就會讓同一張卡片在同一個群組出現兩次（React 也會撞到重複的 key）。
        const seenTagIds = new Set<string>();
        for (const tag of tags) {
            if (seenTagIds.has(tag.id)) continue;
            seenTagIds.add(tag.id);
            let group = taggedGroups.get(tag.id);
            if (!group) {
                group = { id: tag.id, name: tag.name, tasks: [] };
                taggedGroups.set(tag.id, group);
            }
            group.tasks.push(task);
        }
    }

    // 有標籤的群組依名稱排序（zh-Hant；同名時以 Id 當決勝鍵，確保順序穩定不跳動）。
    const sorted = [...taggedGroups.values()].sort((a, b) => {
        const byName = a.name.localeCompare(b.name, "zh-Hant");
        return byName !== 0 ? byName : a.id.localeCompare(b.id);
    });

    // 「未標籤」永遠墊底；沒有未標籤任務時就不產生這個群組。
    if (untaggedTasks.length > 0) {
        sorted.push({ id: UNTAGGED_GROUP_ID, name: UNTAGGED_GROUP_NAME, tasks: untaggedTasks });
    }
    return sorted;
}
