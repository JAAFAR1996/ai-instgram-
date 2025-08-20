import { describe, test, expect } from 'bun:test';
import { InstagramHashtagMentionProcessor } from '../services/instagram-hashtag-mention-processor.js';

function createContext(result: { current_count: number; previous_count: number }) {
  const sqlStub = { unsafe: async () => [result] } as any;
  return {
    db: { getSQL: () => sqlStub },
    getTimeFilter: InstagramHashtagMentionProcessor.prototype.getTimeFilter
  } as any;
}

describe('calculateHashtagGrowth', () => {
  test('returns positive growth percentage', async () => {
    const ctx = createContext({ current_count: 15, previous_count: 10 });
    const growth = await (InstagramHashtagMentionProcessor.prototype as any).calculateHashtagGrowth.call(
      ctx,
      '#test',
      'merchant',
      'week'
    );
    expect(growth).toBeCloseTo(50);
  });

  test('returns negative growth percentage', async () => {
    const ctx = createContext({ current_count: 5, previous_count: 10 });
    const growth = await (InstagramHashtagMentionProcessor.prototype as any).calculateHashtagGrowth.call(
      ctx,
      '#test',
      'merchant',
      'week'
    );
    expect(growth).toBeCloseTo(-50);
  });

  test('handles zero previous count', async () => {
    const ctx = createContext({ current_count: 5, previous_count: 0 });
    const growth = await (InstagramHashtagMentionProcessor.prototype as any).calculateHashtagGrowth.call(
      ctx,
      '#test',
      'merchant',
      'week'
    );
    expect(growth).toBe(100);
  });

  test('returns 0 when no data present', async () => {
    const ctx = createContext({ current_count: 0, previous_count: 0 });
    const growth = await (InstagramHashtagMentionProcessor.prototype as any).calculateHashtagGrowth.call(
      ctx,
      '#test',
      'merchant',
      'week'
    );
    expect(growth).toBe(0);
  });
});