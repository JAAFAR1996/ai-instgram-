/**
 * ===============================================
 * Database Migration Tests - اختبارات شاملة لهجرة قاعدة البيانات
 * Production-grade tests for database schema migrations
 * ===============================================
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { migrate, rollback, getMigrationStatus, createMigrationTable } from './migrate.js';
import { getDatabase } from '../db/adapter.js';
import { getPool } from '../db/index.js';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const TEST_MIGRATION_DIR = 'src/database/migrations';
const BACKUP_SUFFIX = '.test-backup';

describe('Database Migration System - Production Tests', () => {
  let db: any;
  let sql: any;
  let originalMigrations: string[] = [];

  beforeAll(async () => {
    // Initialize database connection
    db = getDatabase();
    sql = db.getSQL();

    // Backup existing migration files
    if (existsSync(TEST_MIGRATION_DIR)) {
      const files = readdirSync(TEST_MIGRATION_DIR).filter(f => f.endsWith('.sql'));
      originalMigrations = files;
    }
  });

  afterAll(async () => {
    // Clean up test migration table
    await sql`DROP TABLE IF EXISTS test_migration_tracking CASCADE`.catch(() => {});
    await sql`DROP TABLE IF EXISTS test_users CASCADE`.catch(() => {});
    await sql`DROP TABLE IF EXISTS test_products CASCADE`.catch(() => {});
    await sql`DROP TABLE IF EXISTS test_orders CASCADE`.catch(() => {});
    await sql`DROP INDEX IF EXISTS test_idx_user_email CASCADE`.catch(() => {});
    
    // Clean up test migration files
    if (existsSync(TEST_MIGRATION_DIR)) {
      const files = readdirSync(TEST_MIGRATION_DIR);
              for (const file of files) {
          if (file.includes('test_migration_') || file.includes(BACKUP_SUFFIX)) {
            try {
              const filePath = join(TEST_MIGRATION_DIR, file);
              if (existsSync(filePath)) {
                const fs = await import('fs');
                fs.unlinkSync(filePath);
              }
            } catch (error) {
              // Ignore cleanup errors
            }
          }
        }
    }
  });

  describe('Migration Table Management Tests', () => {
    beforeEach(async () => {
      // Clean up migration table before each test
      await sql`DROP TABLE IF EXISTS schema_migrations CASCADE`.catch(() => {});
    });

    test('should create migration tracking table', async () => {
      await createMigrationTable();

      // Verify table exists with correct structure
      const tableInfo = await sql`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns 
        WHERE table_name = 'schema_migrations'
        ORDER BY ordinal_position
      `;

      expect(tableInfo.length).toBeGreaterThan(0);
      
      const columns = tableInfo.map((col: any) => col.column_name);
      expect(columns).toContain('version');
      expect(columns).toContain('applied_at');
      expect(columns).toContain('execution_time_ms');
    });

    test('should handle duplicate migration table creation', async () => {
      await createMigrationTable();
      
      // Second call should not throw error
      await expect(createMigrationTable()).resolves.not.toThrow();
      
      // Verify only one table exists
      const tables = await sql`
        SELECT COUNT(*) as count
        FROM information_schema.tables 
        WHERE table_name = 'schema_migrations'
      `;
      
      expect(parseInt(tables[0].count)).toBe(1);
    });
  });

  describe('Migration Status and Tracking Tests', () => {
    beforeEach(async () => {
      await sql`DROP TABLE IF EXISTS schema_migrations CASCADE`.catch(() => {});
      await createMigrationTable();
    });

    test('should return empty status for new database', async () => {
      const status = await getMigrationStatus();

      expect(status.total).toBe(0);
      expect(status.executed).toBe(0);
      expect(status.pending).toBe(0);
      expect(status.migrations).toEqual([]);
    });

    test('should track applied migrations', async () => {
      // Manually add migration record
      await sql`
        INSERT INTO schema_migrations (version, applied_at, execution_time_ms)
        VALUES ('001_initial_schema.sql', NOW(), 150)
      `;

      const status = await getMigrationStatus();

      expect(status.executed).toBe(1);
      expect(status.migrations[0]?.name).toBe('001_initial_schema.sql');
      expect(status.migrations[0]?.status).toBe('executed');
      expect(status.migrations[0]?.applied_at).toBeTruthy();
    });

    test('should identify pending migrations', async () => {
      // Create test migration file
      const testMigrationFile = join(TEST_MIGRATION_DIR, '999_test_migration_pending.sql');
      writeFileSync(testMigrationFile, `
        -- Test migration
        CREATE TABLE test_pending_table (
          id SERIAL PRIMARY KEY,
          name VARCHAR(100)
        );
      `);

      const status = await getMigrationStatus();

      expect(status.pending).toBeGreaterThan(0);
      expect(status.migrations.some(m => m.name.includes('999_test_migration_pending.sql'))).toBe(true);
    });
  });

  describe('Forward Migration Tests', () => {
    beforeEach(async () => {
      await sql`DROP TABLE IF EXISTS schema_migrations CASCADE`.catch(() => {});
      await sql`DROP TABLE IF EXISTS test_users CASCADE`.catch(() => {});
      await sql`DROP TABLE IF EXISTS test_products CASCADE`.catch(() => {});
      await createMigrationTable();
    });

    test('should execute single migration successfully', async () => {
      // Create test migration
      const migrationContent = `
        -- Test migration: Create users table
        CREATE TABLE test_users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          email VARCHAR(255) UNIQUE NOT NULL,
          name VARCHAR(100) NOT NULL,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );

        -- Create index
        CREATE INDEX idx_test_users_email ON test_users(email);
      `;

      const testMigrationFile = join(TEST_MIGRATION_DIR, '998_test_create_users.sql');
      writeFileSync(testMigrationFile, migrationContent);

      const startTime = Date.now();
      await migrate();
      const executionTime = Date.now() - startTime;

      // Verify table was created
      const tableExists = await sql`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'test_users'
        )
      `;
      expect(tableExists[0].exists).toBe(true);

      // Verify index was created
      const indexExists = await sql`
        SELECT EXISTS (
          SELECT FROM pg_indexes 
          WHERE indexname = 'idx_test_users_email'
        )
      `;
      expect(indexExists[0].exists).toBe(true);

      // Verify migration was tracked
      const migrationRecord = await sql`
        SELECT * FROM schema_migrations 
        WHERE version = '998_test_create_users.sql'
      `;

      expect(migrationRecord.length).toBe(1);
      expect(migrationRecord[0].execution_time_ms).toBeGreaterThan(0);
      expect(migrationRecord[0].execution_time_ms).toBeLessThan(executionTime * 2); // Reasonable bounds
    });

    test('should execute multiple migrations in sequence', async () => {
      // Create multiple test migrations
      const migrations = [
        {
          file: '997_test_create_products.sql',
          content: `
            CREATE TABLE test_products (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              name VARCHAR(200) NOT NULL,
              price DECIMAL(10,2) NOT NULL,
              created_at TIMESTAMP DEFAULT NOW()
            );
          `
        },
        {
          file: '996_test_create_orders.sql',
          content: `
            CREATE TABLE test_orders (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              user_id UUID REFERENCES test_users(id),
              product_id UUID REFERENCES test_products(id),
              quantity INTEGER NOT NULL DEFAULT 1,
              total_amount DECIMAL(10,2) NOT NULL,
              created_at TIMESTAMP DEFAULT NOW()
            );

            CREATE INDEX idx_test_orders_user_id ON test_orders(user_id);
            CREATE INDEX idx_test_orders_created_at ON test_orders(created_at);
          `
        }
      ];

      // First create the users table (dependency)
      writeFileSync(
        join(TEST_MIGRATION_DIR, '998_test_create_users.sql'),
        `CREATE TABLE test_users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          email VARCHAR(255) UNIQUE NOT NULL
        );`
      );

      // Create migration files
      migrations.forEach(migration => {
        writeFileSync(join(TEST_MIGRATION_DIR, migration.file), migration.content);
      });

      // Run migrations
      await migrate();
      await migrate();
      await migrate();

      // Verify all tables exist
      const tables = await sql`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_name IN ('test_users', 'test_products', 'test_orders')
      `;

      expect(tables.length).toBe(3);

      // Verify foreign key constraints work
      const constraints = await sql`
        SELECT COUNT(*) as count
        FROM information_schema.table_constraints 
        WHERE table_name = 'test_orders' 
        AND constraint_type = 'FOREIGN KEY'
      `;

      expect(parseInt(constraints[0].count)).toBe(2);

      // Verify all migrations were tracked
      const appliedMigrations = await sql`
        SELECT version FROM schema_migrations 
        WHERE version IN ('998_test_create_users.sql', '997_test_create_products.sql', '996_test_create_orders.sql')
        ORDER BY version
      `;

      expect(appliedMigrations.length).toBe(3);
    });

    test('should handle migration with syntax errors gracefully', async () => {
      const badMigrationContent = `
        -- This migration has syntax errors
        CREATE TABLE test_bad_table (
          id UUID PRIMARY KEY,
          invalid_syntax_here <<<>>>
        );
      `;

      const testMigrationFile = join(TEST_MIGRATION_DIR, '995_test_bad_migration.sql');
      writeFileSync(testMigrationFile, badMigrationContent);

      await expect(migrate()).rejects.toThrow();

      // Verify table was not created
      const tableExists = await sql`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'test_bad_table'
        )
      `;
      expect(tableExists[0].exists).toBe(false);

      // Verify migration was not tracked
      const migrationRecord = await sql`
        SELECT * FROM schema_migrations 
        WHERE version = '995_test_bad_migration.sql'
      `;

      expect(migrationRecord.length).toBe(0);
    });

    test('should prevent duplicate migration execution', async () => {
      const migrationContent = `
        CREATE TABLE test_duplicate_prevention (
          id SERIAL PRIMARY KEY,
          name VARCHAR(100)
        );
      `;

      const testMigrationFile = join(TEST_MIGRATION_DIR, '994_test_duplicate.sql');
      writeFileSync(testMigrationFile, migrationContent);

      // Run migration first time
      await migrate();

      // Attempt to run again should be prevented
      await expect(migrate()).rejects.toThrow();

      // Verify only one migration record exists
      const migrationRecords = await sql`
        SELECT COUNT(*) as count FROM schema_migrations 
        WHERE version = '994_test_duplicate.sql'
      `;

      expect(parseInt(migrationRecords[0].count)).toBe(1);
    });
  });

  describe('Complex Migration Scenarios Tests', () => {
    beforeEach(async () => {
      await sql`DROP TABLE IF EXISTS schema_migrations CASCADE`.catch(() => {});
      await createMigrationTable();
      
      // Clean up test tables
      await sql`DROP TABLE IF EXISTS test_complex_table CASCADE`.catch(() => {});
      await sql`DROP FUNCTION IF EXISTS test_update_timestamp() CASCADE`.catch(() => {});
    });

    test('should handle migration with functions and triggers', async () => {
      const complexMigrationContent = `
        -- Create table with advanced features
        CREATE TABLE test_complex_table (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(200) NOT NULL,
          email VARCHAR(255) UNIQUE NOT NULL,
          status VARCHAR(20) DEFAULT 'active',
          metadata JSONB DEFAULT '{}',
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW(),
          
          CONSTRAINT check_status CHECK (status IN ('active', 'inactive', 'pending'))
        );

        -- Create function for updating timestamps
        CREATE OR REPLACE FUNCTION test_update_timestamp()
        RETURNS TRIGGER AS $$
        BEGIN
          NEW.updated_at = NOW();
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Create trigger
        CREATE TRIGGER test_update_timestamp_trigger
          BEFORE UPDATE ON test_complex_table
          FOR EACH ROW EXECUTE FUNCTION test_update_timestamp();

        -- Create partial index
        CREATE INDEX test_idx_complex_active_users 
          ON test_complex_table(name) 
          WHERE status = 'active';

        -- Create GIN index for JSONB
        CREATE INDEX test_idx_complex_metadata 
          ON test_complex_table USING GIN (metadata);
      `;

      const testMigrationFile = join(TEST_MIGRATION_DIR, '993_test_complex.sql');
      writeFileSync(testMigrationFile, complexMigrationContent);

      await migrate();

      // Verify table structure
      const columns = await sql`
        SELECT column_name, data_type, column_default, is_nullable
        FROM information_schema.columns 
        WHERE table_name = 'test_complex_table'
        ORDER BY ordinal_position
      `;

      expect(columns.length).toBe(7);
      expect(columns.find((c: any) => c.column_name === 'metadata').data_type).toBe('jsonb');

      // Verify constraints
      const constraints = await sql`
        SELECT constraint_name, constraint_type
        FROM information_schema.table_constraints 
        WHERE table_name = 'test_complex_table'
      `;

      expect(constraints.some((c: any) => c.constraint_type === 'CHECK')).toBe(true);
      expect(constraints.some((c: any) => c.constraint_type === 'UNIQUE')).toBe(true);

      // Verify function exists
      const functions = await sql`
        SELECT routine_name
        FROM information_schema.routines 
        WHERE routine_name = 'test_update_timestamp'
      `;

      expect(functions.length).toBe(1);

      // Verify trigger exists
      const triggers = await sql`
        SELECT trigger_name
        FROM information_schema.triggers 
        WHERE trigger_name = 'test_update_timestamp_trigger'
      `;

      expect(triggers.length).toBe(1);

      // Test trigger functionality
      await sql`
        INSERT INTO test_complex_table (name, email) 
        VALUES ('Test User', 'test@example.com')
      `;

      const initialRecord = await sql`
        SELECT created_at, updated_at FROM test_complex_table 
        WHERE email = 'test@example.com'
      `;

      await new Promise(resolve => setTimeout(resolve, 100)); // Ensure timestamp difference

      await sql`
        UPDATE test_complex_table 
        SET name = 'Updated User' 
        WHERE email = 'test@example.com'
      `;

      const updatedRecord = await sql`
        SELECT created_at, updated_at FROM test_complex_table 
        WHERE email = 'test@example.com'
      `;

      expect(updatedRecord[0].updated_at.getTime()).toBeGreaterThan(
        updatedRecord[0].created_at.getTime()
      );
    });

    test('should handle migration with data transformations', async () => {
      // First, create a table with old structure
      await sql`
        CREATE TABLE test_data_migration (
          id SERIAL PRIMARY KEY,
          full_name VARCHAR(200),
          contact_info TEXT,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `;

      // Insert test data
      await sql`
        INSERT INTO test_data_migration (full_name, contact_info) VALUES 
        ('John Doe', 'john.doe@email.com|+1234567890'),
        ('Jane Smith', 'jane.smith@email.com|+9876543210'),
        ('Ahmad Ali', 'ahmad.ali@email.com|+1111111111')
      `;

      const dataMigrationContent = `
        -- Add new columns
        ALTER TABLE test_data_migration 
        ADD COLUMN first_name VARCHAR(100),
        ADD COLUMN last_name VARCHAR(100),
        ADD COLUMN email VARCHAR(255),
        ADD COLUMN phone VARCHAR(20);

        -- Split full_name and contact_info
        UPDATE test_data_migration 
        SET 
          first_name = SPLIT_PART(full_name, ' ', 1),
          last_name = SPLIT_PART(full_name, ' ', 2),
          email = SPLIT_PART(contact_info, '|', 1),
          phone = SPLIT_PART(contact_info, '|', 2);

        -- Drop old columns
        ALTER TABLE test_data_migration 
        DROP COLUMN full_name,
        DROP COLUMN contact_info;

        -- Add constraints
        ALTER TABLE test_data_migration 
        ADD CONSTRAINT test_data_migration_email_unique UNIQUE (email);
      `;

      const testMigrationFile = join(TEST_MIGRATION_DIR, '992_test_data_transform.sql');
      writeFileSync(testMigrationFile, dataMigrationContent);

      await migrate();

      // Verify data transformation
      const transformedData = await sql`
        SELECT first_name, last_name, email, phone 
        FROM test_data_migration 
        ORDER BY email
      `;

      expect(transformedData.length).toBe(3);
      expect(transformedData[0].first_name).toBe('Ahmad');
      expect(transformedData[0].last_name).toBe('Ali');
      expect(transformedData[0].email).toBe('ahmad.ali@email.com');
      expect(transformedData[0].phone).toBe('+1111111111');

      // Verify constraints were added
      const uniqueConstraints = await sql`
        SELECT constraint_name
        FROM information_schema.table_constraints 
        WHERE table_name = 'test_data_migration' 
        AND constraint_type = 'UNIQUE'
      `;

      expect(uniqueConstraints.length).toBeGreaterThan(0);
    });
  });

  describe('Migration Performance and Reliability Tests', () => {
    test('should handle large dataset migrations efficiently', async () => {
      // Create table for performance test
      await sql`
        CREATE TABLE test_performance_migration (
          id SERIAL PRIMARY KEY,
          data VARCHAR(100),
          created_at TIMESTAMP DEFAULT NOW()
        )
      `;

      // Insert large dataset
      const batchSize = 1000;
      const totalRecords = 5000;

      for (let i = 0; i < totalRecords / batchSize; i++) {
        const values = Array.from({ length: batchSize }, (_, j) => 
          `('Test data ${i * batchSize + j + 1}', NOW())`
        ).join(',');

        await sql.unsafe(`
          INSERT INTO test_performance_migration (data, created_at) 
          VALUES ${values}
        `);
      }

      const performanceMigrationContent = `
        -- Add index on large dataset
        CREATE INDEX CONCURRENTLY idx_test_performance_data 
          ON test_performance_migration(data);

        -- Add new column with default value
        ALTER TABLE test_performance_migration 
        ADD COLUMN status VARCHAR(20) DEFAULT 'pending';

        -- Update all records (potentially slow operation)
        UPDATE test_performance_migration 
        SET status = CASE 
          WHEN id % 2 = 0 THEN 'active'
          ELSE 'inactive'
        END;

        -- Create partial index
        CREATE INDEX idx_test_performance_active 
          ON test_performance_migration(created_at) 
          WHERE status = 'active';
      `;

      const testMigrationFile = join(TEST_MIGRATION_DIR, '991_test_performance.sql');
      writeFileSync(testMigrationFile, performanceMigrationContent);

      const startTime = Date.now();
      await migrate();
      const executionTime = Date.now() - startTime;

      // Verify migration completed successfully
      const recordCount = await sql`
        SELECT COUNT(*) as count FROM test_performance_migration 
        WHERE status IN ('active', 'inactive')
      `;

      expect(parseInt(recordCount[0].count)).toBe(totalRecords);

      // Verify indexes were created
      const indexes = await sql`
        SELECT indexname FROM pg_indexes 
        WHERE tablename = 'test_performance_migration'
      `;

      expect(indexes.length).toBeGreaterThan(2); // At least primary key + our indexes

      // Performance should be reasonable (less than 30 seconds for 5000 records)
      expect(executionTime).toBeLessThan(30000);

      // Verify migration timing was recorded
      const migrationRecord = await sql`
        SELECT execution_time_ms FROM schema_migrations 
        WHERE version = '991_test_performance.sql'
      `;

      expect(migrationRecord[0].execution_time_ms).toBeGreaterThan(0);
      expect(migrationRecord[0].execution_time_ms).toBeLessThan(executionTime + 1000); // Within reasonable bounds
    });

    test('should handle concurrent migration attempts safely', async () => {
      const concurrentMigrationContent = `
        CREATE TABLE test_concurrent_migration (
          id SERIAL PRIMARY KEY,
          name VARCHAR(100)
        );
      `;

      const testMigrationFile = join(TEST_MIGRATION_DIR, '990_test_concurrent.sql');
      writeFileSync(testMigrationFile, concurrentMigrationContent);

      // Attempt concurrent migrations (should fail gracefully)
      const migrationPromises = [
        migrate(),
        migrate(),
        migrate()
      ];

      const results = await Promise.allSettled(migrationPromises);

      // Only one should succeed, others should fail
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      expect(successful).toBe(1);
      expect(failed).toBe(2);

      // Verify only one migration record exists
      const migrationRecords = await sql`
        SELECT COUNT(*) as count FROM schema_migrations 
        WHERE version = '990_test_concurrent.sql'
      `;

      expect(parseInt(migrationRecords[0].count)).toBe(1);
    });
  });

  describe('Migration Rollback and Recovery Tests', () => {
    beforeEach(async () => {
      await sql`DROP TABLE IF EXISTS schema_migrations CASCADE`.catch(() => {});
      await sql`DROP TABLE IF EXISTS test_rollback_table CASCADE`.catch(() => {});
      await createMigrationTable();
    });

    test('should rollback failed migration transactions', async () => {
      const failingMigrationContent = `
        -- This will succeed
        CREATE TABLE test_rollback_table (
          id SERIAL PRIMARY KEY,
          name VARCHAR(100)
        );

        -- This will fail and should rollback the entire migration
        ALTER TABLE non_existent_table ADD COLUMN test_column VARCHAR(50);
      `;

      const testMigrationFile = join(TEST_MIGRATION_DIR, '989_test_rollback.sql');
      writeFileSync(testMigrationFile, failingMigrationContent);

      await expect(migrate()).rejects.toThrow();

      // Verify table was not created (transaction rolled back)
      const tableExists = await sql`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'test_rollback_table'
        )
      `;
      expect(tableExists[0].exists).toBe(false);

      // Verify migration was not tracked
      const migrationRecord = await sql`
        SELECT * FROM schema_migrations 
        WHERE version = '989_test_rollback.sql'
      `;

      expect(migrationRecord.length).toBe(0);
    });
  });

  describe('Real-world Migration Scenarios', () => {
    test('should handle Instagram-specific table migrations', async () => {
      const instagramMigrationContent = `
        -- Create Instagram integration tables
        CREATE TABLE instagram_accounts (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          merchant_id UUID NOT NULL,
          username VARCHAR(100) UNIQUE NOT NULL,
          access_token_encrypted TEXT NOT NULL,
          page_id VARCHAR(100),
          account_type VARCHAR(20) DEFAULT 'business',
          is_active BOOLEAN DEFAULT true,
          last_sync_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE instagram_media (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          merchant_id UUID NOT NULL,
          instagram_account_id UUID REFERENCES instagram_accounts(id) ON DELETE CASCADE,
          media_id VARCHAR(100) UNIQUE NOT NULL,
          media_type VARCHAR(20) NOT NULL, -- image, video, carousel_album
          caption TEXT,
          permalink TEXT,
          thumbnail_url TEXT,
          media_url TEXT,
          like_count INTEGER DEFAULT 0,
          comments_count INTEGER DEFAULT 0,
          timestamp TIMESTAMP NOT NULL,
          created_at TIMESTAMP DEFAULT NOW(),
          
          CONSTRAINT check_media_type CHECK (media_type IN ('IMAGE', 'VIDEO', 'CAROUSEL_ALBUM'))
        );

        -- Create indexes for performance
        CREATE INDEX idx_instagram_accounts_merchant_id ON instagram_accounts(merchant_id);
        CREATE INDEX idx_instagram_accounts_active ON instagram_accounts(is_active) WHERE is_active = true;
        CREATE INDEX idx_instagram_media_account_id ON instagram_media(instagram_account_id);
        CREATE INDEX idx_instagram_media_timestamp ON instagram_media(timestamp DESC);
        CREATE INDEX idx_instagram_media_merchant_engagement 
          ON instagram_media(merchant_id, like_count DESC, comments_count DESC);

        -- Create function for updating timestamps
        CREATE OR REPLACE FUNCTION update_instagram_timestamp()
        RETURNS TRIGGER AS $$
        BEGIN
          NEW.updated_at = NOW();
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Create triggers
        CREATE TRIGGER update_instagram_accounts_timestamp
          BEFORE UPDATE ON instagram_accounts
          FOR EACH ROW EXECUTE FUNCTION update_instagram_timestamp();
      `;

      const testMigrationFile = join(TEST_MIGRATION_DIR, '988_instagram_tables.sql');
      writeFileSync(testMigrationFile, instagramMigrationContent);

      await migrate();

      // Verify Instagram tables were created
      const tables = await sql`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_name IN ('instagram_accounts', 'instagram_media')
      `;

      expect(tables.length).toBe(2);

      // Verify foreign key relationships
      const foreignKeys = await sql`
        SELECT 
          tc.constraint_name,
          kcu.column_name,
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY' 
        AND tc.table_name = 'instagram_media'
      `;

      expect(foreignKeys.length).toBe(1);
      expect(foreignKeys[0].foreign_table_name).toBe('instagram_accounts');

      // Test the relationship and trigger
      await sql`
        INSERT INTO instagram_accounts (merchant_id, username, access_token_encrypted)
        VALUES (gen_random_uuid(), 'test_username', 'encrypted_token')
      `;

      const account = await sql`
        SELECT id, created_at, updated_at 
        FROM instagram_accounts 
        WHERE username = 'test_username'
      `;

      expect(account.length).toBe(1);

      // Test trigger by updating
      await new Promise(resolve => setTimeout(resolve, 100));
      
      await sql`
        UPDATE instagram_accounts 
        SET username = 'updated_username' 
        WHERE username = 'test_username'
      `;

      const updatedAccount = await sql`
        SELECT created_at, updated_at 
        FROM instagram_accounts 
        WHERE username = 'updated_username'
      `;

      expect(updatedAccount[0].updated_at.getTime()).toBeGreaterThan(
        updatedAccount[0].created_at.getTime()
      );
    });
  });
});