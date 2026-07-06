/**
 * API 領域模組 — 任務（Task）。
 *
 * 涵蓋任務群組、任務卡片、子任務（檢核清單）、任務關聯，以及筆記與任務的連結。
 */

import { ConflictError } from "../errors";
import { fetchJson } from "./client";

// ============================================================================
// 資料型別 — Task (任務)
// ============================================================================

/**
 * 任務卡片
 */
export interface TaskCard {
  /** 任務 ID */
  id: string;
  /** 標題 */
  title: string;
  /** 內容 (Markdown) */
  content?: string;
  /** 狀態 (todo|doing|done) */
  status: string;
  /** 優先級 (0-3) */
  priority?: number;
  /** 計畫完成時間 (UTC, 可選) */
  plannedDateTime?: string | null;
  /** 截止時間 (UTC, 可選) */
  dueDateTime?: string | null;
  /** 所屬群組 ID */
  groupId?: string | null;
  /** 排序序號 */
  sortOrder?: number;
  /** 重複規則 (iCal RRULE) */
  recurrenceRule?: string | null;
  /** 父任務 ID（null = 頂層任務；非 null = 某任務的子任務）。#8：子任務＝有父任務的任務 */
  parentId?: string | null;
  /** 子任務總數 (清單/看板卡片顯示進度用) */
  subTaskTotal?: number;
  /** 已完成的子任務數 */
  subTaskDone?: number;
  /** 子任務清單 (清單/看板卡片在外層直接顯示，詳情也會帶回) */
  subTasks?: SubTask[];
  /** 標籤 (與筆記共用標籤庫；清單與詳情都會帶回) */
  tags?: { id: string; name: string }[];
  /** 是否為長期任務（true＝不強制截止日、不列入逾期） */
  isLongTerm?: boolean;
  /** 粗粒度目標期的代表日（UTC，可空）；搭配 targetGranularity 解讀（存該月/季/年起始日） */
  targetDateTime?: string | null;
  /** 目標期粒度："month" | "quarter" | "year"；null＝未設粗粒度目標 */
  targetGranularity?: string | null;
  /** 是否釘選到首頁「我的任務」區塊 */
  isPinnedToHome?: boolean;
  /** 首頁釘選區排序序號（越小越前） */
  homeSortOrder?: number;
  /** 建立時間 (UTC) */
  createdDateTime: string;
  /** 更新時間 (UTC) */
  updatedDateTime: string;
  /** 樂觀鎖版本（PostgreSQL xmin，#4/#34）；保存時原封帶回為 baseVersion 供後端偵測併發衝突 */
  version?: number;
}

/**
 * 子任務（任務卡片底下的檢核清單項目）
 */
export interface SubTask {
  /** 子任務 ID */
  id: string;
  /** 所屬任務卡片 ID */
  taskCardId: string;
  /** 標題 */
  title: string;
  /** 是否已完成 */
  isDone: boolean;
  /** 卡片內排序序號 */
  sortOrder: number;
  /** 建立時間 (UTC ISO 字串) */
  createdDateTime?: string;
  /** 完成時間 (UTC ISO 字串；未完成為 null) */
  completedDateTime?: string | null;
}

/**
 * 任務群組（前端以「分類」呈現：用來把任務分到工作/SideProject/研究等情境）
 */
export interface TaskGroup {
  /** 群組（分類）ID */
  id: string;
  /** 名稱 */
  name: string;
  /** 顏色標籤 (可選，HEX 值) */
  color?: string;
  /** 該分類中的任務數 */
  taskCount: number;
}

// ============================================================================
// API 方法 — Task (任務)
// ============================================================================

/**
 * 列出任務群組
 */
export async function listTaskGroups(): Promise<TaskGroup[]> {
  const r = await fetchJson<TaskGroup[]>("/api/task-groups");
  return r.data ?? [];
}

/**
 * 建立任務群組
 */
