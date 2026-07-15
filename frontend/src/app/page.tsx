"use client";

import { useCallback, useEffect, useState } from "react";
import {
  updateTaskCard,
  updateSubTask,
  createCapture,
  deleteCapture,
  type CurrentUser,
  type TaskCard,
  type TaskGroup,
} from "@/lib/api";
import { useCurrentUser, useHomePage, useTaskCards, useTaskGroups } from "@/lib/swr";
import { QuickLinksSection } from "@/components/QuickLinksSection";
import { AiActivitySection } from "@/components/AiActivitySection";
import { TimeTrackingSection } from "@/components/TimeTrackingSection";
import { RefineInputSection } from "@/components/RefineInputSection";
import { CaptureFilingModal } from "@/components/CaptureFilingModal";
import { TaskListView } from "@/app/tasks/components/TaskListView";
import { TaskEditorModal } from "@/app/tasks/components/TaskEditorModal";
import { QuickCreateTaskModal } from "@/app/tasks/components/QuickCreateTaskModal";
import { NoteCreateModal } from "@/components/NoteCreateModal";
import { formatTargetPeriod, isTaskOverdue } from "@/app/tasks/taskUtils";
import {
  formatDateTime as formatDateTimeUtil,
  formatDate as formatDateUtil,
  getDayName as getDayNameUtil,
} from "@/lib/formatters";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import { SkeletonCard, SkeletonListItem } from "@/components/Skeleton";
import { useConfirm } from "@/components/ConfirmProvider";

// 注意：formatDateTime、formatDate、getDayName 函數已移至 lib/formatters.ts
// 這裡使用包裝版本，以確保使用用戶時區

/**
 * Web Speech API 類型定義
 */
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  length: number;
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface WindowWithSpeechRecognition extends Window {
  webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  SpeechRecognition?: new () => SpeechRecognitionInstance;
}

interface HomePageClientProps {
  user: CurrentUser | null;
}

/**
 * 首頁客戶端元件
 *
 * 包含：
 * - 本週行程（週視圖精簡版；預設展開今日，列出當天任務直立卡片）
 * - 常用連結卡（可快速新增/刪除）
 * - 快速捕捉（打字或錄音）
 */
