import { describe, test, expect } from 'vitest';
import { RLSDatabase } from '../database/rls-wrapper.js';

describe('RLSDatabase session ID generation', () => {
  test('generateSessionId should produce unique IDs for consecutive calls', () => {
    const db = new RLSDatabase();
    const ids = new Set<string>();

    for (let i = 0; i < 100; i++) {
      const id = (db as any).generateSessionId();
      expect(ids.has(id)).toBe(false);
      ids.add(id);
    }

    expect(ids.size).toBe(100);
  });
});