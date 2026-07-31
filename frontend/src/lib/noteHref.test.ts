import { describe, expect, it } from "vitest";
import { noteHref } from "./noteHref";

/**
 * noteHref（筆記連結組裝 helper）單元測試——fix/note-url-encoding 包1。
 *
 * 背景：舊檔案匯入時代的筆記 slug 可含「/」（層級）與「#」等 URL 特殊字元
 * （prod 實例：programming/c#/f）。裸串組 href 時「#」會被瀏覽器當 fragment
 * 切掉，導頁變「筆記不存在」。noteHref 的契約：逐段 encodeURIComponent、
 * 以「/」接回、前綴 /notes/；空值退回 /notes（筆記清單頁）。
 *
 * 期望值一律動態計算（encodeURIComponent），不手抄百分號編碼，
 * 避免謄寫錯誤造成偽陽性 RED／偽陰性 GREEN（測試計畫復審裁示）。
 */
describe("noteHref", () => {
  it("單段 ASCII slug 不變形", () => {
    expect(noteHref("foo")).toBe("/notes/foo");
  });

  it("含 # 的多段 slug：# 編碼、/ 保留為路徑分隔（prod 實例形態）", () => {
    expect(noteHref("programming/c#/f")).toBe(
      `/notes/programming/${encodeURIComponent("c#")}/f`
    );
    // # 必須以 %23 呈現（雙保險：明示關鍵字元的編碼結果）
    expect(noteHref("programming/c#/f")).toContain("%23");
  });

  it("中文 slug 逐段編碼、/ 保留", () => {
    expect(noteHref("快捷鍵/vs-code")).toBe(
      `/notes/${encodeURIComponent("快捷鍵")}/vs-code`
    );
  });

  it("query 保留字（? 與 &）逐段編碼", () => {
    expect(noteHref("a?b/c&d")).toBe(
      `/notes/${encodeURIComponent("a?b")}/${encodeURIComponent("c&d")}`
    );
  });

  it("% 與空格正確編碼（% 必須編為 %25，防雙重編碼疑慮）", () => {
    expect(noteHref("50% off/note")).toBe(
      `/notes/${encodeURIComponent("50% off")}/note`
    );
    expect(noteHref("50% off/note")).toContain("%25");
  });

  it("空字串與 undefined 退回筆記清單頁 /notes（邊界定義）", () => {
    expect(noteHref("")).toBe("/notes");
    expect(noteHref(undefined)).toBe("/notes");
  });

  it("往返一致性：decodeURIComponent(noteHref(slug)) === '/notes/' + slug（保障側欄 active 比對）", () => {
    // Sidebar.tsx 以 decodeURIComponent(pathname) 與裸 slug 比對高亮目前筆記——
    // 本不變式保證「編碼後的 href」decode 回來仍等於原 slug 路徑，比對不破。
    const slugs = [
      "foo",
      "programming/c#/f",
      "快捷鍵/vs-code",
      "a?b/c&d",
      "50% off/note",
    ];
    for (const slug of slugs) {
      expect(decodeURIComponent(noteHref(slug))).toBe(`/notes/${slug}`);
    }
  });

  it("RFC 3986 sub-delims（! * ' 圓括號）不編碼——與後端 EncodeSlugForUrl 輸出位元組一致", () => {
    // encodeURIComponent 不編碼這五個字元、.NET Uri.EscapeDataString 會編碼——
    // 後端已對齊 JS 語意（對抗式復審 MEDIUM #1），此測試與後端
    // NoteUrlEncodingHttpTests 的 sub-delims 案例使用同一組期望字面值互相釘死。
    expect(noteHref("movie(2024)!/x*'y")).toBe("/notes/movie(2024)!/x*'y");
  });

  it("畸形 Unicode（孤立 surrogate）不拋例外，改以 U+FFFD 取代後編碼", () => {
    // 舊匯入資料可能含畸形字串；encodeURIComponent 對孤立 surrogate 會丟 URIError，
    // 若不防禦，側欄逐筆渲染 <Link> 時一顆壞 slug 會炸掉整個清單（復審 MEDIUM #2）。
    expect(() => noteHref("a\uD800b/c")).not.toThrow();
    expect(noteHref("a\uD800b/c")).toBe(
      `/notes/${encodeURIComponent("a�b")}/c`
    );
  });

  it("輸出永不含未編碼的 # 與 ?（fragment / query 不可能被意外引入）", () => {
    const slugs = ["programming/c#/f", "a?b/c&d", "x#y?z"];
    for (const slug of slugs) {
      const href = noteHref(slug);
      expect(href).not.toContain("#");
      expect(href).not.toContain("?");
    }
  });
});
