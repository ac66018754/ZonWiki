"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  TrashItem,
  CurrentUser,
  getCurrentUser,
  listTrash,
  restoreTrashItem,
  purgeTrashItem,
} from "@/lib/api";
import { formatDateTime } from "@/lib/formatters";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import { logger } from "@/lib/logger";

/**
 * 統一垃圾桶頁面（/trash）。
 * - 彙整所有模組已刪除項目（筆記、分類、標籤、任務、快速記錄、常用連結、白板、開問啦畫布/節點）。
 * - 依模組分區，可逐區收合/展開；每項顯示標題、內容預覽、刪除時間。
 * - 每項可「還原」或「永久刪除」。
 */

/** 各模組分區的顯示順序與圖示。未列出的群組排在最後。 */
const GROUP_ORDER: { name: string; icon: string }[] = [
  { name: "筆記", icon: "📝" },
  { name: "筆記分類", icon: "🗂️" },
  { name: "標籤", icon: "🏷️" },
  { name: "任務", icon: "✅" },
  { name: "任務分類", icon: "📁" },
  { name: "快速記錄", icon: "⚡" },
  { name: "常用連結", icon: "🔗" },
  { name: "便利貼", icon: "🗒️" },
  { name: "開問啦・畫布", icon: "🎨" },
  { name: "開問啦・節點", icon: "🔵" },
];

export default function TrashPage() {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // 收合的分區名稱集合（不在集合內＝展開；預設全部展開）
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const tz = user?.timeZone || DEFAULT_TIMEZONE;

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [u, list] = await Promise.all([getCurrentUser(), listTrash()]);
      setUser(u);
      setItems(list);
      setError(null);
    } catch (err) {
      logger.error("Failed to load trash:", err);
      setError("無法載入垃圾桶，請稍後重試。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 依模組分區：GROUP_ORDER 內的分區「一律列出（含空的）」，其餘未知分區補在後面。
  const groups = useMemo(() => {
    const map = new Map<string, TrashItem[]>();
    for (const it of items) {
      if (!map.has(it.group)) map.set(it.group, []);
      map.get(it.group)!.push(it);
    }
    const known = GROUP_ORDER.map((g) => ({
      name: g.name,
      icon: g.icon,
      items: map.get(g.name) ?? [],
    }));
    const extras = Array.from(map.keys())
      .filter((n) => !GROUP_ORDER.some((g) => g.name === n))
      .sort((a, b) => a.localeCompare(b))
      .map((n) => ({ name: n, icon: "🗑️", items: map.get(n)! }));
    return [...known, ...extras];
  }, [items]);

  const toggleCollapse = (name: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const handleRestore = async (item: TrashItem) => {
    if (busyId) return;
    setBusyId(item.id);
    try {
      const ok = await restoreTrashItem(item.type, item.id);
      if (ok) setItems((prev) => prev.filter((x) => x.id !== item.id));
    } catch (err) {
      logger.error("Failed to restore:", err);
    } finally {
      setBusyId(null);
    }
  };

  const handlePurge = async (item: TrashItem) => {
    if (busyId) return;
    if (!window.confirm(`永久刪除「${item.title}」？此操作無法復原。`)) return;
    setBusyId(item.id);
    try {
      const ok = await purgeTrashItem(item.type, item.id);
      if (ok) setItems((prev) => prev.filter((x) => x.id !== item.id));
    } catch (err) {
      logger.error("Failed to purge:", err);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="trash-page">
      <div className="trash-container">
        <div style={{ marginBottom: "var(--spacing-5)" }}>
          <h1 style={{ margin: 0, fontSize: "var(--text-2xl)", fontWeight: 700 }}>🗑️ 垃圾桶</h1>
          <p style={{ margin: "var(--spacing-2) 0 0 0", fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
            已刪除的項目集中在此，可還原或永久刪除。共 {items.length} 項。
          </p>
        </div>

        {error && (
          <div
            role="alert"
            style={{
              padding: "var(--spacing-4)",
              background: "var(--status-danger-bg)",
              color: "var(--status-danger-fg)",
              borderRadius: "var(--radius-lg)",
              marginBottom: "var(--spacing-4)",
            }}
          >
            {error}
          </div>
        )}

        {loading ? (
          <p style={{ color: "var(--text-tertiary)" }}>載入中…</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-4)" }}>
            {groups.map((group) => {
              const isCollapsed = collapsed.has(group.name);
              const isEmpty = group.items.length === 0;
              return (
                <section key={group.name} className="trash-group">
                  <button
                    className="trash-group-head"
                    onClick={() => toggleCollapse(group.name)}
                    aria-expanded={!isCollapsed}
                  >
                    <span className="trash-caret">{isCollapsed ? "▸" : "▾"}</span>
                    <span aria-hidden="true">{group.icon}</span>
                    <span className="trash-group-name">{group.name}</span>
                    <span className={`trash-group-count ${isEmpty ? "trash-group-count--empty" : ""}`}>
                      {group.items.length}
                    </span>
                  </button>

                  {!isCollapsed && (
                    <div className="trash-items">
                      {isEmpty ? (
                        <div className="trash-empty">（無項目）</div>
                      ) : (
                        group.items.map((item) => (
                          <div key={item.id} className="trash-item">
                            <div className="trash-item-main">
                              <div className="trash-item-title">{item.title}</div>
                              {item.preview && <div className="trash-item-preview">{item.preview}</div>}
                              {item.context && (
                                <div className="trash-item-context" title="按「還原」後會回到這裡">
                                  ↩ 還原到 {item.context}
                                </div>
                              )}
                              <div className="trash-item-time">🕓 刪除於 {formatDateTime(item.deletedDateTime, tz)}</div>
                            </div>
                            <div className="trash-item-actions">
                              <button
                                className="tk-btn"
                                onClick={() => handleRestore(item)}
                                disabled={busyId === item.id}
                                title="還原此項目"
                              >
                                ↩ 還原
                              </button>
                              <button
                                className="tk-btn tk-btn--danger"
                                onClick={() => handlePurge(item)}
                                disabled={busyId === item.id}
                                title="永久刪除（不可復原）"
                              >
                                永久刪除
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>

      <style jsx>{`
        .trash-page {
          width: 100%;
          overflow-y: auto;
        }
        .trash-container {
          max-width: 900px;
          margin: 0 auto;
          padding: var(--spacing-6) var(--spacing-4);
        }
        @media (max-width: 768px) {
          .trash-container {
            padding: var(--spacing-4) var(--spacing-3);
          }
        }
      `}</style>
    </div>
  );
}
