#!/usr/bin/env node
// One-off fix: ensure audit_logs has columns used by app (entity_type, details, execution_time_ms, success)
import { Pool } from 'pg';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const ssl = /render\.com|sslmode=require/i.test(url) ? { rejectUnauthorized: false } : undefined;
  const pool = new Pool({ connectionString: url, ssl });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      ALTER TABLE public.audit_logs
        ADD COLUMN IF NOT EXISTS entity_type TEXT,
        ADD COLUMN IF NOT EXISTS details JSONB,
        ADD COLUMN IF NOT EXISTS execution_time_ms INTEGER,
        ADD COLUMN IF NOT EXISTS success BOOLEAN DEFAULT TRUE
    `);
    await client.query('COMMIT');
    console.log('✅ audit_logs columns ensured');
  } catch (e) {
    await client.query('ROLLBACK').catch(()=>{});
    console.error('❌ Failed to adjust audit_logs:', e?.message || String(e));
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error(e?.message || String(e)); process.exit(1); });