/**
 * ===============================================
 * SQL Injection Protection Tests
 * Ensures database queries are properly parameterized
 * ===============================================
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { CrossPlatformConversationManager } from '../services/cross-platform-conversation-manager.js';
import { initializeDatabase } from '../database/connection.js';

describe('Database query sanitization', () => {
  let manager: CrossPlatformConversationManager;
  let sql: any;

  beforeAll(async () => {
    const db = await initializeDatabase();
    sql = db.getSQL();
    manager = new CrossPlatformConversationManager();
  });

  test('rejects malicious merchantId input', async () => {
    const maliciousId = "123e4567-e89b-12d3-a456-426614174000'; DROP TABLE merchants;--";

    const profile = await manager.getUnifiedCustomerProfile(maliciousId, { phone: '999' });
    expect(profile).toBeNull();

    const tableCheck = await sql`SELECT to_regclass('public.merchants') as name`;
    expect(tableCheck[0].name).toBe('merchants');
  });
});