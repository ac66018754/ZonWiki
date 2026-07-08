"use client";

import { useEffect, useState, useCallback } from "react";
import {
  createTaskCard,
  updateTaskCard,
  deleteTaskGroup,
  updateSubTask,
  type TaskCard,
  type TaskGroup,
} from "@/lib/api";
import { useCurrentUser, useTaskCards, useTaskGroups, useNoteTags } from "@/lib/swr";
import { logger } from "@/lib/logger";
import { TaskBoardView } from "./components/TaskBoardView";
import { TaskListView } from "./components/TaskListView";
import { TaskEditorModal } from "./components/TaskEditorModal";
import { TaskFilterPopup } from "./components/TaskFilterPopup";
import { QuickCreateTaskModal, type QuickCreateInitial } from "./components/QuickCreateTaskModal";
import { CalendarMonthView } from "@/app/calendar/components/CalendarMonthView";
import { CalendarWeekView } from "@/app/calendar/components/CalendarWeekView";
import { CalendarDayView } from "@/app/calendar/components/CalendarDayView";
import { CalendarYearView } from "@/app/calendar/components/CalendarYearView";
import { SkeletonCard } from "@/components/Skeleton";
import { FALLBACK_TZ, fromLocalInputValue, isOverdue, isToday } from "./taskUtils";
import { SHORTCUT_ACTION_EVENT } from "@/lib/shortcuts";
import { useConfirm } from "@/components/ConfirmProvider";

/**
 * 日程規劃（Todo & Planning）頁面
 * - 多視圖：清單、看板（依狀態分欄）、行事曆。
 * - 任務支援：期間（排程＋截止）、子任務、分類、todo/doing/done 狀態、優先度。
 * - 快速新增、分類篩選、時間篩選（今天 / 逾期 / 未排程）。
 */
