/**
 * shapes.ts 純幾何函式 spec（零相依 Node 測試，慣例見 noteNav.spec.mjs）。
 *
 * 涵蓋本次新增的純函式（對應需求 B/C 與畫記收合 bug 修復）：
 * - scaleShape：調整中狀態的滾輪縮放（以外接框中心等比縮放）
 * - shapeAnchorPoint：形狀的「錨定代表點」（決定它跟哪段內文一起收合）
 * - eraseVisibleOnly：被 toggle 收合隱藏的形狀不得被局部/框選橡皮擦誤擦
 * - normalizeShapes 回歸：line + opacity（螢光筆直線）的持久化格式不得遺失
 *
 * 執行：Node 20 PATH 之後 `node scripts/drawGeometry.spec.mjs`（cwd 需在 frontend/）。
 */

import ts from "typescript";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const shapesPath = resolve(here, "../src/lib/drawing/shapes.ts");

const source = readFileSync(shapesPath, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;

const mod = await import("data:text/javascript," + encodeURIComponent(transpiled));
const { scaleShape, shapeAnchorPoint, eraseVisibleOnly, normalizeShapes, eraseInBox } = mod;

// ── 迷你斷言框架 ────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
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
function assertTrue(name, cond, detail = "") {
  if (cond) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
  }
}
/** 兩點列是否幾乎相等（誤差 <1e-6）。 */
function pointsAlmostEqual(a, b) {
  if (a.length !== b.length) return false;
  return a.every((p, i) => Math.abs(p[0] - b[i][0]) < 1e-6 && Math.abs(p[1] - b[i][1]) < 1e-6);
}

const rect = { type: "rect", color: "#f00", width: 3, dash: false, points: [[10, 20], [30, 60]] };
const line = { type: "line", color: "#f00", width: 16, dash: false, opacity: 0.4, points: [[0, 0], [100, 40]] };
const free = { type: "free", color: "#f00", width: 3, dash: false, points: [[0, 0], [10, 5], [20, 0], [30, 5], [40, 0]] };

console.log("drawGeometry spec:");

// ── scaleShape ──
{
  assertTrue("1 scaleShape 存在", typeof scaleShape === "function");
  const s2 = scaleShape(rect, 2);
  // rect 外接框中心 (20,40)：(10,20)→(0,0)、(30,60)→(40,80)
  assertEqual("1a rect 以中心 2 倍縮放", s2.points, [[0, 0], [40, 80]]);
  assertTrue("1b 原形狀不可被改動（不可變）", JSON.stringify(rect.points) === JSON.stringify([[10, 20], [30, 60]]));
  const identity = scaleShape(free, 1);
  assertTrue("1c factor=1 座標不變", pointsAlmostEqual(identity.points, free.points));
  const roundtrip = scaleShape(scaleShape(line, 2), 0.5);
  assertTrue("1d 2 倍再 0.5 倍可逆", pointsAlmostEqual(roundtrip.points, line.points));
  assertTrue("1e 非點欄位保留（color/width/opacity）", s2.color === "#f00" && s2.width === 3 && scaleShape(line, 2).opacity === 0.4);
}

// ── shapeAnchorPoint ──
{
  assertTrue("2 shapeAnchorPoint 存在", typeof shapeAnchorPoint === "function");
  assertEqual("2a free → 點列中位點", shapeAnchorPoint(free), [20, 0]);
  assertEqual("2b line → 兩端中點", shapeAnchorPoint(line), [50, 20]);
  assertEqual("2c rect → 外接框中心", shapeAnchorPoint(rect), [20, 40]);
  const ell = { ...rect, type: "ellipse" };
  assertEqual("2d ellipse → 外接框中心", shapeAnchorPoint(ell), [20, 40]);
  const empty = { type: "free", color: "#f00", width: 3, points: [] };
  assertEqual("2e 空點列 → null（無錨點＝永遠顯示）", shapeAnchorPoint(empty), null);
}

// ── eraseVisibleOnly：隱藏形狀不受橡皮擦影響、順序保留 ──
{
  assertTrue("3 eraseVisibleOnly 存在", typeof eraseVisibleOnly === "function");
  const hiddenRect = { ...rect }; // 假設它被 toggle 收合隱藏
  const visibleLine = { ...line };
  const list = [hiddenRect, visibleLine];
  // 框選擦除整個畫面 → 只有可見的 line 被擦掉，隱藏的 rect 原樣保留
  const next = eraseVisibleOnly(list, (s) => s === hiddenRect, (sub) => eraseInBox(sub, -1000, -1000, 1000, 1000));
  assertEqual("3a 隱藏形狀不被擦除、可見形狀被擦除", next, [hiddenRect]);
  // 沒有形狀被隱藏 → 行為等同直接擦
  const all = eraseVisibleOnly(list, () => false, (sub) => eraseInBox(sub, -1000, -1000, 1000, 1000));
  assertEqual("3b 無隱藏時等同直接擦除", all, []);
  // 局部擦除只切到可見形狀的一部分 → 斷段結果保留在原位置（順序：隱藏者在前）
  const partial = eraseVisibleOnly(list, (s) => s === hiddenRect, (sub) => eraseInBox(sub, 40, -100, 60, 100));
  assertTrue(
    "3c 部分擦除後順序保留（第一個仍是隱藏的 rect）",
    partial[0] === hiddenRect && partial.length >= 2
  );
}

// ── normalizeShapes 回歸：螢光筆直線（line + opacity）格式 ──
{
  const raw = [{ type: "line", color: "#ff0", width: 16, opacity: 0.4, points: [[0, 0], [10, 10]] }];
  const [s] = normalizeShapes(raw);
  assertTrue("4 line+opacity 持久化格式保留", s.type === "line" && s.opacity === 0.4 && s.width === 16);
}

// ── normalizeShapes：內容錨點（anchor）欄位保留與壞資料丟棄 ──
{
  const anchor = { text: "想像你是新到職的後端工程師", start: 120, prefix: "情境", suffix: "，第一天", ex: 36.5, ey: 480 };
  const raw = [
    { type: "rect", color: "#f00", width: 3, points: [[0, 0], [10, 10]], anchor },
    { type: "rect", color: "#f00", width: 3, points: [[0, 0], [10, 10]], anchor: { text: "", start: 0 } }, // 壞：text 空
    { type: "rect", color: "#f00", width: 3, points: [[0, 0], [10, 10]], anchor: "not-an-object" },        // 壞：非物件
  ];
  const [ok, bad1, bad2] = normalizeShapes(raw);
  assertEqual("5a 合法 anchor 完整保留", ok.anchor, anchor);
  assertTrue("5b 壞 anchor 丟棄（回退絕對座標）", bad1.anchor === undefined && bad2.anchor === undefined);
  // 縮放/展開（spread）不得弄丟 anchor
  const scaled = scaleShape(ok, 2);
  assertEqual("5c scaleShape 保留 anchor", scaled.anchor, anchor);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
