"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { TaskCard } from "@/lib/api";
import { UNTAGGED_GROUP_ID, groupTasksByTag } from "./tagGrouping";

/**
 * localStorage 鍵的前綴。實際的鍵是「前綴 + storageKey」，
 * 讓「置頂的任務」與「今日任務」兩份清單各自記住自己的收合狀態、互不干擾。
 */
const COLLAPSED_STORAGE_PREFIX = "zonwiki:sidebar-tag-collapsed:";

/**
 * 從 localStorage 讀出某份清單「已收合的群組 Id」集合。
 *
 * 刻意做成防呆：伺服器端渲染時沒有 window、瀏覽器可能停用儲存空間、
 * 存進去的內容也可能被外力改壞。任何一種情況都回傳空集合（＝全部展開），
 * 絕不讓側欄因為讀不到偏好設定就整個炸掉。
 *
 * @param storageKey 清單識別字（例如 "pinned" / "today"）。
 * @returns 已收合的群組 Id 集合。
 */
function readCollapsedGroups(storageKey: string): Set<string> {
    if (typeof window === "undefined") return new Set();
    try {
        const raw = window.localStorage.getItem(COLLAPSED_STORAGE_PREFIX + storageKey);
        if (!raw) return new Set();
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return new Set();
        return new Set(parsed.filter((id): id is string => typeof id === "string"));
    } catch {
        return new Set();
    }
}

/**
 * 把「已收合的群組 Id」集合寫回 localStorage（失敗時安靜略過）。
 *
 * @param storageKey 清單識別字。
 * @param collapsed 已收合的群組 Id 集合。
 */
function writeCollapsedGroups(storageKey: string, collapsed: Set<string>): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(
            COLLAPSED_STORAGE_PREFIX + storageKey,
            JSON.stringify([...collapsed])
        );
    } catch {
        // 隱私模式／儲存空間額度滿：記不住收合狀態不影響功能本身，不打擾使用者。
    }
}

/**
 * TagGroupedTaskList 的屬性。
 */
export interface TagGroupedTaskListProps {
    /** 要顯示的任務（順序即為群組內的順序，由呼叫端決定排序規則）。 */
    tasks: TaskCard[];
    /** 這份清單的識別字，用來分開儲存收合狀態（例如 "pinned" / "today"）。 */
    storageKey: string;
    /** 單一任務的渲染方式。兩份清單的列樣式不同（今日任務多一個時間），故做成插槽。 */
    renderTask: (task: TaskCard) => ReactNode;
}

/**
 * 側欄用的「依標籤分組、每組可獨立收合」任務清單。
 *
 * 設計重點：
 * - 分組規則交給 groupTasksByTag（純函式，另有單元測試）：
 *   一個任務貼了幾個標籤就在幾個群組出現，沒貼標籤的落在「未標籤」並排在最後。
 * - 收合以「群組 Id」為單位記在 localStorage，因此換頁、重開瀏覽器都還在；
 *   兩份清單用不同的 storageKey，收合「置頂」不會連帶收合「今日」。
 * - 只有「未標籤」一個群組時（＝使用者還沒替任務貼標籤），底下補一行提示告訴他
 *   要怎麼做才會分組——否則畫面看起來會像功能沒生效。
 */
