/**
 * noteNav 純邏輯 spec（前端無 runner，改用零相依 Node 測試）。
 *
 * 為什麼這樣測：本工作包不引入 jest/vitest（YAGNI，見計畫 §0）。noteNav.ts 無任何 import、
 * 只依賴瀏覽器全域 sessionStorage／URL，故可用 TypeScript 編譯器把「真正的原始碼」即時轉譯成
 * JS 後，在 Node 內以「stub 過的 sessionStorage」實跑，驗證返回堆疊與脈絡切點邏輯（設計書 §7.2/§7.3）。
 *
 * 執行：Node 20 PATH 之後 `node frontend/scripts/noteNav.spec.mjs`（cwd 需在 frontend/，才能解析 typescript）。
 */

import ts from "typescript";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const noteNavPath = resolve(here, "../src/lib/noteNav.ts");

// ── 把真正的 noteNav.ts 即時轉譯成 ESM JS ────────────────────────────────
const source = readFileSync(noteNavPath, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;

// ── stub 瀏覽器全域：sessionStorage（記憶體版）＋ window.location.origin ──────────
class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setItem(key, value) {
    this.map.set(key, String(value));
  }
  removeItem(key) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
}
globalThis.sessionStorage = new MemoryStorage();
// window.location.origin：markNoteContextSwitch 正規化相對路徑時需要一個 base。
globalThis.window = { location: { origin: "https://zonwiki.example.com" } };

const noteNav = await import("data:text/javascript," + encodeURIComponent(transpiled));
const {
  recordNoteNav,
  getNoteBackTarget,
  markNoteContextSwitch,
  markBackNavigation,
  recordRecentCategory,
  getRecentCategoryId,
} = noteNav;

const STACK_KEY = "zonwiki:note-nav-stack";

// ── 迷你斷言框架 ────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
/**
 * 深度相等斷言（JSON 比對，足以覆蓋字串/陣列/物件）。
 */
