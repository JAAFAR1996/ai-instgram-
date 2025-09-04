#!/usr/bin/env node
import { Pool } from 'pg';

const MERCHANT_ID = process.env.MERCHANT_ID || 'dd90061a-a1ad-42de-be9b-1c9760d0de02';
const SERVICES = (process.env.SERVICES || 'AI_RESPONSES,WEBHOOKS,JOBS').split(',');

function getPool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const ssl = /render\.com|sslmode=require/i.test(url) ? { rejectUnauthorized: false } : undefined;
  return new Pool({ connectionString: url, ssl });
}

async function main() {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const s of SERVICES) {
      await client.query(
        `INSERT INTO public.merchant_service_status (merchant_id, service_name, enabled)
         VALUES ($1,$2,true)
         ON CONFLICT (merchant_id, service_name) DO UPDATE SET enabled = true, updated_at = NOW()`,
        [MERCHANT_ID, s.trim()]
      );
    }
    await client.query('COMMIT');
    console.log('✅ Seeded merchant service status for:', MERCHANT_ID, SERVICES);
  } catch (e) {
    await client.query('ROLLBACK').catch((err) => { console.error('ROLLBACK failed', err); });
    console.error('❌ Failed to seed merchant services:', e?.message || String(e));
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error(e?.message || String(e)); process.exit(1); });
