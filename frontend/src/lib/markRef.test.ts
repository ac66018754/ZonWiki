import { describe, expect, it } from "vitest";
import { formatMarkRef, parseMarkRef } from "./markRef";

/**
 * 段落引用字串（`zonwiki-mark:{noteId}:{markId}`）格式化／解析單元測試——包4。
 * 「複製段落引用」複製出此字串；建立關聯搜尋框偵測貼上此格式即直取段落目標。
 */
describe("markRef", () => {
  const noteId = "11111111-2222-3333-4444-555555555555";
  const markId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

  it("format→parse round-trip", () => {
    const ref = formatMarkRef(noteId, markId);
    expect(ref).toBe(`zonwiki-mark:${noteId}:${markId}`);
    expect(parseMarkRef(ref)).toEqual({ noteId, markId });
  });

  it("前後空白容忍（貼上常帶空白）", () => {
    expect(parseMarkRef(`  ${formatMarkRef(noteId, markId)}\n`)).toEqual({ noteId, markId });
  });

  it("壞格式回 null（一般搜尋文字不得被誤判）", () => {
    expect(parseMarkRef("隨便搜尋文字")).toBeNull();
    expect(parseMarkRef("zonwiki-mark:not-a-guid:also-bad")).toBeNull();
    expect(parseMarkRef(`zonwiki-mark:${noteId}`)).toBeNull();
    expect(parseMarkRef("")).toBeNull();
  });
});
