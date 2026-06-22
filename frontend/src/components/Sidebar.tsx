"use client";

import {
  CurrentUser,
  NoteCategory,
  NoteTag,
  listNoteCategories,
  listNoteTags,
  createNoteCategory,
  updateNoteCategory,
  deleteNoteCategory,
  setNoteCategoryTags,
  createNoteTag,
  updateNoteTag,
  deleteNoteTag,
  reorderNoteCategories,
  reorderNoteTags,
  addNoteToCategory,
} from "@/lib/api";
import { NOTE_DND_MIME } from "@/lib/constants";
import { logger } from "@/lib/logger";
import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { NoteCreateModal } from "./NoteCreateModal";
import { MobileSectionNav } from "./MobileSectionNav";
import { TasksShortcutHints } from "./TasksShortcutHints";
import { closeMobileNav } from "@/lib/mobileNav";

/**
 * 個人頁面（/profile）子頁導覽項目。各子頁各自載入自己的資料。
 */
const PROFILE_NAV: { href: string; label: string; icon: string }[] = [
  { href: "/profile", label: "帳號資訊", icon: "👤" },
  { href: "/profile/stats", label: "統計數據", icon: "📊" },
  { href: "/profile/activity", label: "活動紀錄", icon: "🕑" },
  { href: "/profile/shortcuts", label: "快捷鍵", icon: "⌨️" },
];

/**
 * Sidebar 元件（釘選、漂浮在最左側；position:fixed，自身捲動，不會被內容滑掉）
 * - 筆記：標題列（筆記＋新增筆記同行）＋「分類 / 標籤」兩個分頁；分類為無限階層樹，
 *   分類與標籤皆可就地新增/編輯/刪除，分類還可指派標籤。
 * - 日程規劃 / 行事曆 / 首頁 / 開問啦：各自的情境或隱藏。
 * 視覺樣式集中在 globals.css 的 .nt-* 區（不用 styled-jsx，因為節點由遞迴 render 產生，
 * styled-jsx 不會把作用域 class 加到非頂層 return 的 JSX）。
 */
