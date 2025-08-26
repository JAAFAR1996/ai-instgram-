import { Pool } from 'pg';
import { getConfig } from '../config/index.js';
import { getLogger } from '../services/logger.js';

const log = getLogger({ component: 'init-mapping' });

export async function ensurePageMapping(): Promise<void> {
  const config = getConfig();
  const { database: { url: dbUrl }, pageId, merchantId } = config;

  if (!merchantId) {
    log.error('❌ Environment variable MERCHANT_ID is missing. Aborting page mapping.');
    throw new Error('MERCHANT_ID not set');
  }

  if (!pageId) {
    log.warn('⚠️ Environment variable IG_PAGE_ID is missing. Skipping page mapping.');
    return;
  }

  if (!dbUrl) {
    log.warn('⚠️ Environment variable DATABASE_URL is missing. Skipping page mapping.');
    return;
  }

  const pool = new Pool({ connectionString: dbUrl });
  
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS merchant_credentials (
        merchant_id TEXT NOT NULL,
        instagram_page_id TEXT PRIMARY KEY,
        page_access_token TEXT,
        business_account_id TEXT,
        app_secret TEXT,
        platform TEXT DEFAULT 'instagram',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pool.query(`
      INSERT INTO merchant_credentials (merchant_id, instagram_page_id, platform)
      VALUES ($1, $2, 'instagram')
      ON CONFLICT (instagram_page_id) DO UPDATE
      SET merchant_id = EXCLUDED.merchant_id,
          platform = 'instagram'
    `, [merchantId, pageId]);

    log.info(`✅ mapped ${pageId} -> ${merchantId}`);
  } catch (error) {
    log.error('❌ Failed to ensure page mapping:', error);
  } finally {
    await pool.end();
  }
}