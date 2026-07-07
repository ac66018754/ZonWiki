/**
 * buildToc 純邏輯 spec（前端無 runner，沿用零相依 Node 測試慣例，見 noteNav.spec.mjs）。
 *
 * 涵蓋：既有 h1-h3 行為回歸＋「:::toggle 的 <summary> 也要進 TOC」擴充
 * （對應需求 H：純 toggle 結構的筆記——如 prod 的 reamde——目錄表完全空白）。
 *
 * 執行：Node 20 PATH 之後 `node scripts/toc.spec.mjs`（cwd 需在 frontend/，才能解析 typescript）。
 */

import ts from "typescript";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const tocPath = resolve(here, "../src/lib/toc.ts");

// ── 把真正的 toc.ts 即時轉譯成 ESM JS ────────────────────────────────
const source = readFileSync(tocPath, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;

const mod = await import("data:text/javascript," + encodeURIComponent(transpiled));
const { buildToc } = mod;

// ── 迷你斷言框架 ────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
/** 深度相等斷言（JSON 比對）。 */
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
/** 布林斷言。 */
function assertTrue(name, cond, detail = "") {
  if (cond) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
  }
}

/** 產生一個 md-toggle details 片段（模擬後端 ToggleContainerExtension 的輸出）。 */
function toggle(title, inner, open = false) {
  return (
    `<details class="md-toggle"${open ? " open" : ""}>` +
    `<summary class="md-toggle-summary">${title}</summary>\n` +
    `<div class="md-toggle-body">\n${inner}</div>\n</details>`
  );
}

console.log("toc spec:");

// 1. 回歸：只有 h1/h2/h3 → 與現行行為一致（依序、id 注入、層級正確）
{
  const { html, toc } = buildToc("<h1>Alpha</h1><p>x</p><h2>Beta Two</h2><h3>Gamma</h3>");
  assertEqual(
    "1 回歸：純標題結構的層級與順序",
    toc,
    [
      { id: "alpha", text: "Alpha", level: 1 },
      { id: "beta-two", text: "Beta Two", level: 2 },
      { id: "gamma", text: "Gamma", level: 3 },
    ]
  );
  assertTrue("1b 回歸：標題有注入 id", html.includes('<h1 id="alpha">Alpha</h1>'));
}

// 2. 純 toggle 巢狀三層 → summary 依巢狀深度 level 1/2/3，id 注入 <summary>
{
  const inner3 = toggle("內層三", "<p>c</p>");
  const inner2 = toggle("內層二", `<p>b</p>\n${inner3}`);
  const html0 = toggle("外層一", `<p>a</p>\n${inner2}`);
  const { html, toc } = buildToc(html0);
  assertEqual(
    "2 純 toggle 巢狀：summary 依深度成 level 1/2/3",
    toc,
    [
      { id: "外層一", text: "外層一", level: 1 },
      { id: "內層二", text: "內層二", level: 2 },
      { id: "內層三", text: "內層三", level: 3 },
    ]
  );
  assertTrue(
    "2b summary 標籤有注入 id",
    html.includes('<summary class="md-toggle-summary" id="外層一">外層一</summary>')
  );
}

// 3. h 標題與 toggle 混合 → 依文件順序
{
  const html0 = `<h2>前言</h2>${toggle("摺疊章", "<h3>摺疊內標題</h3>")}<h2>結語</h2>`;
  const { toc } = buildToc(html0);
  assertEqual(
    "3 混合結構依文件順序",
    toc.map((t) => t.text),
    ["前言", "摺疊章", "摺疊內標題", "結語"]
  );
}

// 4. 巢狀深度 >3 的 summary 不收錄（與 h1-3 三層上限一致）
{
  const d4 = toggle("第四層", "<p>x</p>");
  const html0 = toggle("一", toggle("二", toggle("三", d4)));
  const { toc } = buildToc(html0);
  assertEqual(
    "4 深度>3 的 summary 不收錄",
    toc.map((t) => t.text),
    ["一", "二", "三"]
  );
}

// 5. id 碰撞（summary 與 heading 同名）→ -2 遞增唯一化
{
  const { toc } = buildToc(`<h2>坑</h2>${toggle("坑", "<p>x</p>")}`);
  assertEqual(
    "5 同名標題與 summary 的 id 唯一化",
    toc.map((t) => t.id),
    ["坑", "坑-2"]
  );
}

// 6. :::toggle-open 的產物（<details class="md-toggle" open>）一樣收錄
{
  const { toc } = buildToc(toggle("預設展開的", "<p>x</p>", true));
  assertEqual("6 toggle-open 也收錄", toc.map((t) => t.text), ["預設展開的"]);
}

// 7a. 壞輸入韌性：未閉合 details 不噴錯
{
  let ok = true;
  let toc = [];
  try {
    ({ toc } = buildToc('<details class="md-toggle"><summary class="md-toggle-summary">孤兒</summary><p>x</p>'));
  } catch {
    ok = false;
  }
  assertTrue("7a 未閉合 details 不噴錯且 summary 仍收錄", ok && toc.length === 1 && toc[0].text === "孤兒");
}

// 7b. summary 內含跳脫字元 → TOC 文字要解回原字元（顯示用）
{
  const { toc } = buildToc(toggle("A &amp; B &lt;tag&gt;", "<p>x</p>"));
  assertEqual("7b 跳脫字元解碼", toc[0].text, "A & B <tag>");
}

// 8. 非 md-toggle 的 summary/details 樣式字串不收錄（防呆：內文不可能有，但正則不可誤抓）
{
  const { toc } = buildToc('<div class="md-toggle-fake"><p>假的</p></div><h2>真標題</h2>');
  assertEqual("8 只認 md-toggle 類別", toc.map((t) => t.text), ["真標題"]);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
