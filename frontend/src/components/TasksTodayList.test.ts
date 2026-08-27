/**
 * 「今日任務」的日期範圍計算測試。
 *
 * 時間鐵則：DB 存 UTC、依「使用者設定的時區」顯示——不是瀏覽器時區。
 * 這裡鎖住 computeTodayRangeUtc 會用「使用者時區的今天」換算出正確的 UTC 起訖，
 * 否則跨時區（或使用者把時區設成跟電腦不同）時，側欄會列出錯誤那一天的任務。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeTodayRangeUtc } from './TasksTodayList';

afterEach(() => {
  vi.useRealTimers();
});

describe('computeTodayRangeUtc', () => {
  it('Asia/Taipei（UTC+8）：當地 2026-08-28 的一天＝UTC 08-27T16:00 ~ 08-28T15:59', () => {
    // 台北時間 2026-08-28 10:00 → UTC 2026-08-28T02:00Z
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T02:00:00.000Z'));

    const { fromIso, toIso } = computeTodayRangeUtc('Asia/Taipei');
    expect(fromIso).toBe('2026-08-27T16:00:00.000Z');
    expect(toIso).toBe('2026-08-28T15:59:00.000Z');
  });

  it('跨日邊界：UTC 仍是 27 號、台北已是 28 號 → 取台北的 28 號那一天', () => {
    // UTC 2026-08-27T20:00Z ＝ 台北 2026-08-28 04:00
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-27T20:00:00.000Z'));

    const { fromIso, toIso } = computeTodayRangeUtc('Asia/Taipei');
    expect(fromIso).toBe('2026-08-27T16:00:00.000Z');
    expect(toIso).toBe('2026-08-28T15:59:00.000Z');
  });

  it('UTC 時區：當地 2026-08-28 的一天＝UTC 08-28T00:00 ~ 08-28T23:59', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T12:00:00.000Z'));

    const { fromIso, toIso } = computeTodayRangeUtc('UTC');
    expect(fromIso).toBe('2026-08-28T00:00:00.000Z');
    expect(toIso).toBe('2026-08-28T23:59:00.000Z');
  });

  it('起一定早於迄（任何時區都成立的基本不變式）', () => {
    for (const tz of ['Asia/Taipei', 'UTC', 'America/New_York', 'Europe/London']) {
      const { fromIso, toIso } = computeTodayRangeUtc(tz);
      expect(new Date(fromIso).getTime()).toBeLessThan(new Date(toIso).getTime());
    }
  });
});
