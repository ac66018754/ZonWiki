"use client";

import {
  CurrentUser,
  NoteCategory,
  NoteTag,
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
import { useNoteCategories, useNoteTags, useNotes } from "@/lib/swr";
import { useConfirm } from "@/components/ConfirmProvider";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSWRConfig } from "swr";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { NoteCreateModal } from "./NoteCreateModal";
import { MobileSectionNav } from "./MobileSectionNav";
import { closeMobileNav } from "@/lib/mobileNav";
import { SHORTCUT_ACTION_EVENT } from "@/lib/shortcuts";
import { subscribeNoteActiveCategory } from "@/lib/noteEvents";
import type {
  CatDrop,
  CatEditorState,
  CategoryEditorContextValue,
  SidebarTreeHandlers,
} from "./sidebar/types";
import { CategoryEditorContext } from "./sidebar/categoryEditorContext";
import { CategoryEditor } from "./sidebar/CategoryEditor";
import { CategoryNode } from "./sidebar/CategoryNode";
import { TagList } from "./sidebar/TagList";
import { ProfileSidebar, TasksSidebar } from "./sidebar/ContextSidebars";

/**
 * Sidebar 元件（釘選、漂浮在最左側；position:fixed，自身捲動，不會被內容滑掉）
 * - 筆記：標題列（筆記＋新增筆記同行）＋「分類 / 標籤」兩個分頁；分類為無限階層樹，
 *   分類與標籤皆可就地新增/編輯/刪除，分類還可指派標籤。
 * - 日程規劃 / 行事曆 / 首頁 / 開問啦：各自的情境或隱藏。
 * 視覺樣式集中在 globals.css 的 .nt-* 區（不用 styled-jsx，因為節點由遞迴 render 產生，
 * styled-jsx 不會把作用域 class 加到非頂層 return 的 JSX）。
 *
 * 資料層（審查 finding #21）：分類 / 標籤 / 筆記清單改由共用的 SWR 快取
 * （useNoteCategories / useNoteTags / useNotes）供給，CRUD 後以 mutate 撤銷快取重抓，
 * 跨元件失效（筆記被歸類）以 SWR global mutate 觸發（取代原本的 window CustomEvent，finding #28）。
 * 樹渲染（審查 finding #22）：分類節點 / 筆記列 / 標籤列已抽成 React.memo 子元件
 * （CategoryNode / NoteRow / TagList），以穩定的回呼與資料存取集合（treeHandlers）沿遞迴傳遞，
 * 讓與樹無關的父層狀態變更不再重建整棵樹。
 */
