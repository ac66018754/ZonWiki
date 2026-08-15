import { describe, expect, it } from 'vitest';
import { resolveExpectedCandidate } from './resolveExpectedCandidate';
import type { SlugCandidate } from './api';

/**
 * resolveExpectedCandidate 單元測試（feature/slug-alias 包3，對抗式復審 CRITICAL #2 / HIGH #2）。
 * 覆蓋：命中 / 未命中 / null expect / 空候選 四個邊界。
 */
describe('resolveExpectedCandidate', () => {
  const makeCandidate = (id: string, title: string): SlugCandidate => ({
    id,
    title,
    slug: title,
    isCurrentHolder: false,
    originalTitle: null,
    updatedAt: '2026-07-31T00:00:00Z',
  });

  const candidates: SlugCandidate[] = [
    makeCandidate('aaaa1111-0000-0000-0000-000000000001', '筆記甲'),
    makeCandidate('bbbb2222-0000-0000-0000-000000000002', '筆記乙'),
  ];

  it('expect 命中候選 → 回傳該候選', () => {
    const found = resolveExpectedCandidate(candidates, 'bbbb2222-0000-0000-0000-000000000002');
    expect(found).not.toBeNull();
    expect(found?.title).toBe('筆記乙');
  });

  it('expect 未命中任何候選 → 回傳 null', () => {
    const found = resolveExpectedCandidate(candidates, 'cccc3333-0000-0000-0000-000000000003');
    expect(found).toBeNull();
  });

  it('expect 為 null → 回傳 null（沒有期望、走一般消歧異）', () => {
    expect(resolveExpectedCandidate(candidates, null)).toBeNull();
  });

  it('候選為空陣列 → 回傳 null（防禦邊界，不炸）', () => {
    expect(resolveExpectedCandidate([], 'aaaa1111-0000-0000-0000-000000000001')).toBeNull();
  });
});
