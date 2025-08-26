-- ===============================================
-- Safe Migration Tracking Unification
-- 🔧 Stage 5: Critical - Safe consolidation without data loss
-- Migration: 051_safe_migration_unification.sql
-- ===============================================

-- 1. Create permanent backup tables before any changes
CREATE TABLE IF NOT EXISTS migrations_backup_20250826 AS 
SELECT * FROM migrations WHERE EXISTS (SELECT 1 FROM migrations LIMIT 1);

CREATE TABLE IF NOT EXISTS _migrations_backup_20250826 AS 
SELECT * FROM _migrations WHERE EXISTS (SELECT 1 FROM _migrations LIMIT 1);

-- 2. Ensure schema_migrations table exists with proper structure
CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    checksum VARCHAR(64),
    execution_time INTEGER, -- milliseconds
    success BOOLEAN DEFAULT true,
    error_message TEXT,
    migration_type VARCHAR(50) DEFAULT 'migration'
);

-- 3. Create index for performance if not exists
CREATE INDEX IF NOT EXISTS idx_schema_migrations_applied_at 
ON schema_migrations (applied_at DESC);

-- 4. Safely merge existing migration data into schema_migrations
-- From migrations table (if it exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'migrations') THEN
        INSERT INTO schema_migrations (version, applied_at, success, migration_type)
        SELECT 
            filename as version,
            COALESCE(executed_at, created_at, CURRENT_TIMESTAMP) as applied_at,
            true as success,
            'legacy_migration' as migration_type
        FROM migrations
        ON CONFLICT (version) DO UPDATE SET
            migration_type = EXCLUDED.migration_type;
    END IF;
END $$;

-- From _migrations table (if it exists) 
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = '_migrations') THEN
        INSERT INTO schema_migrations (version, applied_at, success, migration_type)
        SELECT 
            name as version,
            COALESCE(applied_at, CURRENT_TIMESTAMP) as applied_at,
            true as success,
            'legacy_underscore' as migration_type
        FROM _migrations
        ON CONFLICT (version) DO UPDATE SET
            migration_type = EXCLUDED.migration_type;
    END IF;
END $$;

-- 5. Remove test files from migration tracking (safe deletion)
DELETE FROM schema_migrations 
WHERE version IN (
    '988_instagram_tables.sql',
    '989_manual_followup_queue.sql'
);

-- 6. Insert essential migrations that should exist
INSERT INTO schema_migrations (version, applied_at, success, migration_type) VALUES
    ('001_initial_schema.sql', CURRENT_TIMESTAMP, true, 'core'),
    ('032_unify_migration_tracking.sql', CURRENT_TIMESTAMP, true, 'tracking')
ON CONFLICT (version) DO NOTHING;

-- 7. Create validation view to check migration consistency
CREATE OR REPLACE VIEW migration_validation_report AS
SELECT 
    'schema_migrations' as source,
    COUNT(*) as total_migrations,
    COUNT(*) FILTER (WHERE success = true) as successful_migrations,
    COUNT(*) FILTER (WHERE success = false) as failed_migrations,
    MIN(applied_at) as earliest_migration,
    MAX(applied_at) as latest_migration
FROM schema_migrations

UNION ALL

SELECT 
    'file_system' as source,
    COUNT(*) as total_migrations,
    NULL as successful_migrations, 
    NULL as failed_migrations,
    NULL as earliest_migration,
    NULL as latest_migration
FROM (
    SELECT unnest(ARRAY[
        '001_initial_schema.sql',
        '002_analytics_views.sql', 
        '003_products_search_optimization.sql',
        '004_webhook_infrastructure.sql',
        '005_message_logs_enhancements.sql',
        '006_cross_platform_infrastructure.sql'
        -- Add more as needed, but only confirmed existing files
    ]) as filename
) fs;

-- 8. Create cleanup function for old tables (optional, non-destructive)
CREATE OR REPLACE FUNCTION cleanup_old_migration_tables()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    result_msg TEXT := '';
BEGIN
    -- Only drop if we have successfully migrated data
    IF (SELECT COUNT(*) FROM schema_migrations WHERE migration_type IN ('legacy_migration', 'legacy_underscore')) > 0 THEN
        
        -- Rename old tables instead of dropping (safer)
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'migrations') THEN
            ALTER TABLE migrations RENAME TO migrations_deprecated_backup;
            result_msg := result_msg || 'Renamed migrations to migrations_deprecated_backup. ';
        END IF;
        
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = '_migrations') THEN  
            ALTER TABLE _migrations RENAME TO _migrations_deprecated_backup;
            result_msg := result_msg || 'Renamed _migrations to _migrations_deprecated_backup. ';
        END IF;
        
        result_msg := result_msg || 'Old migration tables safely renamed for backup.';
    ELSE
        result_msg := 'No data found in old migration tables, keeping them as-is for safety.';
    END IF;
    
    RETURN result_msg;
END;
$$;

-- 9. Log the successful unification (with error handling)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'migration_audit_logs') THEN
        INSERT INTO migration_audit_logs (
            migration_version,
            description,
            execution_status,
            affected_tables,
            performance_impact,
            started_at,
            completed_at,
            metadata
        ) VALUES (
            '051_safe_migration_unification.sql',
            'Safely unified migration tracking system without data loss',
            'SUCCESS',
            ARRAY['schema_migrations', 'migration tracking consolidation'],
            'LOW - Migration system now unified safely',
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP,
            jsonb_build_object(
                'backup_tables_created', true,
                'data_migration_completed', true,
                'test_files_removed', true,
                'old_tables_preserved', true
            )
        );
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        -- Continue if audit logging fails
        NULL;
END $$;

-- 10. Instructions for manual cleanup (commented for safety)
/*
-- After confirming everything works correctly, you can optionally run:
-- SELECT cleanup_old_migration_tables();

-- To completely remove old backup tables (only after thorough testing):
-- DROP TABLE IF EXISTS migrations_deprecated_backup CASCADE;
-- DROP TABLE IF EXISTS _migrations_deprecated_backup CASCADE; 
*/

COMMENT ON TABLE schema_migrations IS 'Unified migration tracking - consolidated from multiple legacy systems';
COMMENT ON VIEW migration_validation_report IS 'Validation report comparing tracked vs expected migrations';
COMMENT ON FUNCTION cleanup_old_migration_tables() IS 'Optional cleanup function - renames old migration tables for backup';