export async function createTaskGroup(payload: {
  name: string;
  color?: string;
}): Promise<TaskGroup | null> {
  const r = await fetchJson<TaskGroup>("/api/task-groups", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return r.data ?? null;
}

/**
 * 更新任務群組
 */
export async function updateTaskGroup(
  id: string,
  payload: Partial<TaskGroup>
): Promise<TaskGroup | null> {
  const r = await fetchJson<TaskGroup>(`/api/task-groups/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  return r.data ?? null;
}

/**
 * 刪除任務群組
 */
export async function deleteTaskGroup(id: string): Promise<boolean> {
  const r = await fetchJson(`/api/task-groups/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return r.success;
}

/**
 * 列出任務卡片
 */
export async function listTaskCards(params?: {
  groupId?: string;
  status?: "todo" | "doing" | "done";
}): Promise<TaskCard[]> {
  const query = new URLSearchParams();
  if (params?.groupId) query.append("groupId", params.groupId);
  if (params?.status) query.append("status", params.status);

  const path = `/api/tasks${query.toString() ? `?${query.toString()}` : ""}`;
  const r = await fetchJson<TaskCard[]>(path);
  return r.data ?? [];
}

/**
 * 取得單張任務卡片詳情（含內容與子任務清單）。
 */
export async function getTaskCard(id: string): Promise<TaskCard | null> {
  const r = await fetchJson<TaskCard>(`/api/tasks/${encodeURIComponent(id)}`);
  return r.data ?? null;
}

/**
 * 建立任務卡片
 */
export async function createTaskCard(payload: {
  title: string;
  content?: string;
  status?: "todo" | "doing" | "done";
  priority?: number;
  groupId?: string;
  plannedDateTime?: string | null;
  dueDateTime?: string | null;
  /** 重複規則（iCal RRULE；不重複時省略或傳空字串） */
  recurrenceRule?: string | null;
  /** 父任務 ID（建立為某任務的子任務時帶入） */
  parentId?: string | null;
  /** 是否為長期任務 */
  isLongTerm?: boolean;
  /** 粗粒度目標期代表日（UTC） */
  targetDateTime?: string | null;
  /** 目標期粒度："month" | "quarter" | "year" */
  targetGranularity?: string | null;
  /** 是否釘選到首頁 */
  isPinnedToHome?: boolean;
}): Promise<TaskCard | null> {
  const r = await fetchJson<TaskCard>("/api/tasks", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return r.data ?? null;
}

/**
 * 更新任務卡片的請求酬載。
 * 日期/分類欄位：傳值＝設定；對應的 clearXxx=true＝清空為 null；兩者皆不傳＝維持原值。
 */
export interface UpdateTaskCardPayload {
  title?: string;
  content?: string;
  status?: "todo" | "doing" | "done";
  priority?: number;
  groupId?: string;
  plannedDateTime?: string;
  dueDateTime?: string;
  sortOrder?: number;
  /** 重複規則（iCal RRULE）；傳空字串＝停止重複（清為 null）；不傳＝不更新 */
  recurrenceRule?: string;
  /** 父任務 ID（設定父子關係）；改為頂層任務請用 clearParentId */
  parentId?: string | null;
  /** 是否為長期任務（null/未傳＝不更新） */
  isLongTerm?: boolean;
  /** 粗粒度目標期代表日（UTC）；清空請用 clearTargetDateTime */
  targetDateTime?: string;
  /** 目標期粒度："month" | "quarter" | "year"；清空請用 clearTargetGranularity */
  targetGranularity?: string;
  /** 是否釘選到首頁（未傳＝不更新） */
  isPinnedToHome?: boolean;
  /** 首頁排序序號（未傳＝不更新） */
  homeSortOrder?: number;
  clearPlannedDateTime?: boolean;
  clearDueDateTime?: boolean;
  clearGroupId?: boolean;
  clearParentId?: boolean;
  /** 清空粗粒度目標期代表日 */
  clearTargetDateTime?: boolean;
  /** 清空目標期粒度 */
  clearTargetGranularity?: boolean;
  /** 樂觀鎖 baseVersion（#4/#34）：帶值時後端比對 xmin，衝突丟 ConflictError；不帶＝last-write-wins */
  baseVersion?: number;
}

/**
 * 更新任務卡片
 */
export async function updateTaskCard(
  id: string,
  payload: UpdateTaskCardPayload
): Promise<TaskCard | null> {
  const r = await fetchJson<TaskCard>(`/api/tasks/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  // 樂觀鎖衝突（#4/#34）：轉成 ConflictError 讓呼叫端提示「覆蓋或重新載入」。
  // 只有帶 baseVersion 的編輯保存會走到這裡；快速欄位更新（拖曳狀態/日期）不帶版本，不受影響。
  if (!r.success && r.statusCode === 409) {
    throw new ConflictError(r.error ?? undefined);
  }
  return r.data ?? null;
}

/**
 * 刪除任務卡片
 */
export async function deleteTaskCard(id: string): Promise<boolean> {
  const r = await fetchJson(`/api/tasks/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return r.success;
}

/**
 * 設定任務卡片的標籤（整組取代；與筆記共用標籤庫）。
 * 標籤本身的建立/列出沿用筆記的 createNoteTag / listNoteTags。
 */
export async function assignTaskTags(
  taskId: string,
  tagIds: string[]
): Promise<boolean> {
  const r = await fetchJson(`/api/tasks/${encodeURIComponent(taskId)}/tags`, {
    method: "PUT",
    body: JSON.stringify(tagIds),
  });
  return r.success;
}

// ============================================================================
// API 方法 — SubTask (子任務 / 檢核清單)
// ============================================================================

/**
 * 列出某張卡片底下的子任務（依排序）。
 */
export async function listSubTasks(taskId: string): Promise<SubTask[]> {
  const r = await fetchJson<SubTask[]>(
    `/api/tasks/${encodeURIComponent(taskId)}/subtasks`
  );
  return r.data ?? [];
}

/**
 * 在某張卡片底下新增子任務（自動排到最後）。
 */
export async function createSubTask(
  taskId: string,
  title: string
): Promise<SubTask | null> {
  const r = await fetchJson<SubTask>(
    `/api/tasks/${encodeURIComponent(taskId)}/subtasks`,
    { method: "POST", body: JSON.stringify({ title }) }
  );
  return r.data ?? null;
}

/**
 * 更新子任務（標題 / 完成狀態 / 排序，皆選擇性）。
 */
export async function updateSubTask(
  id: string,
  payload: { title?: string; isDone?: boolean; sortOrder?: number }
): Promise<SubTask | null> {
  const r = await fetchJson<SubTask>(`/api/subtasks/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  return r.data ?? null;
}

/**
 * 刪除子任務（軟刪除）。
 */
export async function deleteSubTask(id: string): Promise<boolean> {
  const r = await fetchJson(`/api/subtasks/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return r.success;
}

/**
 * 重新排序某張卡片底下的子任務。
 */
export async function reorderSubTasks(
  taskId: string,
  orderedIds: string[]
): Promise<boolean> {
  const r = await fetchJson(
    `/api/tasks/${encodeURIComponent(taskId)}/subtasks/reorder`,
    { method: "PUT", body: JSON.stringify({ orderedIds }) }
  );
  return r.success;
}

// ============================================================================
// 資料型別 — Task Relations (任務關聯)
// ============================================================================

/**
 * 任務關聯（卡片間的關係）
 */
export interface TaskRelation {
  /** 關聯 ID */
  id: string;
  /** 來源任務 ID */
  sourceTaskId: string;
  /** 目標任務 ID */
  targetTaskId: string;
  /** 關聯類型 (depends|blocks|relates|subtask) */
  relationType: "depends" | "blocks" | "relates" | "subtask";
  /** 建立時間 (UTC) */
  createdDateTime: string;
}

// ============================================================================
// API 方法 — Task Relations (任務關聯)
// ============================================================================

/**
 * 列出任務的所有關聯（入站和出站）
 */
export async function listTaskRelations(taskId: string): Promise<TaskRelation[]> {
  const r = await fetchJson<TaskRelation[]>(
    `/api/tasks/${encodeURIComponent(taskId)}/relations`
  );
  return r.data ?? [];
}

/**
 * 建立任務關聯
 */
export async function createTaskRelation(payload: {
  sourceTaskId: string;
  targetTaskId: string;
  relationType: "depends" | "blocks" | "relates" | "subtask";
}): Promise<TaskRelation | null> {
  const r = await fetchJson<TaskRelation>("/api/task-relations", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return r.data ?? null;
}

/**
 * 刪除任務關聯
 */
export async function deleteTaskRelation(id: string): Promise<boolean> {
  const r = await fetchJson(`/api/task-relations/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return r.success;
}

// ============================================================================
// API 方法 — Note-Task Links (筆記與任務的連結)
// ============================================================================

/**
 * 列出筆記連結的任務
 */
export async function listNoteTaskLinks(noteId: string): Promise<TaskCard[]> {
  const r = await fetchJson<TaskCard[]>(
    `/api/notes/${encodeURIComponent(noteId)}/tasks`
  );
  return r.data ?? [];
}

/**
 * 建立筆記與任務的連結
 */
export async function createNoteTaskLink(
  noteId: string,
  taskId: string
): Promise<boolean> {
  const r = await fetchJson(
    `/api/notes/${encodeURIComponent(noteId)}/tasks`,
    {
      method: "POST",
      body: JSON.stringify({ taskId }),
    }
  );
  return r.success;
}

/**
 * 移除筆記與任務的連結
 */
export async function deleteNoteTaskLink(
  noteId: string,
  taskId: string
): Promise<boolean> {
  const r = await fetchJson(
    `/api/notes/${encodeURIComponent(noteId)}/tasks/${encodeURIComponent(taskId)}`,
    {
      method: "DELETE",
    }
  );
  return r.success;
}
