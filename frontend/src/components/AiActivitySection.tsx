"use client";

import { useCallback, useEffect, useState } from "react";
import { getAiActivity, type AiActivityItem } from "@/lib/api";
import { formatDateTime } from "@/lib/formatters";
import { getDeviceTimeZone } from "@/lib/timezone";

/**
 * 首頁「🤖 AI 最近動作」區塊。
 *
 * 顯示「外部 AI（透過 MCP / API 權杖）對我的 ZonWiki 做了什麼」的操作軌跡——
 * 任何 CRUD（新增/編輯/刪除/還原）都會自動留痕（由後端 ActivityLog 攔截器記錄、標上來源）。
 * 提供來源（哪個 AI）/ 項目型別 / 動作 的篩選與關鍵字查詢。
 */

/** 動作 → 顯示。 */
const ACTION_META: Record<string, { label: string; icon: string; color: string }> = {
  created: { label: "新增", icon: "➕", color: "var(--status-success-fg, #16a34a)" },
  updated: { label: "編輯", icon: "✏️", color: "var(--action-secondary-fg)" },
  deleted: { label: "刪除", icon: "🗑️", color: "var(--status-danger-fg)" },
  restored: { label: "還原", icon: "↩️", color: "var(--status-warning-fg, #d97706)" },
};

/** 實體型別 → 中文。 */
const ENTITY_LABEL: Record<string, string> = {
  note: "筆記",
  taskcard: "任務",
  subtask: "子任務",
  node: "節點",
  capture: "快速記錄",
  quicklink: "常用連結",
  prompt: "提示詞",
  aimodel: "AI 金鑰",
};

/** 動作篩選選項。 */
const ACTION_OPTIONS = [
  { value: "", label: "全部動作" },
  { value: "created", label: "新增" },
  { value: "updated", label: "編輯" },
  { value: "deleted", label: "刪除" },
  { value: "restored", label: "還原" },
];

/** 項目型別篩選選項。 */
const ENTITY_OPTIONS = [
  { value: "", label: "全部項目" },
  { value: "note", label: "筆記" },
  { value: "taskcard", label: "任務" },
  { value: "subtask", label: "子任務" },
  { value: "node", label: "節點" },
  { value: "capture", label: "快速記錄" },
  { value: "quicklink", label: "常用連結" },
];

