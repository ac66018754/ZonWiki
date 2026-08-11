/**
 * 編輯模式的 toggle 摺疊（editor folding）純邏輯。
 *
 * 設計（見 docs/design/測試計畫-編輯模式toggle摺疊.md v2 與 docs/DECISIONS.md）：
 * - textarea 顯示的是「display 文字」：與完整文字相同，但被摺疊的 `:::toggle` 區塊
 *   只剩標頭行＋一枚「徽章」（如 `` ⋯〔已摺疊 3 行 #gk7q〕``），被移除的
 *   「內文＋結尾 :::」原文存在 FoldRecord.hiddenText（React state），不進 DB。
 * - 核心不變式：expandDisplay(display, state) 必須精確還原完整文字；
 *   對外（onChange／存檔）永遠只送展開後的完整文字。
 * - 編輯驗證（validateEdit）：徽章 count 1＝正常；0＝整塊刪除（紀錄移入 graveyard，
 *   undo 讓徽章重現時自動「復活」，堵死孤兒徽章入庫路徑）；0 但 id 殘片仍在＝改壞
 *   徽章 → 拒絕；≥2＝複製 → 拒絕。
 * - 徽章行「只有 id 命中 records（含 graveyard）」才視為已摺疊；未知假徽章＝一般文字。
 * - 所有字串代換以 slice 拼接實作（不用 String.replace 的字串樣板），
 *   避免 hiddenText 內的 `$&` / `` $` `` / `$'` / `$1` 被解義。
 */

import {
  CONTAINER_CLOSE_PATTERN,
  CONTAINER_OPEN_PATTERN,
  FENCE_PATTERN,
  TOGGLE_OPEN_PATTERN,
} from './toggleBlocks';

/**
 * 摺疊紀錄：一個被摺起來的 toggle 區塊。
 */
export interface FoldRecord {
  /** 徽章 id（4 碼，字母集刻意排除十六進位字元，避免與內容中的色碼 `#a3f2` 撞名）。 */
  id: string;
  /** 完整徽章字串（含前導空白），display 中以此原樣出現。 */
  badge: string;
  /** 從 display 移除的原文（含前導換行、含結尾 `:::` 行）；expand 時原樣代換回去。 */
  hiddenText: string;
}

/**
 * 摺疊狀態：現行摺疊＋墓碑（被刪除、可由 undo 復活）。
 */
export interface FoldState {
  /** 現行摺疊紀錄。 */
  records: FoldRecord[];
  /** 墓碑：被使用者刪除的摺疊（元件存續期保留，徽章經 undo 重現時自動復活）。 */
  graveyard: FoldRecord[];
}

/** 空的摺疊狀態（凍結：不可變共用預設值）。 */
export const emptyFoldState: FoldState = Object.freeze({ records: [], graveyard: [] });

/** 徽章 id 字母集：排除十六進位字元（a-f、0/1）與易混淆字（i/l/o/u），避免撞上內容中的 `#hex` 色碼。 */
const ID_ALPHABET = 'ghjkmnpqrstvwxyz23456789';
/** 徽章 id 長度。 */
const ID_LENGTH = 4;

/** 產生一個隨機徽章 id（可被測試注入的產生器取代）。 */
function randomId(): string {
  let out = '';
  for (let i = 0; i < ID_LENGTH; i += 1) {
    out += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
  }
  return out;
}

/**
 * 組出徽章字串（含前導空白，附加在 `:::toggle 標題` 之後）。
 * @param id 徽章 id。
 * @param hiddenLineCount 被摺疊的行數（hiddenText 中的換行數）。
 * @returns 徽章字串。
 */
export function makeBadge(id: string, hiddenLineCount: number): string {
  return ` ⋯〔已摺疊 ${hiddenLineCount} 行 #${id}〕`;
}

/**
 * 位置感知的 toggle 區塊資訊（座標皆為 display 文字上的 char offset）。
 */
export interface EditorToggleBlock {
  /** 標頭行行首。 */
  headerStart: number;
  /** 標頭行內容結尾（行終止符之前；CRLF 時在 `\r` 之前）＝徽章插入點。 */
  headerLineEnd: number;
  /** 摘要標題（不含徽章）。 */
  title: string;
  /** 是否已摺疊（徽章 id 命中 records／graveyard）。 */
  folded: boolean;
  /** 已摺疊時的紀錄 id。 */
  foldId?: string;
  /** 已摺疊時：徽章（含前導空白）起點。 */
  badgeStart?: number;
  /** 已摺疊時：徽章終點（exclusive）。 */
  badgeEnd?: number;
  /** 未摺疊時：整塊結尾（結尾 `:::` 行內容之後、行終止符之前；未閉合＝文末）。 */
  blockEnd?: number;
}

