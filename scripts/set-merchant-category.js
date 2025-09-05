#!/usr/bin/env node
// Update a merchant's business_category easily.
// Usage examples:
//   DATABASE_URL=postgresql://... node scripts/set-merchant-category.js --merchant-id=<uuid> --category=electronics
//   DATABASE_URL=postgresql://... node scripts/set-merchant-category.js --ig-username=zo27j --category=grocery

import { Pool } from 'pg';

function getArgFlag(name) {
  const p = `--${name}=`;
  const f = process.argv.find((a) => a.startsWith(p));
  return f ? f.substring(p.length) : undefined;
}

function getPool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const ssl = /render\.com|sslmode=require/i.test(url) ? { rejectUnauthorized: false } : undefined;
  return new Pool({ connectionString: url, ssl });
}

async function run() {
  const merchantId = getArgFlag('merchant-id');
  const igUsername = getArgFlag('ig-username');
  const categoryRaw = getArgFlag('category') || process.env.BUSINESS_CATEGORY || 'other';
  const category = String(categoryRaw).toLowerCase();

  if (!merchantId && !igUsername) {
    console.error('❌ Provide --merchant-id=<uuid> or --ig-username=<name>');
    process.exit(1);
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let idRow;
    if (merchantId) {
      idRow = { id: merchantId };
    } else {
      const { rows } = await client.query(
        `SELECT id FROM public.merchants WHERE lower(instagram_username) = lower($1) LIMIT 1`,
        [igUsername]
      );
      if (!rows.length) {
        throw new Error(`Merchant with instagram_username=${igUsername} not found`);
      }
      idRow = rows[0];
    }

    await client.query(
      `UPDATE public.merchants SET business_category = $1, updated_at = NOW() WHERE id = $2`,
      [category, idRow.id]
    );

    await client.query('COMMIT');
    console.log(`✅ Updated merchant ${idRow.id} category => ${category}`);
  } catch (err) {
    await client.query('ROLLBACK').catch((err) => { console.error('ROLLBACK failed', err); });
    console.error('❌ Update failed:', err?.message || String(err));
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((e) => {
  console.error('Fatal:', e?.message || String(e));
  process.exit(1);
});

