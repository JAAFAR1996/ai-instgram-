/**
 * ===============================================
 * Database Migration System - Production Ready
 * Handles database schema migrations and rollbacks
 * ===============================================
 */

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getLogger } from '../services/logger.js';
import { getPool } from '../db/index.js';

const log = getLogger({ component: 'database-migration' });

function resolveMigrationDir(): string | null {
  const candidates = [
    join(process.cwd(), 'migrations'),
    join(process.cwd(), 'src/database/migrations'),
    join(process.cwd(), 'src/migrations')
  ];
  for (const dir of candidates) {
    try {
      // Using dynamic import to avoid ESM/CJS interop pitfalls
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      
      if (existsSync(dir)) return dir;
    } catch {}
  }
  return null;
}

/**
 * Run database migrations using production-ready pattern
 */
export async function runDatabaseMigrations(): Promise<void> {
  const { Pool } = await import('pg');
  const directPool = process.env.DATABASE_URL
    ? new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
        max: 3,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 15000
      })
    : getPool();

  const migrationDir = resolveMigrationDir();
  if (!migrationDir) {
    log.warn('No migration directory found, skipping migrations');
    return;
  }

  const files = readdirSync(migrationDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    log.info('No migration files found');
    return;
  }

  const client = await (directPool as any).connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )`);

    for (const file of files) {
      const { rows } = await client.query('SELECT 1 FROM _migrations WHERE name = $1', [file]);
      if (rows.length > 0) {
        log.info(`⏭️  Migration already applied: ${file}`);
        continue;
      }

      const sql = readFileSync(join(migrationDir, file), 'utf8');
      log.info(`🔧 Running migration: ${file}`);

      await client.query('BEGIN');
      try {
        await client.query(sql);
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
  } finally {
    client.release();
    if (process.env.DATABASE_URL && typeof (directPool as any).end === 'function' && directPool !== getPool()) {
      await (directPool as any).end();
    }
  }
}

/**
 * Get migration status
 */
export async function getMigrationStatus(): Promise<{
  total: number;
  executed: number;
  pending: number;
  migrations: { name: string; status: 'executed' | 'pending'; applied_at: string | null }[];
}> {
  const { Pool } = await import('pg');
  const directPool = process.env.DATABASE_URL
    ? new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
        max: 3,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 15000
      })
    : getPool();
  const client = await (directPool as any).connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )`);

    const migrationDir = resolveMigrationDir();
    if (!migrationDir) return { total: 0, executed: 0, pending: 0, migrations: [] };

    const allFiles = readdirSync(migrationDir).filter(f => f.endsWith('.sql')).sort();
    const { rows: executedMigrations } = await client.query(
      'SELECT name, applied_at FROM _migrations ORDER BY applied_at'
    );

    const migrations = allFiles.map(file => {
      const executed = executedMigrations.find((m: any) => m.name === file);
      return {
        name: file,
        status: executed ? 'executed' as const : 'pending' as const,
        applied_at: executed?.applied_at || null
      };
    });

    return {
      total: allFiles.length,
      executed: executedMigrations.length,
      pending: allFiles.length - executedMigrations.length,
      migrations
    };
  } finally {
    client.release();
    if (process.env.DATABASE_URL && typeof (directPool as any).end === 'function' && directPool !== getPool()) {
      await (directPool as any).end();
    }
  }
}

/**
 * Create migration tracking table
 */
export async function createMigrationTable(): Promise<void> {
  const { Pool } = await import('pg');
  const directPool = process.env.DATABASE_URL
    ? new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
        max: 3,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 15000
      })
    : getPool();
  const client = await (directPool as any).connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )`);
    log.info('✅ Migration tracking table created');
  } finally {
    client.release();
    if (process.env.DATABASE_URL && typeof (directPool as any).end === 'function' && directPool !== getPool()) {
      await (directPool as any).end();
    }
  }
}

/**
 * Rollback last migration (metadata only)
 */
export async function rollbackMigration(): Promise<void> {
  const { Pool } = await import('pg');
  const directPool = process.env.DATABASE_URL
    ? new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
        max: 3,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 15000
      })
    : getPool();
  const client = await (directPool as any).connect();
  try {
    const { rows } = await client.query('SELECT name FROM _migrations ORDER BY applied_at DESC LIMIT 1');
    if (rows.length === 0) {
      log.info('ℹ️ No migrations to rollback');
      return;
    }
    const lastMigration = rows[0].name;
    log.info(`🔧 Rolling back migration: ${lastMigration}`);
    await client.query('DELETE FROM _migrations WHERE name = $1', [lastMigration]);
    log.info(`✅ Migration rolled back: ${lastMigration}`);
  } finally {
    client.release();
    if (process.env.DATABASE_URL && typeof (directPool as any).end === 'function' && directPool !== getPool()) {
      await (directPool as any).end();
    }
  }
}

// Export functions for backward compatibility
export const migrate = runDatabaseMigrations;
export const rollback = rollbackMigration;

// Default export
export default {
  runDatabaseMigrations,
  getMigrationStatus,
  createMigrationTable,
  rollbackMigration
};


