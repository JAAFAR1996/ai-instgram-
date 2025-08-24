/**
 * ===============================================
 * Database Migration Runner
 * Handles database schema migrations safely
 * ===============================================
 */

import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { getDatabase } from '../db/adapter.js';
import type { SqlFunction } from '../db/sql-template.js';
import type { Migration } from '../types/database.js';
import { logger } from '../services/logger.js';

export class MigrationRunner {
  private db = getDatabase();
  private migrationsPath: string;

  constructor(migrationsPath?: string) {
    this.migrationsPath = migrationsPath || join(process.cwd(), 'src/database/migrations');
  }

  /**
   * Run all pending migrations
   */
  public async migrate(): Promise<void> {
    try {
      logger.info('🚀 Starting database migrations...');
      
      // Ensure database connection
      if (!this.db.isReady()) {
        await this.db.connect();
      }

      // Create migrations table if it doesn't exist
      await this.createMigrationsTable();

      // Get pending migrations
      const pendingMigrations = await this.getPendingMigrations();
      
      if (pendingMigrations.length === 0) {
        logger.info('✅ No pending migrations found');
        return;
      }

      logger.info(`📋 Found ${pendingMigrations.length} pending migrations`);

      // Run each migration in transaction
      for (const migration of pendingMigrations) {
        await this.runMigration(migration);
      }

      logger.info('✅ All migrations completed successfully');
    } catch (error) {
      console.error('❌ Migration failed:', error);
      throw error;
    }
  }

  /**
   * Rollback last migration (if rollback file exists)
   */
  public async rollback(): Promise<void> {
    try {
      logger.info('🔄 Starting migration rollback...');
      
      const lastMigration = await this.getLastExecutedMigration();
      if (!lastMigration) {
        logger.info('ℹ️ No migrations to rollback');
        return;
      }

      const rollbackFile = lastMigration.filename.replace('.sql', '.rollback.sql');
      const rollbackPath = join(this.migrationsPath, rollbackFile);

      try {
        const rollbackSQL = await readFile(rollbackPath, 'utf-8');
        
        await this.db.transaction(async (sql: SqlFunction) => {
          // Execute rollback SQL
          await sql.unsafe(rollbackSQL);
          
          // Remove migration record
          await sql`
            DELETE FROM migrations 
            WHERE id = ${lastMigration.id}
          `;
        });

        logger.info(`✅ Rollback completed for migration: ${lastMigration.name}`);
      } catch (error) {
        console.error(`❌ Rollback file not found: ${rollbackPath}`);
        throw new Error(`Cannot rollback migration ${lastMigration.name}: rollback file missing`);
      }
    } catch (error) {
      console.error('❌ Rollback failed:', error);
      throw error;
    }
  }

  /**
   * Get migration status
   */
  public async status(): Promise<{
    total: number;
    executed: number;
    pending: number;
    migrations: Array<Migration & { status: 'executed' | 'pending' }>;
  }> {
    try {
      const allMigrations = await this.getAllMigrationFiles();
      const executedMigrations = await this.getExecutedMigrations();
      
      const migrations = allMigrations.map(file => {
        const executed = executedMigrations.find(m => m.filename === file);
        const status: 'executed' | 'pending' = executed ? 'executed' : 'pending';
        const executedAt: Date = executed?.executed_at ?? new Date(0);
        const row = {
          id: executed?.id || 0,
          name: this.extractMigrationName(file),
          filename: file,
          executed_at: executedAt,
          status
        };
        // تطابقًا صارمًا مع النوع المستهدف
        return row as unknown as Migration & { status: 'executed' | 'pending' };
      });

      return {
        total: allMigrations.length,
        executed: executedMigrations.length,
        pending: allMigrations.length - executedMigrations.length,
        migrations: migrations as Array<Migration & { status: 'executed' | 'pending' }>
      };
    } catch (error) {
      console.error('❌ Error getting migration status:', error);
      throw error;
    }
  }

  /**
   * Create a new migration file
   */
  public async create(name: string): Promise<string> {
    try {
      const timestamp = new Date().toISOString().replace(/[-T:\.Z]/g, '').slice(0, 14);
      const filename = `${timestamp}_${name.toLowerCase().replace(/\s+/g, '_')}.sql`;
      const filepath = join(this.migrationsPath, filename);

      const template = `-- ===============================================
-- Migration: ${name}
-- Created: ${new Date().toISOString()}
-- ===============================================

-- Add your migration SQL here

-- Record this migration
INSERT INTO migrations (name, filename) VALUES ('${name}', '${filename}');
`;

      await readFile(filepath).catch(async () => {
        // File doesn't exist, create it
        const fs = await import('fs/promises');
        await fs.writeFile(filepath, template, 'utf-8');
      });

      logger.info(`✅ Migration file created: ${filename}`);
      return filepath;
    } catch (error) {
      console.error('❌ Error creating migration:', error);
      throw error;
    }
  }

