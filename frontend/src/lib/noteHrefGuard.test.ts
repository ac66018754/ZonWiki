import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 靜態守衛測試：禁止前端原始碼再出現「裸串組筆記連結」的樣式——
 * fix/note-url-encoding 包1（測試計畫復審 HIGH 修正）。
 *
 * 為什麼需要它：本包要把約 12 處 `/notes/${...}` 裸串／整串編碼呼叫點全數改為
 * 共用 noteHref helper。單元測試只能證明 helper 本身正確，證明不了「每個呼叫點
 * 都真的改用了 helper」。本測試直接掃描 frontend/src 全部 .ts/.tsx 原始碼，
 * 出現任何裸串樣式即 FAIL 並列出檔案：既把「漏改某處」關進自動化測試，
 * 也擋下未來任何人再寫裸串（守衛性回歸測試）。
 *
 * 修復前此測試必然 FAIL（現存呼叫點清單見 scratchpad 測試計畫）＝本包的
 * 前端側 runtime RED 證據。
 */

/** 禁止樣式：以字串拼接組出，避免本測試檔自己命中掃描。 */
const FORBIDDEN_PATTERN = "/notes/" + "${";

/** 允許清單：collectViolations 會排除測試檔（*.test.ts）；helper 本身不含模板字串樣式，毋須另列。 */
const ALLOWED_FILES: string[] = [];

/**
 * 遞迴收集目錄下所有 .ts / .tsx 檔案路徑。
 *
 * @param dir 起始目錄（絕對路徑）
 * @returns 檔案絕對路徑清單
 */
function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...collectSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

/**
 * 掃描 src 下所有原始碼，回傳含禁止樣式的檔案（相對路徑）清單。
 *
 * 排除「/api/notes/${...}」：那是後端 API 路徑（參數為 GUID 的 noteId，
 * 各呼叫點已自行 encodeURIComponent），不是本守衛要抓的「頁面連結裸串」。
 * 判別方式：命中位置前方 4 字元若是 "/api" 即略過。
 *
 * @param srcDir src 目錄絕對路徑
 * @returns 違規檔案相對路徑（含首個命中行號）
 */
function collectViolations(srcDir: string): string[] {
  const violations: string[] = [];
  for (const file of collectSourceFiles(srcDir)) {
    const rel = relative(srcDir, file).replaceAll("\\", "/");
    if (rel.endsWith(".test.ts") || ALLOWED_FILES.includes(rel)) continue;
    const content = readFileSync(file, "utf8");
    for (
      let index = content.indexOf(FORBIDDEN_PATTERN);
      index >= 0;
      index = content.indexOf(FORBIDDEN_PATTERN, index + 1)
    ) {
      if (content.slice(Math.max(0, index - 4), index) === "/api") continue;
      const line = content.slice(0, index).split("\n").length;
      violations.push(`${rel}:${line}`);
    }
  }
  return violations;
}

describe("筆記連結靜態守衛", () => {
  it("frontend/src 不得殘留任何 `/notes/${...}` 裸串組連結（一律改用 noteHref）", () => {
    // vitest 於 frontend/ 目錄下執行，src 以 cwd 相對定位。
    const violations = collectViolations(join(process.cwd(), "src"));
    expect(
      violations,
      `以下檔案仍以裸串組筆記連結，請改用 lib/noteHref 的 noteHref(slug)：\n${violations.join("\n")}`
    ).toEqual([]);
  });
});