export function Sidebar({ user }: { user: CurrentUser | null }) {
  void user;
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [activeTab, setActiveTab] = useState<"categories" | "tags">("categories");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [categories, setCategories] = useState<NoteCategory[]>([]);
  const [tags, setTags] = useState<NoteTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 樹的收合狀態（預設全部展開；放進此集合者為收合）
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // 分類編輯器（新增或編輯）
  const [catEditor, setCatEditor] = useState<
    { mode: "add" | "edit"; id?: string; parentId: string | null } | null
  >(null);
  const [catName, setCatName] = useState("");
  const [catParentId, setCatParentId] = useState<string | null>(null);
  const [catTagIds, setCatTagIds] = useState<string[]>([]);

  // 標籤編輯器（新增或編輯）
  const [tagEditor, setTagEditor] = useState<{ mode: "add" | "edit"; id?: string } | null>(null);
  const [tagNameInput, setTagNameInput] = useState("");

  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [cats, tgs] = await Promise.all([listNoteCategories(), listNoteTags()]);
      setCategories(cats);
      setTags(tgs);
    } catch (err) {
      logger.error("Failed to load categories/tags:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // 換頁時自動關閉行動版側欄抽屜（手機點側欄連結導到新頁後，抽屜不應殘留開啟）。
  useEffect(() => {
    closeMobileNav();
  }, [pathname]);

  // 預設「全部收合」：分類首次載入時，把所有「有子分類的分類」放進收合集合（只做一次）。
  // 之後使用者自由展開/收合；分類 CRUD 重抓不會重設（didInitCollapse 守衛）。
  const didInitCollapse = useRef(false);
  useEffect(() => {
    if (didInitCollapse.current || categories.length === 0) return;
    didInitCollapse.current = true;
    const haveChildren = new Set<string>();
    for (const c of categories) if (c.parentId) haveChildren.add(c.parentId);
    setCollapsed(haveChildren);
  }, [categories]);

  // 點選某分類（?categoryId=…）時，自動展開其「所有祖先」，確保該分類在樹中可見並捲動到視野。
  // 注意：刻意「不展開該分類本身」——它本身的展開/收合改由點名稱（＝點三角形）切換，
  // 否則此處強制展開會把使用者的收合動作蓋掉。
  useEffect(() => {
    const categoryId = searchParams.get("categoryId");
    if (!categoryId || categories.length === 0) return;
    const byId = new Map(categories.map((c) => [c.id, c] as const));
    if (!byId.has(categoryId)) return;

    const toExpand = new Set<string>();
    let cur = byId.get(categoryId);
    while (cur?.parentId) {
      // 只往上展開所有祖先（不含自己），確保被點分類可見
      toExpand.add(cur.parentId);
      cur = byId.get(cur.parentId);
    }

    setCollapsed((prev) => {
      let changed = false;
      const next = new Set(prev);
      toExpand.forEach((id) => {
        if (next.delete(id)) changed = true;
      });
      return changed ? next : prev;
    });

    // 展開後（DOM 更新）捲動到該分類
    const timer = setTimeout(() => {
      document
        .querySelector(`[data-cat-id="${categoryId}"]`)
        ?.scrollIntoView({ block: "nearest" });
    }, 60);
    return () => clearTimeout(timer);
  }, [searchParams, categories]);

  // ─────────── 樹工具 ───────────
  const childrenOf = (parentId: string | null) =>
    categories.filter((c) => (c.parentId ?? null) === parentId);

  const descendantIds = (id: string): Set<string> => {
    const out = new Set<string>();
    const walk = (pid: string) =>
      childrenOf(pid).forEach((ch) => {
        out.add(ch.id);
        walk(ch.id);
      });
    walk(id);
    return out;
  };

  const toggleCollapse = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // 有子分類的節點（用於「全部展開/收合」與是否顯示該控制列）
  const parentIds = categories.filter((c) => childrenOf(c.id).length > 0).map((c) => c.id);
  const allExpanded = collapsed.size === 0;
  const toggleExpandAll = () =>
    setCollapsed(allExpanded ? new Set(parentIds) : new Set());

  // 排序模式（開啟後可拖曳：分類調順序／變子分類；標籤調順序）。「分類」「標籤」兩分頁共用。
  const [sortMode, setSortMode] = useState(false);

  // 正在拖曳的分類 ID（排序模式下）
  const [dragCatId, setDragCatId] = useState<string | null>(null);
  // 分類拖曳的放置目標與落點區：before/after＝同層級調順序；inside＝變成該分類的子分類
  const [catDrop, setCatDrop] = useState<
    { id: string; zone: "before" | "after" | "inside" } | null
  >(null);
  // 變最上層（拖到樹根下方空白）時的標示
  const [rootDrop, setRootDrop] = useState(false);

  // 正在拖曳的標籤 ID（排序模式下；標籤是平的，只有調順序）
  const [dragTagId, setDragTagId] = useState<string | null>(null);
  const [tagDrop, setTagDrop] = useState<{ id: string; zone: "before" | "after" } | null>(null);

  // 筆記拖入（來自筆記清單頁）時，游標所在的分類 ID（用於高亮）
  const [noteDropCatId, setNoteDropCatId] = useState<string | null>(null);

  // 任何拖曳結束（放下／取消）時，統一清除所有暫時性拖曳狀態與高亮。
  // HTML5 的 dragend 一定會在拖曳結束時觸發；用 window 層級監聽，
  // 可避免巢狀列冒泡導致 onDragLeave 漏清而殘留高亮，也避免中途切頁時狀態卡住。
  useEffect(() => {
    const clearDragState = () => {
      setDragCatId(null);
      setCatDrop(null);
      setRootDrop(false);
      setDragTagId(null);
      setTagDrop(null);
      setNoteDropCatId(null);
    };
    window.addEventListener("dragend", clearDragState);
    window.addEventListener("drop", clearDragState);
    return () => {
      window.removeEventListener("dragend", clearDragState);
      window.removeEventListener("drop", clearDragState);
    };
  }, []);

  // 依游標在某列的縱向位置判斷落點：上 30%＝before、下 30%＝after、中間＝inside
  const dropZoneFromEvent = (
    e: React.DragEvent,
    el: HTMLElement
  ): "before" | "after" | "inside" => {
    const rect = el.getBoundingClientRect();
    const y = e.clientY - rect.top;
    if (y < rect.height * 0.3) return "before";
    if (y > rect.height * 0.7) return "after";
    return "inside";
  };

  // 把分類改掛到新的上層（拖曳變子分類）；新上層不可是自己或自己的子孫
  const reparentCategory = async (childId: string, newParentId: string | null) => {
    if (childId === newParentId) return;
    const child = categories.find((c) => c.id === childId);
    if (!child) return;
    if (newParentId && descendantIds(childId).has(newParentId)) return; // 防循環
    if ((child.parentId ?? null) === newParentId) return; // 沒變
    setError(null);
    try {
      await updateNoteCategory(childId, { name: child.name, parentId: newParentId });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "搬移分類失敗");
    }
  };

  // 把分類插到某個目標分類的同層級「前面／後面」（拖曳調順序）。
  // 若被拖者原本在不同上層，會先改掛到目標的上層，再依新順序寫回 SortOrder。
  const reorderCategorySibling = async (
    dragId: string,
    targetId: string,
    zone: "before" | "after"
  ) => {
    if (dragId === targetId) return;
    const target = categories.find((c) => c.id === targetId);
    const drag = categories.find((c) => c.id === dragId);
    if (!target || !drag) return;

    const newParentId = target.parentId ?? null;
    // 不可把分類移成自己的上層（拖到自己的直接子分類旁邊時，newParentId 會等於自己）
    if (newParentId === dragId) return;
    // 不可把分類移進自己的子孫底下（防循環）
    if (newParentId && descendantIds(dragId).has(newParentId)) return;

    // 目標上層底下的兄弟（依目前顯示順序），排除被拖者後，插到目標前／後
    const siblings = childrenOf(newParentId)
      .map((c) => c.id)
      .filter((id) => id !== dragId);
    let insertAt = siblings.indexOf(targetId);
    if (insertAt < 0) return;
    if (zone === "after") insertAt += 1;
    siblings.splice(insertAt, 0, dragId);

    setError(null);
    try {
      // 跨層級（拖到不同上層的兄弟之間）→ 先改上層
      if ((drag.parentId ?? null) !== newParentId) {
        await updateNoteCategory(dragId, { name: drag.name, parentId: newParentId });
      }
      await reorderNoteCategories(siblings);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "排序分類失敗");
    }
  };

  // 標籤調順序：把被拖標籤插到目標標籤的前／後，依新順序寫回 SortOrder
  const reorderTagSibling = async (
    dragId: string,
    targetId: string,
    zone: "before" | "after"
  ) => {
    if (dragId === targetId) return;
    const ids = tags.map((t) => t.id).filter((id) => id !== dragId);
    let insertAt = ids.indexOf(targetId);
    if (insertAt < 0) return;
    if (zone === "after") insertAt += 1;
    ids.splice(insertAt, 0, dragId);

    setError(null);
    try {
      await reorderNoteTags(ids);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "排序標籤失敗");
    }
  };

  // 把一篇筆記加入某分類（來自筆記清單頁的拖曳；冪等）
  const handleDropNoteOnCategory = async (noteId: string, categoryId: string) => {
    setError(null);
    try {
      await addNoteToCategory(noteId, categoryId);
      await reload(); // 更新分類的筆記數
      // 通知筆記清單頁刷新（若正在看該分類）
      window.dispatchEvent(
        new CustomEvent("zonwiki:note-categorized", { detail: { noteId, categoryId } })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "加入分類失敗");
    }
  };

  // ─────────── 分類 CRUD ───────────
  const openAddCategory = (parentId: string | null) => {
    setCatEditor({ mode: "add", parentId });
    setCatName("");
    setCatParentId(parentId);
    setCatTagIds([]);
    setError(null);
  };

  const openEditCategory = (cat: NoteCategory) => {
    setCatEditor({ mode: "edit", id: cat.id, parentId: cat.parentId ?? null });
    setCatName(cat.name);
    setCatParentId(cat.parentId ?? null);
    setCatTagIds((cat.tags ?? []).map((t) => t.id));
    setError(null);
  };

  const closeCatEditor = () => setCatEditor(null);

  const toggleCatTag = (tagId: string) =>
    setCatTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((x) => x !== tagId) : [...prev, tagId]
    );

  const saveCategory = async () => {
    if (!catName.trim()) {
      setError("請輸入分類名稱");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let id = catEditor?.id;
      if (catEditor?.mode === "add") {
        const created = await createNoteCategory({ name: catName.trim(), parentId: catParentId });
        id = created?.id;
      } else if (id) {
        await updateNoteCategory(id, { name: catName.trim(), parentId: catParentId });
      }
      if (id) await setNoteCategoryTags(id, catTagIds);
      await reload();
      closeCatEditor();
    } catch (err) {
      setError(err instanceof Error ? err.message : "儲存分類失敗");
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteCategory = async (cat: NoteCategory) => {
    if (!window.confirm(`確定刪除分類「${cat.name}」？`)) return;
    setError(null);
    try {
      await deleteNoteCategory(cat.id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "刪除分類失敗");
    }
  };

  // ─────────── 標籤 CRUD ───────────
  const openAddTag = () => {
    setTagEditor({ mode: "add" });
    setTagNameInput("");
    setError(null);
  };
  const openEditTag = (tag: NoteTag) => {
    setTagEditor({ mode: "edit", id: tag.id });
    setTagNameInput(tag.name);
    setError(null);
  };
  const closeTagEditor = () => setTagEditor(null);

  const saveTag = async () => {
    if (!tagNameInput.trim()) {
      setError("請輸入標籤名稱");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (tagEditor?.mode === "add") await createNoteTag(tagNameInput.trim());
      else if (tagEditor?.id) await updateNoteTag(tagEditor.id, tagNameInput.trim());
      await reload();
      closeTagEditor();
    } catch (err) {
      setError(err instanceof Error ? err.message : "儲存標籤失敗");
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteTag = async (tag: NoteTag) => {
    if (!window.confirm(`確定刪除標籤「${tag.name}」？`)) return;
    setError(null);
    try {
      await deleteNoteTag(tag.id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "刪除標籤失敗");
    }
  };

  // ─────────── 其它頁面的情境側欄 ───────────
  if (pathname === "/tasks") {
    return (
      <aside id="app-sidebar" className="sidebar" role="complementary">
        <MobileSectionNav />
        <div className="ctx-head">
          <h2 className="ctx-title">日程規劃 (Todo &amp; Planning)</h2>
        </div>
        {/* 原先的純文字提示改為「鍵盤快捷鍵」清單（可在個人頁自訂） */}
        <TasksShortcutHints />
        <style jsx>{`
          .ctx-head {
            margin-bottom: var(--spacing-4);
            padding-bottom: var(--spacing-3);
            border-bottom: 1px solid var(--border-default);
          }
          .ctx-title {
            margin: 0;
            font-size: var(--text-sm);
            font-weight: 600;
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.05em;
          }
        `}</style>
      </aside>
    );
  }

  // ─────────── 個人頁側欄（帳號 / 統計 / 活動 / 快捷鍵 子頁導覽）───────────
  if (pathname.startsWith("/profile")) {
    return (
      <aside id="app-sidebar" className="sidebar" role="complementary">
        <MobileSectionNav />
        <div className="ctx-head">
          <h2 className="ctx-title">個人頁面</h2>
        </div>
        <nav className="pf-nav">
          {PROFILE_NAV.map((item) => {
            const active =
              item.href === "/profile"
                ? pathname === "/profile"
                : pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`pf-link ${active ? "pf-link--active" : ""}`}
              >
                <span className="pf-icon">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <style jsx>{`
          .ctx-head {
            margin-bottom: var(--spacing-4);
            padding-bottom: var(--spacing-3);
            border-bottom: 1px solid var(--border-default);
          }
          .ctx-title {
            margin: 0;
            font-size: var(--text-sm);
            font-weight: 600;
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.05em;
          }
          .pf-nav {
            display: flex;
            flex-direction: column;
            gap: 2px;
          }
          .pf-link {
            display: flex;
            align-items: center;
            gap: var(--spacing-2);
            padding: var(--spacing-2) var(--spacing-3);
            border-radius: var(--radius-md);
            color: var(--text-secondary);
            text-decoration: none;
            font-size: var(--text-sm);
          }
          .pf-link:hover {
            background: var(--bg-surface-secondary, var(--bg-default));
            color: var(--text-primary);
          }
          .pf-link--active {
            background: var(--action-primary-bg);
            color: var(--action-primary-fg);
            font-weight: 600;
          }
          .pf-icon {
            width: 18px;
            text-align: center;
          }
        `}</style>
      </aside>
    );
  }

  // 首頁、開問啦、垃圾桶：桌機隱藏側欄（這些頁面是滿版內容）；
  // 手機斷點則作為抽屜出現，僅提供區段導覽（讓手機仍能在各區段間切換）。
  if (pathname === "/" || pathname === "/canvas" || pathname === "/trash") {
    return (
      <aside id="app-sidebar" className="sidebar sidebar--hidden" role="complementary">
        <MobileSectionNav />
      </aside>
    );
  }

  // ─────────── 筆記側欄（分類 / 標籤）───────────
  const selectedCategoryId = searchParams.get("categoryId");
  const selectedTagId = searchParams.get("tagId");
  const noFilter = !selectedCategoryId && !selectedTagId;

  // 編輯分類時，上層下拉要排除自己與其子孫（避免循環）
  const parentDropdownOptions = (() => {
    const exclude =
      catEditor?.mode === "edit" && catEditor.id
        ? new Set<string>([catEditor.id, ...descendantIds(catEditor.id)])
        : new Set<string>();
    return categories.filter((c) => !exclude.has(c.id));
  })();

  // 分類編輯器（新增/編輯共用）
  const renderCatEditor = () => (
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

  // 標籤編輯器（新增/編輯共用）
  const renderTagEditor = () => (
    <div className="nt-editor">
      <input
        className="nt-input"
        value={tagNameInput}
        onChange={(e) => setTagNameInput(e.target.value)}
        placeholder="標籤名稱"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter") saveTag();
        }}
      />
      <div className="nt-editor-actions">
        <button className="nt-btn nt-btn-primary" onClick={saveTag} disabled={busy}>
          {busy ? "儲存中…" : "儲存"}
        </button>
        <button className="nt-btn" onClick={closeTagEditor} disabled={busy}>
          取消
        </button>
      </div>
    </div>
  );

  // 遞迴渲染分類節點（無限階層）
  const renderNode = (cat: NoteCategory, depth: number): React.ReactNode => {
    const kids = childrenOf(cat.id);
    const isCollapsed = collapsed.has(cat.id);
    const isSelected = selectedCategoryId === cat.id;
    return (
      <div key={cat.id}>
        <div
          className={[
            "nt-row",
            sortMode ? "nt-row--draggable" : "",
            noteDropCatId === cat.id ? "nt-row--notedrop" : "",
            catDrop?.id === cat.id ? `nt-row--drop-${catDrop.zone}` : "",
          ]
            .filter(Boolean)
            .join(" ")}
          style={{ paddingLeft: `${depth * 14}px` }}
          draggable={sortMode}
          onDragStart={
            sortMode
              ? (e) => {
                  setDragCatId(cat.id);
                  e.dataTransfer.effectAllowed = "move";
                }
              : undefined
          }
          onDragEnd={() => {
            setDragCatId(null);
            setCatDrop(null);
            setNoteDropCatId(null);
          }}
          onDragOver={(e) => {
            // (1) 來自筆記清單頁的「筆記拖入」——任何時候都可放（不限排序模式）
            if (e.dataTransfer.types.includes(NOTE_DND_MIME)) {
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = "copy";
              setNoteDropCatId(cat.id);
              setCatDrop(null);
              return;
            }
            // (2) 分類拖曳（排序模式）——上＝插到前、下＝插到後、中＝變成子分類
            if (
              sortMode &&
              dragCatId &&
              dragCatId !== cat.id &&
              !descendantIds(dragCatId).has(cat.id)
            ) {
              e.preventDefault();
              e.stopPropagation();
              setCatDrop({ id: cat.id, zone: dropZoneFromEvent(e, e.currentTarget) });
              setNoteDropCatId(null);
            }
          }}
          onDragLeave={(e) => {
            // 只在離開「這一列本身」時清除高亮（避免子元素冒泡誤清）
            if (e.currentTarget === e.target) {
              if (noteDropCatId === cat.id) setNoteDropCatId(null);
              if (catDrop?.id === cat.id) setCatDrop(null);
            }
          }}
          onDrop={(e) => {
            // (1) 筆記拖入 → 把該筆記加入這個分類
            if (e.dataTransfer.types.includes(NOTE_DND_MIME)) {
              e.preventDefault();
              e.stopPropagation();
              const noteId = e.dataTransfer.getData(NOTE_DND_MIME);
              setNoteDropCatId(null);
              if (noteId) handleDropNoteOnCategory(noteId, cat.id);
              return;
            }
            // (2) 分類拖曳放下 → 依落點調順序或變子分類
            if (
              sortMode &&
              dragCatId &&
              dragCatId !== cat.id &&
              !descendantIds(dragCatId).has(cat.id)
            ) {
              e.preventDefault();
              e.stopPropagation();
              const zone =
                catDrop?.id === cat.id
                  ? catDrop.zone
                  : dropZoneFromEvent(e, e.currentTarget);
              setCatDrop(null);
              setDragCatId(null);
              if (zone === "inside") reparentCategory(dragCatId, cat.id);
              else reorderCategorySibling(dragCatId, cat.id, zone);
            }
          }}
        >
          {sortMode && (
            <span className="nt-drag-handle" title="拖曳：上下＝調順序、中間＝變子分類">
              ⠿
            </span>
          )}
          {kids.length > 0 ? (
            <button
              className="nt-caret"
              onClick={() => toggleCollapse(cat.id)}
              title={isCollapsed ? "展開" : "收合"}
            >
              {isCollapsed ? "▸" : "▾"}
            </button>
          ) : (
            <span className="nt-caret nt-caret--spacer" />
          )}
          <Link
            href={`/notes?categoryId=${cat.id}`}
            prefetch
            className="nt-name"
            data-cat-id={cat.id}
            onClick={(e) => {
              if (sortMode) {
                e.preventDefault();
                return;
              }
              // 點分類名稱＝點左側三角形：切換展開/收合（同時照常導覽/篩選該分類）。
              if (kids.length > 0) toggleCollapse(cat.id);
            }}
            style={{
              fontWeight: isSelected ? 600 : 400,
              color: isSelected ? "var(--action-secondary-fg)" : "var(--text-secondary)",
            }}
          >
            <span className="nt-name-text">{cat.name}</span>
            <span className="nt-count">
              {kids.length > 0
                ? `(子類: ${kids.length}, 筆記: ${cat.noteCount})`
                : `(筆記: ${cat.noteCount})`}
            </span>
          </Link>
          {(cat.tags ?? []).slice(0, 1).map((t) => (
            <span key={t.id} className="nt-chip">
              #{t.name}
            </span>
          ))}
          <span className="nt-actions">
            <button title="編輯分類" onClick={() => openEditCategory(cat)}>
              ✎
            </button>
            <button title="新增子分類" onClick={() => openAddCategory(cat.id)}>
              ＋
            </button>
            <button title="刪除分類" onClick={() => handleDeleteCategory(cat)}>
              🗑
            </button>
          </span>
        </div>
        {catEditor &&
          ((catEditor.mode === "edit" && catEditor.id === cat.id) ||
            (catEditor.mode === "add" && catEditor.parentId === cat.id)) &&
          renderCatEditor()}
        {!isCollapsed && kids.map((k) => renderNode(k, depth + 1))}
      </div>
    );
  };

  // 「全部」清除篩選列（分類/標籤共用）
  const allRow = (
    <Link
      href="/notes"
      prefetch
      className="nt-all"
      style={{
        fontWeight: noFilter ? 600 : 400,
        color: noFilter ? "var(--action-secondary-fg)" : "var(--text-secondary)",
      }}
    >
      全部
    </Link>
  );

  return (
    <>
    <aside id="app-sidebar" className="sidebar sidebar--notes" role="complementary">
      <MobileSectionNav />
      {/* ── 置頂固定區（不隨清單捲動）：標題 + 分頁 + 工具列 + 全部 ── */}
      <div className="nt-pinned">
        {/* 標題列：筆記 + 新增筆記（同一行） */}
        <div className="nt-header">
          <h2 className="nt-title">筆記</h2>
          <button className="nt-newnote" onClick={() => setShowCreateModal(true)} data-testid="new-note-button">
            ＋ 新增筆記
          </button>
        </div>

        {/* 分頁：分類 / 標籤 */}
        <div className="nt-tabs">
          <button
            className={`nt-tab ${activeTab === "categories" ? "nt-tab--active" : ""}`}
            onClick={() => setActiveTab("categories")}
            aria-pressed={activeTab === "categories"}
          >
            分類
          </button>
          <button
            className={`nt-tab ${activeTab === "tags" ? "nt-tab--active" : ""}`}
            onClick={() => setActiveTab("tags")}
            aria-pressed={activeTab === "tags"}
          >
            標籤
          </button>
        </div>

        {/* 工具列：一鍵展開收合 | 排序 | 新增 */}
        <div className="nt-toolbar">
          {activeTab === "categories" ? (
            <>
              <button
                className="nt-tool"
                onClick={toggleExpandAll}
                disabled={parentIds.length === 0}
                title={allExpanded ? "全部收合" : "全部展開"}
              >
                {allExpanded ? "⊟ 收合" : "⊞ 展開"}
              </button>
              <button
                className={`nt-tool ${sortMode ? "nt-tool--on" : ""}`}
                onClick={() => setSortMode((v) => !v)}
                title="排序模式：拖曳分類—上下邊緣＝調順序、中間＝變子分類、下方空白＝變最上層"
              >
                ⇅ 排序{sortMode ? "中" : ""}
              </button>
              <button className="nt-tool nt-tool--primary" onClick={() => openAddCategory(null)} title="新增分類">
                ＋ 新增
              </button>
            </>
          ) : (
            <>
              <button
                className={`nt-tool ${sortMode ? "nt-tool--on" : ""}`}
                onClick={() => setSortMode((v) => !v)}
                disabled={tags.length < 2}
                title="排序模式：拖曳標籤調整順序"
              >
                ⇅ 排序{sortMode ? "中" : ""}
              </button>
              <button className="nt-tool nt-tool--primary" onClick={openAddTag} title="新增標籤">
                ＋ 新增
              </button>
            </>
          )}
        </div>

        {error && <div className="nt-error">{error}</div>}

        {allRow}
      </div>

      {/* ── 捲動區：分類樹 / 標籤清單 ── */}
      <div className="nt-scroll">
        {loading ? (
          <div className="nt-muted">載入中...</div>
        ) : activeTab === "categories" ? (
          <div
            data-testid="category-tree"
            className={`nt-tree${sortMode ? " nt-tree--sorting" : ""}${rootDrop ? " nt-droproot" : ""}`}
            onDragOver={
              sortMode && dragCatId
                ? (e) => {
                    e.preventDefault();
                    setRootDrop(true);
                  }
                : undefined
            }
            onDragLeave={
              sortMode && dragCatId
                ? (e) => {
                    if (e.currentTarget === e.target) setRootDrop(false);
                  }
                : undefined
            }
            onDrop={
              sortMode && dragCatId
                ? (e) => {
                    e.preventDefault();
                    reparentCategory(dragCatId, null);
                    setDragCatId(null);
                    setRootDrop(false);
                  }
                : undefined
            }
          >
            {sortMode && (
              <div className="nt-sort-hint">
                排序模式：拖曳分類—<b>上下邊緣</b>＝調整順序、<b>放到分類中間</b>＝變子分類、放到下方空白＝變最上層。也可從筆記清單把<b>筆記拖進分類</b>。
              </div>
            )}
            {catEditor && catEditor.mode === "add" && catEditor.parentId === null && renderCatEditor()}
            {childrenOf(null).map((c) => renderNode(c, 0))}
            {categories.length === 0 && <p className="nt-muted">還未建立分類</p>}
          </div>
        ) : (
          <div data-testid="tag-list">
            {sortMode && tags.length >= 2 && (
              <div className="nt-sort-hint">排序模式：拖曳標籤調整順序（上半＝插到前、下半＝插到後）。</div>
            )}
            {tagEditor && tagEditor.mode === "add" && renderTagEditor()}
            {tags.map((tag) => {
              const isSelected = selectedTagId === tag.id;
              return (
                <div key={tag.id}>
                  <div
                    className={[
                      "nt-row",
                      sortMode ? "nt-row--draggable" : "",
                      tagDrop?.id === tag.id ? `nt-row--drop-${tagDrop.zone}` : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    draggable={sortMode}
                    onDragStart={
                      sortMode
                        ? (e) => {
                            setDragTagId(tag.id);
                            e.dataTransfer.effectAllowed = "move";
                          }
                        : undefined
                    }
                    onDragEnd={() => {
                      setDragTagId(null);
                      setTagDrop(null);
                    }}
                    onDragOver={
                      sortMode && dragTagId && dragTagId !== tag.id
                        ? (e) => {
                            e.preventDefault();
                            const rect = e.currentTarget.getBoundingClientRect();
                            const zone =
                              e.clientY - rect.top < rect.height / 2 ? "before" : "after";
                            setTagDrop({ id: tag.id, zone });
                          }
                        : undefined
                    }
                    onDrop={
                      sortMode && dragTagId && dragTagId !== tag.id
                        ? (e) => {
                            e.preventDefault();
                            const zone = tagDrop?.id === tag.id ? tagDrop.zone : "after";
                            const dragged = dragTagId;
                            setTagDrop(null);
                            setDragTagId(null);
                            reorderTagSibling(dragged, tag.id, zone);
                          }
                        : undefined
                    }
                  >
                    {sortMode ? (
                      <span className="nt-drag-handle" title="拖曳調整順序">
                        ⠿
                      </span>
                    ) : (
                      <span className="nt-caret nt-caret--spacer" />
                    )}
                    <Link
                      href={`/notes?tagId=${tag.id}`}
                      prefetch
                      className="nt-name"
                      onClick={sortMode ? (e) => e.preventDefault() : undefined}
                      style={{
                        fontWeight: isSelected ? 600 : 400,
                        color: isSelected ? "var(--action-secondary-fg)" : "var(--text-secondary)",
                      }}
                    >
                      <span className="nt-name-text">#{tag.name}</span>
                      <span className="nt-count">{tag.noteCount}</span>
                    </Link>
                    <span className="nt-actions">
                      <button title="編輯標籤" onClick={() => openEditTag(tag)}>✎</button>
                      <button title="刪除標籤" onClick={() => handleDeleteTag(tag)}>🗑</button>
                    </span>
                  </div>
                  {tagEditor && tagEditor.mode === "edit" && tagEditor.id === tag.id && renderTagEditor()}
                </div>
              );
            })}
            {tags.length === 0 && <p className="nt-muted">還沒有標籤，點上方「＋ 新增」。</p>}
          </div>
        )}
      </div>
    </aside>
    <NoteCreateModal
      open={showCreateModal}
      onClose={() => setShowCreateModal(false)}
      onCreated={reload}
    />
    </>
  );
}