export function TagGroupedTaskList({ tasks, storageKey, renderTask }: TagGroupedTaskListProps) {
    const groups = groupTasksByTag(tasks);

    // 初始值直接讀 localStorage：本元件只在資料載入完成後才被渲染（上層先顯示「載入中…」），
    // 所以不會發生「伺服器端算出展開、瀏覽器端算出收合」的水合不一致。
    const [collapsed, setCollapsed] = useState<Set<string>>(() => readCollapsedGroups(storageKey));

    // storageKey 變動時（同一元件被複用到另一份清單）重新載入該清單的偏好。
    useEffect(() => {
        setCollapsed(readCollapsedGroups(storageKey));
    }, [storageKey]);

    /** 切換某個群組的展開／收合，並立刻寫回 localStorage。 */
    const toggleGroup = useCallback(
        (groupId: string) => {
            setCollapsed((prev) => {
                // 不可變更新：產生新的 Set，而不是改動原本那個（否則 React 不會重繪）。
                const next = new Set(prev);
                if (next.has(groupId)) {
                    next.delete(groupId);
                } else {
                    next.add(groupId);
                }
                writeCollapsedGroups(storageKey, next);
                return next;
            });
        },
        [storageKey]
    );

    // 只有「未標籤」一組＝使用者手上的任務都還沒貼標籤，這時要給提示而不是讓他以為壞了。
    const hasOnlyUntagged = groups.length === 1 && groups[0].id === UNTAGGED_GROUP_ID;

    return (
        <div className="tgl-groups">
            {groups.map((group) => {
                const isCollapsed = collapsed.has(group.id);
                const panelId = `tag-group-panel-${storageKey}-${group.id}`;
                return (
                    <section className="tgl-group" key={group.id}>
                        <button
                            type="button"
                            className="tgl-grouphead"
                            data-testid={`tag-group-toggle-${group.id}`}
                            aria-expanded={!isCollapsed}
                            /* 收合時清單根本沒有被渲染，這時再指向該 id 會變成「指到不存在的元素」，
                               輔助技術讀到會出錯；所以只有展開時才掛 aria-controls。 */
                            aria-controls={isCollapsed ? undefined : panelId}
                            onClick={() => toggleGroup(group.id)}
                            title={isCollapsed ? `展開「${group.name}」` : `收合「${group.name}」`}
                        >
                            <span className="tgl-caret" aria-hidden>
                                {isCollapsed ? "▸" : "▾"}
                            </span>
                            <span className="tgl-groupname">{group.name}</span>
                            <span className="tgl-count">{group.tasks.length}</span>
                        </button>

                        {!isCollapsed && (
                            <ul className="tgl-list" id={panelId}>
                                {group.tasks.map((task) => (
                                    <li key={task.id}>{renderTask(task)}</li>
                                ))}
                            </ul>
                        )}
                    </section>
                );
            })}

            {hasOnlyUntagged && (
                <p className="tgl-hint" data-testid="tag-group-empty-hint">
                    替任務貼上標籤，這裡就會自動依標籤分組。
                </p>
            )}

            <style jsx>{`
                .tgl-groups {
                    display: flex;
                    flex-direction: column;
                    gap: var(--spacing-2);
                }
                .tgl-group {
                    display: flex;
                    flex-direction: column;
                    gap: var(--spacing-1);
                }
                .tgl-grouphead {
                    width: 100%;
                    display: flex;
                    align-items: center;
                    gap: var(--spacing-1);
                    padding: var(--spacing-1) var(--spacing-2);
                    border: 1px solid transparent;
                    border-radius: var(--radius-md);
                    background: transparent;
                    color: var(--text-secondary);
                    font-family: var(--font-body);
                    font-size: var(--text-xs);
                    text-align: left;
                    cursor: pointer;
                    transition: background 0.15s ease, border-color 0.15s ease;
                }
                .tgl-grouphead:hover {
                    background: var(--bg-surface-secondary, var(--bg-default));
                    border-color: var(--border-default);
                }
                .tgl-grouphead:focus-visible {
                    outline: 2px solid var(--action-secondary-fg);
                    outline-offset: 1px;
                }
                .tgl-caret {
                    flex-shrink: 0;
                    width: 0.9em;
                    color: var(--text-tertiary);
                }
                .tgl-groupname {
                    flex: 1;
                    min-width: 0;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    letter-spacing: 0.03em;
                }
                .tgl-count {
                    flex-shrink: 0;
                    padding: 0 var(--spacing-1);
                    border-radius: var(--radius-sm, 4px);
                    background: var(--bg-surface-secondary, var(--bg-default));
                    /* 刻意用 --text-secondary 而非更淡的 --text-tertiary：
                       徽章自己有底色，淡色字壓在那層底色上實測只有 4.38:1，達不到 WCAG AA
                       的 4.5:1（這是 12px 的內文字級）。改用次要文字色後實測 5.48:1（亮）／
                       5.26:1（暗），兩個主題都過。 */
                    color: var(--text-secondary);
                    font-variant-numeric: tabular-nums;
                }
                .tgl-list {
                    margin: 0;
                    /* 群組內的任務往右縮排，讓「哪些屬於這一組」一眼看得出來。 */
                    padding: 0 0 0 var(--spacing-3);
                    list-style: none;
                    display: flex;
                    flex-direction: column;
                    gap: var(--spacing-1);
                }
                .tgl-hint {
                    margin: 0;
                    padding: 0 var(--spacing-2);
                    font-size: var(--text-xs);
                    color: var(--text-tertiary);
                    line-height: 1.7;
                }
            `}</style>
        </div>
    );
}
