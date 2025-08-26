/**
 * ===============================================
 * Page Mapping Utility - Production Ready
 * Ensures proper mapping between Instagram pages and merchants
 * ===============================================
 */

import { Pool } from 'pg';
import { getLogger } from '../services/logger.js';

const log = getLogger({ component: 'ensure-page-mapping' });

export async function ensurePageMapping(pool: Pool, pageId: string, businessAccountId?: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // تأكد من وجود merchants
    await client.query(`
      CREATE TABLE IF NOT EXISTS merchants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // احصل/أنشئ merchant واحد افتراضي
    const m = await client.query(`SELECT id FROM merchants LIMIT 1;`);
    let merchantId = m.rows[0]?.id;
    if (!merchantId) {
      const ins = await client.query(`INSERT INTO merchants DEFAULT VALUES RETURNING id;`);
      merchantId = ins.rows[0].id;
    }

    // تأكد من وجود merchant_credentials بالأعمدة المطلوبة
    await client.query(`
      CREATE TABLE IF NOT EXISTS merchant_credentials (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        merchant_id UUID NOT NULL,
        instagram_page_id TEXT UNIQUE,
        instagram_business_account_id TEXT,
        business_account_id TEXT,
        app_secret TEXT,
        platform TEXT DEFAULT 'INSTAGRAM',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // عالج الصفوف القديمة التي فيها NULL
    await client.query(`
      UPDATE merchant_credentials
      SET merchant_id = $1, updated_at = NOW()
      WHERE merchant_id IS NULL;
    `, [merchantId]);

    // upsert للربط - ON CONFLICT على المفتاح المركب الصحيح (merchant_id, instagram_page_id)
    await client.query(`
      INSERT INTO merchant_credentials
        (merchant_id, instagram_page_id, instagram_business_account_id, business_account_id, platform, created_at, updated_at)
      VALUES ($1, $2, $3, $3, 'INSTAGRAM', NOW(), NOW())
      ON CONFLICT (merchant_id, instagram_page_id) DO UPDATE
      SET
        instagram_business_account_id = COALESCE(EXCLUDED.instagram_business_account_id, merchant_credentials.instagram_business_account_id),
        business_account_id = COALESCE(EXCLUDED.business_account_id, merchant_credentials.business_account_id),
        platform = 'INSTAGRAM',
        updated_at = NOW()
    `, [merchantId, pageId, businessAccountId ?? null]);

    await client.query('COMMIT');
    log.info('✅ ensurePageMapping: ok', { pageId, merchantId });
  } catch (e: any) {
    await client.query('ROLLBACK');
    log.error('❌ ensurePageMapping failed:', e.message);
  } finally {
    client.release();
  }
}
