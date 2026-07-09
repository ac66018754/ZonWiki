"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  TaskCard,
  TaskGroup,
  SubTask,
  CurrentUser,
  NoteTag,
  getTaskCard,
  updateTaskCard,
  listTaskCards,
  deleteTaskCard,
  assignTaskTags,
  listNoteTags,
  createNoteTag,
  createTaskGroup,
  createSubTask,
  updateSubTask,
  reorderSubTasks,
  type UpdateTaskCardPayload,
} from "@/lib/api";
import {
  FALLBACK_TZ,
  STATUS_ORDER,
  STATUS_META,
  PRIORITY_META,
} from "../taskUtils";
import {
  type RecurrenceState,
  type RecurrenceMode,
  type WeekdayCode,
  emptyRecurrence,
  parseRrule,
  buildRrule,
  clampMonthDay,
  WEEKDAY_ORDER,
  WEEKDAY_LABELS,
} from "../recurrence";
import { SubtaskChecklist, isTempSubtaskId } from "./SubtaskChecklist";
import { TaskScheduleFields } from "./TaskScheduleFields";
import { SearchableMultiSelect } from "@/components/SearchableMultiSelect";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { DateTimePicker } from "@/components/DateTimePicker";
import { EntityLinkPopover } from "@/components/EntityLinkPopover";
import { LinkedEntitiesBar } from "@/components/LinkedEntitiesBar";
import { logger } from "@/lib/logger";
import { useConfirm } from "@/components/ConfirmProvider";
import { showToast } from "@/lib/toast";
import { ConflictError } from "@/lib/errors";
import type { LinkEntityType } from "@/lib/api";

/** 連結浮動視窗的開啟狀態（針對某個子任務）。 */
interface LinkPopoverState {
  type: LinkEntityType;
  id: string;
  title: string;
  rect: { top: number; bottom: number; left: number; right: number };
}

/**
 * 任務編輯器（單一彈窗，永遠可編輯）。清單 / 看板 / 行事曆共用。
 *
 * 設計（依使用者要求）：
 * - 不再有「檢視 / 編輯」兩段式；開啟任務即直接是可編輯表單（合併成一個彈窗）。
 * - 版面：標題置頂、其下分兩欄——左欄放所有屬性（狀態 / 優先度 / 分類 / 標籤 /
 *   開始 / 截止 / 父任務 / 子任務 / 關聯），右欄放內容（Markdown 編輯器）。
 * - 子任務本身也是一張任務卡片：可「↗ 開啟」進入該子任務；關閉子任務時回到父任務（由上層 stack 控制）。
 * - **交易式編輯**：所有欄位與子任務變更（含解除父子關係）都只暫存於本彈窗，**唯有按「儲存」才寫入後端**；
 *   關閉 / 返回 / 進入子任務若有未存變更會先詢問，放棄則全部還原（不寫入）。子任務改為受控暫存清單，
 *   存檔時才 diff 出「解除 / 新增 / 改名 / 打勾 / 排序」一次套用。
 */