export function Sidebar({ user }: { user: CurrentUser | null }) {
  const confirm = useConfirm();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // ─────────── 資料層（SWR 共用快取）───────────
  const { data: catData, mutate: mutateCats } = useNoteCategories();
  const { data: tagData, mutate: mutateTags } = useNoteTags();
  const { data: notesData, mutate: mutateNotes } = useNotes();
  const { mutate: globalMutate } = useSWRConfig();

  // 以 useMemo 固定空陣列的參考，避免 `?? []` 每次渲染都產生新陣列而破壞下游記憶化。
  const categories = useMemo(() => catData ?? [], [catData]);
  const tags = useMemo(() => tagData ?? [], [tagData]);
  const notes = useMemo(() => notesData ?? [], [notesData]);
  // 首次載入（尚無快取）時顯示「載入中」；notesLoaded 供「預設收合」初始化時機判斷。
  const loading = catData === undefined;
  const notesLoaded = notesData !== undefined;

  const [activeTab, setActiveTab] = useState<"categories" | "tags">("categories");
  // 目前正在閱讀的筆記所屬分類（由筆記詳情頁透過事件提供），用來在側欄標示「📍 此筆記在這」，
  // 即使網址沒有 ?categoryId 也能讓使用者知道目前內容的分類，不會迷路。
  const [activeNoteCats, setActiveNoteCats] = useState<string[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  // 新增筆記彈窗的預設分類（從某分類的「＋ → 在此分類下新增筆記」帶入）。
  const [presetCatForNewNote, setPresetCatForNewNote] = useState<string[]>([]);
  // 點分類「＋」時開啟的中央彈窗：問要「在此分類下新增筆記」還是「新增子分類」。
  const [categoryActionFor, setCategoryActionFor] = useState<NoteCategory | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 樹的收合狀態（預設全部展開；放進此集合者為收合）
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // 分類編輯器（新增或編輯）
  const [catEditor, setCatEditor] = useState<CatEditorState | null>(null);
  const [catName, setCatName] = useState("");
  const [catParentId, setCatParentId] = useState<string | null>(null);
  const [catTagIds, setCatTagIds] = useState<string[]>([]);

  // 標籤編輯器（新增或編輯）
  const [tagEditor, setTagEditor] = useState<{ mode: "add" | "edit"; id?: string } | null>(null);
  const [tagNameInput, setTagNameInput] = useState("");

  const [busy, setBusy] = useState(false);

  /** 重新整理分類與標籤（撤銷 SWR 快取重抓）。 */
  const reload = useCallback(async () => {
    await Promise.all([mutateCats(), mutateTags()]);
  }, [mutateCats, mutateTags]);

  // ─────────── 樹工具（記憶化，供 CategoryNode 穩定使用）───────────
  const childrenOf = useCallback(
    (parentId: string | null) => categories.filter((c) => (c.parentId ?? null) === parentId),
    [categories]
  );

  // 依分類分組的筆記（一篇筆記可屬多個分類 → 會出現在每個所屬分類下），標題排序。
  const notesByCat = useMemo(() => {
    const map = new Map<string, typeof notes>();
    for (const note of notes) {
      for (const cat of note.categories ?? []) {
        const list = map.get(cat.id) ?? [];
        list.push(note);
        map.set(cat.id, list);
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.title.localeCompare(b.title, "zh-Hant"));
    }
    return map;
  }, [notes]);

  const notesOf = useCallback(
    (categoryId: string) => notesByCat.get(categoryId) ?? [],
    [notesByCat]
  );

  const descendantIds = useCallback(
    (id: string): Set<string> => {
      const out = new Set<string>();
      const walk = (pid: string) =>
        childrenOf(pid).forEach((ch) => {
          out.add(ch.id);
          walk(ch.id);
        });
      walk(id);
      return out;
    },
    [childrenOf]
  );

  const toggleCollapse = useCallback(
    (id: string) =>
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    []
  );

  // 筆記被拖入某分類後，撤銷所有「筆記清單」快取（本側欄的無篩選清單＋筆記頁的各篩選清單），
  // 讓兩邊都即時反映歸屬變化（取代原本的 zonwiki:note-categorized 事件，finding #28）。
  const invalidateAllNotes = useCallback(() => {
    globalMutate((key) => Array.isArray(key) && key[0] === "notes");
  }, [globalMutate]);

  // 預設「全部收合」：分類與筆記首次載入後，把所有「可展開（有子分類或底下有筆記）的分類」
  // 放進收合集合（只做一次）。之後使用者自由展開/收合；CRUD 重抓不會重設（didInitCollapse 守衛）。
  //
  // 競態修復（2026-07-10）：直接輸入筆記網址進頁時，「筆記詳情 / 筆記清單 / 分類」三個 API
  // 是平行起跑的，完成順序不定。若「筆記詳情」先回來，會先透過 emitNoteActiveCategory
  // 把所屬分類廣播出去（見下方監聽 activeNoteCats 的 effect），但此時 collapsed 還是空集合，
  // 那個「展開 activeNoteCats 祖先」的 effect 跑起來等於無事可做；等「分類 + 筆記清單」才
  // 載完，這個初始化 effect 才把「全部可展開分類」一次性塞進 collapsed（此時已包含
  // activeNoteCats 的祖先）——但 activeNoteCats／categories 之後都沒有再變化，展開 effect
  // 不會重新觸發，於是 📍 所在分類的祖先就這樣被鎖在收合狀態，樹整棵看起來全收合、找不到
  // 目前筆記。（若換成「分類 + 筆記清單」先回來，初始化先跑完再收到廣播，則展開 effect 會
  // 正常補上——這就是「有時候正常、有時候不正常」的原因。）
  // 解法：初始化當下就先把 activeNoteCats 的所有祖先從「要收合」的集合裡排除，讓兩種到達
  // 順序都收斂到同一個正確結果。只排除「祖先」、不排除該分類本身——語意與下方展開 effect
  // 一致（該分類本身的展開/收合仍交由使用者點三角形控制，不被自動展開蓋掉）。
  const didInitCollapse = useRef(false);
  useEffect(() => {
    if (didInitCollapse.current || categories.length === 0 || !notesLoaded) return;
    didInitCollapse.current = true;
    const expandable = new Set<string>();
    // 有子分類者
    for (const c of categories) if (c.parentId) expandable.add(c.parentId);
    // 底下有筆記者（一篇筆記可屬多個分類）
    for (const note of notes) for (const cat of note.categories ?? []) expandable.add(cat.id);
    // 排除目前筆記所屬分類（activeNoteCats）的所有祖先，避免與展開 effect 產生上述競態。
    if (activeNoteCats.length > 0) {
      const byId = new Map(categories.map((c) => [c.id, c] as const));
      for (const id of activeNoteCats) {
        let cur = byId.get(id);
        while (cur?.parentId) {
          expandable.delete(cur.parentId);
          cur = byId.get(cur.parentId);
        }
      }
    }
    setCollapsed(expandable);
  }, [categories, notes, notesLoaded, activeNoteCats]);

  // 筆記頁快捷鍵「A」→ 開「新增筆記」彈窗。ShortcutRuntime 在 /notes 派發 SHORTCUT_ACTION_EVENT，
  // 側欄在所有頁面常駐、又擁有新增筆記彈窗，故由它統一接收並開啟。（全域快捷鍵事件保留為 window 事件。）
  useEffect(() => {
    const onShortcut = (e: Event) => {
      const actionId = (e as CustomEvent<{ actionId?: string }>).detail?.actionId;
      if (actionId === "newNote") {
        setPresetCatForNewNote([]);
        setShowCreateModal(true);
      }
    };
    window.addEventListener(SHORTCUT_ACTION_EVENT, onShortcut);
    return () => window.removeEventListener(SHORTCUT_ACTION_EVENT, onShortcut);
  }, []);

  // 切換路由（例如新增/刪除/編輯筆記後導覽）時，刷新樹中的筆記清單，保持與內容一致。
  useEffect(() => {
    mutateNotes();
  }, [pathname, mutateNotes]);

  // 換頁時自動關閉行動版側欄抽屜（手機點側欄連結導到新頁後，抽屜不應殘留開啟）。
  useEffect(() => {
    closeMobileNav();
  }, [pathname]);

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

  // 監聽筆記詳情頁送來的「目前筆記所屬分類」事件（型別化 event bus，finding #28）。
  useEffect(() => subscribeNoteActiveCategory(setActiveNoteCats), []);

  // 目前筆記所屬分類變更時，自動展開其所有祖先，讓「📍 此筆記在這」可見。
  useEffect(() => {
    if (activeNoteCats.length === 0 || categories.length === 0) return;
    const byId = new Map(categories.map((c) => [c.id, c] as const));
    const toExpand = new Set<string>();
    for (const id of activeNoteCats) {
      let cur = byId.get(id);
      while (cur?.parentId) {
        toExpand.add(cur.parentId);
        cur = byId.get(cur.parentId);
      }
    }
    setCollapsed((prev) => {
      let changed = false;
      const next = new Set(prev);
      toExpand.forEach((id) => {
        if (next.delete(id)) changed = true;
      });
      return changed ? next : prev;
    });
  }, [activeNoteCats, categories]);

  // 可展開的節點（有「子分類」或「底下有筆記」者；用於「全部展開/收合」與是否顯示該控制列）
  const parentIds = useMemo(
    () =>
      categories
        .filter((c) => childrenOf(c.id).length > 0 || notesOf(c.id).length > 0)
        .map((c) => c.id),
    [categories, childrenOf, notesOf]
  );
  const allExpanded = collapsed.size === 0;
  const toggleExpandAll = () => setCollapsed(allExpanded ? new Set(parentIds) : new Set());

  // 排序模式（開啟後可拖曳：分類調順序／變子分類；標籤調順序）。「分類」「標籤」兩分頁共用。
  const [sortMode, setSortMode] = useState(false);

  // 正在拖曳的分類 ID（排序模式下）
  const [dragCatId, setDragCatId] = useState<string | null>(null);
  // 分類拖曳的放置目標與落點區：before/after＝同層級調順序；inside＝變成該分類的子分類
  const [catDrop, setCatDrop] = useState<CatDrop | null>(null);
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
  const dropZoneFromEvent = useCallback(
    (e: React.DragEvent, el: HTMLElement): "before" | "after" | "inside" => {
      const rect = el.getBoundingClientRect();
      const y = e.clientY - rect.top;
      if (y < rect.height * 0.3) return "before";
      if (y > rect.height * 0.7) return "after";
      return "inside";
    },
    []
  );

  // 把分類改掛到新的上層（拖曳變子分類）；新上層不可是自己或自己的子孫
  const reparentCategory = useCallback(
    async (childId: string, newParentId: string | null) => {
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
    },
    [categories, descendantIds, reload]
  );

  // 把分類插到某個目標分類的同層級「前面／後面」（拖曳調順序）。
  // 若被拖者原本在不同上層，會先改掛到目標的上層，再依新順序寫回 SortOrder。
  const reorderCategorySibling = useCallback(
    async (dragId: string, targetId: string, zone: "before" | "after") => {
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
    },
    [categories, childrenOf, descendantIds, reload]
  );

  // 標籤調順序：把被拖標籤插到目標標籤的前／後，依新順序寫回 SortOrder
  const reorderTagSibling = useCallback(
    async (dragId: string, targetId: string, zone: "before" | "after") => {
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
    },
    [tags, reload]
  );

  // ── 觸控友善的「↑/↓ 上下移」與「⤴ 移到頂層」：手機無法做樹狀拖放，故在排序模式提供按鈕，
  //    皆沿用上面的 reorderCategorySibling / reorderTagSibling / reparentCategory 邏輯。──
  /** 把分類在「同層兄弟」中往上移一位（與前一個兄弟對調）。 */
  const moveCategoryUp = useCallback(
    (cat: NoteCategory) => {
      const sibs = childrenOf(cat.parentId ?? null);
      const i = sibs.findIndex((c) => c.id === cat.id);
      if (i > 0) reorderCategorySibling(cat.id, sibs[i - 1].id, "before");
    },
    [childrenOf, reorderCategorySibling]
  );
  /** 把分類在「同層兄弟」中往下移一位。 */
  const moveCategoryDown = useCallback(
    (cat: NoteCategory) => {
      const sibs = childrenOf(cat.parentId ?? null);
      const i = sibs.findIndex((c) => c.id === cat.id);
      if (i >= 0 && i < sibs.length - 1) reorderCategorySibling(cat.id, sibs[i + 1].id, "after");
    },
    [childrenOf, reorderCategorySibling]
  );
  /** 把標籤往上移一位。 */
  const moveTagUp = useCallback(
    (tagId: string) => {
      const i = tags.findIndex((t) => t.id === tagId);
      if (i > 0) reorderTagSibling(tagId, tags[i - 1].id, "before");
    },
    [tags, reorderTagSibling]
  );
  /** 把標籤往下移一位。 */
  const moveTagDown = useCallback(
    (tagId: string) => {
      const i = tags.findIndex((t) => t.id === tagId);
      if (i >= 0 && i < tags.length - 1) reorderTagSibling(tagId, tags[i + 1].id, "after");
    },
    [tags, reorderTagSibling]
  );

  // 把一篇筆記加入某分類（來自筆記清單頁的拖曳；冪等）
  const handleDropNoteOnCategory = useCallback(
    async (noteId: string, categoryId: string) => {
      setError(null);
      try {
        await addNoteToCategory(noteId, categoryId);
        await reload(); // 更新分類的筆記數
        invalidateAllNotes(); // 撤銷所有筆記清單快取，兩邊即時更新
      } catch (err) {
        setError(err instanceof Error ? err.message : "加入分類失敗");
      }
    },
    [reload, invalidateAllNotes]
  );

  // ─────────── 分類 CRUD ───────────
  const openAddCategory = useCallback((parentId: string | null) => {
    setCatEditor({ mode: "add", parentId });
    setCatName("");
    setCatParentId(parentId);
    setCatTagIds([]);
    setError(null);
  }, []);

  const openEditCategory = useCallback((cat: NoteCategory) => {
    setCatEditor({ mode: "edit", id: cat.id, parentId: cat.parentId ?? null });
    setCatName(cat.name);
    setCatParentId(cat.parentId ?? null);
    setCatTagIds((cat.tags ?? []).map((t) => t.id));
    setError(null);
  }, []);

  const closeCatEditor = useCallback(() => setCatEditor(null), []);

  const toggleCatTag = useCallback(
    (tagId: string) =>
      setCatTagIds((prev) =>
        prev.includes(tagId) ? prev.filter((x) => x !== tagId) : [...prev, tagId]
      ),
    []
  );

  const saveCategory = useCallback(async () => {
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
  }, [catName, catEditor, catParentId, catTagIds, reload, closeCatEditor]);

  const handleDeleteCategory = useCallback(
    async (cat: NoteCategory) => {
      if (!(await confirm({ message: `確定刪除分類「${cat.name}」？`, danger: true }))) return;
      setError(null);
      try {
        await deleteNoteCategory(cat.id);
        await reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : "刪除分類失敗");
      }
    },
    [confirm, reload]
  );

  // ─────────── 標籤 CRUD ───────────
  const openAddTag = () => {
    setTagEditor({ mode: "add" });
    setTagNameInput("");
    setError(null);
  };
  const openEditTag = useCallback((tag: NoteTag) => {
    setTagEditor({ mode: "edit", id: tag.id });
    setTagNameInput(tag.name);
    setError(null);
  }, []);
  const closeTagEditor = useCallback(() => setTagEditor(null), []);

  const saveTag = useCallback(async () => {
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
  }, [tagNameInput, tagEditor, reload, closeTagEditor]);

  const handleDeleteTag = useCallback(
    async (tag: NoteTag) => {
      if (!(await confirm({ message: `確定刪除標籤「${tag.name}」？`, danger: true }))) return;
      setError(null);
      try {
        await deleteNoteTag(tag.id);
        await reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : "刪除標籤失敗");
      }
    },
    [confirm, reload]
  );

  // 編輯分類時，上層下拉要排除自己與其子孫（避免循環）。
  const parentDropdownOptions = useMemo(() => {
    const exclude =
      catEditor?.mode === "edit" && catEditor.id
        ? new Set<string>([catEditor.id, ...descendantIds(catEditor.id)])
        : new Set<string>();
    return categories.filter((c) => !exclude.has(c.id));
  }, [catEditor, categories, descendantIds]);

  // 分類樹的穩定回呼與資料存取集合（沿遞迴傳給 CategoryNode）。
  // 必須以 useMemo 固定參考，否則每次渲染都是新物件 → CategoryNode 的 handlers prop 每次都變、
  // React.memo 永遠無法略過重繪，記憶化就形同虛設（finding #22 的關鍵）。
  const treeHandlers = useMemo<SidebarTreeHandlers>(
    () => ({
      childrenOf,
      notesOf,
      descendantIds,
      toggleCollapse,
      dropZoneFromEvent,
      setDragCatId,
      setCatDrop,
      setNoteDropCatId,
      reparentCategory,
      reorderCategorySibling,
      handleDropNoteOnCategory,
      moveCategoryUp,
      moveCategoryDown,
      openEditCategory,
      openCategoryAction: setCategoryActionFor,
      handleDeleteCategory,
    }),
    [
      childrenOf,
      notesOf,
      descendantIds,
      toggleCollapse,
      dropZoneFromEvent,
      reparentCategory,
      reorderCategorySibling,
      handleDropNoteOnCategory,
      moveCategoryUp,
      moveCategoryDown,
      openEditCategory,
      handleDeleteCategory,
    ]
  );

  // 分類編輯器 context 值（只供 CategoryEditor 表單消費；輸入變更只重繪該表單、不動整棵樹）。
  const categoryEditorValue = useMemo<CategoryEditorContextValue>(
    () => ({
      editor: catEditor,
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
    }),
    [
      catEditor,
      catName,
      catParentId,
      catTagIds,
      toggleCatTag,
      tags,
      parentDropdownOptions,
      saveCategory,
      closeCatEditor,
      busy,
    ]
  );

  // ─────────── 其它頁面的情境側欄（已抽成獨立元件）───────────
  if (pathname === "/tasks") {
    return <TasksSidebar />;
  }
  if (pathname.startsWith("/profile")) {
    return <ProfileSidebar user={user} />;
  }

  // 只有「筆記相關頁面」才顯示左側的「筆記分類 / 標籤」側欄：
  //   - /notes、/notes/...（清單、詳情、關係圖）
  //   - /a/...（文章閱讀，內容即筆記）
  // 其餘所有頁面（首頁、開問啦、垃圾桶、AI 處理佇列，以及「未來任何新頁」）桌機一律隱藏側欄、
  // 手機作為區段導覽抽屜。這樣新頁不會再「預設」掉進下方的筆記側欄。
  // （/tasks 與 /profile* 已於上方各自 return，不會走到這裡。）
  const isNotesArea =
    pathname === "/notes" || pathname.startsWith("/notes/") || pathname.startsWith("/a/");
  if (!isNotesArea) {
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

  // 目前正在閱讀的筆記路徑（用來在樹中高亮該「檔案」）。slug 可能含「/」，路徑直接比對即可。
  const currentNotePath = decodeURIComponent(pathname);

  // 「全部」也是一個分類篩選：只有在「筆記清單的全部頁」才視為選中並突出——
  // 即 pathname 精確等於 /notes 且無 categoryId/tagId 篩選。
  // 為何要加 pathname 精確匹配：讀單篇筆記（/notes/{slug}）時網址同樣沒有 query，
  // noFilter 會誤為 true；但那時該亮的是筆記所屬分類的 📍，不該讓「全部」跟著亮。
  const isAllActive = pathname === "/notes" && noFilter;

  // 「全部」清除篩選列（分類/標籤共用）。選中時比照分類列 highlighted（CategoryNode 的
  // isCurrentNote）：粗體＋強調字色＋背景膠囊（--action-secondary-* 為既有語意 token，
  // 四主題皆已驗過對比）。未選中維持次要字色、無背景。
  const allRow = (
    <Link
      href="/notes"
      prefetch
      className="nt-all"
      aria-current={isAllActive ? "page" : undefined}
      style={{
        fontWeight: isAllActive ? 600 : 400,
        color: isAllActive ? "var(--action-secondary-fg)" : "var(--text-secondary)",
        background: isAllActive ? "var(--action-secondary-bg)" : undefined,
      }}
    >
      全部
    </Link>
  );

  return (
    <CategoryEditorContext.Provider value={categoryEditorValue}>
      <aside id="app-sidebar" className="sidebar sidebar--notes" role="complementary">
        <MobileSectionNav />
        {/* ── 置頂固定區（不隨清單捲動）：標題 + 分頁 + 工具列 + 全部 ── */}
        <div className="nt-pinned">
          {/* 標題列：筆記 + 新增筆記（同一行） */}
          <div className="nt-header">
            <h2 className="nt-title">筆記</h2>
            <button
              className="nt-newnote"
              onClick={() => {
                setPresetCatForNewNote([]);
                setShowCreateModal(true);
              }}
              data-testid="new-note-button"
            >
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
                <button
                  className="nt-tool nt-tool--primary"
                  onClick={() => openAddCategory(null)}
                  title="新增分類"
                >
                  ＋ 新增分類
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
                  ＋ 新增標籤
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
              {catEditor && catEditor.mode === "add" && catEditor.parentId === null && (
                <CategoryEditor />
              )}
              {childrenOf(null).map((c) => (
                <CategoryNode
                  key={c.id}
                  cat={c}
                  depth={0}
                  handlers={treeHandlers}
                  collapsed={collapsed}
                  sortMode={sortMode}
                  dragCatId={dragCatId}
                  catDrop={catDrop}
                  noteDropCatId={noteDropCatId}
                  selectedCategoryId={selectedCategoryId}
                  activeNoteCats={activeNoteCats}
                  currentNotePath={currentNotePath}
                  catEditor={catEditor}
                />
              ))}
              {categories.length === 0 && <p className="nt-muted">還未建立分類</p>}
            </div>
          ) : (
            <TagList
              tags={tags}
              sortMode={sortMode}
              selectedTagId={selectedTagId}
              dragTagId={dragTagId}
              tagDrop={tagDrop}
              tagEditor={tagEditor}
              tagNameInput={tagNameInput}
              busy={busy}
              setDragTagId={setDragTagId}
              setTagDrop={setTagDrop}
              reorderTagSibling={reorderTagSibling}
              moveTagUp={moveTagUp}
              moveTagDown={moveTagDown}
              openEditTag={openEditTag}
              handleDeleteTag={handleDeleteTag}
              setTagNameInput={setTagNameInput}
              saveTag={saveTag}
              closeTagEditor={closeTagEditor}
            />
          )}
        </div>
      </aside>

      {/* 分類「＋」中央彈窗：在此分類下新增筆記 / 新增子分類 */}
      {categoryActionFor && (
        <div
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setCategoryActionFor(null);
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 2000,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="分類操作"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-default)",
              borderRadius: "var(--radius-lg)",
              boxShadow: "var(--shadow-lg)",
              padding: "var(--spacing-5)",
              width: 320,
              maxWidth: "90vw",
            }}
          >
            <h3 style={{ margin: "0 0 var(--spacing-1)", fontSize: "var(--text-lg)", fontWeight: 700 }}>
              「{categoryActionFor.name}」
            </h3>
            <p
              style={{
                margin: "0 0 var(--spacing-4)",
                fontSize: "var(--text-sm)",
                color: "var(--text-secondary)",
              }}
            >
              要在這個分類下做什麼？
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-2)" }}>
              <button
                className="btn-primary"
                onClick={() => {
                  setPresetCatForNewNote([categoryActionFor.id]);
                  setShowCreateModal(true);
                  setCategoryActionFor(null);
                }}
              >
                📝 在此分類下新增筆記
              </button>
              <button
                className="btn-secondary"
                onClick={() => {
                  openAddCategory(categoryActionFor.id);
                  setCategoryActionFor(null);
                }}
              >
                📁 新增子分類
              </button>
              <button className="btn-secondary" onClick={() => setCategoryActionFor(null)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}
      <NoteCreateModal
        open={showCreateModal}
        onClose={() => {
          setShowCreateModal(false);
          setPresetCatForNewNote([]);
        }}
        onCreated={() => {
          reload();
          mutateNotes();
        }}
        presetCategoryIds={presetCatForNewNote}
      />
    </CategoryEditorContext.Provider>
  );
}
