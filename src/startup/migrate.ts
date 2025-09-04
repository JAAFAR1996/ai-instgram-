import { Pool } from 'pg';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { requireMerchantId } from '../utils/merchant.js';
import { getEnv } from '../config/env.js';
import { logger } from '../services/logger.js';

/**
 * Production-grade migration and seeding system
 * Applies SQL migrations in order and seeds initial data
 */
export async function migrateAndSeed(): Promise<void> {
  const databaseUrl = getEnv('DATABASE_URL');

  if (!databaseUrl) {
    throw new Error('DATABASE_URL not set');
  }

  const pool = new Pool({ 
    connectionString: databaseUrl,
    ssl: getEnv('NODE_ENV') === 'production' 
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
      logger.info('📁 No migrations directory found, skipping migrations');
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
        logger.info(`⏭️  Migration already applied: ${migrationId}`);
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
      
      logger.info(`✅ Applied migration: ${migrationId}`);
    }

    await client.query('COMMIT');
    logger.info('✅ All migrations completed');

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
interface DatabaseClient {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
}

async function seedInitialData(client: DatabaseClient): Promise<void> {
  // Get configuration from environment
  const merchantId = requireMerchantId();
  const merchantName = getEnv('MERCHANT_NAME');
  const adminEmail = getEnv('ADMIN_EMAIL');
  const adminPhone = getEnv('ADMIN_PHONE_NUMBER');
  const igBusinessId = getEnv('INSTAGRAM_BUSINESS_ACCOUNT_ID');
  const igPageId = getEnv('PAGE_ID') || getEnv('IG_PAGE_ID');

  if (!merchantName) {
    throw new Error('Environment variable MERCHANT_NAME is required');
  }

  if (!adminEmail) {
    throw new Error('Environment variable ADMIN_EMAIL is required');
  }

  if (!adminPhone) {
    throw new Error('Environment variable ADMIN_PHONE_NUMBER is required');
  }

  if (!igBusinessId) {
    throw new Error('Environment variable INSTAGRAM_BUSINESS_ACCOUNT_ID is required');
  }

  if (!igPageId) {
    throw new Error('Environment variable PAGE_ID or IG_PAGE_ID is required');
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
        instagram_business_account_id,
        platform
      )
      VALUES ($1::uuid, $2, $3, 'instagram')
      ON CONFLICT (instagram_page_id) DO UPDATE
      SET
        merchant_id = EXCLUDED.merchant_id,
        instagram_business_account_id = EXCLUDED.instagram_business_account_id,
        platform = 'instagram',
        updated_at = NOW()
    `, [merchantId, igPageId, igBusinessId]);
    
    await client.query('COMMIT');
    
    logger.info('✅ Seed complete:', {
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