/** 掃描任意徽章樣式（含未知 id 的假徽章），供解析時把徽章從標題文字剝除。 */
const BADGE_SCAN_PATTERN = / ⋯〔已摺疊 \d+ 行 #([a-z0-9]+)〕/;

/** 一行的位置資訊。 */
interface LineInfo {
  /** 行首絕對位置。 */
  start: number;
  /** 行內容結尾（`\n` 與其前的 `\r` 之前）。 */
  contentEnd: number;
  /** 行文字（不含終止符）。 */
  text: string;
}

/** 把文字切成帶絕對位置的行（保留 CRLF 資訊：contentEnd 在 `\r` 之前）。 */
function splitLines(text: string): LineInfo[] {
  const lines: LineInfo[] = [];
  let start = 0;
  for (;;) {
    const nl = text.indexOf('\n', start);
    const end = nl === -1 ? text.length : nl;
    const contentEnd = end > start && text[end - 1] === '\r' ? end - 1 : end;
    lines.push({ start, contentEnd, text: text.slice(start, contentEnd) });
    if (nl === -1) break;
    start = nl + 1;
  }
  return lines;
}

/** 已知 id 集合（records＋graveyard）。 */
function knownIds(state: FoldState): Set<string> {
  const ids = new Set<string>();
  for (const r of state.records) ids.add(r.id);
  for (const r of state.graveyard) ids.add(r.id);
  return ids;
}

/**
 * 解析 display 文字，列出所有 toggle 區塊（含巢狀；已摺疊者只佔標頭一行）。
 * 圍欄語意與 lib/toggleBlocks 的預覽解析一致（共用同組樣式常數）。
 * @param display 顯示文字。
 * @param state 摺疊狀態（判定徽章行是否為已摺疊區塊）。
 * @returns 依標頭位置排序的區塊清單。
 */
