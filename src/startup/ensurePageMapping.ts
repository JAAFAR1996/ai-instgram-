import { Pool } from 'pg';

export async function ensurePageMapping(pool: Pool, pageId: string, igBusinessAccountId?: string) {
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

    // upsert للربط - ON CONFLICT على merchant_id لأنه الـ PK الفعلي
    await client.query(`
      INSERT INTO merchant_credentials
        (merchant_id, instagram_page_id, instagram_business_account_id, created_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      ON CONFLICT (merchant_id) DO UPDATE
      SET
        instagram_page_id = EXCLUDED.instagram_page_id,
        instagram_business_account_id = COALESCE(EXCLUDED.instagram_business_account_id, merchant_credentials.instagram_business_account_id),
        updated_at = NOW()
    `, [merchantId, pageId, igBusinessAccountId ?? null]);

    await client.query('COMMIT');
    console.log('✅ ensurePageMapping: ok for page', pageId, 'merchant', merchantId);
  } catch (e: any) {
    await client.query('ROLLBACK');
    console.error('❌ ensurePageMapping failed:', e.message);
  } finally {
    client.release();
  }
}