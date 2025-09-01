import { describe, expect, test } from 'vitest';
import { pushDLQ, drainDLQ } from './dead-letter.js';

describe('generateDLQId', () => {
  test('produces unique identifiers', () => {
    const count = 100;

    for (let i = 0; i < count; i++) {
      pushDLQ({ reason: 'test', payload: i });
    }

    const items = drainDLQ();
    const ids = new Set(items.map(item => item.id));

    expect(ids.size).toBe(count);
  });
});