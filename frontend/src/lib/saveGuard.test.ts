// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { computeLostMarks } from "./saveGuard";
import {
  NUMBER_SCENARIO,
  NUMBER_SCENARIO_HTML,
} from "./__fixtures__/anchorFixtures";
import type { NoteMark } from "./api";

/**
 * 存檔攔截判定（computeLostMarks）單元測試——包4 錨點保護核心。
 *
 * 契約：以「舊 HTML 的 textContent」與「新 HTML（render dry-run）的 textContent」
 * 各跑一次既有 reAnchor，回傳「舊找得到、新找不到」的 marks——
 * 「原本」基準＝**即時重算舊內容**，絕不讀 DB 存量 Detached（滯後污染會把舊帳
 * 誤植為本次破壞；計畫二輪復審裁決）。座標系＝瀏覽器 textContent（jsdom 同規格），
 * 測資用含格式 Markdown 的 Markdig 形狀 HTML（共用 fixtures，與 E2E 同一份）。
 */

/** 造一顆最小可用的 mark（只填 computeLostMarks 會讀的欄位）。 */
function makeMark(id: string, anchorText: string, overrides: Partial<NoteMark> = {}): NoteMark {
  return {
    id,
    kind: "anchor",
    anchorText,
    anchorStart: 0,
    anchorEnd: anchorText.length,
    anchorPrefix: "",
    anchorSuffix: "",
    detached: false,
    ...overrides,
  } as NoteMark;
}

describe("computeLostMarks", () => {
  it("1~100 情境：刪掉 50 與 52 → 「50」與「51、52」兩錨判定會斷；存活段不誤判", () => {
    const marks = [
      makeMark("m-50", NUMBER_SCENARIO.anchorFifty),
      makeMark("m-51-52", NUMBER_SCENARIO.anchorFiftyOnePair),
      makeMark("m-alive", NUMBER_SCENARIO.anchorSurvivor),
    ];

    const lost = computeLostMarks(
      NUMBER_SCENARIO_HTML.oldHtml,
      NUMBER_SCENARIO_HTML.newHtml,
      marks
    );

    expect(lost.map((m) => m.id).sort()).toEqual(["m-50", "m-51-52"]);
  });

  it("舊帳不歸因：舊內容就已找不到的 mark 不得列入本次會斷清單", () => {
    const marks = [makeMark("m-ghost", "根本不存在的文字")];

    const lost = computeLostMarks(
      NUMBER_SCENARIO_HTML.oldHtml,
      NUMBER_SCENARIO_HTML.newHtml,
      marks
    );

    expect(lost).toEqual([]);
  });

  it("內容未變 → 空清單", () => {
    const marks = [makeMark("m-50", NUMBER_SCENARIO.anchorFifty)];
    expect(
      computeLostMarks(NUMBER_SCENARIO_HTML.oldHtml, NUMBER_SCENARIO_HTML.oldHtml, marks)
    ).toEqual([]);
  });

  it("格式化元素（粗體/清單）不影響座標判定（fixtures 即含 strong/ul/li）", () => {
    // 錨定跨越粗體邊界後方的純文字——只要 textContent 座標系一致就找得到。
    const marks = [makeMark("m-fmt", "說明文字")];
    expect(
      computeLostMarks(NUMBER_SCENARIO_HTML.oldHtml, NUMBER_SCENARIO_HTML.newHtml, marks)
    ).toEqual([]);
  });
});