export function HomePageClient({ user }: HomePageClientProps) {
  // 客戶端快取（SWR）：首頁聚合資料切走再回來直接吃快取、瞬間顯示。
  // data 無樂觀更新（新增/刪除捕捉後一律重抓），故直接使用 SWR 資料。
  const { data, isLoading: loading, mutate: mutateHome } = useHomePage();
  const confirm = useConfirm();
  const [error, setError] = useState<string | null>(null);

  // 首頁「快速操作列」狀態：精煉/快速記錄是否展開、新增任務/筆記彈窗是否開啟。
  const [showRefine, setShowRefine] = useState(false);
  const [showCapture, setShowCapture] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [newNoteOpen, setNewNoteOpen] = useState(false);

  // 快速捕捉狀態
  const [captureInput, setCaptureInput] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);

  // 錄音相關
  const [recognition, setRecognition] = useState<
    SpeechRecognitionInstance | null
  >(null);

  // 捕捉分流彈窗（點最近記錄開啟）
  const [filingCapture, setFilingCapture] = useState<{ id: string; rawContent: string } | null>(null);

  // 本週行程：目前展開查看內容的日期（yyyy-MM-dd）；預設＝今天（與日格的 dayStr 同樣以 ISO 日期為鍵）
  const [expandedDay, setExpandedDay] = useState<string | null>(
    () => new Date().toISOString().split("T")[0]
  );
  // 展開面板用「完整任務」（含子任務）以重用日程規劃的卡片＋編輯；故另抓 listTaskCards/Groups
  // allTasks 有樂觀更新（勾選/子任務）故保留本地、由 SWR seed；taskGroups 直接吃 SWR。
  // 與「日程規劃」頁共用同一組 SWR 快取（task-cards / task-groups），切頁不重抓。
  const { data: allTasksData, mutate: mutateAllTasks } = useTaskCards();
  const { data: taskGroupsData, mutate: mutateTaskGroups } = useTaskGroups();
  const taskGroups: TaskGroup[] = taskGroupsData ?? [];
  const [allTasks, setAllTasks] = useState<TaskCard[]>([]);
  useEffect(() => {
    // 以 SWR 快取 seed 本地樂觀狀態：allTasksData 參考穩定（僅在實際重抓時才變動），
    // 故不會造成無限重渲染；這是「外部資料源 → 本地可樂觀更新副本」的刻意同步。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (allTasksData) setAllTasks(allTasksData);
  }, [allTasksData]);
  const [collapsedTaskIds, setCollapsedTaskIds] = useState<Set<string>>(new Set());
  // 編輯彈窗導覽堆疊：進入子任務時 push、關閉時 pop（關閉子任務即回到父任務）。
  const [editorStack, setEditorStack] = useState<string[]>([]);
  const editorTaskId = editorStack.length ? editorStack[editorStack.length - 1] : null;
  const openTask = useCallback((id: string) => setEditorStack([id]), []);
  const pushTask = useCallback((id: string) => setEditorStack((prev) => [...prev, id]), []);

  /** 重新整理展開面板用的完整任務清單與分類（撤銷 SWR 快取並重抓）。SWR 掛載時會自動抓取。 */
  const reloadTasks = useCallback(() => {
    mutateAllTasks();
    mutateTaskGroups();
  }, [mutateAllTasks, mutateTaskGroups]);

  // 點子任務標題會派發 zonwiki:open-task → 開啟該子任務；彈窗已開則 push（關閉會回到上層）。
  useEffect(() => {
    const onOpenTask = (e: Event) => {
      const id = (e as CustomEvent<{ taskId: string }>).detail?.taskId;
      if (id) setEditorStack((prev) => (prev.length ? [...prev, id] : [id]));
    };
    window.addEventListener("zonwiki:open-task", onOpenTask);
    return () => window.removeEventListener("zonwiki:open-task", onOpenTask);
  }, []);

  /** 勾選完成：樂觀更新且「不消失」（卡片留著，只變完成樣式）；失敗回滾。 */
  const handleTaskToggleDone = useCallback(async (task: TaskCard) => {
    const nextStatus = task.status === "done" ? "todo" : "done";
    let snapshot: TaskCard[] | null = null;
    setAllTasks((prev) => {
      snapshot = prev;
      return prev.map((t) => (t.id === task.id ? { ...t, status: nextStatus } : t));
    });
    try {
      await updateTaskCard(task.id, { status: nextStatus });
      mutateAllTasks(); // 同步 SWR 快取
    } catch {
      if (snapshot) setAllTasks(snapshot);
    }
  }, [mutateAllTasks]);

  /** 子任務打勾：樂觀更新（只動該子任務），失敗只回滾該子任務。 */
  const handleSubtaskToggle = useCallback(
    async (taskId: string, subtaskId: string, nextDone: boolean) => {
      const apply = (done: boolean) => (prev: TaskCard[]) =>
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
      setAllTasks(apply(nextDone));
      try {
        await updateSubTask(subtaskId, { isDone: nextDone });
        mutateAllTasks(); // 同步 SWR 快取
      } catch {
        setAllTasks(apply(!nextDone));
      }
    },
    [mutateAllTasks]
  );

  const handleToggleCollapse = useCallback((taskId: string) => {
    setCollapsedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  // 重新載入首頁聚合資料（常用連結/捕捉變更後呼叫）：撤銷 SWR 快取並重抓
  const reloadHome = useCallback(() => {
    mutateHome();
  }, [mutateHome]);

  // 刪除最近記錄（軟刪，進垃圾桶）
  const handleDeleteCapture = useCallback(
    async (id: string) => {
      if (!(await confirm({ message: "刪除這則快速記錄？（會進垃圾桶，可還原）", danger: true }))) return;
      try {
        await deleteCapture(id);
        await reloadHome();
      } catch {
        setError("無法刪除記錄，請稍後重試。");
      }
    },
    [reloadHome]
  );

  // 初始化 Web Speech API
  useEffect(() => {
    if (typeof window === "undefined") return;

    const win = window as WindowWithSpeechRecognition;
    const SpeechRecognitionAPI =
      win.webkitSpeechRecognition || win.SpeechRecognition;

    if (SpeechRecognitionAPI) {
      const rec = new SpeechRecognitionAPI();
      rec.lang = "zh-Hant-TW";
      rec.continuous = false;
      rec.interimResults = false;

      rec.onstart = () => {
        setIsRecording(true);
        setRecordingTime(0);
      };

      rec.onresult = (event: SpeechRecognitionEvent) => {
        let transcript = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        setCaptureInput(transcript);
      };

      rec.onerror = () => {
        setIsRecording(false);
      };

      rec.onend = () => {
        setIsRecording(false);
      };

      setRecognition(rec);
    }
  }, []);

  // 錄音計時器
  useEffect(() => {
    if (!isRecording) return;

    const timer = setInterval(() => {
      setRecordingTime((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [isRecording]);

  // 開始/停止錄音
  const handleToggleRecording = () => {
    if (!recognition) {
      setError("您的瀏覽器不支援語音辨識");
      return;
    }

    if (isRecording) {
      recognition.stop();
    } else {
      setCaptureInput("");
      recognition.start();
    }
  };

  // 提交快速捕捉
  const handleCaptureSubmit = async () => {
    if (!captureInput.trim()) return;

    try {
      await createCapture({
        source: isRecording ? "voice" : "text",
        rawContent: captureInput,
      });
      setCaptureInput("");
      setRecordingTime(0);

      // 重新載入首頁資料（撤銷 SWR 快取並重抓）
      mutateHome();
    } catch {
      setError("無法保存快速捕捉，請稍後重試。");
    }
  };

  /**
   * 時區感知的日期時間格式化
   */
  const userTimeZone = user?.timeZone || DEFAULT_TIMEZONE;
  const formatDateTime = (dateStr: string) =>
    formatDateTimeUtil(dateStr, userTimeZone);
  const formatDate = (dateStr: string) =>
    formatDateUtil(dateStr, userTimeZone);
  const getDayName = (dateStr: string) =>
    getDayNameUtil(dateStr, userTimeZone);

  if (loading) {
    return (
      <div className="home-page">
        <div className="home-page__container">
          {/* 標題 */}
          <div style={{ marginBottom: "var(--spacing-8)" }}>
            <SkeletonCard />
          </div>

          {/* 當週日曆骨架 */}
          <section className="home-section">
            <div style={{ marginBottom: "var(--spacing-4)" }}>
              <SkeletonCard />
            </div>
          </section>

          {/* 常用連結骨架 */}
          <section className="home-section">
            <div style={{ marginBottom: "var(--spacing-4)" }}>
              <SkeletonCard />
            </div>
            <SkeletonListItem />
          </section>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="home-page">
        <div className="home-page__container">
          <div
            style={{
              padding: "var(--spacing-6)",
              background: "var(--status-danger-bg)",
              color: "var(--status-danger-fg)",
              borderRadius: "var(--radius-lg)",
              textAlign: "center",
            }}
            role="alert"
          >
            <p style={{ margin: 0, fontWeight: 500 }}>{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="home-page">
        <div className="home-page__container">
          <div
            style={{
              padding: "var(--spacing-6)",
              textAlign: "center",
              color: "var(--text-secondary)",
            }}
          >
            <p style={{ margin: 0 }}>無法載入首頁資料</p>
          </div>
        </div>
      </div>
    );
  }

  // 後端回傳的 startDate 為 UTC 日期字串
  // 使用 setUTCDate() 確保在 UTC 時區的日期計算，避免本地時區導致的偏差
  const weekStart = new Date(data.weeklyCalendar.startDate);
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(weekStart);
    day.setUTCDate(weekStart.getUTCDate() + i);
    return day;
  });

  return (
    <div className="home-page">
      <div className="home-page__container">
        {/* 歡迎標題 */}
        <div style={{ marginBottom: "var(--spacing-6)" }}>
          <h1
            style={{
              fontSize: "var(--text-3xl)",
              fontWeight: 700,
              margin: 0,
              marginBottom: "var(--spacing-2)",
            }}
          >
            你好，{user?.displayName || "朋友"}！
          </h1>
          <p
            style={{
              fontSize: "var(--text-base)",
              color: "var(--text-secondary)",
              margin: 0,
            }}
          >
            這是你的個人知識與任務中心。
          </p>
        </div>

        {/* 當週日曆 */}
        <section className="home-section">
          <h2
            style={{
              fontSize: "var(--text-lg)",
              fontWeight: 600,
              margin: 0,
              marginBottom: "var(--spacing-4)",
            }}
          >
            本週行程
          </h2>

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(120px, 1fr))",
              gap: "var(--spacing-3)",
              marginBottom: "var(--spacing-4)",
            }}
          >
            {weekDays.map((day, idx) => {
              const dayStr = day.toISOString().split("T")[0];
              const dayTasks = data.weeklyCalendar.tasks.filter(
                (t) =>
                  (t.plannedDateTime &&
                    t.plannedDateTime.split("T")[0] === dayStr) ||
                  (t.dueDateTime && t.dueDateTime.split("T")[0] === dayStr)
              );
              const dayJournals = data.weeklyCalendar.journalNotes.filter(
                (j) =>
                  j.updatedDateTime &&
                  j.updatedDateTime.split("T")[0] === dayStr
              );
              const hasContent = dayTasks.length > 0 || dayJournals.length > 0;
              const isExpanded = expandedDay === dayStr;

              return (
                <div
                  key={idx}
                  onClick={() => setExpandedDay(isExpanded ? null : dayStr)}
                  title="點擊展開查看當日任務內容"
                  style={{
                    padding: "var(--spacing-3)",
                    background: isExpanded
                      ? "var(--action-secondary-bg)"
                      : "var(--bg-surface)",
                    borderRadius: "var(--radius-lg)",
                    border: isExpanded
                      ? "2px solid var(--action-primary-bg)"
                      : hasContent
                        ? "2px solid var(--action-secondary-bg)"
                        : "1px solid var(--border-default)",
                    textAlign: "center",
                    transition: "all 0.2s ease",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.boxShadow =
                      "var(--shadow-md)";
                    e.currentTarget.style.transform =
                      "translateY(-2px)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.boxShadow = "none";
                    e.currentTarget.style.transform = "translateY(0)";
                  }}
                >
                  <div
                    style={{
                      fontSize: "var(--text-xs)",
                      fontWeight: 600,
                      color: "var(--text-secondary)",
                      textTransform: "uppercase",
                      marginBottom: "var(--spacing-1)",
                      letterSpacing: "0.05em",
                    }}
                  >
                    {getDayName(day.toISOString())}
                  </div>
                  <div
                    style={{
                      fontSize: "var(--text-lg)",
                      fontWeight: 700,
                      color: "var(--text-primary)",
                      marginBottom: "var(--spacing-2)",
                    }}
                  >
                    {formatDate(day.toISOString())}
                  </div>
                  {hasContent && (
                    <div
                      style={{
                        fontSize: "var(--text-xs)",
                        color: "var(--text-tertiary)",
                      }}
                    >
                      {dayTasks.length > 0 && (
                        <span>🎯 {dayTasks.length}</span>
                      )}
                      {dayJournals.length > 0 && (
                        <span>
                          {dayTasks.length > 0 ? " • " : ""}
                          📝 {dayJournals.length}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 展開查看：點某一天後，列出當天的任務（含內容）與日記 */}
          {expandedDay && (() => {
            // 展開面板用「完整任務」（含子任務）→ 重用日程規劃的直立卡片＋編輯＋打勾。
            // 與日格相同：以 ISO 日期字串比對 planned/due，確保「今日」對得上格子。
            const dayTasks = allTasks.filter(
              (t) =>
                (t.plannedDateTime && t.plannedDateTime.split("T")[0] === expandedDay) ||
                (t.dueDateTime && t.dueDateTime.split("T")[0] === expandedDay)
            );
            const dayJournals = data.weeklyCalendar.journalNotes.filter(
              (j) => j.updatedDateTime && j.updatedDateTime.split("T")[0] === expandedDay
            );
            return (
              <div
                style={{
                  padding: "var(--spacing-4)",
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border-default)",
                  borderRadius: "var(--radius-lg)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: "var(--spacing-3)",
                  }}
                >
                  <h3 style={{ margin: 0, fontSize: "var(--text-base)", fontWeight: 600 }}>
                    {formatDate(`${expandedDay}T00:00:00.000Z`)}（{getDayName(`${expandedDay}T00:00:00.000Z`)}）
                  </h3>
                  <button
                    onClick={() => setExpandedDay(null)}
                    aria-label="收合"
                    title="收合"
                    style={{
                      border: "1px solid var(--border-default)",
                      borderRadius: "var(--radius-sm)",
                      background: "var(--bg-default)",
                      color: "var(--text-secondary)",
                      cursor: "pointer",
                      padding: "0 var(--spacing-2)",
                      lineHeight: 1.6,
                    }}
                  >
                    ✕
                  </button>
                </div>

                {/* 任務：直立卡片（重用日程規劃）；點卡片編輯、左側打勾完成但卡片不消失 */}
                {dayTasks.length > 0 ? (
                  <TaskListView
                    tasks={dayTasks}
                    groups={taskGroups}
                    sortBy="plannedDate"
                    grouped={false}
                    user={user}
                    collapsedTaskIds={collapsedTaskIds}
                    onOpen={openTask}
                    onToggleDone={handleTaskToggleDone}
                    onToggleCollapse={handleToggleCollapse}
                    onToggleSubtask={handleSubtaskToggle}
                  />
                ) : (
                  <p style={{ margin: 0, color: "var(--text-tertiary)", fontSize: "var(--text-sm)" }}>
                    這天沒有任務。
                  </p>
                )}

                {/* 日記 */}
                {dayJournals.length > 0 && (
                  <div style={{ display: "grid", gap: "var(--spacing-2)", marginTop: "var(--spacing-3)" }}>
                    {dayJournals.map((j) => (
                      <div
                        key={j.id}
                        style={{
                          padding: "var(--spacing-3)",
                          background: "var(--bg-default)",
                          border: "1px solid var(--border-default)",
                          borderRadius: "var(--radius-md)",
                          fontSize: "var(--text-sm)",
                          color: "var(--text-secondary)",
                        }}
                      >
                        📝 {j.title || "（無標題日記）"}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </section>

        {/* 快速操作列（在「我的任務」之上）：待辦/筆記直接開彈窗；精煉/快速記錄點了才展開區塊。 */}
        <div
          style={{
            display: "flex",
            gap: "var(--spacing-2)",
            flexWrap: "wrap",
            marginBottom: "var(--spacing-5)",
          }}
        >
          <button className="home-quickbtn" onClick={() => setNewTaskOpen(true)} title="快速新增待辦">
            ＋ 待辦
          </button>
          <button className="home-quickbtn" onClick={() => setNewNoteOpen(true)} title="快速新增筆記">
            ＋ 筆記
          </button>
          <button
            className={`home-quickbtn ${showRefine ? "home-quickbtn--on" : ""}`}
            onClick={() => setShowRefine((v) => !v)}
            aria-expanded={showRefine}
            title="精煉成筆記（貼連結或上傳影音 → AI 整理成分類筆記）"
          >
            ✨ 精煉成筆記
          </button>
          <button
            className={`home-quickbtn ${showCapture ? "home-quickbtn--on" : ""}`}
            onClick={() => setShowCapture((v) => !v)}
            aria-expanded={showCapture}
            title="快速記錄（打字或錄音速記）"
          >
            ⚡ 快速記錄
          </button>
        </div>

        {/* 我的任務（釘選到首頁的任務；可在任務編輯彈窗或這裡取消釘選） */}
        {(data.pinnedTasks?.length ?? 0) > 0 && (
          <section className="home-section">
            <h2
              style={{
                fontSize: "var(--text-lg)",
                fontWeight: 600,
                margin: 0,
                marginBottom: "var(--spacing-4)",
              }}
            >
              📌 我的任務
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-2)" }}>
              {(data.pinnedTasks ?? []).map((task) => {
                const done = task.status === "done";
                const overdue = !done && isTaskOverdue(task);
                const target = formatTargetPeriod(task.targetDateTime, task.targetGranularity);
                return (
                  <div
                    key={task.id}
                    onClick={() => openTask(task.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--spacing-3)",
                      padding: "var(--spacing-3)",
                      background: "var(--bg-surface)",
                      border: "1px solid var(--border-default)",
                      borderRadius: "var(--radius-md)",
                      cursor: "pointer",
                    }}
                  >
                    <span style={{ fontSize: "var(--text-base)" }}>{done ? "✅" : "📌"}</span>
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontWeight: 500,
                        color: "var(--text-primary)",
                        textDecoration: done ? "line-through" : "none",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {task.title}
                    </span>
                    {task.isLongTerm && (
                      <span
                        className="tk-chip"
                        style={{
                          background: "var(--action-secondary-bg)",
                          color: "var(--action-secondary-fg)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        ♾️ 長期{target ? `・${target}` : ""}
                      </span>
                    )}
                    {task.dueDateTime && (
                      <span
                        style={{
                          fontSize: "var(--text-xs)",
                          color: overdue ? "var(--status-danger-fg)" : "var(--text-tertiary)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        ⏰ {formatDateTimeUtil(task.dueDateTime, userTimeZone)}
                        {overdue ? "（逾期）" : ""}
                      </span>
                    )}
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        await updateTaskCard(task.id, { isPinnedToHome: false });
                        reloadHome();
                      }}
                      title="取消釘選"
                      style={{
                        border: "none",
                        background: "transparent",
                        cursor: "pointer",
                        color: "var(--text-tertiary)",
                        fontSize: "var(--text-xs)",
                        flexShrink: 0,
                      }}
                    >
                      ✕ 取消釘選
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* 時間追蹤：記錄每天把時間花在什麼上面（可收合；iOS 捷徑亦可操作同一批資料） */}
        <TimeTrackingSection />

        {/* 常用連結卡（分類 + 共用標籤） */}
        <QuickLinksSection links={data.quickLinks} onChanged={reloadHome} />

        {/* 精煉成筆記：點上方「✨ 精煉成筆記」按鈕才展開（貼連結或上傳影音 → AI 整理成分類筆記） */}
        {showRefine && <RefineInputSection />}

        {/* AI 最近動作（外部 AI 透過 MCP/權杖對知識庫做的 CRUD 軌跡） */}
        <AiActivitySection />

        {/* 快速捕捉：點上方「⚡ 快速記錄」按鈕才展開 */}
        {showCapture && (
        <section className="home-section">
          <h2
            style={{
              fontSize: "var(--text-lg)",
              fontWeight: 600,
              margin: 0,
              marginBottom: "var(--spacing-4)",
            }}
          >
            快速記錄
          </h2>

          <div
            style={{
              padding: "var(--spacing-4)",
              background: "var(--bg-surface)",
              borderRadius: "var(--radius-lg)",
              border: "1px solid var(--border-default)",
              marginBottom: "var(--spacing-3)",
            }}
          >
            {/* 輸入欄位 */}
            <textarea
              value={captureInput}
              onChange={(e) => setCaptureInput(e.target.value)}
              placeholder={
                recognition
                  ? "輸入文字或使用下方按鈕錄音..."
                  : "輸入想法或筆記..."
              }
              style={{
                width: "100%",
                minHeight: "100px",
                padding: "var(--spacing-3)",
                fontSize: "var(--text-base)",
                border: "1px solid var(--border-default)",
                borderRadius: "var(--radius-md)",
                fontFamily: "var(--font-body)",
                resize: "vertical",
                marginBottom: "var(--spacing-3)",
              }}
              disabled={isRecording}
            />

            {/* 錄音中狀態 */}
            {isRecording && (
              <div
                style={{
                  padding: "var(--spacing-3)",
                  background: "var(--status-warning-bg)",
                  color: "var(--status-warning-fg)",
                  borderRadius: "var(--radius-md)",
                  marginBottom: "var(--spacing-3)",
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--spacing-2)",
                  fontSize: "var(--text-sm)",
                  fontWeight: 500,
                }}
              >
                <span style={{ fontSize: "var(--text-base)" }}>
                  🎤
                </span>
                <span>錄音中... {recordingTime}秒</span>
              </div>
            )}

            {/* 按鈕 */}
            <div
              style={{
                display: "flex",
                gap: "var(--spacing-2)",
                justifyContent: "flex-end",
                flexWrap: "wrap",
              }}
            >
              {recognition && (
                <button
                  onClick={handleToggleRecording}
                  style={{
                    padding: "var(--spacing-2) var(--spacing-4)",
                    fontSize: "var(--text-sm)",
                    fontWeight: 500,
                    border: "1px solid var(--border-default)",
                    background: isRecording
                      ? "var(--status-danger-bg)"
                      : "var(--bg-surface)",
                    color: isRecording
                      ? "var(--status-danger-fg)"
                      : "var(--text-primary)",
                    borderRadius: "var(--radius-md)",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor =
                      "var(--status-danger-fg)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor =
                      "var(--border-default)";
                  }}
                >
                  {isRecording ? "⏹ 停止錄音" : "🎤 開始錄音"}
                </button>
              )}
              <button
                onClick={handleCaptureSubmit}
                className="btn-primary"
                style={{ fontSize: "var(--text-sm)" }}
                disabled={!captureInput.trim()}
              >
                💾 保存
              </button>
            </div>
          </div>

          {/* 最近捕捉 */}
          {data.recentCaptures.length > 0 && (
            <div>
              <h3
                style={{
                  fontSize: "var(--text-sm)",
                  fontWeight: 600,
                  color: "var(--text-secondary)",
                  margin: "0 0 var(--spacing-3) 0",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                最近記錄
              </h3>
              <div
                style={{
                  display: "grid",
                  gap: "var(--spacing-2)",
                }}
              >
                {data.recentCaptures.map((capture) => (
                  <div
                    key={capture.id}
                    onClick={() =>
                      setFilingCapture({ id: capture.id, rawContent: capture.rawContent })
                    }
                    title="點擊分流：新增筆記 / Todo，或查看過去新增的"
                    style={{
                      position: "relative",
                      padding: "var(--spacing-3)",
                      paddingRight: "var(--spacing-8)",
                      background: "var(--bg-surface)",
                      borderRadius: "var(--radius-md)",
                      border: "1px solid var(--border-default)",
                      fontSize: "var(--text-sm)",
                      cursor: "pointer",
                      transition: "border-color 0.15s ease, box-shadow 0.15s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = "var(--border-strong)";
                      e.currentTarget.style.boxShadow = "var(--shadow-sm)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = "var(--border-default)";
                      e.currentTarget.style.boxShadow = "none";
                    }}
                  >
                    <div
                      style={{
                        marginBottom: "var(--spacing-1)",
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--spacing-2)",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "var(--text-lg)",
                        }}
                      >
                        {capture.source === "voice"
                          ? "🎙️"
                          : capture.source === "web"
                            ? "🌐"
                            : "✏️"}
                      </span>
                      <span
                        style={{
                          fontSize: "var(--text-xs)",
                          color: "var(--text-tertiary)",
                        }}
                      >
                        {formatDateTime(capture.createdDateTime)}
                      </span>
                    </div>
                    <div
                      style={{
                        color: "var(--text-secondary)",
                        wordBreak: "break-word",
                        maxHeight: "80px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {capture.rawContent}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteCapture(capture.id);
                      }}
                      aria-label="刪除這則記錄"
                      title="刪除"
                      style={{
                        position: "absolute",
                        top: "var(--spacing-2)",
                        right: "var(--spacing-2)",
                        width: "24px",
                        height: "24px",
                        border: "1px solid var(--border-default)",
                        borderRadius: "var(--radius-sm)",
                        background: "var(--bg-surface)",
                        color: "var(--text-tertiary)",
                        fontSize: "var(--text-xs)",
                        lineHeight: 1,
                        cursor: "pointer",
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
        )}
      </div>

      {/* 捕捉分流彈窗（點最近記錄開啟：上 1/3 原文、下 2/3 新增筆記/Todo + 過去衍生清單） */}
      <CaptureFilingModal
        capture={filingCapture}
        onClose={() => setFilingCapture(null)}
        onChanged={reloadHome}
      />

      {/* 快速新增待辦 / 筆記彈窗（由上方「快速操作列」的「＋ 待辦」「＋ 筆記」開啟） */}
      <QuickCreateTaskModal
        initial={newTaskOpen ? { plannedDateTime: null, dueDateTime: null } : null}
        groups={taskGroups}
        user={user}
        onClose={() => setNewTaskOpen(false)}
        onCreated={() => {
          setNewTaskOpen(false);
          reloadHome();
          reloadTasks();
        }}
      />
      <NoteCreateModal
        open={newNoteOpen}
        onClose={() => setNewNoteOpen(false)}
        onCreated={() => {
          setNewNoteOpen(false);
          reloadHome();
        }}
      />

      {/* 任務檢視/編輯彈窗（首頁本週行程的卡片點擊開啟）；關閉後重抓任務以同步變更 */}
      <TaskEditorModal
        taskId={editorTaskId}
        groups={taskGroups}
        user={user}
        canGoBack={editorStack.length > 1}
        onClose={() => {
          setEditorStack((prev) => prev.slice(0, -1));
          reloadTasks();
          reloadHome(); // 同步本週行程聚合（任務日期/狀態可能在彈窗內改過）
        }}
        onSaved={reloadTasks}
        onDeleted={reloadTasks}
        onNavigateToSubtask={pushTask}
      />

    </div>
  );
}

/**
 * 首頁伺服器端包裝器——獲取用戶資訊後傳給客戶端
 */
export default function HomePage() {
  // 使用者資訊改用 SWR 快取（與其他頁共用 'me' 快取，切頁不重抓）。
  const { data: user, isLoading: userLoading } = useCurrentUser();

  if (userLoading) {
    return (
      <div className="home-page">
        <div className="home-page__container">
          <div
            style={{
              padding: "var(--spacing-6)",
              textAlign: "center",
              color: "var(--text-secondary)",
            }}
          >
            <p style={{ margin: 0 }}>載入中...</p>
          </div>
        </div>
      </div>
    );
  }

  return <HomePageClient user={user ?? null} />;
}