export function AiActivitySection() {
  const tz = getDeviceTimeZone();
  const [items, setItems] = useState<AiActivityItem[]>([]);
  const [sources, setSources] = useState<{ source: string; count: number }[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // 篩選狀態
  const [source, setSource] = useState(""); // "" = 只看 AI；"all" = 含人類；或指定來源
  const [entityType, setEntityType] = useState("");
  const [action, setAction] = useState("");
  const [q, setQ] = useState("");

  const TAKE = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getAiActivity({
        source: source || undefined,
        entityType: entityType || undefined,
        action: action || undefined,
        q: q.trim() || undefined,
        days: 30,
        take: TAKE,
      });
      setItems(r.items);
      setSources(r.sources);
      setTotal(r.total);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [source, entityType, action, q]);

  // 篩選變動時重新查詢（關鍵字做 350ms 去抖）。
  useEffect(() => {
    const t = setTimeout(load, 350);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <section style={cardStyle}>
      <div style={headerRowStyle}>
        <h2 style={titleStyle}>🤖 AI 最近動作</h2>
        <button style={ghostBtnStyle} onClick={load} title="重新整理" aria-label="重新整理">
          ↻
        </button>
      </div>
      <p style={hintStyle}>外部 AI（透過 MCP / API 權杖）對你知識庫做的每一筆操作都會留在這裡。</p>

      {/* 篩選列 */}
      <div style={filterRowStyle}>
        <select style={selectStyle} value={source} onChange={(e) => setSource(e.target.value)} aria-label="來源">
          <option value="">全部 AI</option>
          {sources.map((s) => (
            <option key={s.source} value={s.source}>
              {s.source}（{s.count}）
            </option>
          ))}
          <option value="all">＋含人類網頁操作</option>
        </select>
        <select style={selectStyle} value={entityType} onChange={(e) => setEntityType(e.target.value)} aria-label="項目型別">
          {ENTITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select style={selectStyle} value={action} onChange={(e) => setAction(e.target.value)} aria-label="動作">
          {ACTION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input
          style={searchStyle}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜尋標題…"
          aria-label="搜尋標題"
        />
      </div>

      {/* 清單 */}
      {loading ? (
        <p style={emptyStyle}>載入中…</p>
      ) : items.length === 0 ? (
        <p style={emptyStyle}>
          目前沒有符合條件的 AI 操作紀錄。接上 Claude Code / ChatGPT 後，它們做的事會出現在這裡。
        </p>
      ) : (
        <>
          <div style={{ display: "grid", gap: "var(--spacing-1)", maxHeight: "420px", overflow: "auto" }}>
            {items.map((e) => {
              const a = ACTION_META[e.action] ?? { label: e.action, icon: "•", color: "var(--text-secondary)" };
              const typeLabel = ENTITY_LABEL[e.entityType] ?? e.entityType;
              const isHuman = e.source === "web";
              return (
                <div key={e.id} style={rowStyle}>
                  <span style={{ ...badgeStyle, color: a.color, borderColor: a.color }}>
                    {a.icon} {a.label}
                  </span>
                  <span style={typeBadgeStyle}>{typeLabel}</span>
                  <span style={titleCellStyle} title={e.title}>
                    {e.title || "（無標題）"}
                  </span>
                  <span style={{ ...sourceBadgeStyle, opacity: isHuman ? 0.6 : 1 }}>
                    {isHuman ? "🧑 網頁" : `🤖 ${e.source}`}
                  </span>
                  <span style={timeCellStyle}>{formatDateTime(e.at, tz)}</span>
                </div>
              );
            })}
          </div>
          {total > items.length && (
            <p style={hintStyle}>
              顯示最近 {items.length} 筆（共 {total} 筆符合條件）。可用上方篩選縮小範圍。
            </p>
          )}
        </>
      )}
    </section>
  );
}

// ── 樣式（與全站 CSS 變數一致）──────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: "var(--bg-surface)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-lg)",
  padding: "var(--spacing-5)",
  marginBottom: "var(--spacing-5)",
};
const headerRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "var(--spacing-2)",
};
const titleStyle: React.CSSProperties = {
  fontSize: "var(--text-lg)",
  fontWeight: 600,
  margin: 0,
  color: "var(--text-primary)",
};
const hintStyle: React.CSSProperties = {
  margin: "var(--spacing-2) 0",
  fontSize: "var(--text-xs)",
  color: "var(--text-secondary)",
};
const ghostBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-md)",
  color: "var(--text-secondary)",
  cursor: "pointer",
  padding: "2px 10px",
  fontSize: "var(--text-md)",
};
const filterRowStyle: React.CSSProperties = {
  display: "flex",
  gap: "var(--spacing-2)",
  flexWrap: "wrap",
  marginBottom: "var(--spacing-3)",
};
const selectStyle: React.CSSProperties = {
  padding: "var(--spacing-1) var(--spacing-2)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-md)",
  background: "var(--bg-default)",
  color: "var(--text-primary)",
  fontSize: "var(--text-sm)",
};
const searchStyle: React.CSSProperties = {
  flex: 1,
  minWidth: "120px",
  padding: "var(--spacing-1) var(--spacing-2)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-md)",
  background: "var(--bg-default)",
  color: "var(--text-primary)",
  fontSize: "var(--text-sm)",
};
const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--spacing-2)",
  padding: "var(--spacing-2)",
  background: "var(--bg-default)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-md)",
  fontSize: "var(--text-sm)",
  flexWrap: "wrap",
};
const badgeStyle: React.CSSProperties = {
  flexShrink: 0,
  fontWeight: 600,
  border: "1px solid",
  borderRadius: "var(--radius-sm, 6px)",
  padding: "0 6px",
  fontSize: "var(--text-xs)",
};
const typeBadgeStyle: React.CSSProperties = {
  flexShrink: 0,
  color: "var(--text-tertiary)",
  minWidth: "44px",
};
const titleCellStyle: React.CSSProperties = {
  flex: 1,
  minWidth: "100px",
  color: "var(--text-primary)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const sourceBadgeStyle: React.CSSProperties = {
  flexShrink: 0,
  color: "var(--text-secondary)",
  fontSize: "var(--text-xs)",
};
const timeCellStyle: React.CSSProperties = {
  flexShrink: 0,
  color: "var(--text-tertiary)",
  fontSize: "var(--text-xs)",
};
const emptyStyle: React.CSSProperties = {
  color: "var(--text-secondary)",
  fontSize: "var(--text-sm)",
  margin: "var(--spacing-2) 0",
};
