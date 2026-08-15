import { describe, expect, it } from "vitest";
import { encodeSlugPath } from "./slugPath.js";

/**
 * encodeSlugPath（slug 路徑編碼 helper）單元測試——fix/note-url-encoding 包1。
 *
 * 背景：MCP 的 get_note 原本把 slug 裸串進 `/api/notes/${slug}`，slug 含「#」時
 * fetch 會把其後整段當 fragment 丟棄（實證：get_note("programming/c#/f") 回
 * Note not found，但該筆記存在）。契約與前端 noteHref 的編碼段完全一致：
 * 逐段 encodeURIComponent、以「/」接回（兩套件無共用機制，各自持有＋註解互指）。
 *
 * 案例與前端 noteHref.test.ts 對稱（測試計畫復審 MEDIUM 修正）；
 * 期望值動態計算，不手抄百分號編碼。
 */
describe("encodeSlugPath", () => {
  it("單段 ASCII slug 不變形", () => {
    expect(encodeSlugPath("foo")).toBe("foo");
  });

  it("含 # 的多段 slug：# 編碼、/ 保留（prod 實例形態）", () => {
    expect(encodeSlugPath("programming/c#/f")).toBe(
      `programming/${encodeURIComponent("c#")}/f`
    );
    expect(encodeSlugPath("programming/c#/f")).toContain("%23");
  });

  it("中文 slug 逐段編碼、/ 保留", () => {
    expect(encodeSlugPath("快捷鍵/vs-code")).toBe(
      `${encodeURIComponent("快捷鍵")}/vs-code`
    );
  });

  it("query 保留字（? 與 &）逐段編碼", () => {
    expect(encodeSlugPath("a?b/c&d")).toBe(
      `${encodeURIComponent("a?b")}/${encodeURIComponent("c&d")}`
    );
  });

  it("% 與空格正確編碼（% 必須編為 %25，防雙重編碼疑慮）", () => {
    expect(encodeSlugPath("50% off/note")).toBe(
      `${encodeURIComponent("50% off")}/note`
    );
    expect(encodeSlugPath("50% off/note")).toContain("%25");
  });

  it("空字串回空字串（邊界定義）", () => {
    expect(encodeSlugPath("")).toBe("");
  });

  it("往返一致性：逐段 decode 還原等於原 slug", () => {
    const slugs = ["foo", "programming/c#/f", "快捷鍵/vs-code", "a?b/c&d", "50% off/note"];
    for (const slug of slugs) {
      const restored = encodeSlugPath(slug)
        .split("/")
        .map((segment) => decodeURIComponent(segment))
        .join("/");
      expect(restored).toBe(slug);
    }
  });

  it("RFC 3986 sub-delims（! * ' 圓括號）不編碼——與前端/後端輸出位元組一致", () => {
    expect(encodeSlugPath("movie(2024)!/x*'y")).toBe("movie(2024)!/x*'y");
  });

  it("畸形 Unicode（孤立 surrogate）不拋例外，改以 U+FFFD 取代後編碼", () => {
    expect(() => encodeSlugPath("a\uD800b/c")).not.toThrow();
    expect(encodeSlugPath("a\uD800b/c")).toBe(
      `${encodeURIComponent("a�b")}/c`
    );
  });

  it("輸出永不含未編碼的 # 與 ?（fragment / query 不可能被意外引入）", () => {
    for (const slug of ["programming/c#/f", "a?b/c&d", "x#y?z"]) {
      const encoded = encodeSlugPath(slug);
      expect(encoded).not.toContain("#");
      expect(encoded).not.toContain("?");
    }
  });
});
