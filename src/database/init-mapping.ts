import { Pool } from 'pg';
// requireMerchantId removed - not used
import { getConfig } from '../config/index.js';

export async function ensurePageMapping(): Promise<void> {
  const config = getConfig();
  const { database: { url: dbUrl }, pageId, merchantId } = config;

  if (!merchantId) {
    console.error('❌ Environment variable MERCHANT_ID is missing. Aborting page mapping.');
    throw new Error('MERCHANT_ID not set');
  }

  if (!pageId) {
    console.log('⚠️ Environment variable IG_PAGE_ID is missing. Skipping page mapping.');
    return;
  }

  if (!dbUrl) {
    console.log('⚠️ Environment variable DATABASE_URL is missing. Skipping page mapping.');
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

    console.log(`✅ mapped ${pageId} -> ${merchantId}`);
  } catch (error) {
    console.error('❌ Failed to ensure page mapping:', error);
  } finally {
    await pool.end();
  }
}