export default function TasksPage() {
  const confirm = useConfirm();
  const [view, setView] = useState<"list" | "board" | "calendar">("list");
  const [calendarView, setCalendarView] = useState<"month" | "week" | "day" | "year">("month");
  // 客戶端快取（SWR）：切走再切回此頁直接吃快取、瞬間顯示，背景再靜默重抓。
  const { data: userData } = useCurrentUser();
  const {
    data: tasksData,
    error: tasksError,
    isLoading: tasksLoading,
    mutate: mutateTasks,
  } = useTaskCards();
  const { data: groupsData, mutate: mutateGroups } = useTaskGroups();
  const { data: tagsData, mutate: mutateTags } = useNoteTags();

  const user = userData ?? null;
  const groups = groupsData ?? [];
  const tagPool = tagsData ?? [];

  // tasks 保留本地 state 承載大量「樂觀更新」（新增/勾選/子任務），並於 SWR 取得新資料時同步 seed。
  const [tasks, setTasks] = useState<TaskCard[]>([]);
  useEffect(() => {
    if (tasksData) setTasks(tasksData);
  }, [tasksData]);

  // 只有「首次載入且尚無資料」才顯示骨架；keepPreviousData 下背景重抓不會閃骨架。
  const loading = tasksLoading && tasks.length === 0;
  const error = tasksError ? "載入任務失敗" : null;
  // 預設：急迫度（優先度）排序、逆序（高→低）、拆行（依排序值分組）。
  const [sortBy, setSortBy] = useState<
    "createdDate" | "plannedDate" | "dueDate" | "priority" | "groupName" | "status"
  >("priority");
  // 排序方向：asc（正序）/ desc（逆序）。點下拉右側按鈕切換。
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  // 是否「拆行」：依排序值分組顯示（每個值一組、可收合）。關閉＝單純扁平清單。
  const [splitRows, setSplitRows] = useState(true);
  // 行事曆點格子→快速新增任務的初始時間（null＝未開啟）
  const [quickCreateInitial, setQuickCreateInitial] = useState<QuickCreateInitial | null>(null);
  // 子任務（有父任務的任務）顯示模式：false＝只顯示頂層任務（子任務內嵌於父卡）；true＝連子任務也當獨立卡片顯示。
  const [showAllTasks, setShowAllTasks] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  // 行事曆視圖自帶資料抓取（getCalendarView）；編輯任務關閉後 bump 此 key 以強制重抓，
  // 讓在行事曆中改過的任務（日期/狀態）即時反映。
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);

  // 編輯彈窗導覽堆疊：頂層任務 → 進入子任務時 push、關閉時 pop（關閉子任務即回到父任務）。
  const [editorStack, setEditorStack] = useState<string[]>([]);
  const editorTaskId = editorStack.length ? editorStack[editorStack.length - 1] : null;
  /** 開啟一張任務（重置堆疊；清單/看板/行事曆點擊用）。 */
  const openTask = useCallback((id: string) => setEditorStack([id]), []);
  /** 進入子任務（推入堆疊）。 */
  const pushTask = useCallback((id: string) => setEditorStack((prev) => [...prev, id]), []);
  // 快速新增
  const [quickAddTitle, setQuickAddTitle] = useState("");
  const [quickAdding, setQuickAdding] = useState(false);
  // 分類篩選（多選 Set；含分類 ID 與哨兵 "__none__"＝未分類；空集合＝全部）
  const [catFilterIds, setCatFilterIds] = useState<Set<string>>(new Set());
  // 標籤篩選（多選 Set；任務含其中任一所選標籤即顯示；空集合＝全部）
  const [tagFilterIds, setTagFilterIds] = useState<Set<string>>(new Set());
  // 時間篩選
  const [timeFilter, setTimeFilter] = useState<"all" | "today" | "overdue" | "undated">("all");
  // 篩選彈窗（分類/標籤共用）
  const [filterPopupOpen, setFilterPopupOpen] = useState(false);
  // 子任務在卡片外層收合狀態（不在集合內＝展開；預設全部展開）
  const [collapsedTaskIds, setCollapsedTaskIds] = useState<Set<string>>(new Set());

  const tz = user?.timeZone || FALLBACK_TZ;

  /**
   * 重新載入任務與分類（任務卡片含子任務進度）。
   */
  /** 重新整理任務/群組/標籤（撤銷 SWR 快取並重抓）。SWR 會在掛載時自動抓取，毋須額外 useEffect 觸發。 */
  const reload = useCallback(() => {
    mutateTasks();
    mutateGroups();
    mutateTags();
  }, [mutateTasks, mutateGroups, mutateTags]);

  // 清單/看板卡片上點子任務標題會派發 zonwiki:open-task → 開啟該子任務。
  // 若彈窗已開（在某任務內）則 push（之後關閉會回到此任務）；否則重置堆疊開新的。
  useEffect(() => {
    const onOpenTask = (e: Event) => {
      const id = (e as CustomEvent<{ taskId: string }>).detail?.taskId;
      if (id) setEditorStack((prev) => (prev.length ? [...prev, id] : [id]));
    };
    window.addEventListener("zonwiki:open-task", onOpenTask);
    return () => window.removeEventListener("zonwiki:open-task", onOpenTask);
  }, []);

  // Todo 頁專用快捷鍵：由全域執行器（ShortcutRuntime）派發 SHORTCUT_ACTION_EVENT，
  // 此頁負責執行行事曆檢視切換、顯示模式循環、彈出新增任務表單。
  // setState 函式參考穩定，故空相依、只註冊一次。
  useEffect(() => {
    const onShortcut = (e: Event) => {
      const actionId = (e as CustomEvent<{ actionId: string }>).detail?.actionId;
      if (!actionId) return;
      switch (actionId) {
        case "calYear":
          setView("calendar");
          setCalendarView("year");
          break;
        case "calMonth":
          setView("calendar");
          setCalendarView("month");
          break;
        case "calWeek":
          setView("calendar");
          setCalendarView("week");
          break;
        case "calDay":
          setView("calendar");
          setCalendarView("day");
          break;
        case "newTodo":
          // 彈出「新增任務」表單（不預填時間，純快速新增）
          setQuickCreateInitial({ plannedDateTime: null, dueDateTime: null });
          break;
      }
    };
    window.addEventListener(SHORTCUT_ACTION_EVENT, onShortcut);
    return () => window.removeEventListener(SHORTCUT_ACTION_EVENT, onShortcut);
  }, []);

  // 深連結：?view=calendar&calendarView=week&date=YYYY-MM-DD（供「連結」彈窗從筆記/節點跳回任務當天）。
  // 用 window.location 解析避免 useSearchParams 的 Suspense 要求；僅掛載時套用一次。
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const v = sp.get("view");
    if (v === "list" || v === "board" || v === "calendar") setView(v);
    const cv = sp.get("calendarView");
    if (cv === "year" || cv === "month" || cv === "week" || cv === "day") setCalendarView(cv);
    const d = sp.get("date");
    if (d) {
      const dt = new Date(d);
      if (!Number.isNaN(dt.getTime())) setSelectedDate(dt);
    }
  }, []);

  // ─────────── 任務操作 ───────────

  /** 快速新增任務（標題即可；若有選定分類則自動歸類）。 */
  const handleQuickAdd = useCallback(async () => {
    const title = quickAddTitle.trim();
    if (!title || quickAdding) return;
    setQuickAdding(true);
    try {
      // 僅在「剛好篩選單一真實分類」時自動歸類。
      const realCats = Array.from(catFilterIds).filter((id) => id !== "__none__");
      const groupId = realCats.length === 1 ? realCats[0] : undefined;
      const created = await createTaskCard({ title, status: "todo", groupId });
      if (created) {
        setTasks((prev) => [created, ...prev]);
        mutateTasks(); // 同步 SWR 快取，避免切走再回來看到舊清單
      }
      setQuickAddTitle("");
    } catch (err) {
      logger.error("Failed to quick-add task:", err);
    } finally {
      setQuickAdding(false);
    }
  }, [quickAddTitle, quickAdding, catFilterIds, mutateTasks]);

  /** 快速切換完成 / 待辦（清單與看板的核取方塊）。樂觀更新，失敗回滾。 */
  const handleToggleDone = useCallback(async (task: TaskCard) => {
    const nextStatus = task.status === "done" ? "todo" : "done";
    let snapshot: TaskCard[] | null = null;
    setTasks((prev) => {
      snapshot = prev;
      return prev.map((t) => (t.id === task.id ? { ...t, status: nextStatus } : t));
    });
    try {
      await updateTaskCard(task.id, { status: nextStatus });
      mutateTasks(); // 同步 SWR 快取
    } catch (err) {
      logger.error("Failed to toggle task:", err);
      if (snapshot) setTasks(snapshot); // 回滾
    }
  }, [mutateTasks]);

  /** 看板拖曳改狀態。樂觀更新，失敗回滾。 */
  const handleBoardStatusChange = useCallback(
    async (id: string, updates: { status: "todo" | "doing" | "done" }) => {
      let snapshot: TaskCard[] | null = null;
      setTasks((prev) => {
        snapshot = prev;
        return prev.map((t) => (t.id === id ? { ...t, status: updates.status } : t));
      });
      try {
        await updateTaskCard(id, updates);
        mutateTasks(); // 同步 SWR 快取
      } catch (err) {
        logger.error("Failed to update task status:", err);
        if (snapshot) setTasks(snapshot); // 回滾
      }
    },
    [mutateTasks]
  );

  /**
   * 在卡片外層直接打勾/取消子任務。樂觀更新，失敗只回滾「該子任務」本身。
   * 用 functional setState 僅針對目標子任務套用狀態，故與其他子任務的併發切換不會互相覆蓋
   * （不快照整個 tasks 陣列，避免「A 失敗回滾把同時成功的 B 也還原」）。
   */
  const handleToggleSubtask = useCallback(
    async (taskId: string, subtaskId: string, nextDone: boolean) => {
      // 產生「把指定子任務設為 done」的 functional updater（連同重算進度）。
      const applyDone = (done: boolean) => (prev: TaskCard[]) =>
        prev.map((t) => {
          if (t.id !== taskId) return t;
          const subTasks = (t.subTasks ?? []).map((s) =>
            s.id === subtaskId ? { ...s, isDone: done } : s
          );
          return {
            ...t,
            subTasks,
            subTaskTotal: subTasks.length,
            subTaskDone: subTasks.filter((s) => s.isDone).length,
          };
        });

      setTasks(applyDone(nextDone)); // 樂觀更新
      try {
        await updateSubTask(subtaskId, { isDone: nextDone });
        mutateTasks(); // 同步 SWR 快取
      } catch (err) {
        logger.error("Failed to toggle subtask:", err);
        setTasks(applyDone(!nextDone)); // 只回滾該子任務
      }
    },
    [mutateTasks]
  );

  /** 切換單一任務的子任務外層收合。 */
  const handleToggleCollapse = useCallback((taskId: string) => {
    setCollapsedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  /** 一鍵收合 / 展開所有「有子任務」的卡片。 */
  const toggleCollapseAll = useCallback((idsWithSubs: string[]) => {
    setCollapsedTaskIds((prev) => {
      const allCollapsed = idsWithSubs.length > 0 && idsWithSubs.every((id) => prev.has(id));
      return allCollapsed ? new Set() : new Set(idsWithSubs);
    });
  }, []);

  /**
   * 關閉編輯彈窗：pop 一層——若還有上層（父任務）則回到父任務，否則完全關閉。
   * 每次都 reload 以同步子任務進度 / 行事曆。
   */
  const handleCloseEditor = useCallback(() => {
    setEditorStack((prev) => prev.slice(0, -1));
    reload();
    setCalendarRefreshKey((k) => k + 1); // 行事曆視圖在此重抓
  }, [reload]);

  /**
   * 行事曆點格子 → 開「快速新增任務」表單，並依點到的日期/小時帶入開始/截止時間。
   * dateStr：yyyy-MM-dd（牆上日期）；hour：0-23（週/日的小時格）或 null（月視圖整天）。
   */
  const handleSlotClick = useCallback(
    (dateStr: string, hour: number | null) => {
      const tzx = user?.timeZone || FALLBACK_TZ;
      let startWall: string;
      let endWall: string;
      if (hour === null) {
        // 月視圖：預設帶入該日 09:00–10:00（皆可再調整）。
        startWall = `${dateStr}T09:00`;
        endWall = `${dateStr}T10:00`;
      } else {
        const sh = String(hour).padStart(2, "0");
        // 結束時間＝下一小時；最後一小時則收到 23:59。
        const endH = hour >= 23 ? "23" : String(hour + 1).padStart(2, "0");
        const endM = hour >= 23 ? "59" : "00";
        startWall = `${dateStr}T${sh}:00`;
        endWall = `${dateStr}T${endH}:${endM}`;
      }
      setQuickCreateInitial({
        plannedDateTime: fromLocalInputValue(startWall, tzx),
        dueDateTime: fromLocalInputValue(endWall, tzx),
      });
    },
    [user]
  );

  // ─────────── 分類操作 ───────────
  // 新增分類已移至「任務編輯器」的分類欄就地新增；此頁不再提供新增按鈕。

  /** 刪除分類（卡片會變成未分類）。 */
  const handleDeleteCategory = useCallback(
    async (group: TaskGroup) => {
      if (!(await confirm({ message: `刪除分類「${group.name}」？該分類底下的任務會變成未分類。`, danger: true }))) return;
      try {
        await deleteTaskGroup(group.id);
        setCatFilterIds((prev) => {
          if (!prev.has(group.id)) return prev;
          const next = new Set(prev);
          next.delete(group.id);
          return next;
        });
        await reload();
      } catch (err) {
        logger.error("Failed to delete category:", err);
      }
    },
    [reload]
  );

  // ─────────── 行事曆導覽 ───────────
  const goNextCalendarPeriod = useCallback(() => {
    setSelectedDate((prev) => {
      const next = new Date(prev);
      if (calendarView === "year") next.setFullYear(next.getFullYear() + 1);
      else if (calendarView === "month") next.setMonth(next.getMonth() + 1);
      else if (calendarView === "week") next.setDate(next.getDate() + 7);
      else next.setDate(next.getDate() + 1);
      return next;
    });
  }, [calendarView]);

  const goPrevCalendarPeriod = useCallback(() => {
    setSelectedDate((prev) => {
      const prevDate = new Date(prev);
      if (calendarView === "year") prevDate.setFullYear(prevDate.getFullYear() - 1);
      else if (calendarView === "month") prevDate.setMonth(prevDate.getMonth() - 1);
      else if (calendarView === "week") prevDate.setDate(prevDate.getDate() - 7);
      else prevDate.setDate(prevDate.getDate() - 1);
      return prevDate;
    });
  }, [calendarView]);

  /** 從年/月鑽研到指定日期所在的月視圖。 */
  const drillToDate = useCallback((date: Date) => {
    setSelectedDate(date);
    setCalendarView("month");
  }, []);

  const goTodayCalendar = useCallback(() => setSelectedDate(new Date()), []);

  function formatMonthDisplay(date: Date) {
    return new Intl.DateTimeFormat("zh-Hant", { year: "numeric", month: "long" }).format(date);
  }
  function formatDateDisplay(date: Date) {
    return new Intl.DateTimeFormat("zh-Hant", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "short",
    }).format(date);
  }
  function getWeekNumber(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.floor((d.getTime() - yearStart.getTime()) / (86400000 * 7)) + 1;
  }

  // ─────────── 篩選 ───────────
  const filteredTasks = tasks.filter((t) => {
    // 預設只顯示頂層任務（子任務內嵌於父卡）；「顯示全部」時連子任務也當獨立卡片列出。
    if (!showAllTasks && t.parentId) return false;
    // 分類（多選 OR；空集合＝全部。"__none__" 代表未分類）
    if (catFilterIds.size > 0) {
      const inCat = t.groupId ? catFilterIds.has(t.groupId) : catFilterIds.has("__none__");
      if (!inCat) return false;
    }
    // 標籤（多選 OR；含任一所選標籤即顯示；空集合＝全部）
    if (tagFilterIds.size > 0) {
      const taskTagIds = (t.tags ?? []).map((tg) => tg.id);
      if (!taskTagIds.some((id) => tagFilterIds.has(id))) return false;
    }
    // 時間
    const done = t.status === "done";
    if (timeFilter === "overdue" && !(!done && isOverdue(t.dueDateTime))) return false;
    if (timeFilter === "today" && !(isToday(t.dueDateTime, tz) || isToday(t.plannedDateTime, tz)))
      return false;
    if (timeFilter === "undated" && (t.plannedDateTime || t.dueDateTime)) return false;
    return true;
  });

  const overdueTotal = tasks.filter((t) => t.status !== "done" && isOverdue(t.dueDateTime)).length;

  if (loading) {
    return (
      <div style={{ padding: "var(--spacing-6)" }}>
        <div style={{ marginBottom: "var(--spacing-4)" }}>
          <SkeletonCard height="40px" width="30%" />
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
            gap: "var(--spacing-4)",
          }}
        >
          {[...Array(6)].map((_, i) => (
            <SkeletonCard key={i} height="160px" />
          ))}
        </div>
      </div>
    );
  }

  const timeChips: { key: typeof timeFilter; label: string }[] = [
    { key: "all", label: "全部" },
    { key: "today", label: "今天" },
    { key: "overdue", label: `逾期${overdueTotal > 0 ? ` ${overdueTotal}` : ""}` },
    { key: "undated", label: "未排程" },
  ];

  // 子任務一鍵收合範圍＝目前可見且有子任務的卡片
  const idsWithSubs = filteredTasks.filter((t) => (t.subTaskTotal ?? 0) > 0).map((t) => t.id);
  const allSubsCollapsed = idsWithSubs.length > 0 && idsWithSubs.every((id) => collapsedTaskIds.has(id));

  // 篩選列摘要：已選分類/標籤名稱（至多顯示 3 個，其餘以 …+N 表示）
  const catNameOf = (id: string) =>
    id === "__none__" ? "未分類" : groups.find((g) => g.id === id)?.name ?? "";
  const selectedCatNames = Array.from(catFilterIds).map(catNameOf).filter(Boolean);
  const selectedTagNames = Array.from(tagFilterIds)
    .map((id) => tagPool.find((t) => t.id === id)?.name)
    .filter((n): n is string => Boolean(n));

  const summaryChips = (names: string[], prefix = "") => {
    if (names.length === 0) return <span className="tk-fsum-empty">全部</span>;
    const shown = names.slice(0, 3);
    const rest = names.length - shown.length;
    return (
      <>
        {shown.map((n, i) => (
          <span key={i} className="tk-fsum-chip">
            {prefix}
            {n}
          </span>
        ))}
        {rest > 0 && <span className="tk-fsum-more">…+{rest}</span>}
      </>
    );
  };

  return (
    <div style={{ padding: "var(--spacing-6)", height: "100%" }}>
      {/* 標題 + 視圖切換 */}
      <div
        style={{
          marginBottom: "var(--spacing-5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--spacing-3)",
          flexWrap: "wrap",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "var(--text-3xl)", fontWeight: 700, color: "var(--text-primary)" }}>
          日程規劃 (Todo &amp; Planning)
        </h1>
        <div style={{ display: "flex", gap: "var(--spacing-2)" }}>
          {(["list", "board", "calendar"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`tk-filter-chip ${view === v ? "tk-filter-chip--on" : ""}`}
              style={{ fontSize: "var(--text-sm)", padding: "var(--spacing-2) var(--spacing-3)" }}
            >
              {v === "list" ? "清單" : v === "board" ? "看板" : "行事曆"}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: "var(--spacing-3) var(--spacing-4)",
            borderRadius: "var(--radius-md)",
            background: "var(--status-danger-bg)",
            color: "var(--status-danger-fg)",
            marginBottom: "var(--spacing-4)",
          }}
        >
          {error}
        </div>
      )}

      {/* 清單 / 看板：快速新增 + 篩選 */}
      {view !== "calendar" && (
        <>
          <div className="tk-toolbar2">
            <div className="tk-quickadd">
              <input
                className="tk-quickadd-input"
                value={quickAddTitle}
                onChange={(e) => setQuickAddTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleQuickAdd();
                }}
                placeholder="快速新增任務，按 Enter（之後可點開設定期間、子任務…）"
              />
              <button
                className="tk-btn tk-btn--primary"
                onClick={handleQuickAdd}
                disabled={!quickAddTitle.trim() || quickAdding}
              >
                ＋ 新增
              </button>
            </div>
            {view === "list" && (
              <div style={{ display: "flex", gap: "var(--spacing-2)", alignItems: "center" }}>
                <select
                  value={sortBy}
                  onChange={(e) =>
                    setSortBy(
                      e.target.value as
                        | "createdDate"
                        | "plannedDate"
                        | "dueDate"
                        | "priority"
                        | "groupName"
                        | "status"
                    )
                  }
                  className="tk-input"
                  style={{ width: "auto" }}
                  aria-label="排序方式"
                >
                  {/* 三個日期擺在一起 */}
                  <option value="createdDate">建立日期</option>
                  <option value="plannedDate">排程日期</option>
                  <option value="dueDate">截止日期</option>
                  <option value="groupName">分類名稱</option>
                  <option value="priority">急迫度（優先度）</option>
                  <option value="status">狀態</option>
                </select>
                {/* 正序 / 逆序 切換 */}
                <button
                  type="button"
                  className="tk-input"
                  style={{ width: "auto", cursor: "pointer", whiteSpace: "nowrap" }}
                  onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                  title={sortDir === "asc" ? "目前：正序（點擊改逆序）" : "目前：逆序（點擊改正序）"}
                  aria-label="切換排序方向"
                >
                  {sortDir === "asc" ? "↑ 正序" : "↓ 逆序"}
                </button>
                {/* 拆行（依排序值分組）/ 不拆行（單純清單） 切換 */}
                <button
                  type="button"
                  className="tk-input"
                  style={{ width: "auto", cursor: "pointer", whiteSpace: "nowrap" }}
                  onClick={() => setSplitRows((v) => !v)}
                  title={
                    splitRows
                      ? "目前：拆行（依排序值分組、可逐組收合）；點擊改為單純清單"
                      : "目前：不拆行（單純清單）；點擊改為依排序值分組"
                  }
                  aria-label="切換是否依排序值分組（拆行）"
                >
                  {splitRows ? "⊟ 拆行" : "☰ 不拆行"}
                </button>
              </div>
            )}
          </div>

          {/* 分類 + 標籤（同一行；點任一開啟篩選彈窗） */}
          <div className="tk-filterbar" style={{ marginBottom: "var(--spacing-2)" }}>
            <button className="tk-filter-trigger" onClick={() => setFilterPopupOpen(true)} title="篩選分類">
              <span className="tk-flabel">分類</span>
              {summaryChips(selectedCatNames)}
            </button>
            <button className="tk-filter-trigger" onClick={() => setFilterPopupOpen(true)} title="篩選標籤">
              <span className="tk-flabel">標籤</span>
              {summaryChips(selectedTagNames, "#")}
            </button>
          </div>

          {/* 時間 + 一鍵收合/展開子任務 */}
          <div className="tk-filterbar" style={{ marginBottom: "var(--spacing-4)" }}>
            <span className="tk-flabel">時間</span>
            {/* 時間選項包進單一邊框的分段控制（與分類/標籤一致，不再每個獨立邊框） */}
            <div className="tk-seg" role="group" aria-label="時間篩選">
              {timeChips.map((c) => (
                <button
                  key={c.key}
                  className={`tk-seg-item ${timeFilter === c.key ? "tk-seg-item--on" : ""}`}
                  onClick={() => setTimeFilter(c.key)}
                >
                  {c.label}
                </button>
              ))}
            </div>
            {/* 頂層/全部 切換：放在「收合子任務」旁邊 */}
            <button
              className={`tk-filter-chip ${showAllTasks ? "tk-filter-chip--on" : ""}`}
              style={{ marginLeft: "auto" }}
              onClick={() => setShowAllTasks((v) => !v)}
              title="切換：只顯示頂層任務（子任務內嵌父卡）/ 顯示全部任務（子任務也獨立成卡）"
            >
              {showAllTasks ? "▦ 顯示全部" : "▣ 只顯示頂層"}
            </button>
            {idsWithSubs.length > 0 && (
              <button
                className="tk-filter-chip"
                onClick={() => toggleCollapseAll(idsWithSubs)}
                title="一鍵收合 / 展開所有任務的子任務"
              >
                {allSubsCollapsed ? "▸ 展開子任務" : "▾ 收合子任務"}
              </button>
            )}
          </div>
        </>
      )}

      {/* 行事曆導覽 */}
      {view === "calendar" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--spacing-2)",
            marginBottom: "var(--spacing-5)",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", gap: "var(--spacing-2)", marginRight: "var(--spacing-3)" }}>
            {(["year", "month", "week", "day"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setCalendarView(v)}
                className={`tk-filter-chip ${calendarView === v ? "tk-filter-chip--on" : ""}`}
              >
                {v === "year" ? "年" : v === "month" ? "月" : v === "week" ? "週" : "日"}
              </button>
            ))}
          </div>
          <button className="tk-btn" onClick={goPrevCalendarPeriod}>← 上一個</button>
          <button className="tk-btn" onClick={goTodayCalendar}>今天</button>
          <button className="tk-btn" onClick={goNextCalendarPeriod}>下一個 →</button>
          <div style={{ marginLeft: "auto", fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
            {calendarView === "year" && `${selectedDate.getFullYear()} 年`}
            {calendarView === "month" && formatMonthDisplay(selectedDate)}
            {calendarView === "week" && `第 ${getWeekNumber(selectedDate)} 週`}
            {calendarView === "day" && formatDateDisplay(selectedDate)}
          </div>
        </div>
      )}

      {/* 視圖內容 */}
      {view === "list" && (
        <TaskListView
          tasks={filteredTasks}
          groups={groups}
          sortBy={sortBy}
          sortDir={sortDir}
          grouped={splitRows}
          user={user}
          collapsedTaskIds={collapsedTaskIds}
          onOpen={openTask}
          onToggleDone={handleToggleDone}
          onToggleCollapse={handleToggleCollapse}
          onToggleSubtask={handleToggleSubtask}
        />
      )}

      {view === "board" && (
        <TaskBoardView
          tasks={filteredTasks}
          groups={groups}
          user={user}
          collapsedTaskIds={collapsedTaskIds}
          onOpen={openTask}
          onToggleDone={handleToggleDone}
          onUpdateTask={handleBoardStatusChange}
          onToggleCollapse={handleToggleCollapse}
          onToggleSubtask={handleToggleSubtask}
        />
      )}

      {view === "calendar" && (
        <>
          {calendarView === "year" && (
            <CalendarYearView
              selectedDate={selectedDate}
              user={user}
              refreshKey={calendarRefreshKey}
              onDrillToDate={drillToDate}
            />
          )}
          {calendarView === "month" && (
            <CalendarMonthView
              selectedDate={selectedDate}
              user={user}
              onTaskClick={openTask}
              onSlotClick={handleSlotClick}
              refreshKey={calendarRefreshKey}
            />
          )}
          {calendarView === "week" && (
            <CalendarWeekView
              selectedDate={selectedDate}
              onTaskClick={openTask}
              onSlotClick={handleSlotClick}
              refreshKey={calendarRefreshKey}
            />
          )}
          {calendarView === "day" && (
            <CalendarDayView
              selectedDate={selectedDate}
              onTaskClick={openTask}
              onSlotClick={handleSlotClick}
              refreshKey={calendarRefreshKey}
            />
          )}
        </>
      )}

      {/* 篩選彈窗（分類 / 標籤） */}
      {filterPopupOpen && (
        <TaskFilterPopup
          groups={groups}
          tagPool={tagPool}
          catSelected={catFilterIds}
          tagSelected={tagFilterIds}
          onChangeCat={setCatFilterIds}
          onChangeTag={setTagFilterIds}
          onClose={() => setFilterPopupOpen(false)}
          onDeleteCategory={handleDeleteCategory}
        />
      )}

      {/* 編輯彈窗 */}
      <TaskEditorModal
        taskId={editorTaskId}
        groups={groups}
        user={user}
        canGoBack={editorStack.length > 1}
        onClose={handleCloseEditor}
        onSaved={reload}
        onDeleted={reload}
        onNavigateToSubtask={pushTask}
      />

      {/* 行事曆點格子→快速新增任務（預填開始/截止時間） */}
      <QuickCreateTaskModal
        initial={quickCreateInitial}
        groups={groups}
        user={user}
        onClose={() => setQuickCreateInitial(null)}
        onCreated={() => {
          reload();
          setCalendarRefreshKey((k) => k + 1);
        }}
      />
    </div>
  );
}
