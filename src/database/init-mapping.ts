import { Pool } from 'pg';

export async function ensurePageMapping(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  const pageId = process.env.IG_PAGE_ID;
  const merchantId = process.env.MERCHANT_ID || 'merchant-default-001';

  if (!pageId) {
    console.log('⚠️ No IG_PAGE_ID set in env, skipping mapping');
    return;
  }

  if (!dbUrl) {
    console.log('⚠️ No DATABASE_URL set, skipping mapping');
    return;
  }

  const pool = new Pool({ connectionString: dbUrl });
  
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS merchant_credentials (
        merchant_id TEXT NOT NULL,
        instagram_page_id TEXT PRIMARY KEY,
        page_access_token TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pool.query(`
      INSERT INTO merchant_credentials (merchant_id, instagram_page_id)
      VALUES ($1, $2)
      ON CONFLICT (instagram_page_id) DO UPDATE
      SET merchant_id = EXCLUDED.merchant_id
    `, [merchantId, pageId]);

    console.log(`✅ mapped ${pageId} -> ${merchantId}`);
  } catch (error) {
    console.error('❌ Failed to ensure page mapping:', error);
  } finally {
    await pool.end();
  }
}