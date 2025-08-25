/**
 * ===============================================
 * Database Startup Module
 * Handles PostgreSQL pool initialization and migrations
 * ===============================================
 */

import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { getLogger } from '../services/logger.js';

const log = getLogger({ component: 'database-startup' });

// Global pool instance
let pool: Pool | null = null;

/**
 * Initialize database connection pool
 */
export function initializePool(): Pool {
  if (pool) return pool;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const isRender = process.env.IS_RENDER === 'true';

  pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('sslmode=require') ? {
      rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false'
    } : false,
    max: Number(process.env.DB_MAX_CONNECTIONS || process.env.DATABASE_POOL_MAX || 20),
    min: Number(process.env.DATABASE_POOL_MIN || 2),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT || 10000),
  });

  pool.on('error', (err) => {
    log.error('Unexpected database pool error:', err);
  });

  log.info('Database pool initialized');
  return pool;
}

/**
 * Get the database pool instance
 */
export function getPool(): Pool {
  if (!pool) {
    return initializePool();
  }
  return pool;
}

/**
 * Run database migrations
 */
export async function runDatabaseMigrations(): Promise<void> {
  const currentPool = getPool();
  
  // Check for multiple migration directories
  const migrationDirs = [
    path.join(process.cwd(), 'migrations'),
    path.join(process.cwd(), 'src/database/migrations'),
    path.join(process.cwd(), 'src/migrations')
  ];

  let migrationDir: string | null = null;
  for (const dir of migrationDirs) {
    if (fs.existsSync(dir)) {
      migrationDir = dir;
      break;
    }
  }

  if (!migrationDir) {
    log.warn('No migration directory found, skipping migrations');
    return;
  }

  log.info(`Running migrations from: ${migrationDir}`);

  const files = fs.readdirSync(migrationDir)
    .filter(f => f.endsWith('.sql'))
    .sort(); // Ensure chronological order

  if (files.length === 0) {
    log.info('No migration files found');
    return;
  }

  const client = await currentPool.connect();
  try {
    // Create migrations tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    for (const file of files) {
      // Check if migration already applied
      const { rows } = await client.query(
        'SELECT 1 FROM _migrations WHERE name = $1',
        [file]
      );
      
      if (rows.length > 0) {
        log.info(`⏭️  Migration already applied: ${file}`);
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationDir, file), 'utf8');
      log.info(`🔄 Running migration: ${file}`);
      
      await client.query('BEGIN');
      try {
        await client.query(sql);
        // Record migration as applied
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        log.info(`✅ Migration completed: ${file}`);
      } catch (error) {
        await client.query('ROLLBACK');
        log.error(`❌ Migration failed: ${file}`, error);
        throw error;
      }
    }

    log.info('✅ All migrations completed successfully');
  } catch (error) {
    log.error('❌ Migration process failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Close database connections gracefully
 */
export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    log.info('Database pool closed');
  }
}

// Export the pool for backward compatibility
export { pool };