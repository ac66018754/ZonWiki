import { describe, expect, it } from "vitest";
import { formatAmbiguous } from "./ambiguousFormat.js";

/**
 * formatAmbiguous（消歧異候選清單 → 人類可讀文字）單元測試——feature/slug-alias 包3。
 *
 * 背景：GET /api/notes/{slug} 的回應改為 { kind:"note"|"ambiguous", ... }；
 * get_note 收到 kind=ambiguous 時不能再把 JSON 原樣丟回（AI 呼叫端會困惑），
 * 改以本函式輸出：每個候選一行（標題＋現用/曾用標示＋id），並提示「以 id 重查可直達」。
 */
describe("formatAmbiguous", () => {
  const candidates = [
    {
      id: "aaaa1111-0000-0000-0000-000000000001",
      title: "筆記1",
      slug: "筆記1",
      isCurrentHolder: true,
      originalTitle: null,
      updatedAt: "2026-07-31T00:00:00Z",
    },
    {
      id: "bbbb2222-0000-0000-0000-000000000002",
      title: "筆記2",
      slug: "筆記2",
      isCurrentHolder: false,
      originalTitle: "筆記1",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  ];

  it("每個候選都列出標題與 id，並標示現用/曾用", () => {
    const text = formatAmbiguous("筆記1", candidates);
    expect(text).toContain("筆記1");
    expect(text).toContain("筆記2");
    expect(text).toContain(candidates[0].id);
    expect(text).toContain(candidates[1].id);
    expect(text).toContain("現用");
    expect(text).toContain("曾用");
  });

  it("提示可用 id 重查直達（get_note 支援 GUID 當 slug）", () => {
    const text = formatAmbiguous("筆記1", candidates);
    expect(text).toMatch(/id.*重(新)?查|以 id/);
  });

  it("空候選（防禦邊界）不炸、輸出仍為非空字串", () => {
    const text = formatAmbiguous("孤字", []);
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  });
});
