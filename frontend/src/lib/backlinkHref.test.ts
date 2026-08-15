import { describe, expect, it } from "vitest";
import { backlinkHref } from "./backlinkHref";
import { noteHref } from "./noteHref";

/**
 * backlinkHref（反向連結項目的導航網址）單元測試——feature/backlinks-union 包2。
 *
 * 契約：mark 來源（框選段落關聯）要能跳回「來源筆記的那個段落」——
 * 走既有的 ?mark= 深連結（筆記頁會捲動到該標註並短暫高亮）；
 * wiki／entity 來源與 markId 缺失時退回整篇連結。
 * 路徑一律經 noteHref（包1 的逐段編碼契約）。
 */
describe("backlinkHref", () => {
  it("mark 來源帶 ?mark= 深連結（跳回來源段落）", () => {
    expect(
      backlinkHref({ sourceNoteSlug: "a/b", kind: "mark", markId: "m1" })
    ).toBe(`${noteHref("a/b")}?mark=m1`);
  });

  it("wiki 與 entity 來源為整篇連結（無 ?mark= 尾巴）", () => {
    expect(
      backlinkHref({ sourceNoteSlug: "a/b", kind: "wiki", markId: null })
    ).toBe(noteHref("a/b"));
    expect(
      backlinkHref({ sourceNoteSlug: "a/b", kind: "entity", markId: null })
    ).toBe(noteHref("a/b"));
  });

  it("slug 含 # 的 mark 來源：路徑編碼與 ?mark= 並存（與包1 編碼協同）", () => {
    const href = backlinkHref({
      sourceNoteSlug: "programming/c#/f",
      kind: "mark",
      markId: "m1",
    });
    expect(href).toBe(`${noteHref("programming/c#/f")}?mark=m1`);
    expect(href).toContain("%23");
  });

  it("markId 為特殊字元時要 encodeURIComponent（防 query 注入）", () => {
    expect(
      backlinkHref({ sourceNoteSlug: "x", kind: "mark", markId: "a&b=c" })
    ).toBe(`${noteHref("x")}?mark=${encodeURIComponent("a&b=c")}`);
  });

  it("kind=mark 但 markId 缺失（null/undefined）→ 優雅退回整篇連結，不得拼出 ?mark=null", () => {
    expect(
      backlinkHref({ sourceNoteSlug: "x", kind: "mark", markId: null })
    ).toBe(noteHref("x"));
    expect(
      backlinkHref({ sourceNoteSlug: "x", kind: "mark" })
    ).toBe(noteHref("x"));
  });

  it("kind 缺失（舊資料相容）→ 整篇連結", () => {
    expect(backlinkHref({ sourceNoteSlug: "x" })).toBe(noteHref("x"));
  });
});