  /**
   * Validate all migrations without executing
   */
  public async validate(): Promise<boolean> {
    try {
      logger.info('🔍 Validating migrations...');
      
      const migrationFiles = await this.getAllMigrationFiles();
      let isValid = true;

      for (const file of migrationFiles) {
        try {
          const filepath = join(this.migrationsPath, file);
          const content = await readFile(filepath, 'utf-8');
          
          // Basic validation
          if (!content.trim()) {
            console.error(`❌ Empty migration file: ${file}`);
            isValid = false;
            continue;
          }

          // Check for required elements
          // لم نعد نلزم الملف بتسجيل نفسه. التسجيل مركزي بعد التنفيذ.

          logger.info(`✅ ${file} - Valid`);
        } catch (error) {
          console.error(`❌ ${file} - Invalid:`, error);
          isValid = false;
        }
      }

      if (isValid) {
        logger.info('✅ All migrations are valid');
      } else {
        console.error('❌ Some migrations have validation errors');
      }

      return isValid;
    } catch (error) {
      console.error('❌ Validation failed:', error);
      return false;
    }
  }

  /**
   * Reset database (drop all tables and re-run migrations)
   * WARNING: This will destroy all data!
   */
  public async reset(): Promise<void> {
    try {
      logger.info('⚠️ WARNING: This will destroy all data!');
      logger.info('🔄 Resetting database...');
      
      await this.db.transaction(async (sql: SqlFunction) => {
        // Drop all tables in reverse dependency order
        await sql`DROP TABLE IF EXISTS message_logs CASCADE`;
        await sql`DROP TABLE IF EXISTS conversations CASCADE`;
        await sql`DROP TABLE IF EXISTS orders CASCADE`;
        await sql`DROP TABLE IF EXISTS products CASCADE`;
        await sql`DROP TABLE IF EXISTS merchants CASCADE`;
        await sql`DROP TABLE IF EXISTS migrations CASCADE`;
        
        // Drop all views
        await sql`DROP VIEW IF EXISTS merchant_analytics CASCADE`;
        await sql`DROP VIEW IF EXISTS daily_platform_stats CASCADE`;
        await sql`DROP VIEW IF EXISTS product_performance CASCADE`;
        await sql`DROP VIEW IF EXISTS customer_analytics CASCADE`;
        await sql`DROP VIEW IF EXISTS ai_performance_stats CASCADE`;
        
        // Drop functions
        await sql`DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE`;
        await sql`DROP FUNCTION IF EXISTS generate_order_number() CASCADE`;
        await sql`DROP FUNCTION IF EXISTS update_merchant_search_vector() CASCADE`;
        await sql`DROP FUNCTION IF EXISTS update_product_search_vector() CASCADE`;
        await sql`DROP FUNCTION IF EXISTS update_message_content_search() CASCADE`;
        await sql`DROP FUNCTION IF EXISTS get_merchant_kpis(UUID, INTEGER) CASCADE`;
        await sql`DROP FUNCTION IF EXISTS get_platform_health() CASCADE`;
        await sql`DROP FUNCTION IF EXISTS get_performance_metrics(INTEGER) CASCADE`;
      });

      logger.info('🗑️ Database reset completed');
      
      // Re-run all migrations
      await this.migrate();
    } catch (error) {
      console.error('❌ Database reset failed:', error);
      throw error;
    }
  }

