"use client";

import { useState } from "react";
import { TaskCard, TaskGroup, CurrentUser } from "@/lib/api";
import { TaskListItem } from "./TaskListItem";
import { FALLBACK_TZ, STATUS_META, PRIORITY_META } from "../taskUtils";

type SortBy = "createdDate" | "plannedDate" | "dueDate" | "priority" | "groupName" | "status";

/** 分組分類結果：用來分組、排序、顯示標題。 */
interface Classified {
  key: string;
  label: string;
  value: number | string;
  /** 缺值（未排程/無截止/未分類）→ 永遠排最後 */
  missing: boolean;
}

/**
 * 清單視圖：依「排序方式 + 方向」將任務分組顯示。
 * - 每個排序值自成一個「群組」，群組標題單獨一行（與項目不同行），可展開 / 收合。
 * - grouped=false 時退回單純的扁平排序清單（首頁本週行程當天用）。
 * - 點卡片開編輯彈窗；左側核取方塊快速完成（只點核取方塊才會切換）。
 */
export function TaskListView({
  tasks,
  groups,
  sortBy,
  sortDir = "asc",
  grouped = true,
  user,
  collapsedTaskIds,
  onOpen,
  onToggleDone,
  onToggleCollapse,
  onToggleSubtask,
}: {
  tasks: TaskCard[];
  groups: TaskGroup[];
  sortBy: SortBy;
  /** 排序方向：asc 正序、desc 逆序 */
  sortDir?: "asc" | "desc";
  /** 是否分組顯示（預設 true；首頁傳 false 用扁平清單） */
  grouped?: boolean;
  user: CurrentUser | null;
  collapsedTaskIds: Set<string>;
  onOpen: (id: string) => void;
  onToggleDone: (task: TaskCard) => void;
  onToggleCollapse: (taskId: string) => void;
  onToggleSubtask: (taskId: string, subtaskId: string, nextDone: boolean) => void;
}) {
  const tz = user?.timeZone || FALLBACK_TZ;
  const dir = sortDir === "asc" ? 1 : -1;
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const byCreatedDesc = (a: TaskCard, b: TaskCard) =>
    new Date(b.createdDateTime).getTime() - new Date(a.createdDateTime).getTime();
  const statusRank = (s: string | undefined) =>
    s === "todo" ? 0 : s === "doing" ? 1 : s === "done" ? 2 : 3;
  const dayKey = (iso: string) =>
    new Date(iso).toLocaleDateString("zh-TW", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

  /** 依排序方式把任務分類成 {群組鍵, 群組標題, 排序值, 是否缺值}。 */
  const classify = (t: TaskCard): Classified => {
    switch (sortBy) {
      case "createdDate": {
        const k = dayKey(t.createdDateTime);
        return { key: k, label: k, value: new Date(t.createdDateTime).getTime(), missing: false };
      }
      case "plannedDate":
        return t.plannedDateTime
          ? {
              key: dayKey(t.plannedDateTime),
              label: dayKey(t.plannedDateTime),
              value: new Date(t.plannedDateTime).getTime(),
              missing: false,
            }
          : { key: "__none__", label: "未排程", value: Infinity, missing: true };
      case "dueDate":
        return t.dueDateTime
          ? {
              key: dayKey(t.dueDateTime),
              label: dayKey(t.dueDateTime),
              value: new Date(t.dueDateTime).getTime(),
              missing: false,
            }
          : { key: "__none__", label: "無截止", value: Infinity, missing: true };
      case "priority": {
        const p = t.priority ?? 0;
        const label = p > 0 ? `${PRIORITY_META[p]?.label ?? p} 優先` : "無優先級";
        return { key: `p${p}`, label, value: p, missing: false };
      }
      case "status":
        return {
          key: t.status || "todo",
          label: STATUS_META[t.status]?.label ?? t.status ?? "其他",
          value: statusRank(t.status),
          missing: false,
        };
      case "groupName": {
        const n = t.groupId ? groups.find((g) => g.id === t.groupId)?.name ?? "" : "";
        return n
          ? { key: n, label: n, value: n, missing: false }
          : { key: "__none__", label: "未分類", value: "", missing: true };
      }
      default:
        return { key: "all", label: "", value: 0, missing: false };
    }
  };

  /** 比較兩個排序值（缺值永遠最後；數字數值比、字串 localeCompare），再套方向。 */
  const compareValue = (
    av: number | string,
    aMissing: boolean,
    bv: number | string,
    bMissing: boolean
  ): number => {
    if (aMissing !== bMissing) return aMissing ? 1 : -1;
    let base: number;
    if (typeof av === "number" && typeof bv === "number") base = av - bv;
    else base = String(av).localeCompare(String(bv), "zh-Hant");
    return base * dir;
  };

  const toggleGroup = (key: string) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const renderItem = (task: TaskCard) => (
    <TaskListItem
      key={task.id}
      task={task}
      group={groups.find((g) => g.id === task.groupId) || null}
      user={user}
      collapsed={collapsedTaskIds.has(task.id)}
      onOpen={onOpen}
      onToggleDone={onToggleDone}
      onToggleCollapse={onToggleCollapse}
      onToggleSubtask={onToggleSubtask}
    />
  );

  if (tasks.length === 0) {
    return (
      <div
        style={{
          padding: "var(--spacing-12) var(--spacing-4)",
          textAlign: "center",
          color: "var(--text-tertiary)",
          background: "var(--bg-surface)",
          borderRadius: "var(--radius-lg)",
          border: "1px dashed var(--border-default)",
        }}
      >
        <span style={{ fontSize: "var(--text-2xl)", display: "block", marginBottom: "var(--spacing-2)" }}>🎯</span>
        <p style={{ margin: 0, fontWeight: 500 }}>沒有符合條件的任務</p>
        <p style={{ margin: "var(--spacing-2) 0 0 0", fontSize: "var(--text-sm)" }}>
          用上方的「快速新增任務」開始記錄，或調整篩選條件。
        </p>
      </div>
    );
  }

  // 扁平清單（不分組；首頁用）
  if (!grouped) {
    const sorted = [...tasks].sort((a, b) => {
      const ca = classify(a);
      const cb = classify(b);
      return compareValue(ca.value, ca.missing, cb.value, cb.missing) || byCreatedDesc(a, b);
    });
    return <div style={GRID_STYLE}>{sorted.map(renderItem)}</div>;
  }

  // 分組清單：先分組，再依群組排序值（含方向）排序群組，群組內以建立時間新到舊。
  const map = new Map<string, { label: string; value: number | string; missing: boolean; items: TaskCard[] }>();
  for (const t of tasks) {
    const c = classify(t);
    if (!map.has(c.key)) map.set(c.key, { label: c.label, value: c.value, missing: c.missing, items: [] });
    map.get(c.key)!.items.push(t);
  }
  const groupList = [...map.entries()].map(([key, g]) => ({ key, ...g }));
  groupList.sort((a, b) => compareValue(a.value, a.missing, b.value, b.missing));
  groupList.forEach((g) => g.items.sort(byCreatedDesc));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-4)" }}>
      {groupList.map((g) => {
        const collapsed = collapsedGroups.has(g.key);
        return (
          <div key={g.key}>
            {/* 群組標題（單獨一行，與項目不同行）：可展開 / 收合 */}
            <button
              type="button"
              onClick={() => toggleGroup(g.key)}
              title={collapsed ? "展開" : "收合"}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--spacing-2)",
                width: "100%",
                textAlign: "left",
                padding: "var(--spacing-2) var(--spacing-3)",
                marginBottom: "var(--spacing-2)",
                background: "var(--bg-surface-secondary, var(--bg-surface))",
                border: "1px solid var(--border-default)",
                borderRadius: "var(--radius-md)",
                cursor: "pointer",
                color: "var(--text-primary)",
                fontSize: "var(--text-sm)",
              }}
            >
              <span style={{ color: "var(--text-tertiary)" }}>{collapsed ? "▸" : "▾"}</span>
              <span style={{ fontWeight: 700 }}>{g.label}</span>
              <span style={{ color: "var(--text-tertiary)", fontWeight: 400 }}>（{g.items.length}）</span>
            </button>
            {!collapsed && <div style={GRID_STYLE}>{g.items.map(renderItem)}</div>}
          </div>
        );
      })}
    </div>
  );
}

const GRID_STYLE: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
  gap: "var(--spacing-3)",
};
