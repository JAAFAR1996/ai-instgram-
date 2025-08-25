/**
 * Row Level Security (RLS) Tests
 * Critical security tests for tenant isolation
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool, PoolClient } from 'pg';
import { getConfig } from '../config/environment.js';

const config = getConfig();
let testPool: Pool;
let adminClient: PoolClient;

// Test merchant IDs
const MERCHANT_A = '11111111-1111-1111-1111-111111111111';
const MERCHANT_B = '22222222-2222-2222-2222-222222222222';
const MERCHANT_C = '33333333-3333-3333-3333-333333333333';

beforeAll(async () => {
  // Create test pool
  testPool = new Pool({
    host: config.database.host,
    port: config.database.port,
    database: config.database.database,
    user: config.database.username,
    password: config.database.password,
    ssl: config.database.ssl ? { rejectUnauthorized: false } : false,
    max: 5
  });

  // Get admin client for setup
  adminClient = await testPool.connect();
  
  // Enable admin mode to bypass RLS for setup
  await adminClient.query("SET app.admin_mode = 'true'");
  
  // Create test merchants
  await adminClient.query(`
    INSERT INTO merchants (id, business_name, is_active, email)
    VALUES 
      ('${MERCHANT_A}', 'Test Merchant A', true, 'testa@example.com'),
      ('${MERCHANT_B}', 'Test Merchant B', true, 'testb@example.com'),
      ('${MERCHANT_C}', 'Test Merchant C', true, 'testc@example.com')
    ON CONFLICT (id) DO UPDATE SET
      business_name = EXCLUDED.business_name,
      is_active = EXCLUDED.is_active,
      email = EXCLUDED.email
  `);

  // Create test conversations for each merchant
  await adminClient.query(`
    INSERT INTO conversations (id, merchant_id, customer_id, platform, conversation_stage)
    VALUES 
      ('aaaa1111-1111-1111-1111-111111111111', '${MERCHANT_A}', 'cust-a-1', 'INSTAGRAM', 'DISCOVERY'),
      ('aaaa2222-2222-2222-2222-222222222222', '${MERCHANT_A}', 'cust-a-2', 'INSTAGRAM', 'NEGOTIATION'),
      ('bbbb1111-1111-1111-1111-111111111111', '${MERCHANT_B}', 'cust-b-1', 'INSTAGRAM', 'DISCOVERY'),
      ('bbbb2222-2222-2222-2222-222222222222', '${MERCHANT_B}', 'cust-b-2', 'INSTAGRAM', 'NEGOTIATION'),
      ('cccc1111-1111-1111-1111-111111111111', '${MERCHANT_C}', 'cust-c-1', 'INSTAGRAM', 'DISCOVERY')
    ON CONFLICT (id) DO UPDATE SET
      merchant_id = EXCLUDED.merchant_id,
      customer_id = EXCLUDED.customer_id,
      platform = EXCLUDED.platform,
      conversation_stage = EXCLUDED.conversation_stage
  `);

  // Create test messages for each conversation
  await adminClient.query(`
    INSERT INTO messages (id, conversation_id, direction, platform, message_type, content, platform_message_id)
    VALUES 
      ('msg-a-1-1', 'aaaa1111-1111-1111-1111-111111111111', 'INCOMING', 'INSTAGRAM', 'TEXT', 'Hello from customer A1', 'ig-msg-a-1-1'),
      ('msg-a-1-2', 'aaaa1111-1111-1111-1111-111111111111', 'OUTGOING', 'INSTAGRAM', 'TEXT', 'Hello back to customer A1', 'ig-msg-a-1-2'),
      ('msg-a-2-1', 'aaaa2222-2222-2222-2222-222222222222', 'INCOMING', 'INSTAGRAM', 'TEXT', 'Hello from customer A2', 'ig-msg-a-2-1'),
      ('msg-b-1-1', 'bbbb1111-1111-1111-1111-111111111111', 'INCOMING', 'INSTAGRAM', 'TEXT', 'Hello from customer B1', 'ig-msg-b-1-1'),
      ('msg-b-2-1', 'bbbb2222-2222-2222-2222-222222222222', 'INCOMING', 'INSTAGRAM', 'TEXT', 'Hello from customer B2', 'ig-msg-b-2-1'),
      ('msg-c-1-1', 'cccc1111-1111-1111-1111-111111111111', 'INCOMING', 'INSTAGRAM', 'TEXT', 'Hello from customer C1', 'ig-msg-c-1-1')
    ON CONFLICT (id) DO UPDATE SET
      conversation_id = EXCLUDED.conversation_id,
      content = EXCLUDED.content
  `);
});

afterAll(async () => {
  // Cleanup test data
  if (adminClient) {
    await adminClient.query("SET app.admin_mode = 'true'");
    await adminClient.query(`DELETE FROM messages WHERE id LIKE 'msg-%'`);
    await adminClient.query(`DELETE FROM conversations WHERE id LIKE '%1111-1111-1111-1111-111111111111' OR id LIKE '%2222-2222-2222-2222-222222222222'`);
    await adminClient.query(`DELETE FROM merchants WHERE id IN ('${MERCHANT_A}', '${MERCHANT_B}', '${MERCHANT_C}')`);
    adminClient.release();
  }
  
  if (testPool) {
    await testPool.end();
  }
});

describe('Row Level Security (RLS) Tests', () => {
  
  describe('Conversations Table RLS', () => {
    
    test('should allow access to same merchant conversations', async () => {
      const client = await testPool.connect();
      try {
        // Set tenant context for Merchant A
        await client.query(`SET LOCAL app.current_merchant_id = '${MERCHANT_A}'`);
        await client.query("SET LOCAL app.admin_mode = 'false'");
        
        const result = await client.query(`
          SELECT id, merchant_id, customer_id 
          FROM conversations 
          WHERE merchant_id = $1
        `, [MERCHANT_A]);
        
        // Should see Merchant A's conversations
        expect(result.rows.length).toBe(2);
        expect(result.rows.every(row => row.merchant_id === MERCHANT_A)).toBe(true);
        
      } finally {
        client.release();
      }
    });

    test('should deny access to other merchant conversations', async () => {
      const client = await testPool.connect();
      try {
        // Set tenant context for Merchant A
        await client.query(`SET LOCAL app.current_merchant_id = '${MERCHANT_A}'`);
        await client.query("SET LOCAL app.admin_mode = 'false'");
        
        const result = await client.query(`
          SELECT id, merchant_id, customer_id 
          FROM conversations 
          WHERE merchant_id = $1
        `, [MERCHANT_B]);
        
        // Should not see Merchant B's conversations
        expect(result.rows.length).toBe(0);
        
      } finally {
        client.release();
      }
    });

    test('should enforce RLS on INSERT operations', async () => {
      const client = await testPool.connect();
      try {
        // Set tenant context for Merchant A
        await client.query(`SET LOCAL app.current_merchant_id = '${MERCHANT_A}'`);
        await client.query("SET LOCAL app.admin_mode = 'false'");
        
        // Try to insert conversation for different merchant
        try {
          await client.query(`
            INSERT INTO conversations (id, merchant_id, customer_id, platform, conversation_stage)
            VALUES ('test-conv-wrong-merchant', '${MERCHANT_B}', 'test-customer', 'INSTAGRAM', 'DISCOVERY')
          `);
          
          // Should not reach here - RLS should prevent this
          expect(false).toBe(true);
          
        } catch (error) {
          // Expected - RLS should block this
          expect(error.message).toContain('policy');
        }
        
      } finally {
        client.release();
      }
    });

    test('should allow INSERT for same merchant', async () => {
      const client = await testPool.connect();
      try {
        // Set tenant context for Merchant A
        await client.query(`SET LOCAL app.current_merchant_id = '${MERCHANT_A}'`);
        await client.query("SET LOCAL app.admin_mode = 'false'");
        
        const testConvId = 'test-conv-allowed-' + Date.now();
        
        // Insert conversation for same merchant should work
        const result = await client.query(`
          INSERT INTO conversations (id, merchant_id, customer_id, platform, conversation_stage)
          VALUES ($1, $2, 'test-customer-allowed', 'INSTAGRAM', 'DISCOVERY')
          RETURNING id, merchant_id
        `, [testConvId, MERCHANT_A]);
        
        expect(result.rows.length).toBe(1);
        expect(result.rows[0].merchant_id).toBe(MERCHANT_A);
        
        // Clean up
        await client.query("SET LOCAL app.admin_mode = 'true'");
        await client.query(`DELETE FROM conversations WHERE id = $1`, [testConvId]);
        
      } finally {
        client.release();
      }
    });
  });

  describe('Messages Table RLS', () => {
    
    test('should allow access to messages from same merchant conversations', async () => {
      const client = await testPool.connect();
      try {
        // Set tenant context for Merchant A
        await client.query(`SET LOCAL app.current_merchant_id = '${MERCHANT_A}'`);
        await client.query("SET LOCAL app.admin_mode = 'false'");
        
        const result = await client.query(`
          SELECT m.id, m.content, c.merchant_id
          FROM messages m 
          JOIN conversations c ON m.conversation_id = c.id
          WHERE c.merchant_id = $1
        `, [MERCHANT_A]);
        
        // Should see messages from Merchant A's conversations
        expect(result.rows.length).toBe(3); // 3 messages for Merchant A
        expect(result.rows.every(row => row.merchant_id === MERCHANT_A)).toBe(true);
        
      } finally {
        client.release();
      }
    });

    test('should deny access to messages from other merchant conversations', async () => {
      const client = await testPool.connect();
      try {
        // Set tenant context for Merchant A
        await client.query(`SET LOCAL app.current_merchant_id = '${MERCHANT_A}'`);
        await client.query("SET LOCAL app.admin_mode = 'false'");
        
        const result = await client.query(`
          SELECT m.id, m.content, c.merchant_id
          FROM messages m 
          JOIN conversations c ON m.conversation_id = c.id
          WHERE c.merchant_id = $1
        `, [MERCHANT_B]);
        
        // Should not see messages from Merchant B's conversations
        expect(result.rows.length).toBe(0);
        
      } finally {
        client.release();
      }
    });
  });

  describe('current_setting() Function Tests', () => {
    
    test('should correctly read current_merchant_id setting', async () => {
      const client = await testPool.connect();
      try {
        // Set tenant context
        await client.query(`SET LOCAL app.current_merchant_id = '${MERCHANT_A}'`);
        
        const result = await client.query(`
          SELECT current_setting('app.current_merchant_id', true) as current_merchant
        `);
        
        expect(result.rows[0].current_merchant).toBe(MERCHANT_A);
        
      } finally {
        client.release();
      }
    });

    test('should return empty string for unset merchant_id', async () => {
      const client = await testPool.connect();
      try {
        // Don't set any tenant context
        const result = await client.query(`
          SELECT current_setting('app.current_merchant_id', true) as current_merchant
        `);
        
        // Should return empty string when not set
        expect(result.rows[0].current_merchant).toBe('');
        
      } finally {
        client.release();
      }
    });

    test('should correctly read admin_mode setting', async () => {
      const client = await testPool.connect();
      try {
        // Set admin mode
        await client.query("SET LOCAL app.admin_mode = 'true'");
        
        const result = await client.query(`
          SELECT current_setting('app.admin_mode', true) as admin_mode
        `);
        
        expect(result.rows[0].admin_mode).toBe('true');
        
      } finally {
        client.release();
      }
    });
  });

  describe('User Role Verification', () => {
    
    test('should verify connection is not superuser', async () => {
      const client = await testPool.connect();
      try {
        const result = await client.query(`
          SELECT 
            current_user,
            usesuper,
            usecreatedb,
            userepl
          FROM pg_user 
          WHERE usename = current_user
        `);
        
        const user = result.rows[0];
        expect(user.usesuper).toBe(false); // Should NOT be superuser
        
        console.log('Database user verification:', {
          user: user.current_user,
          superuser: user.usesuper,
          createdb: user.usecreatedb,
          replication: user.userepl
        });
        
      } finally {
        client.release();
      }
    });

    test('should verify user cannot bypass RLS', async () => {
      const client = await testPool.connect();
      try {
        const result = await client.query(`
          SELECT 
            rolname,
            rolsuper,
            rolbypassrls
          FROM pg_roles 
          WHERE rolname = current_user
        `);
        
        const role = result.rows[0];
        expect(role.rolsuper).toBe(false);        // Should NOT be superuser
        expect(role.rolbypassrls).toBe(false);    // Should NOT bypass RLS
        
        console.log('Database role verification:', {
          role: role.rolname,
          superuser: role.rolsuper,
          bypassRLS: role.rolbypassrls
        });
        
      } finally {
        client.release();
      }
    });
  });

  describe('Cross-Merchant Data Isolation', () => {
    
    test('should completely isolate merchants from each other', async () => {
      // Test with Merchant A context
      const clientA = await testPool.connect();
      const clientB = await testPool.connect();
      
      try {
        // Set up contexts
        await clientA.query(`SET LOCAL app.current_merchant_id = '${MERCHANT_A}'`);
        await clientA.query("SET LOCAL app.admin_mode = 'false'");
        
        await clientB.query(`SET LOCAL app.current_merchant_id = '${MERCHANT_B}'`);
        await clientB.query("SET LOCAL app.admin_mode = 'false'");
        
        // Query conversations from each client
        const [resultA, resultB] = await Promise.all([
          clientA.query(`SELECT id, merchant_id FROM conversations`),
          clientB.query(`SELECT id, merchant_id FROM conversations`)
        ]);
        
        // Verify complete isolation
        expect(resultA.rows.every(row => row.merchant_id === MERCHANT_A)).toBe(true);
        expect(resultB.rows.every(row => row.merchant_id === MERCHANT_B)).toBe(true);
        
        // Verify no cross-contamination
        expect(resultA.rows.some(row => row.merchant_id === MERCHANT_B)).toBe(false);
        expect(resultB.rows.some(row => row.merchant_id === MERCHANT_A)).toBe(false);
        
      } finally {
        clientA.release();
        clientB.release();
      }
    });
  });

  describe('Admin Mode Bypass', () => {
    
    test('should allow admin mode to see all data', async () => {
      const client = await testPool.connect();
      try {
        // Enable admin mode
        await client.query("SET LOCAL app.admin_mode = 'true'");
        await client.query(`SET LOCAL app.current_merchant_id = '${MERCHANT_A}'`);
        
        const result = await client.query(`SELECT DISTINCT merchant_id FROM conversations ORDER BY merchant_id`);
        
        // Should see all merchants when in admin mode
        expect(result.rows.length).toBeGreaterThanOrEqual(3);
        const merchantIds = result.rows.map(r => r.merchant_id);
        expect(merchantIds).toContain(MERCHANT_A);
        expect(merchantIds).toContain(MERCHANT_B);
        expect(merchantIds).toContain(MERCHANT_C);
        
      } finally {
        client.release();
      }
    });
  });
});