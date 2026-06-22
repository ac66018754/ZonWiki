"use client";

import { useEffect, useState } from "react";
import { TaskGroup, NoteTag } from "@/lib/api";

/**
 * 任務篩選彈窗（分類 / 標籤共用）。
 * 兩個可摺疊段落：分類、標籤；展開後為各選項的核取方塊，並提供「全選」。
 * 分類含「（未分類）」選項（以哨兵 "__none__" 表示）。
 */
const NONE = "__none__";

export function TaskFilterPopup({
  groups,
  tagPool,
  catSelected,
  tagSelected,
  onChangeCat,
  onChangeTag,
  onClose,
  onDeleteCategory,
}: {
  groups: TaskGroup[];
  tagPool: NoteTag[];
  catSelected: Set<string>;
  tagSelected: Set<string>;
  onChangeCat: (next: Set<string>) => void;
  onChangeTag: (next: Set<string>) => void;
  onClose: () => void;
  onDeleteCategory?: (group: TaskGroup) => void;
}) {
  const [catOpen, setCatOpen] = useState(true);
  const [tagOpen, setTagOpen] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const catOptions = [
    ...groups.map((g) => ({ id: g.id, name: g.name })),
    { id: NONE, name: "（未分類）" },
  ];
  const allCatIds = catOptions.map((o) => o.id);
  const allCatSelected = allCatIds.length > 0 && allCatIds.every((id) => catSelected.has(id));
  const toggleCat = (id: string) => {
    const n = new Set(catSelected);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    onChangeCat(n);
  };

  const allTagIds = tagPool.map((t) => t.id);
  const allTagSelected = allTagIds.length > 0 && allTagIds.every((id) => tagSelected.has(id));
  const toggleTag = (id: string) => {
    const n = new Set(tagSelected);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    onChangeTag(n);
  };

  return (
    <div
      className="tfp-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="tfp-panel" role="dialog" aria-modal="true" aria-label="篩選任務">
        <div className="tfp-head">
          <span className="tfp-title">篩選</span>
          <button className="tfp-x" onClick={onClose} aria-label="關閉">
            ✕
          </button>
        </div>

        {/* 分類 */}
        <div className="tfp-section">
          <button className="tfp-sec-head" onClick={() => setCatOpen((v) => !v)}>
            <span>
              {catOpen ? "▾" : "▸"} 分類
            </span>
            {catSelected.size > 0 && <span className="tfp-badge">{catSelected.size}</span>}
          </button>
          {catOpen && (
            <div className="tfp-sec-body">
              <label className="tfp-opt tfp-opt--all">
                <input
                  type="checkbox"
                  checked={allCatSelected}
                  onChange={() => onChangeCat(allCatSelected ? new Set() : new Set(allCatIds))}
                />
                <span className="tfp-opt-name">全選</span>
              </label>
              {catOptions.map((o) => (
                <label key={o.id} className="tfp-opt">
                  <input
                    type="checkbox"
                    checked={catSelected.has(o.id)}
                    onChange={() => toggleCat(o.id)}
                  />
                  <span className="tfp-opt-name">{o.name}</span>
                  {onDeleteCategory && o.id !== NONE && (
                    <button
                      type="button"
                      className="tfp-del"
                      title="刪除分類"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const g = groups.find((x) => x.id === o.id);
                        if (g) onDeleteCategory(g);
                      }}
                    >
                      🗑
                    </button>
                  )}
                </label>
              ))}
            </div>
          )}
        </div>

        {/* 標籤 */}
        <div className="tfp-section">
          <button className="tfp-sec-head" onClick={() => setTagOpen((v) => !v)}>
            <span>
              {tagOpen ? "▾" : "▸"} 標籤
            </span>
            {tagSelected.size > 0 && <span className="tfp-badge">{tagSelected.size}</span>}
          </button>
          {tagOpen && tagPool.length > 0 && (
            <div className="tfp-sec-body">
              <label className="tfp-opt tfp-opt--all">
                <input
                  type="checkbox"
                  checked={allTagSelected}
                  onChange={() => onChangeTag(allTagSelected ? new Set() : new Set(allTagIds))}
                />
                <span className="tfp-opt-name">全選</span>
              </label>
              {tagPool.map((t) => (
                <label key={t.id} className="tfp-opt">
                  <input
                    type="checkbox"
                    checked={tagSelected.has(t.id)}
                    onChange={() => toggleTag(t.id)}
                  />
                  <span className="tfp-opt-name">#{t.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="tfp-foot">
          <button
            className="tk-btn"
            onClick={() => {
              onChangeCat(new Set());
              onChangeTag(new Set());
            }}
          >
            清除全部
          </button>
          <button className="tk-btn tk-btn--primary" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