export function listToggleBlocks(display: string, state: FoldState): EditorToggleBlock[] {
  const ids = knownIds(state);
  const lines = splitLines(display);
  const blocks: EditorToggleBlock[] = [];
  /** 尚未閉合的容器堆疊（toggle 才有 blockIndex；其他容器為 null）。 */
  const stack: (number | null)[] = [];
  let inFence = false;
  let fenceChar = '';

  for (const line of lines) {
    const trimmed = line.text.trimStart();

    // 程式碼圍欄：圍欄內一律不解析容器語法。
    const fenceMatch = trimmed.match(FENCE_PATTERN);
    if (fenceMatch) {
      if (!inFence) {
        inFence = true;
        fenceChar = fenceMatch[1][0];
      } else if (trimmed.startsWith(fenceChar.repeat(3))) {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;

    // 容器結束行：關掉堆疊最上層；若那是 toggle，補上 blockEnd。
    if (CONTAINER_CLOSE_PATTERN.test(trimmed)) {
      const top = stack.pop();
      if (top != null) blocks[top].blockEnd = line.contentEnd;
      continue;
    }

    const toggleMatch = trimmed.match(TOGGLE_OPEN_PATTERN);
    if (toggleMatch) {
      const rawTitle = toggleMatch[2];
      // 標頭行帶「已知 id」的徽章 → 已摺疊區塊（只佔一行、不推入堆疊、不找結尾）。
      const badgeMatch = line.text.match(BADGE_SCAN_PATTERN);
      if (badgeMatch && badgeMatch.index !== undefined && ids.has(badgeMatch[1])) {
        blocks.push({
          headerStart: line.start,
          headerLineEnd: line.start + badgeMatch.index,
          title: rawTitle.slice(0, Math.max(0, rawTitle.indexOf(' ⋯〔已摺疊'))).trim() || rawTitle.replace(BADGE_SCAN_PATTERN, '').trim(),
          folded: true,
          foldId: badgeMatch[1],
          badgeStart: line.start + badgeMatch.index,
          badgeEnd: line.start + badgeMatch.index + badgeMatch[0].length,
        });
        continue;
      }
      // 一般（未摺疊）toggle 標頭：推入堆疊，等對應的 ::: 收尾。
      blocks.push({
        headerStart: line.start,
        headerLineEnd: line.contentEnd,
        title: rawTitle.trim(),
        folded: false,
      });
      stack.push(blocks.length - 1);
      continue;
    }

    // 其他容器（protect 等）：推 null 佔位，讓深度計數正確。
    if (CONTAINER_OPEN_PATTERN.test(trimmed)) {
      stack.push(null);
    }
  }

  // 未閉合的容器：toggle 的範圍到文末。
  for (const top of stack) {
    if (top != null) blocks[top].blockEnd = display.length;
  }
  return blocks.sort((a, b) => a.headerStart - b.headerStart);
}

/** 以 slice 拼接做「單次代換」（不經 String.replace 的字串樣板，$ 序列安全）。 */
function spliceReplace(text: string, index: number, removeLength: number, insert: string): string {
  return text.slice(0, index) + insert + text.slice(index + removeLength);
}

/** 數 needle 在 haystack 中出現的次數（重疊不計；徽章不可能自我重疊）。 */
function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

/**
 * 產生不與現有內容／紀錄撞名的徽章 id。
 * @param display 顯示文字。
 * @param state 摺疊狀態。
 * @param idGen 可注入的 id 產生器（測試用；預設隨機）。
 */
function generateUniqueId(display: string, state: FoldState, idGen?: () => string): string {
  const gen = idGen ?? randomId;
  const taken = knownIds(state);
  const texts = [display, ...state.records.map((r) => r.hiddenText), ...state.graveyard.map((r) => r.hiddenText)];
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const id = gen();
    if (taken.has(id)) continue;
    const token = `#${id}〕`;
    if (texts.some((t) => t.includes(token))) continue;
    return id;
  }
  // 100 次都撞（理論上不可能）：退回帶時戳字尾的長 id，保證唯一。
  return `${gen()}${ID_ALPHABET[state.records.length % ID_ALPHABET.length]}`;
}

/**
 * 摺疊「標頭行行首＝headerStart」的區塊。
 * @returns 新的 display 與狀態；該處無可摺疊區塊（或已摺疊）時回 null。
 */
export function foldBlockAt(
  display: string,
  state: FoldState,
  headerStart: number,
  idGen?: () => string,
): { display: string; state: FoldState } | null {
  const block = listToggleBlocks(display, state).find((b) => b.headerStart === headerStart);
  if (!block || block.folded || block.blockEnd === undefined) return null;

  const hiddenText = display.slice(block.headerLineEnd, block.blockEnd);
  const hiddenLineCount = countOccurrences(hiddenText, '\n');
  const id = generateUniqueId(display, state, idGen);
  const badge = makeBadge(id, hiddenLineCount);

  const nextDisplay =
    display.slice(0, block.headerLineEnd) + badge + display.slice(block.blockEnd);
  const nextState: FoldState = {
    records: [...state.records, { id, badge, hiddenText }],
    graveyard: state.graveyard,
  };
  return { display: nextDisplay, state: nextState };
}

/**
 * 展開指定 id 的摺疊區塊（徽章代換回 hiddenText）。
 * 徽章不在 display（例如藏在外層摺疊內）時原樣返回、紀錄保留。
 */
export function unfoldBlock(
  display: string,
  state: FoldState,
  foldId: string,
): { display: string; state: FoldState } {
  const record = state.records.find((r) => r.id === foldId);
  if (!record) return { display, state };
  const idx = display.indexOf(record.badge);
  if (idx === -1) return { display, state };
  const nextDisplay = spliceReplace(display, idx, record.badge.length, record.hiddenText);
  return {
    display: nextDisplay,
    state: { records: state.records.filter((r) => r.id !== foldId), graveyard: state.graveyard },
  };
}

/**
 * 摺疊所有可摺疊區塊（由內而外：巢狀時先摺內層，之後展開外層可看到內層仍摺疊）。
 */
export function foldAll(
  display: string,
  state: FoldState,
  idGen?: () => string,
): { display: string; state: FoldState } {
  let cur = { display, state };
  // 每輪挑「標頭位置最後」的未摺疊區塊先摺（內層標頭必在外層之後），直到沒有為止。
  for (;;) {
    const candidates = listToggleBlocks(cur.display, cur.state).filter((b) => !b.folded);
    if (candidates.length === 0) return cur;
    const target = candidates[candidates.length - 1];
    const next = foldBlockAt(cur.display, cur.state, target.headerStart, idGen);
    if (!next) return cur; // 防禦：不可摺（未閉合資訊異常）時停止，避免死迴圈
    cur = next;
  }
}

/**
 * 展開全部（含巢狀：展開外層後露出的內層徽章繼續展開），records 清空。
 */
export function unfoldAll(display: string, state: FoldState): { display: string; state: FoldState } {
  let out = display;
  let records = [...state.records];
  for (;;) {
    let replaced = false;
    for (const r of records) {
      const idx = out.indexOf(r.badge);
      if (idx !== -1) {
        out = spliceReplace(out, idx, r.badge.length, r.hiddenText);
        records = records.filter((x) => x.id !== r.id);
        replaced = true;
        break; // 位置已變，重新掃描
      }
    }
    if (!replaced) break;
  }
  // 剩餘（徽章遍尋不著的）紀錄移入墓碑，保留復活機會、不遺失內容。
  return {
    display: out,
    state: { records: [], graveyard: [...state.graveyard, ...records] },
  };
}

/**
 * 把 display 文字展開成「完整文字」（onChange 對外的唯一出口）。
 * 巢狀徽章（藏在 hiddenText 內）以迭代代換解決；graveyard 不參與展開。
 */
export function expandDisplay(display: string, state: FoldState): string {
  let out = display;
  // 迭代上限＝紀錄數＋1：每輪至少消掉一枚徽章，否則停止（防禦異常狀態）。
  for (let round = 0; round <= state.records.length; round += 1) {
    let replaced = false;
    for (const r of state.records) {
      let idx = out.indexOf(r.badge);
      while (idx !== -1) {
        out = spliceReplace(out, idx, r.badge.length, r.hiddenText);
        replaced = true;
        idx = out.indexOf(r.badge, idx + r.hiddenText.length);
      }
    }
    if (!replaced) break;
  }
  return out;
}

/** 編輯驗證結果。 */
export type EditValidation =
  | {
      ok: true;
      /** 驗證後的新狀態（刪除移入 graveyard、復活移回 records）。 */
      state: FoldState;
      /** 本次被整塊刪除的 fold id。 */
      deletedIds: string[];
      /** 本次由墓碑復活的 fold id。 */
      revivedIds: string[];
    }
  | {
      ok: false;
      /** damaged＝徽章被改壞（id 殘片仍在）；duplicated＝徽章出現 ≥2 份。 */
      reason: 'damaged' | 'duplicated';
    };

/**
 * 驗證一次使用者編輯後的 display 文字。
 * @param newDisplay 編輯後的顯示文字。
 * @param state 編輯前的摺疊狀態。
 */
export function validateEdit(newDisplay: string, state: FoldState): EditValidation {
  // 巢狀 id：徽章藏在「其他」紀錄的 hiddenText 內者（display 不應出現）。
  const all = [...state.records, ...state.graveyard];
  const nestedIds = new Set<string>();
  for (const r of all) {
    for (const other of all) {
      if (other.id !== r.id && other.hiddenText.includes(r.badge)) nestedIds.add(r.id);
    }
  }

  const records: FoldRecord[] = [];
  const graveyard: FoldRecord[] = [];
  const deletedIds: string[] = [];
  const revivedIds: string[] = [];

  for (const r of state.records) {
    const count = countOccurrences(newDisplay, r.badge);
    if (nestedIds.has(r.id)) {
      // 巢狀紀錄：display 不該出現它的徽章；出現＝被複製貼出來。
      if (count > 0) return { ok: false, reason: 'duplicated' };
      records.push(r);
      continue;
    }
    if (count === 1) {
      records.push(r);
    } else if (count === 0) {
      // 徽章整枚消失：殘片還在＝改壞（拒絕）；完全不見＝整塊刪除（進墓碑）。
      // 殘片判定必須綁「徽章包裝樣式」而非裸 `#id` 全文比對——內文可能恰有
      // `#gh23xyz` 這類 hashtag/issue 編號，裸比對會把合法的整塊刪除誤判成
      // damaged、讓使用者永久卡住（對抗式復審 HIGH，已實測重現）。
      // 殘片樣式：① `#id〕`（尾括號還在）② 同一行內「⋯〔已摺疊…#id」（前框還在）。
      // id 字母集僅小寫字母與數字（ID_ALPHABET），直接內插進 RegExp 是安全的。
      const isDamagedRemnant =
        newDisplay.includes(`#${r.id}〕`) ||
        new RegExp(`⋯〔已摺疊[^\\n]*#${r.id}`).test(newDisplay);
      if (isDamagedRemnant) return { ok: false, reason: 'damaged' };
      graveyard.push(r);
      deletedIds.push(r.id);
    } else {
      return { ok: false, reason: 'duplicated' };
    }
  }

  for (const r of state.graveyard) {
    const count = countOccurrences(newDisplay, r.badge);
    if (count === 1 && !nestedIds.has(r.id)) {
      // undo 讓徽章重現 → 復活（隱藏內容完整回歸）。
      records.push(r);
      revivedIds.push(r.id);
    } else if (count >= 2) {
      return { ok: false, reason: 'duplicated' };
    } else {
      graveyard.push(r);
    }
  }

  return { ok: true, state: { records, graveyard }, deletedIds, revivedIds };
}

/** display 中每枚（現行）徽章的位置與展開資訊。 */
interface BadgePosition {
  record: FoldRecord;
  start: number;
  end: number;
  /** hiddenText 完全展開（含巢狀）後的長度。 */
  expandedLength: number;
}

/** 計算 hiddenText「完全展開」後的長度（巢狀徽章遞迴展開）。 */
function fullyExpandedLength(record: FoldRecord, state: FoldState, seen: Set<string>): number {
  if (seen.has(record.id)) return record.hiddenText.length; // 防禦：循環參照（不應發生）
  seen.add(record.id);
  let length = record.hiddenText.length;
  for (const other of state.records) {
    let idx = record.hiddenText.indexOf(other.badge);
    while (idx !== -1) {
      length += fullyExpandedLength(other, state, seen) - other.badge.length;
      idx = record.hiddenText.indexOf(other.badge, idx + other.badge.length);
    }
  }
  return length;
}

/** 找出 display 中所有現行徽章的位置（依位置排序）。 */
function findBadgePositions(display: string, state: FoldState): BadgePosition[] {
  const positions: BadgePosition[] = [];
  for (const r of state.records) {
    let idx = display.indexOf(r.badge);
    while (idx !== -1) {
      positions.push({
        record: r,
        start: idx,
        end: idx + r.badge.length,
        expandedLength: fullyExpandedLength(r, state, new Set()),
      });
      idx = display.indexOf(r.badge, idx + r.badge.length);
    }
  }
  return positions.sort((a, b) => a.start - b.start);
}

/**
 * 把 display 座標的選取範圍映射回「完整文字」座標（供局部排版）。
 * 貼齊徽章前後緣＝允許；嚴格跨入徽章內部＝回 null。
 */
export function mapDisplayRangeToFull(
  display: string,
  state: FoldState,
  start: number,
  end: number,
): { start: number; end: number } | null {
  const positions = findBadgePositions(display, state);
  let deltaStart = 0;
  let deltaEnd = 0;
  for (const p of positions) {
    // 嚴格相交（貼齊邊緣不算）：任一端點落在徽章內部、或範圍完整涵蓋徽章。
    if (start < p.end && end > p.start) return null;
    const delta = p.expandedLength - (p.end - p.start);
    if (p.end <= start) deltaStart += delta;
    if (p.end <= end) deltaEnd += delta;
  }
  return { start: start + deltaStart, end: end + deltaEnd };
}

/**
 * 游標位置與徽章的關係（供編輯器的展開手勢）。
 * @returns inside＝嚴格在徽章內；atStart／atEnd＝貼齊前／後緣；不在任何徽章附近＝null。
 */
export function findBadgeAt(
  display: string,
  state: FoldState,
  pos: number,
): { foldId: string; badgeStart: number; badgeEnd: number; touching: 'inside' | 'atStart' | 'atEnd' } | null {
  for (const p of findBadgePositions(display, state)) {
    if (pos > p.start && pos < p.end) {
      return { foldId: p.record.id, badgeStart: p.start, badgeEnd: p.end, touching: 'inside' };
    }
    if (pos === p.start) return { foldId: p.record.id, badgeStart: p.start, badgeEnd: p.end, touching: 'atStart' };
    if (pos === p.end) return { foldId: p.record.id, badgeStart: p.start, badgeEnd: p.end, touching: 'atEnd' };
  }
  return null;
}
