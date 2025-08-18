import { Pool } from 'pg';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Production-grade migration and seeding system
 * Applies SQL migrations in order and seeds initial data
 */
export async function migrateAndSeed(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  
  if (!databaseUrl) {
    console.warn('⚠️ DATABASE_URL not set, skipping migrations');
    return;
  }

  const pool = new Pool({ 
    connectionString: databaseUrl,
    ssl: process.env.NODE_ENV === 'production' 
      ? { rejectUnauthorized: false } 
      : undefined
  });
  
  const client = await pool.connect();
  
  try {
    // Start transaction
    await client.query('BEGIN');

    // Create migrations tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Read migration files
    const migrationsDir = join(process.cwd(), 'migrations');
    let files: string[] = [];
    
    try {
      files = readdirSync(migrationsDir)
        .filter(f => /^\d+_.+\.sql$/.test(f))
        .sort(); // Sort in ascending order
    } catch (err) {
      console.log('📁 No migrations directory found, skipping migrations');
    }

    // Apply each migration
    for (const file of files) {
      const migrationId = file;
      
      // Check if already applied
      const exists = await client.query(
        'SELECT 1 FROM schema_migrations WHERE id = $1',
        [migrationId]
      );
      
      if (exists.rowCount && exists.rowCount > 0) {
        console.log(`⏭️  Migration already applied: ${migrationId}`);
        continue;
      }

      // Read and execute migration
      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      await client.query(sql);
      
      // Mark as applied
      await client.query(
        'INSERT INTO schema_migrations (id) VALUES ($1)',
        [migrationId]
      );
      
      console.log(`✅ Applied migration: ${migrationId}`);
    }

    await client.query('COMMIT');
    console.log('✅ All migrations completed');

    // ====== SEED DATA (idempotent) ======
    await seedInitialData(client);
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration error:', error instanceof Error ? error.message : error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

/**
 * Seeds initial data (merchant and page mapping)
 */
async function seedInitialData(client: any): Promise<void> {
  // Get configuration from environment
  const merchantId = process.env.MERCHANT_ID || '550e8400-e29b-41d4-a716-446655440000';
  const merchantName = process.env.MERCHANT_NAME || 'Default Merchant';
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
  const adminPhone = process.env.ADMIN_PHONE_NUMBER || '+1234567890';
  const igBusinessId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID || '17841405545604018';
  const igPageId = process.env.PAGE_ID || process.env.IG_PAGE_ID || '772043875986598';
  
  if (!igPageId || !igBusinessId) {
    console.warn('⚠️ Instagram IDs not set, skipping seed');
    return;
  }

  try {
    await client.query('BEGIN');
    
    // Insert merchant (idempotent)
    await client.query(`
      INSERT INTO merchants (
        id, 
        name, 
        email, 
        whatsapp_phone_number,
        instagram_business_account_id,
        subscription_status
      )
      VALUES ($1::uuid, $2, $3, $4, $5, 'ACTIVE')
      ON CONFLICT (id) DO UPDATE
      SET 
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        whatsapp_phone_number = EXCLUDED.whatsapp_phone_number,
        instagram_business_account_id = EXCLUDED.instagram_business_account_id,
        updated_at = NOW()
    `, [merchantId, merchantName, adminEmail, adminPhone, igBusinessId]);
    
    // Insert page mapping (idempotent)
    await client.query(`
      INSERT INTO merchant_credentials (
        merchant_id,
        instagram_page_id,
        instagram_business_account_id
      )
      VALUES ($1::uuid, $2, $3)
      ON CONFLICT (instagram_page_id) DO UPDATE
      SET 
        merchant_id = EXCLUDED.merchant_id,
        instagram_business_account_id = EXCLUDED.instagram_business_account_id,
        updated_at = NOW()
    `, [merchantId, igPageId, igBusinessId]);
    
    await client.query('COMMIT');
    
    console.log('✅ Seed complete:', {
      merchantId: merchantId.substring(0, 8) + '...',
      pageId: igPageId,
      businessId: igBusinessId
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Seed error:', error instanceof Error ? error.message : error);
    // Don't throw - seeding failure shouldn't stop the app
  }
}