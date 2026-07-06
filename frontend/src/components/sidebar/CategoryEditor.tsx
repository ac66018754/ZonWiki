"use client";

import React from "react";
import { useCategoryEditor } from "./categoryEditorContext";

/**
 * 分類編輯器表單（新增 / 編輯共用）。
 *
 * 從 CategoryEditorContext 取用受控狀態，因此只有這個表單會隨輸入重繪，
 * 不會牽動整棵 CategoryNode 樹（審查 finding #22）。JSX 與原 Sidebar.renderCatEditor 一致。
 */
export function CategoryEditor(): React.ReactElement {
  const {
    catName,
    setCatName,
    catParentId,
    setCatParentId,
    catTagIds,
    toggleCatTag,
    tags,
    parentDropdownOptions,
    saveCategory,
    closeCatEditor,
    busy,
  } = useCategoryEditor();

  return (
    <div className="nt-editor">
      <input
        className="nt-input"
        value={catName}
        onChange={(e) => setCatName(e.target.value)}
        placeholder="分類名稱"
        autoFocus
      />
      <label className="nt-label">上層分類</label>
      <select
        className="nt-input"
        value={catParentId ?? ""}
        onChange={(e) => setCatParentId(e.target.value || null)}
      >
        <option value="">（無＝最上層）</option>
        {parentDropdownOptions.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <label className="nt-label">標籤</label>
      <div className="nt-tagpick">
        {tags.length === 0 ? (
          <span className="nt-muted">尚無標籤</span>
        ) : (
          tags.map((t) => (
            <label key={t.id} className="nt-tagpick-item">
              <input
                type="checkbox"
                checked={catTagIds.includes(t.id)}
                onChange={() => toggleCatTag(t.id)}
              />
              #{t.name}
            </label>
          ))
        )}
      </div>
      <div className="nt-editor-actions">
        <button className="nt-btn nt-btn-primary" onClick={saveCategory} disabled={busy}>
          {busy ? "儲存中…" : "儲存"}
        </button>
        <button className="nt-btn" onClick={closeCatEditor} disabled={busy}>
          取消
        </button>
      </div>
    </div>
  );
}
