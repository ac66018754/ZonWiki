/**
 * 本地草稿備份（防停電，2026-08-13 使用者裁示）。
 *
 * 動機：使用者曾長時間編輯未按儲存（想保持歷史乾淨），停電後整篇遺失。
 * localStorage 為「同步」API——寫入即落地，行程被殺（停電/當機/關機）也不遺失，
 * 是瀏覽器端最可靠的斷電保險。
 *
 * 鍵空間：`zw:draft:note:{id}`／`zw:draft:note:new`／`zw:draft:task:{id}`／`zw:draft:task:new`。
 * 已知限制（記於 DECISIONS.md）：同一筆記開兩個分頁同時編輯時草稿互踩（後寫贏）。
 *
 * 防自毀（對抗復審 H5）：呼叫端必須「進入編輯當下先讀走既有草稿」再啟動寫入，
 * 且只在首次「真實使用者輸入」後開始寫——程式化 set（進入編輯、409 重載、AI 覆寫）
 * 不得覆寫草稿。此規範由呼叫端（頁面/彈窗）遵守，本模組僅提供儲存原語。
 */

/** 草稿內容（儲存於 localStorage 的 JSON 形狀）。 */
export interface DraftRecord {
  /** 標題草稿。 */
  title: string;
  /** 內容草稿。 */
  content: string;
  /** 最後寫入時間（ISO 8601）。 */
  savedAt: string;
}

/** 所有草稿鍵的共同前綴（過期清理的掃描範圍）。 */
const DRAFT_KEY_PREFIX = 'zw:draft:';

/** 草稿保存期限：7 天（超過視為陳舊，載入時順手清理）。 */
const DRAFT_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 筆記草稿鍵。
 * @param noteId 筆記 id；null＝新增筆記（尚無 id）。
 * @returns localStorage 鍵。
 */
export function draftKeyForNote(noteId: string | null): string {
  return `${DRAFT_KEY_PREFIX}note:${noteId ?? 'new'}`;
}

/**
 * 任務草稿鍵。
 * @param taskId 任務 id；null＝新增任務。
 * @returns localStorage 鍵。
 */
export function draftKeyForTask(taskId: string | null): string {
  return `${DRAFT_KEY_PREFIX}task:${taskId ?? 'new'}`;
}

/** SSR／無 storage 環境守門（Next.js 伺服端渲染時所有操作靜默略過）。 */
function storageOrNull(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null; // 隱私模式等取用即拋的環境
  }
}

/**
 * 寫入草稿（同步落地）。QuotaExceeded 等寫入失敗靜默略過——
 * 草稿是保險而非主資料，寧可少存也不可干擾編輯。
 *
 * @param key 草稿鍵（draftKeyForNote/draftKeyForTask）。
 * @param draft 標題與內容。
 */
export function saveDraft(key: string, draft: { title: string; content: string }): void {
  const storage = storageOrNull();
  if (!storage) return;
  const record: DraftRecord = { ...draft, savedAt: new Date().toISOString() };
  try {
    storage.setItem(key, JSON.stringify(record));
  } catch {
    // QuotaExceeded／隱私模式：靜默略過（僅開發時可觀察）。
  }
}

/**
 * 讀取草稿；順手清理所有過期（>7 天）或損毀的草稿。
 *
 * @param key 草稿鍵。
 * @returns 草稿；不存在、損毀（移除）或過期時回 null。
 */
export function loadDraft(key: string): DraftRecord | null {
  const storage = storageOrNull();
  if (!storage) return null;

  pruneExpiredDrafts(storage);

  const raw = storage.getItem(key);
  if (raw === null) return null;
  const record = parseDraft(raw);
  if (record === null) {
    try {
      storage.removeItem(key); // 損毀的草稿沒有救援價值，移除避免每次載入都撞
    } catch {
      /* 移除失敗無妨 */
    }
    return null;
  }
  return record;
}

/**
 * 清除草稿（儲存成功／明確放棄時呼叫）。
 * @param key 草稿鍵。
 */
export function clearDraft(key: string): void {
  const storage = storageOrNull();
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    /* 靜默 */
  }
}

/** 解析並驗證草稿 JSON；形狀不符回 null。 */
function parseDraft(raw: string): DraftRecord | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as DraftRecord).title === 'string' &&
      typeof (parsed as DraftRecord).content === 'string' &&
      typeof (parsed as DraftRecord).savedAt === 'string'
    ) {
      return parsed as DraftRecord;
    }
    return null;
  } catch {
    return null;
  }
}

/** 掃描草稿鍵空間，移除過期（>7 天）與無法解析出時間的項目。 */
function pruneExpiredDrafts(storage: Storage): void {
  const now = Date.now();
  const staleKeys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key || !key.startsWith(DRAFT_KEY_PREFIX)) continue;
    const record = parseDraft(storage.getItem(key) ?? '');
    const savedAt = record ? Date.parse(record.savedAt) : NaN;
    if (Number.isNaN(savedAt) || now - savedAt > DRAFT_EXPIRY_MS) {
      staleKeys.push(key); // 邊迭代邊刪會亂序，先收集再刪
    }
  }
  for (const key of staleKeys) {
    try {
      storage.removeItem(key);
    } catch {
      /* 靜默 */
    }
  }
}

/** 具 debounce 的草稿寫入器（見 createDraftWriter）。 */
export interface DraftWriter {
  /** 排程寫入（debounce）；連續呼叫只落地最後一筆。 */
  write: (draft: { title: string; content: string }) => void;
  /** 立即同步落地未寫入的草稿（beforeunload 用——localStorage 同步 API 可靠）。 */
  flush: () => void;
  /** 放棄未寫入的草稿並停止計時（元件卸載/明確放棄用；不清除已落地的草稿）。 */
  cancel: () => void;
}

/**
 * 建立具 debounce 的草稿寫入器：把「每次按鍵都寫 localStorage」節流成
 * 停止輸入 delayMs 後寫一次；flush 供 beforeunload 同步補上最後空窗。
 *
 * @param key 草稿鍵。
 * @param delayMs debounce 時距（預設 800ms——最壞情況停電只損失不到 1 秒輸入）。
 * @returns 寫入器。
 */
export function createDraftWriter(key: string, delayMs = 800): DraftWriter {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { title: string; content: string } | null = null;

  const stopTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    write(draft) {
      pending = draft;
      stopTimer();
      timer = setTimeout(() => {
        timer = null;
        if (pending) {
          saveDraft(key, pending);
          pending = null;
        }
      }, delayMs);
    },
    flush() {
      stopTimer();
      if (pending) {
        saveDraft(key, pending);
        pending = null;
      }
    },
    cancel() {
      stopTimer();
      pending = null;
    },
  };
}
