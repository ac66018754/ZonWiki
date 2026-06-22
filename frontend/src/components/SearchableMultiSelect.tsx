"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * 下拉選單的單一選項。
 */
export interface MultiSelectOption {
  /** 選項識別碼。 */
  id: string;
  /** 顯示名稱（分類可傳完整階層路徑）。 */
  name: string;
}

/**
 * 可搜尋的多選下拉元件（combobox）：
 * - 已選項目以可移除的 chip 呈現。
 * - 輸入即時過濾選項；下拉清單可點選或用上下鍵 + Enter 選取。
 * - 提供 onCreate 時，輸入沒有完全相符的名稱會出現「＋ 建立「X」」可就地新增。
 * - 點外部 / Esc 關閉；空輸入時按 Backspace 移除最後一個已選。
 */
export function SearchableMultiSelect({
  options,
  selectedIds,
  onChange,
  onCreate,
  placeholder,
  prefix = "",
  single = false,
}: {
  options: MultiSelectOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  /** 提供時，可就地新增；回傳新建選項（含 id）。 */
  onCreate?: (name: string) => Promise<MultiSelectOption | null>;
  placeholder?: string;
  /** 顯示前綴（例如標籤的 "#"）。 */
  prefix?: string;
  /** 單選模式：選取即取代既有選擇並收合下拉（用於「分類」這類單選欄位）。 */
  single?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const selected = selectedIds
    .map((id) => byId.get(id))
    .filter((o): o is MultiSelectOption => Boolean(o));

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      options.filter(
        (o) => !selectedIds.includes(o.id) && o.name.toLowerCase().includes(q)
      ),
    [options, selectedIds, q]
  );
  const exactExists = options.some((o) => o.name.toLowerCase() === q);
  const canCreate = Boolean(onCreate) && q.length > 0 && !exactExists;
  const rowCount = filtered.length + (canCreate ? 1 : 0);

  // 點元件外部時關閉下拉
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const addId = (id: string) => {
    onChange(single ? [id] : [...selectedIds, id]);
    setQuery("");
    setHighlight(0);
    if (single) setOpen(false);
  };
  const removeId = (id: string) => onChange(selectedIds.filter((x) => x !== id));

  const create = async () => {
    if (!onCreate || !query.trim() || creating) return;
    setCreating(true);
    try {
      const created = await onCreate(query.trim());
      if (created) {
        onChange(single ? [created.id] : [...selectedIds, created.id]);
        setQuery("");
        setHighlight(0);
        if (single) setOpen(false);
      }
    } finally {
      setCreating(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, Math.max(rowCount - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlight < filtered.length) addId(filtered[highlight].id);
      else if (canCreate) create();
    } else if (e.key === "Backspace" && !query && selected.length > 0) {
      removeId(selected[selected.length - 1].id);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="ms-root" ref={rootRef}>
      <div
        className="ms-control"
        onClick={() => {
          setOpen(true);
          inputRef.current?.focus();
        }}
      >
        {selected.map((o) => (
          <span key={o.id} className="ms-chip">
            {prefix}
            {o.name}
            <button
              type="button"
              className="ms-chip-x"
              onClick={(e) => {
                e.stopPropagation();
                removeId(o.id);
              }}
              aria-label={`移除 ${o.name}`}
            >
              ✕
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="ms-input"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={selected.length === 0 ? placeholder : ""}
        />
      </div>

      {open && (rowCount > 0 || q.length > 0) && (
        <div className="ms-menu">
          {rowCount === 0 && <div className="ms-empty">查無相符</div>}
          {filtered.map((o, i) => (
            <button
              type="button"
              key={o.id}
              className={`ms-opt ${i === highlight ? "ms-opt--hl" : ""}`}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => addId(o.id)}
            >
              {prefix}
              {o.name}
            </button>
          ))}
          {canCreate && (
            <button
              type="button"
              className={`ms-opt ms-opt--create ${
                highlight === filtered.length ? "ms-opt--hl" : ""
              }`}
              onMouseEnter={() => setHighlight(filtered.length)}
              onClick={create}
              disabled={creating}
            >
              ＋ 建立「{query.trim()}」
            </button>
          )}
        </div>
      )}
    </div>
  );
}
