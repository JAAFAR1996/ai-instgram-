/**
 * ===============================================
 * Migration 032: Unify Migration Tracking Tables
 * ===============================================
 * 
 * This migration consolidates all migration tracking tables into a single
 * schema_migrations table for consistency and better management.
 * 
 * Consolidates:
 * - migrations table (from 001_initial_schema.sql)
 * - _migrations table (from startup/database.ts)
 * - schema_migrations table (from migrate.test.ts)
 */

-- Create unified migration tracking table
CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMPTZ DEFAULT NOW(),
    execution_time_ms INTEGER,
    checksum VARCHAR(64),
    success BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_schema_migrations_applied_at 
ON schema_migrations(applied_at);

CREATE INDEX IF NOT EXISTS idx_schema_migrations_success 
ON schema_migrations(success);

-- Migrate data from existing migration tables
-- First, migrate from 'migrations' table (if exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'migrations') THEN
        INSERT INTO schema_migrations (version, applied_at, success)
        SELECT DISTINCT 
            filename as version,
            COALESCE(executed_at, NOW()) as applied_at,
            TRUE as success
        FROM migrations 
        WHERE filename IS NOT NULL
        ON CONFLICT (version) DO NOTHING;
        
        RAISE NOTICE 'Migrated data from migrations table';
    END IF;
END $$;

-- Migrate from '_migrations' table (if exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = '_migrations') THEN
        INSERT INTO schema_migrations (version, applied_at, success)
        SELECT DISTINCT 
            name as version,
            COALESCE(applied_at, NOW()) as applied_at,
            TRUE as success
        FROM _migrations
        WHERE name IS NOT NULL
        ON CONFLICT (version) DO NOTHING;
        
        RAISE NOTICE 'Migrated data from _migrations table';
    END IF;
END $$;

-- Insert current migration into tracking
INSERT INTO schema_migrations (version, applied_at, success)
VALUES ('032_unify_migration_tracking.sql', NOW(), TRUE)
ON CONFLICT (version) DO NOTHING;

-- Create function to get migration status
CREATE OR REPLACE FUNCTION get_migration_status()
RETURNS TABLE(
    version VARCHAR(255),
    applied_at TIMESTAMPTZ,
    execution_time_ms INTEGER,
    success BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        sm.version,
        sm.applied_at,
        sm.execution_time_ms,
        sm.success
    FROM schema_migrations sm
    ORDER BY sm.applied_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to check if migration is applied
CREATE OR REPLACE FUNCTION is_migration_applied(migration_version VARCHAR(255))
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM schema_migrations 
        WHERE version = migration_version AND success = TRUE
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to record migration execution
CREATE OR REPLACE FUNCTION record_migration_execution(
    migration_version VARCHAR(255),
    execution_time_ms INTEGER DEFAULT NULL,
    migration_checksum VARCHAR(64) DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
    INSERT INTO schema_migrations (version, applied_at, execution_time_ms, checksum, success)
    VALUES (migration_version, NOW(), execution_time_ms, migration_checksum, TRUE)
    ON CONFLICT (version) DO UPDATE SET
        applied_at = EXCLUDED.applied_at,
        execution_time_ms = EXCLUDED.execution_time_ms,
        checksum = EXCLUDED.checksum,
        success = TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to record migration failure
CREATE OR REPLACE FUNCTION record_migration_failure(
    migration_version VARCHAR(255),
    execution_time_ms INTEGER DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
    INSERT INTO schema_migrations (version, applied_at, execution_time_ms, success)
    VALUES (migration_version, NOW(), execution_time_ms, FALSE)
    ON CONFLICT (version) DO UPDATE SET
        applied_at = EXCLUDED.applied_at,
        execution_time_ms = EXCLUDED.execution_time_ms,
        success = FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions to app_user role
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        GRANT SELECT, INSERT, UPDATE ON schema_migrations TO app_user;
        GRANT EXECUTE ON FUNCTION get_migration_status() TO app_user;
        GRANT EXECUTE ON FUNCTION is_migration_applied(VARCHAR) TO app_user;
        GRANT EXECUTE ON FUNCTION record_migration_execution(VARCHAR, INTEGER, VARCHAR) TO app_user;
        GRANT EXECUTE ON FUNCTION record_migration_failure(VARCHAR, INTEGER) TO app_user;
    END IF;
END $$;

-- Add comments for documentation
COMMENT ON TABLE schema_migrations IS 'Unified migration tracking table for all database schema changes';
COMMENT ON COLUMN schema_migrations.version IS 'Migration filename/version identifier';
COMMENT ON COLUMN schema_migrations.applied_at IS 'When the migration was executed';
COMMENT ON COLUMN schema_migrations.execution_time_ms IS 'Migration execution time in milliseconds';
COMMENT ON COLUMN schema_migrations.checksum IS 'SHA256 checksum of migration file content';
COMMENT ON COLUMN schema_migrations.success IS 'Whether migration executed successfully';

COMMENT ON FUNCTION get_migration_status() IS 'Get status of all migrations';
COMMENT ON FUNCTION is_migration_applied(VARCHAR) IS 'Check if specific migration is applied';
COMMENT ON FUNCTION record_migration_execution(VARCHAR, INTEGER, VARCHAR) IS 'Record successful migration execution';
COMMENT ON FUNCTION record_migration_failure(VARCHAR, INTEGER) IS 'Record failed migration execution';

-- Clean up old migration tables (after ensuring data is migrated)
-- Note: These are commented out for safety - uncomment after verification
-- DROP TABLE IF EXISTS migrations CASCADE;
-- DROP TABLE IF EXISTS _migrations CASCADE;