  /**
   * Create migrations table if it doesn't exist
   */
  public async createMigrationsTable(): Promise<void> {
    const sql = this.db.getSQL() as any;
    
    await sql`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        filename VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
  }

  /**
   * Get all migration files from disk
   */
  private async getAllMigrationFiles(): Promise<string[]> {
    try {
      const files = await readdir(this.migrationsPath);
      return files
        .filter(file => file.endsWith('.sql') && !file.endsWith('.rollback.sql'))
        .sort(); // Sort by filename (which includes timestamp)
    } catch (error) {
      console.error('❌ Error reading migrations directory:', error);
      throw new Error(`Cannot read migrations directory: ${this.migrationsPath}`);
    }
  }

  /**
   * Get executed migrations from database
   */
  private async getExecutedMigrations(): Promise<Migration[]> {
    const sql = this.db.getSQL() as any;
    
    try {
      const migrations = await sql<Migration>`
        SELECT id, name, filename, executed_at 
        FROM migrations 
        ORDER BY id ASC
      `;
      return migrations;
    } catch (error) {
      // If migrations table doesn't exist, return empty array
      return [];
    }
  }

  /**
   * Get pending migrations
   */
  private async getPendingMigrations(): Promise<string[]> {
    const allMigrations = await this.getAllMigrationFiles();
    const executedMigrations = await this.getExecutedMigrations();
    const executedFilenames = new Set(executedMigrations.map(m => m.filename));
    
    return allMigrations.filter(file => !executedFilenames.has(file));
  }

  /**
   * Get last executed migration
   */
  private async getLastExecutedMigration(): Promise<Migration | null> {
    const executed = await this.getExecutedMigrations();
    return executed.length > 0 ? executed[executed.length - 1]! : null;
  }

  /**
   * Run a single migration
   */
  private async runMigration(filename: string): Promise<void> {
    // Sanitize filename to prevent path traversal
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '');
    if (sanitizedFilename !== filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      throw new Error(`Invalid migration filename: ${filename}`);
    }
    const filepath = join(this.migrationsPath, sanitizedFilename);
    const migrationName = this.extractMigrationName(filename);
    
    try {
      logger.info(`📄 Running migration: ${migrationName}`);
      
      const sql_content = await readFile(filepath, 'utf-8');
      
      await this.db.transaction(async (sql: SqlFunction) => {
        // تنفيذ سكربت الهجرة
        await sql.unsafe(sql_content);
        // تسجيل التنفيذ بشكل مركزي
        const sanitizedFilename = filename.replace(/[^a-zA-Z0-9_.-]/g, '');
        await sql`
          INSERT INTO migrations (name, filename)
          VALUES (${migrationName}, ${sanitizedFilename})
          ON CONFLICT (filename) DO NOTHING
        `;
      });
      
      logger.info(`✅ Migration completed: ${migrationName}`);
    } catch (error) {
      console.error(`❌ Migration failed: ${migrationName}`, error);
      throw new Error(`Migration ${filename} failed: ${error}`);
    }
  }

  /**
   * Extract migration name from filename
   */
  private extractMigrationName(filename: string): string {
    // Remove timestamp prefix and .sql extension
    return filename
      .replace(/^\d+_/, '') // Remove leading timestamp
      .replace(/\.sql$/, '') // Remove .sql extension
      .replace(/_/g, ' ') // Replace underscores with spaces
      .replace(/\b\w/g, char => char.toUpperCase()); // Capitalize words
  }
}

// Export singleton instance
const migrationRunner = new MigrationRunner();

// CLI interface
export async function runMigrations(): Promise<void> {
  await migrationRunner.migrate();
}

export async function rollbackMigration(): Promise<void> {
  await migrationRunner.rollback();
}

// Export functions for testing
export const migrate = () => migrationRunner.migrate();
export const rollback = () => migrationRunner.rollback();
export const getMigrationStatus = () => migrationRunner.status();
export const createMigrationTable = () => migrationRunner.createMigrationsTable();

export async function createMigration(name: string): Promise<string> {
  return await migrationRunner.create(name);
}

export async function validateMigrations(): Promise<boolean> {
  return await migrationRunner.validate();
}

export async function resetDatabase(): Promise<void> {
  await migrationRunner.reset();
}

// Default export
export default migrationRunner;

// CLI script runner (when file is executed directly)
async function runCLI() {
  const command = process.argv[2];
  
  try {
    switch (command) {
      case 'migrate':
      case 'up':
        await runMigrations();
        break;
      case 'rollback':
        await rollbackMigration();
        break;
      case 'status':
        const status = await getMigrationStatus();
        logger.info('📊 Migration Status:');
        logger.info(`Total: ${status.total}, Executed: ${status.executed}, Pending: ${status.pending}`);
        status.migrations.forEach((m: any) => {
          const indicator = m.status === 'executed' ? '✅' : '⏳';
          logger.info(`${indicator} ${m.name} (${m.filename})`);
        });
        break;
      case 'create':
        const name = process.argv[3];
        if (!name) {
          console.error('❌ Please provide migration name: bun run migrate.ts create "migration name"');
          process.exit(1);
        }
        await createMigration(name);
        break;
      case 'validate':
        const isValid = await validateMigrations();
        process.exit(isValid ? 0 : 1);
        break;
      case 'reset':
        logger.info('⚠️ WARNING: This will destroy ALL data!');
        await resetDatabase();
        break;
      default:
        logger.info('📖 Available commands:');
        logger.info('  migrate   - Run pending migrations');
        logger.info('  rollback  - Rollback last migration');
        logger.info('  status    - Show migration status');
        logger.info('  create    - Create new migration');
        logger.info('  validate  - Validate all migrations');
        logger.info('  reset     - Reset database (DANGER!)');
    }
  } catch (error) {
    console.error('❌ Command failed:', error);
    process.exit(1);
  }
}

// Check if this file is being run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runCLI().catch(console.error);
}