export function TaskEditorModal({
  taskId,
  groups,
  user,
  canGoBack,
  onClose,
  onSaved,
  onDeleted,
  onNavigateToSubtask,
}: {
  /** 要編輯的卡片 ID；為 null 時不顯示 */
  taskId: string | null;
  /** 可選分類清單 */
  groups: TaskGroup[];
  /** 目前使用者（取時區） */
  user: CurrentUser | null;
  /** 是否可返回上一層（目前在子任務、堆疊中還有父任務） */
  canGoBack: boolean;
  /** 關閉彈窗（在子任務時＝返回父任務） */
  onClose: () => void;
  /** 儲存成功後通知上層刷新 */
  onSaved: () => void;
  /** 刪除成功後通知上層刷新 */
  onDeleted: () => void;
  /** 進入某個子任務（推入導覽堆疊） */
  onNavigateToSubtask: (subtaskId: string) => void;
}) {
  const tz = user?.timeZone || FALLBACK_TZ;
  const confirm = useConfirm();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  // 圖片上傳進行中的數量：>0 時擋「儲存」，避免把「〔圖片上傳中 #xxx〕」佔位文字存進 DB。
  const [uploadingCount, setUploadingCount] = useState(0);
  const [savedFlash, setSavedFlash] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [card, setCard] = useState<TaskCard | null>(null);
  // 子任務關聯浮動視窗（點子任務旁的 🔗 開啟）
  const [linkPopover, setLinkPopover] = useState<LinkPopoverState | null>(null);

  // 表單狀態
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<"todo" | "doing" | "done">("todo");
  const [priority, setPriority] = useState(0);
  const [groupId, setGroupId] = useState<string>("");
  const [plannedIso, setPlannedIso] = useState<string | null>(null);
  const [dueIso, setDueIso] = useState<string | null>(null);
  // 重複規則（#17）：結構化狀態，儲存時組成 RRULE 存入 recurrenceRule。
  const [recurrence, setRecurrence] = useState<RecurrenceState>(emptyRecurrence());
  // 長期任務（#1）：標記 + 粗粒度目標期（"" / "month" / "quarter" / "year" 與其代表日 UTC）。
  const [isLongTerm, setIsLongTerm] = useState(false);
  const [targetGranularity, setTargetGranularity] = useState<string>("");
  const [targetIso, setTargetIso] = useState<string | null>(null);
  // 釘選到首頁（#2）。
  const [isPinnedToHome, setIsPinnedToHome] = useState(false);
  const [subTasks, setSubTasks] = useState<SubTask[]>([]);
  // 父任務（任務之間可有父子關係）。"" = 頂層任務。
  const [parentId, setParentId] = useState<string>("");
  const [parentOptions, setParentOptions] = useState<{ id: string; name: string }[]>([]);

  // 標籤（與筆記共用標籤庫）
  const [tagPool, setTagPool] = useState<NoteTag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);

  // 分類選項（以 props.groups 為底，加入本彈窗就地新增的分類）
  const [localGroups, setLocalGroups] = useState<TaskGroup[]>(groups);
  useEffect(() => {
    setLocalGroups(groups);
  }, [groups]);

  // 是否有未存變更（用於關閉 / 切換子任務前自動存檔）。載入 / 存檔後清為 false。
  const dirtyRef = useRef(false);
  // 樂觀鎖（#4/#34）覆蓋旗標：使用者於衝突時選擇「覆蓋」時設為 true，讓本次保存略過 baseVersion。
  const overwriteRef = useRef(false);
  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    setSavedFlash(false);
    setSaveError(false);
  }, []);

  /** 開啟連結浮動視窗（定位在被點的 🔗 鈕旁）。 */
  const openLinkPopover = (type: LinkEntityType, id: string, t: string, e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setLinkPopover({ type, id, title: t, rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right } });
  };

  /** 以卡片資料填入表單欄位（載入時用）。填完視為「乾淨」。 */
  const populateFields = useCallback((c: TaskCard) => {
    setTitle(c.title);
    setContent(c.content || "");
    setStatus((c.status as "todo" | "doing" | "done") || "todo");
    setPriority(c.priority ?? 0);
    setGroupId(c.groupId || "");
    setPlannedIso(c.plannedDateTime ?? null);
    setDueIso(c.dueDateTime ?? null);
    setRecurrence(parseRrule(c.recurrenceRule));
    setIsLongTerm(!!c.isLongTerm);
    setTargetGranularity(c.targetGranularity || "");
    setTargetIso(c.targetDateTime ?? null);
    setIsPinnedToHome(!!c.isPinnedToHome);
    setSubTasks(c.subTasks || []);
    setSelectedTagIds((c.tags || []).map((t) => t.id));
    setParentId(c.parentId || "");
    dirtyRef.current = false;
  }, []);

  // 開啟 / 切換卡片時載入詳情
  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    setLoading(true);
    setConfirmDelete(false);
    setSavedFlash(false);
    getTaskCard(taskId)
      .then((c) => {
        if (cancelled || !c) return;
        setCard(c);
        populateFields(c);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, populateFields]);

  // 載入共用標籤庫
  useEffect(() => {
    if (!taskId) return;
    listNoteTags()
      .then(setTagPool)
      .catch(() => {});
  }, [taskId]);

  // 載入「可選父任務」清單（排除自己與自己的直接子任務，避免成環）
  useEffect(() => {
    if (!taskId) return;
    listTaskCards()
      .then((all) =>
        setParentOptions(
          all
            .filter((t) => t.id !== taskId && t.parentId !== taskId)
            .map((t) => ({ id: t.id, name: t.title }))
        )
      )
      .catch(() => {});
  }, [taskId]);

  /** 組出更新 payload（區分「設定」與「清空」）。 */
  const buildPayload = useCallback((): UpdateTaskCardPayload => {
    const payload: UpdateTaskCardPayload = {
      title: title.trim(),
      content,
      status,
      priority,
    };
    if (plannedIso) payload.plannedDateTime = plannedIso;
    else payload.clearPlannedDateTime = true;
    if (dueIso) payload.dueDateTime = dueIso;
    else payload.clearDueDateTime = true;
    if (groupId) payload.groupId = groupId;
    else payload.clearGroupId = true;
    if (parentId) payload.parentId = parentId;
    else payload.clearParentId = true;
    // 重複規則（#17）：組成 RRULE；不重複時送空字串＝清為 null（停止重複）。
    payload.recurrenceRule = buildRrule(recurrence) ?? "";
    // 長期任務 + 釘選到首頁（皆送目前值；後端 null＝不更新，故一律明送布林）。
    payload.isLongTerm = isLongTerm;
    payload.isPinnedToHome = isPinnedToHome;
    // 粗粒度目標期：只有「長期 + 有選粒度」才寫入，否則清空。
    if (isLongTerm && targetGranularity) {
      payload.targetGranularity = targetGranularity;
      if (targetIso) payload.targetDateTime = targetIso;
      else payload.clearTargetDateTime = true;
    } else {
      payload.clearTargetGranularity = true;
      payload.clearTargetDateTime = true;
    }
    return payload;
  }, [
    title, content, status, priority, plannedIso, dueIso, groupId, parentId,
    isLongTerm, isPinnedToHome, targetGranularity, targetIso, recurrence,
  ]);

  /**
   * 把子任務的暫存變更 diff 後寫入後端：解除父子關係 / 新增 / 改名 / 打勾 / 排序。
   * original＝載入時的子任務（基準），current＝彈窗內暫存的最新清單。
   */
  const flushSubtasks = useCallback(
    async (original: SubTask[], current: SubTask[], cardId: string) => {
      const origById = new Map(original.map((s) => [s.id, s]));
      const currentRealIds = new Set(
        current.filter((s) => !isTempSubtaskId(s.id)).map((s) => s.id)
      );

      // 1. 解除父子關係（原本是子任務、現在不在清單）→ 變回頂層任務（不刪除）
      for (const o of original) {
        if (!currentRealIds.has(o.id)) await updateTaskCard(o.id, { clearParentId: true });
      }
      // 2. 新增（暫存 id）→ 建立並記錄真實 id
      const tempToReal = new Map<string, string>();
      for (const c of current) {
        if (isTempSubtaskId(c.id) && c.title.trim()) {
          const created = await createSubTask(cardId, c.title.trim());
          // 建立失敗就拋出（而非靜默吞掉，導致新子任務消失或排序錯亂）。
          if (!created) throw new Error(`建立子任務「${c.title.trim()}」失敗`);
          tempToReal.set(c.id, created.id);
        }
      }
      // 3. 既有：改名 / 打勾
      for (const c of current) {
        if (isTempSubtaskId(c.id)) continue;
        const o = origById.get(c.id);
        if (!o) continue;
        const patch: { title?: string; isDone?: boolean } = {};
        const t = c.title.trim();
        if (t && t !== o.title) patch.title = t;
        if (c.isDone !== o.isDone) patch.isDone = c.isDone;
        if (patch.title !== undefined || patch.isDone !== undefined) await updateSubTask(c.id, patch);
      }
      // 4. 排序（用最終實 id 順序；與原本剩餘者順序不同才送）
      const finalIds = current
        .map((c) => (isTempSubtaskId(c.id) ? tempToReal.get(c.id) : c.id))
        .filter((x): x is string => !!x);
      const origRemaining = original.map((o) => o.id).filter((id) => currentRealIds.has(id));
      if (finalIds.length && finalIds.join(",") !== origRemaining.join(",")) {
        await reorderSubTasks(cardId, finalIds);
      }
    },
    []
  );

  /** 實際寫入（卡片欄位 + 標籤 + 子任務暫存變更）。 */
  const doSave = useCallback(async () => {
    if (!taskId || !title.trim()) return;
    // 樂觀鎖（#4/#34）：帶目前卡片版本；overwriteRef=true 時略過（覆蓋、last-write-wins）。
    await updateTaskCard(taskId, {
      ...buildPayload(),
      baseVersion: overwriteRef.current ? undefined : card?.version,
    });
    await assignTaskTags(taskId, selectedTagIds);
    await flushSubtasks(card?.subTasks ?? [], subTasks, taskId);
    dirtyRef.current = false;
    onSaved();
  }, [taskId, title, buildPayload, selectedTagIds, flushSubtasks, card, subTasks, onSaved]);

  /**
   * 點「儲存」：寫入卡片 + 標籤 + 子任務變更。
   * 成功＝重抓最新資料（含標籤名稱、子任務真實 id）續留編輯、顯示「已儲存」。
   * 失敗＝保留使用者目前的編輯與未儲存狀態（dirty 仍 true），顯示錯誤供重試——
   * 不在失敗時重抓，避免 baseline 與仍為暫存 id 的本地清單不一致而在重試時誤刪/重複。
   */
  const handleSave = useCallback(async () => {
    if (!taskId || !title.trim()) return;
    // 防線放在函式本體（非只有按鈕 disabled）：任何呼叫入口都不可在圖片上傳中儲存，
    // 避免把「〔圖片上傳中 #xxx〕」佔位文字永久存進 DB。
    if (uploadingCount > 0) {
      showToast("圖片上傳中，請稍候再儲存", { type: "info" });
      return;
    }
    setSaving(true);
    setSaveError(false);
    try {
      await doSave();
      const fresh = await getTaskCard(taskId);
      if (fresh) {
        setCard(fresh);
        populateFields(fresh);
      }
      setSavedFlash(true);
      // 醒目的小彈窗提示（自動淡出消失，無關閉鈕）
      showToast("任務已儲存", { type: "success" });
    } catch (e) {
      if (e instanceof ConflictError) {
        // 併發衝突（#4/#34）：讓使用者選「重新載入最新版」或「以自己的版本覆蓋」。
        const reload = await confirm({
          title: "任務已被修改",
          message:
            "此任務已被其他來源修改。\n\n" +
            "按「確定」重新載入最新版本（放棄本次修改）；\n" +
            "按「取消」以您目前的內容覆蓋。",
        });
        if (reload) {
          const latest = await getTaskCard(taskId);
          if (latest) {
            setCard(latest);
            populateFields(latest);
          }
          showToast("此任務已被其他來源修改，已載入最新版本", { type: "info" });
        } else {
          // 覆蓋：略過 baseVersion 再存一次。
          overwriteRef.current = true;
          try {
            await doSave();
            const fresh = await getTaskCard(taskId);
            if (fresh) {
              setCard(fresh);
              populateFields(fresh);
            }
            setSavedFlash(true);
            showToast("任務已儲存（已覆蓋）", { type: "success" });
          } finally {
            overwriteRef.current = false;
          }
        }
        return;
      }
      logger.error("儲存任務失敗：", e);
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }, [taskId, title, doSave, populateFields, uploadingCount]);

  /** 有未存變更時詢問是否放棄；回傳 Promise<true>＝可離開。 */
  const confirmDiscardIfDirty = useCallback(async () => {
    if (!dirtyRef.current) return true;
    return confirm({
      title: "放棄未儲存的變更？",
      message:
        "此任務有未儲存的變更，要放棄並離開嗎？\n（包含子任務的新增 / 解除 / 改名 / 排序，未按「儲存」都不會生效。）",
      danger: true,
      confirmLabel: "放棄並離開",
    });
  }, [confirm]);

  /** 關閉（或返回父任務）：未儲存變更一律不寫入；若有變更先確認。 */
  const requestClose = useCallback(async () => {
    if (await confirmDiscardIfDirty()) onClose();
  }, [confirmDiscardIfDirty, onClose]);

  /** 進入子任務：未儲存變更一律不寫入；若有變更先確認，再推入導覽堆疊。 */
  const navigateToSubtask = useCallback(
    async (subtaskId: string) => {
      if (await confirmDiscardIfDirty()) onNavigateToSubtask(subtaskId);
    },
    [confirmDiscardIfDirty, onNavigateToSubtask]
  );

  // Esc 關閉（以 ref 取最新 requestClose，避免過時閉包；只在切換卡片時重掛）
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;
  useEffect(() => {
    if (!taskId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [taskId]);

  const handleDelete = useCallback(async () => {
    if (!taskId) return;
    setSaving(true);
    try {
      await deleteTaskCard(taskId);
      onDeleted();
      onClose(); // 刪除後直接關閉（不存檔）
    } finally {
      setSaving(false);
    }
  }, [taskId, onDeleted, onClose]);

  // 目標期選單/輸入框的共用樣式（重複規則的每月/自訂 RRULE 仍用；長期目標期已抽到 TaskScheduleFields）。
  const ctlStyle: React.CSSProperties = {
    padding: "4px 6px", border: "1px solid var(--border-default)", borderRadius: "var(--radius-sm)",
    background: "var(--bg-surface)", color: "var(--text-primary)", fontSize: "var(--text-sm)",
  };

  if (!taskId) return null;

  return (
    <div
      className="tk-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div className="tk-modal tk-modal--split" role="dialog" aria-modal="true" aria-label="編輯任務">
        {loading || !card ? (
          <div className="tk-modal-loading">載入中…</div>
        ) : (
          <>
            {/* 標題列 */}
            <div className="tk-edit-head">
              {canGoBack && (
                <button
                  className="tk-modal-x"
                  onClick={requestClose}
                  aria-label="返回父任務"
                  title="返回父任務"
                >
                  ←
                </button>
              )}
              <input
                className="tk-modal-title"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  markDirty();
                }}
                placeholder="任務標題"
                autoFocus
              />
              <button className="tk-modal-x" onClick={requestClose} aria-label="關閉" title="關閉">
                ✕
              </button>
            </div>

            {/* 兩欄：左＝屬性、右＝內容 */}
            <div className="tk-edit-body">
              {/* 左欄：屬性 */}
              <div className="tk-edit-meta">
                {/* 首頁釘選 ｜ 長期任務（置於最上方；長期可設粗粒度目標期「月/季/年」，且不列入逾期）。
                    與快速新增共用 TaskScheduleFields，避免兩處走樣。 */}
                <TaskScheduleFields
                  isPinnedToHome={isPinnedToHome}
                  onPinnedChange={(v) => { setIsPinnedToHome(v); markDirty(); }}
                  isLongTerm={isLongTerm}
                  onLongTermChange={(v) => { setIsLongTerm(v); markDirty(); }}
                  targetGranularity={targetGranularity}
                  onGranularityChange={(v) => { setTargetGranularity(v); markDirty(); }}
                  targetIso={targetIso}
                  onTargetIsoChange={(v) => { setTargetIso(v); markDirty(); }}
                />

                {/* 狀態 */}
                <div className="tk-field">
                  <label className="tk-field-label">狀態</label>
                  <div className="tk-seg">
                    {STATUS_ORDER.map((s) => (
                      <button
                        key={s}
                        className={`tk-seg-btn ${status === s ? "tk-seg-btn--on" : ""}`}
                        onClick={() => {
                          setStatus(s);
                          markDirty();
                        }}
                        type="button"
                      >
                        {STATUS_META[s].icon} {STATUS_META[s].label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 優先度 */}
                <div className="tk-field">
                  <label className="tk-field-label">優先度</label>
                  <div className="tk-seg">
                    {PRIORITY_META.map((p, idx) => (
                      <button
                        key={idx}
                        className={`tk-seg-btn ${priority === idx ? "tk-seg-btn--on" : ""}`}
                        onClick={() => {
                          setPriority(idx);
                          markDirty();
                        }}
                        type="button"
                        title={p.label}
                      >
                        {p.dot} {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 分類 */}
                <div className="tk-field">
                  <label className="tk-field-label">分類</label>
                  <SearchableMultiSelect
                    single
                    options={localGroups.map((g) => ({ id: g.id, name: g.name }))}
                    selectedIds={groupId ? [groupId] : []}
                    onChange={(ids) => {
                      setGroupId(ids[0] ?? "");
                      markDirty();
                    }}
                    onCreate={async (name) => {
                      try {
                        const g = await createTaskGroup({ name });
                        if (g) {
                          setLocalGroups((prev) => [...prev, g]);
                          markDirty();
                          return { id: g.id, name: g.name };
                        }
                      } catch {
                        /* 建立失敗：忽略，使用者可重試 */
                      }
                      return null;
                    }}
                    placeholder="搜尋或新增分類…"
                  />
                </div>

                {/* 標籤（與筆記共用標籤庫） */}
                <div className="tk-field">
                  <label className="tk-field-label">標籤</label>
                  <SearchableMultiSelect
                    options={tagPool.map((t) => ({ id: t.id, name: t.name }))}
                    selectedIds={selectedTagIds}
                    onChange={(ids) => {
                      setSelectedTagIds(ids);
                      markDirty();
                    }}
                    onCreate={async (name) => {
                      const existing = tagPool.find((t) => t.name === name);
                      if (existing) return { id: existing.id, name: existing.name };
                      try {
                        const created = await createNoteTag(name);
                        if (created) {
                          setTagPool((prev) => [...prev, created]);
                          markDirty();
                          return { id: created.id, name: created.name };
                        }
                      } catch {
                        /* 409 重名等：忽略 */
                      }
                      return null;
                    }}
                    prefix="#"
                    placeholder="搜尋或新增標籤…（與筆記共用）"
                  />
                </div>

                {/* 開始日期 */}
                <div className="tk-field">
                  <label className="tk-field-label">開始日期</label>
                  <DateTimePicker
                    value={plannedIso}
                    onChange={(v) => {
                      setPlannedIso(v);
                      markDirty();
                    }}
                    tz={tz}
                    ariaLabel="開始日期"
                  />
                </div>

                {/* 截止日期 */}
                <div className="tk-field">
                  <label className="tk-field-label">截止日期</label>
                  <DateTimePicker
                    value={dueIso}
                    onChange={(v) => {
                      setDueIso(v);
                      markDirty();
                    }}
                    tz={tz}
                    ariaLabel="截止日期"
                  />
                </div>

                {/* 重複規則（#17）：不重複／每天／每週選星期／每月選日／自訂 RRULE。
                    儲存後由後端背景服務把到期發生具現化成一張張可打勾的實體任務卡。 */}
                <div className="tk-field">
                  <label className="tk-field-label">重複</label>
                  <div className="tk-seg" style={{ flexWrap: "wrap" }}>
                    {([
                      ["none", "不重複"],
                      ["daily", "每天"],
                      ["weekly", "每週"],
                      ["monthly", "每月"],
                      ["custom", "自訂"],
                    ] as [RecurrenceMode, string][]).map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        className={`tk-seg-btn ${recurrence.mode === mode ? "tk-seg-btn--on" : ""}`}
                        onClick={() => {
                          setRecurrence((prev) => ({ ...prev, mode }));
                          markDirty();
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {/* 每週：選星期（週一起） */}
                  {recurrence.mode === "weekly" && (
                    <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {WEEKDAY_ORDER.map((code: WeekdayCode) => {
                        const on = recurrence.weekdays.includes(code);
                        return (
                          <button
                            key={code}
                            type="button"
                            className={`tk-seg-btn ${on ? "tk-seg-btn--on" : ""}`}
                            style={{ minWidth: 40 }}
                            aria-pressed={on}
                            onClick={() => {
                              setRecurrence((prev) => ({
                                ...prev,
                                weekdays: on
                                  ? prev.weekdays.filter((w) => w !== code)
                                  : [...prev.weekdays, code],
                              }));
                              markDirty();
                            }}
                          >
                            {WEEKDAY_LABELS[code]}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {recurrence.mode === "weekly" && recurrence.weekdays.length === 0 && (
                    <div style={{ marginTop: 4, fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                      未選任何星期＝視同不重複
                    </div>
                  )}

                  {/* 每月：選日（1-31） */}
                  {recurrence.mode === "monthly" && (
                    <div style={{ marginTop: 8, display: "flex", gap: 6, alignItems: "center" }}>
                      <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>每月</span>
                      <select
                        style={ctlStyle}
                        value={recurrence.monthDay}
                        onChange={(e) => {
                          setRecurrence((prev) => ({ ...prev, monthDay: clampMonthDay(Number(e.target.value)) }));
                          markDirty();
                        }}
                        aria-label="每月第幾日"
                      >
                        {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </select>
                      <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>日</span>
                    </div>
                  )}

                  {/* 自訂 RRULE */}
                  {recurrence.mode === "custom" && (
                    <div style={{ marginTop: 8 }}>
                      <input
                        type="text"
                        style={{ ...ctlStyle, width: "100%", fontFamily: "var(--font-mono, monospace)" }}
                        value={recurrence.custom}
                        onChange={(e) => {
                          setRecurrence((prev) => ({ ...prev, custom: e.target.value }));
                          markDirty();
                        }}
                        placeholder="FREQ=WEEKLY;INTERVAL=2;BYDAY=MO"
                        aria-label="自訂 RRULE"
                      />
                      <div style={{ marginTop: 4, fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                        iCal RRULE 格式；支援 FREQ／INTERVAL／BYDAY／BYMONTHDAY／COUNT／UNTIL
                      </div>
                    </div>
                  )}

                  {recurrence.mode !== "none" && (
                    <div style={{ marginTop: 6, fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                      需設定「開始日期」作為重複的起算時間；到期發生會自動產生為可打勾的任務。
                    </div>
                  )}
                </div>

                {/* 父任務 */}
                <div className="tk-field">
                  <label className="tk-field-label">父任務</label>
                  <SearchableMultiSelect
                    single
                    options={parentOptions}
                    selectedIds={parentId ? [parentId] : []}
                    onChange={(ids) => {
                      setParentId(ids[0] ?? "");
                      markDirty();
                    }}
                    placeholder="搜尋要當父任務的任務（留空＝頂層任務）…"
                  />
                </div>

                {/* 子任務（key=taskId：切換卡片時重置內部狀態） */}
                <SubtaskChecklist
                  key={taskId}
                  items={subTasks}
                  onChange={(next) => {
                    setSubTasks(next);
                    markDirty();
                  }}
                  onOpenSubtask={navigateToSubtask}
                  onLinkSubtask={(id, t, e) => openLinkPopover("taskcard", id, t, e)}
                />

                {/* 關聯（連到筆記 / 開問啦節點 / 其他任務 / 外部網址；不弄丟既有關聯） */}
                <div className="tk-field">
                  <label className="tk-field-label">關聯</label>
                  <LinkedEntitiesBar type="taskcard" id={taskId} sourceTitle={title} label="🔗" />
                </div>
              </div>

              {/* 右欄：內容 */}
              <div className="tk-edit-content">
                <label className="tk-field-label">內容（Markdown）</label>
                <MarkdownEditor
                  value={content}
                  onChange={(v) => {
                    setContent(v);
                    markDirty();
                  }}
                  minHeight={360}
                  withPreview
                  placeholder="補充說明…（可用上方工具列套用 Markdown 格式；右上可切換 編輯／並排／預覽，或彈出獨立預覽視窗）"
                  onUploadingChange={setUploadingCount}
                />
              </div>
            </div>

            {/* 底部操作 */}
            <div className="tk-modal-actions">
              {!confirmDelete ? (
                <button className="tk-btn tk-btn--danger" onClick={() => setConfirmDelete(true)} disabled={saving}>
                  刪除
                </button>
              ) : (
                <button className="tk-btn tk-btn--danger-solid" onClick={handleDelete} disabled={saving}>
                  確認刪除
                </button>
              )}
              <div style={{ flex: 1 }} />
              {saveError && !saving && (
                <span style={{ fontSize: "var(--text-xs)", color: "var(--status-danger-fg)" }}>儲存失敗，請重試</span>
              )}
              {savedFlash && !saving && (
                <span style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>已儲存</span>
              )}
              <button
                className="tk-btn tk-btn--primary"
                onClick={handleSave}
                disabled={!title.trim() || saving || uploadingCount > 0}
                title={uploadingCount > 0 ? "圖片上傳中，請稍候…" : undefined}
              >
                {saving ? "儲存中…" : uploadingCount > 0 ? "圖片上傳中…" : "儲存"}
              </button>
            </div>
          </>
        )}

        {/* 子任務關聯浮動視窗 */}
        {linkPopover && (
          <EntityLinkPopover
            sourceType={linkPopover.type}
            sourceId={linkPopover.id}
            sourceTitle={linkPopover.title}
            rect={linkPopover.rect}
            onClose={() => setLinkPopover(null)}
          />
        )}
      </div>
    </div>
  );
}