function assertEqual(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}\n        expected ${e}\n        actual   ${a}`);
  }
}
/** 重置所有堆疊/紀錄，讓每條測試互相隔離。 */
function reset() {
  sessionStorage.clear();
}
/** 直接讀目前堆疊（測試輔助）。 */
function stack() {
  const raw = sessionStorage.getItem(STACK_KEY);
  return raw ? JSON.parse(raw) : [];
}
/** 直接設定堆疊（Arrange 用）。 */
function setStack(arr) {
  sessionStorage.setItem(STACK_KEY, JSON.stringify(arr));
}

console.log("noteNav spec:");

// 1. recordNoteNav 新頁前進即推入
reset();
recordNoteNav("/notes/a");
assertEqual("1 recordNoteNav 新頁前進即推入", stack(), ["/notes/a"]);

// 2.（修 audit HIGH #1）recordNoteNav 前進到「已在堆疊中的頁」且無返回標記 → move-to-top，
//    保留來時脈絡（不再一律截斷；舊版一律截斷正是「重訪吃掉分類脈絡」bug 的根源）。
reset();
setStack(["/notes/a", "/notes/b", "/notes/c"]);
recordNoteNav("/notes/a");
assertEqual(
  "2 無返回標記再訪＝move-to-top（保留 b/c）",
  stack(),
  ["/notes/b", "/notes/c", "/notes/a"]
);

// 3. getNoteBackTarget 有上一項回上一項
reset();
setStack(["/notes?categoryId=X", "/notes/a"]);
assertEqual(
  "3 getNoteBackTarget 有上一項回上一項",
  getNoteBackTarget("/notes/a"),
  "/notes?categoryId=X"
);

// 4. getNoteBackTarget 堆疊起點回 null
reset();
setStack(["/notes/a"]);
assertEqual("4 getNoteBackTarget 堆疊起點回 null", getNoteBackTarget("/notes/a"), null);

// 5. markNoteContextSwitch 截斷為單筆（ASCII slug）
reset();
setStack(["/notes?categoryId=X", "/notes/a"]);
markNoteContextSwitch("/notes/b");
assertEqual("5 markNoteContextSwitch 截斷為單筆", stack(), ["/notes/b"]);
assertEqual("5b 截斷後 getNoteBackTarget 回 null", getNoteBackTarget("/notes/b"), null);

// 6. recordRecentCategory / getRecentCategoryId 往返
reset();
recordRecentCategory("cat-1");
assertEqual("6 recordRecentCategory/getRecentCategoryId 往返", getRecentCategoryId(), "cat-1");

// 7. getRecentCategoryId 未設回 null
reset();
assertEqual("7 getRecentCategoryId 未設回 null", getRecentCategoryId(), null);

// 8.（審查 MEDIUM #2）中文 slug（需 percent-encode）：markNoteContextSwitch 存入的字串必須與
//    筆記詳情頁 recordNoteNav(window.location.pathname + search) 實際算出的「已編碼」字串同形，
//    否則詳情頁會再 push 一筆、返回跳回舊筆記（設計書 §7.2 洞 2 復發）。
reset();
setStack(["/notes?categoryId=X", "/notes/%E8%88%8A%E7%AD%86%E8%A8%98"]); // 舊筆記（已編碼）
// 搜尋結果 URL 為後端未編碼形式（SearchEndpoints.cs:121 = $"/notes/{Slug}"）
markNoteContextSwitch("/notes/中文筆記");
const encoded = "/notes/" + encodeURIComponent("中文筆記");
assertEqual("8 中文 slug 截斷成單筆（已正規化為編碼形）", stack(), [encoded]);
// 模擬詳情頁抵達時的 recordNoteNav（瀏覽器 location.pathname 一律為編碼形）
recordNoteNav(encoded);
assertEqual("8b 詳情頁 recordNoteNav 同形→維持單筆（不 push 第二筆）", stack(), [encoded]);
assertEqual("8c 返回不回舊筆記（getNoteBackTarget 回 null→走 3a/b/c）", getNoteBackTarget(encoded), null);

// ── 修 audit HIGH #1：返回標記（markBackNavigation）驅動「截斷 vs 前進」的分歧 ──────────────

// ①（監工實測 bug）C→N：N 已在堆疊、從分類頁 C 前進點入 N（無返回標記）→ N move-to-top、C 保留；
//    在 N 按返回 → 標記 C 為返回目標 → 抵達 C 時截斷成單筆。舊版會在點 N 時就把 C 截掉、返回錯回 /notes。
reset();
setStack(["/notes/n"]); // N 曾造訪
recordNoteNav("/notes?categoryId=c"); // 到分類頁 C（前進）
assertEqual("① C 前進後堆疊", stack(), ["/notes/n", "/notes?categoryId=c"]);
recordNoteNav("/notes/n"); // 從 C 點入曾造訪的 N（前進，無返回標記）
assertEqual("① C→N move-to-top（C 保留於前）", stack(), ["/notes?categoryId=c", "/notes/n"]);
assertEqual("① 在 N 的返回目標＝C", getNoteBackTarget("/notes/n"), "/notes?categoryId=c");
markBackNavigation("/notes?categoryId=c"); // 返回鈕：導頁前立標記
recordNoteNav("/notes?categoryId=c"); // 抵達 C（有返回標記）→ 截斷
assertEqual("① 返回抵達 C 後截斷成單筆", stack(), ["/notes?categoryId=c"]);

// ② N1→N2→按返回回 N1（截斷語意仍正確）：有返回標記 → 截斷到 N1。
reset();
setStack(["/notes/n1"]);
recordNoteNav("/notes/n2"); // 前進
assertEqual("② N1→N2 前進堆疊", stack(), ["/notes/n1", "/notes/n2"]);
markBackNavigation("/notes/n1");
recordNoteNav("/notes/n1"); // 返回 N1（有標記）→ 截斷
assertEqual("② N2 返回 N1 截斷成單筆", stack(), ["/notes/n1"]);

// ③ 連續 back 鏈 A→B→C→back→back 回 A：每一步都用標記驅動截斷。
reset();
recordNoteNav("/notes/a");
recordNoteNav("/notes/b");
recordNoteNav("/notes/c");
assertEqual("③ A→B→C 前進堆疊", stack(), ["/notes/a", "/notes/b", "/notes/c"]);
assertEqual("③ 在 C 的返回目標＝B", getNoteBackTarget("/notes/c"), "/notes/b");
markBackNavigation("/notes/b");
recordNoteNav("/notes/b"); // back 一次 → 抵達 B
assertEqual("③ 第一次 back 抵達 B 截斷", stack(), ["/notes/a", "/notes/b"]);
assertEqual("③ 在 B 的返回目標＝A", getNoteBackTarget("/notes/b"), "/notes/a");
markBackNavigation("/notes/a");
recordNoteNav("/notes/a"); // 再 back 一次 → 抵達 A
assertEqual("③ 第二次 back 抵達 A 截斷成單筆", stack(), ["/notes/a"]);

// ④ 返回標記的一次性：讀後即清——同一頁再訪（無新標記）回到 move-to-top 語意，不誤截斷。
reset();
setStack(["/notes/a", "/notes/b"]);
markBackNavigation("/notes/a");
recordNoteNav("/notes/a"); // 消費標記 → 截斷
assertEqual("④ 標記消費一次→截斷", stack(), ["/notes/a"]);
setStack(["/notes/a", "/notes/b"]); // 重佈同樣情境，但這次「不」立標記
recordNoteNav("/notes/a"); // 標記已被清 → 前進 move-to-top，不截斷
assertEqual("④ 標記已清→再訪為 move-to-top", stack(), ["/notes/b", "/notes/a"]);

// ⑤ markBackNavigation 對中文 slug 正規化（未編碼→編碼形），與 recordNoteNav 抵達的瀏覽器編碼形相符 → 截斷成功。
reset();
const cnEncoded = "/notes/" + encodeURIComponent("研究筆記");
setStack([cnEncoded, "/notes/x"]);
markBackNavigation("/notes/研究筆記"); // 未編碼形（如來自後端）
recordNoteNav(cnEncoded); // 瀏覽器一律以編碼形抵達
assertEqual("⑤ 中文返回目標正規化後命中截斷", stack(), [cnEncoded]);

console.log(`\nnoteNav spec: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
