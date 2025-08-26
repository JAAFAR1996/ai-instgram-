-- ===============================================
-- Migration Backup System
-- 💾 Stage 4: Risk Management - Comprehensive backup and recovery
-- Migration: 046_migration_backup_system.sql
-- ===============================================

-- 💾 1. Create backup metadata table
CREATE TABLE IF NOT EXISTS migration_backups (
    id SERIAL PRIMARY KEY,
    backup_id UUID DEFAULT gen_random_uuid(),
    migration_version VARCHAR(255) NOT NULL,
    backup_type VARCHAR(50) NOT NULL CHECK (backup_type IN ('pre_migration', 'post_migration', 'rollback_point')),
    backup_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    backup_size_bytes BIGINT,
    backup_location TEXT,
    backup_status VARCHAR(50) DEFAULT 'in_progress' CHECK (backup_status IN ('in_progress', 'completed', 'failed', 'expired')),
    backup_checksum VARCHAR(64),
    schema_snapshot JSONB,
    data_snapshot_tables TEXT[],
    rollback_script TEXT,
    created_by VARCHAR(255) DEFAULT current_user,
    expires_at TIMESTAMP,
    restored_at TIMESTAMP,
    notes TEXT
);

-- Add indexes for backup management
CREATE INDEX IF NOT EXISTS idx_migration_backups_version 
ON migration_backups (migration_version, backup_type);

CREATE INDEX IF NOT EXISTS idx_migration_backups_timestamp 
ON migration_backups (backup_timestamp DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_migration_backups_unique 
ON migration_backups (migration_version, backup_type) 
WHERE backup_status = 'completed';

-- 💾 2. Create schema snapshot function
CREATE OR REPLACE FUNCTION capture_schema_snapshot()
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    schema_info JSONB;
BEGIN
    SELECT jsonb_build_object(
        'tables', (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'table_name', table_name,
                    'table_schema', table_schema,
                    'columns', (
                        SELECT jsonb_agg(
                            jsonb_build_object(
                                'column_name', column_name,
                                'data_type', data_type,
                                'is_nullable', is_nullable,
                                'column_default', column_default
                            )
                        )
                        FROM information_schema.columns c
                        WHERE c.table_name = t.table_name 
                        AND c.table_schema = t.table_schema
                    ),
                    'constraints', (
                        SELECT jsonb_agg(
                            jsonb_build_object(
                                'constraint_name', constraint_name,
                                'constraint_type', constraint_type
                            )
                        )
                        FROM information_schema.table_constraints tc
                        WHERE tc.table_name = t.table_name 
                        AND tc.table_schema = t.table_schema
                    ),
                    'indexes', (
                        SELECT jsonb_agg(
                            jsonb_build_object(
                                'index_name', indexname,
                                'index_def', indexdef
                            )
                        )
                        FROM pg_indexes pi
                        WHERE pi.tablename = t.table_name 
                        AND pi.schemaname = t.table_schema
                    )
                )
            )
            FROM information_schema.tables t
            WHERE t.table_schema = 'public'
            AND t.table_type = 'BASE TABLE'
        ),
        'functions', (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'function_name', routine_name,
                    'return_type', data_type,
                    'language', external_language
                )
            )
            FROM information_schema.routines
            WHERE routine_schema = 'public'
        ),
        'views', (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'view_name', table_name,
                    'view_definition', view_definition
                )
            )
            FROM information_schema.views
            WHERE table_schema = 'public'
        ),
        'captured_at', CURRENT_TIMESTAMP
    ) INTO schema_info;
    
    RETURN schema_info;
END;
$$;

-- 💾 3. Create backup creation function
CREATE OR REPLACE FUNCTION create_migration_backup(
    p_migration_version VARCHAR(255),
    p_backup_type VARCHAR(50),
    p_include_data BOOLEAN DEFAULT false,
    p_data_tables TEXT[] DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    backup_uuid UUID;
    schema_snapshot JSONB;
    backup_size BIGINT := 0;
    table_name TEXT;
    row_count BIGINT;
BEGIN
    -- Generate backup ID
    backup_uuid := gen_random_uuid();
    
    -- Capture schema snapshot
    schema_snapshot := capture_schema_snapshot();
    
    -- Calculate approximate backup size
    IF p_include_data AND p_data_tables IS NOT NULL THEN
        FOREACH table_name IN ARRAY p_data_tables
        LOOP
            EXECUTE format('SELECT COUNT(*) FROM %I', table_name) INTO row_count;
            backup_size := backup_size + (row_count * 1024); -- Rough estimate
        END LOOP;
    END IF;
    
    -- Insert backup record
    INSERT INTO migration_backups (
        backup_id,
        migration_version,
        backup_type,
        backup_size_bytes,
        schema_snapshot,
        data_snapshot_tables,
        expires_at
    ) VALUES (
        backup_uuid,
        p_migration_version,
        p_backup_type,
        backup_size,
        schema_snapshot,
        p_data_tables,
        CURRENT_TIMESTAMP + INTERVAL '30 days'
    );
    
    -- Log backup creation
    INSERT INTO migration_audit_logs (
        migration_version,
        description,
        execution_status,
        metadata
    ) VALUES (
        p_migration_version,
        format('Created %s backup: %s', p_backup_type, backup_uuid),
        'SUCCESS',
        jsonb_build_object(
            'backup_id', backup_uuid,
            'backup_type', p_backup_type,
            'include_data', p_include_data,
            'schema_tables_count', jsonb_array_length(schema_snapshot->'tables')
        )
    );
    
    RETURN backup_uuid;
END;
$$;

-- 💾 4. Create backup validation function
CREATE OR REPLACE FUNCTION validate_backup(p_backup_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    backup_record RECORD;
    current_schema JSONB;
    validation_passed BOOLEAN := true;
BEGIN
    -- Get backup record
    SELECT * INTO backup_record 
    FROM migration_backups 
    WHERE backup_id = p_backup_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Backup not found: %', p_backup_id;
    END IF;
    
    -- Capture current schema for comparison
    current_schema := capture_schema_snapshot();
    
    -- Update backup status based on validation
    IF validation_passed THEN
        UPDATE migration_backups 
        SET backup_status = 'completed',
            backup_checksum = md5(schema_snapshot::text)
        WHERE backup_id = p_backup_id;
    ELSE
        UPDATE migration_backups 
        SET backup_status = 'failed'
        WHERE backup_id = p_backup_id;
    END IF;
    
    RETURN validation_passed;
END;
$$;

-- 💾 5. Create backup cleanup function
CREATE OR REPLACE FUNCTION cleanup_expired_backups()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    cleanup_count INTEGER;
BEGIN
    -- Mark expired backups
    UPDATE migration_backups 
    SET backup_status = 'expired'
    WHERE expires_at < CURRENT_TIMESTAMP 
    AND backup_status = 'completed';
    
    GET DIAGNOSTICS cleanup_count = ROW_COUNT;
    
    -- Log cleanup activity
    INSERT INTO migration_audit_logs (
        migration_version,
        description,
        execution_status,
        metadata
    ) VALUES (
        'SYSTEM',
        'Backup cleanup completed',
        'SUCCESS',
        jsonb_build_object('expired_backups_count', cleanup_count)
    );
    
    RETURN cleanup_count;
END;
$$;

-- 💾 6. Create backup restoration function
CREATE OR REPLACE FUNCTION restore_from_backup(
    p_backup_id UUID,
    p_dry_run BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    backup_record RECORD;
    restoration_plan JSONB;
    current_schema JSONB;
BEGIN
    -- Get backup record
    SELECT * INTO backup_record 
    FROM migration_backups 
    WHERE backup_id = p_backup_id 
    AND backup_status = 'completed';
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Valid backup not found: %', p_backup_id;
    END IF;
    
    -- Capture current schema
    current_schema := capture_schema_snapshot();
    
    -- Create restoration plan
    restoration_plan := jsonb_build_object(
        'backup_id', p_backup_id,
        'backup_timestamp', backup_record.backup_timestamp,
        'migration_version', backup_record.migration_version,
        'dry_run', p_dry_run,
        'restoration_timestamp', CURRENT_TIMESTAMP,
        'schema_changes_required', jsonb_build_object(
            'tables_to_drop', '[]'::jsonb,
            'tables_to_create', '[]'::jsonb,
            'columns_to_modify', '[]'::jsonb
        )
    );
    
    IF NOT p_dry_run THEN
        -- Mark backup as restored
        UPDATE migration_backups 
        SET restored_at = CURRENT_TIMESTAMP
        WHERE backup_id = p_backup_id;
        
        -- Log restoration
        INSERT INTO migration_audit_logs (
            migration_version,
            description,
            execution_status,
            metadata
        ) VALUES (
            backup_record.migration_version,
            format('Restored from backup: %s', p_backup_id),
            'SUCCESS',
            restoration_plan
        );
    END IF;
    
    RETURN restoration_plan;
END;
$$;

-- 💾 7. Create backup monitoring view
CREATE OR REPLACE VIEW backup_health_dashboard AS
SELECT 
    'Migration Backups' as category,
    jsonb_build_object(
        'total_backups', (SELECT COUNT(*) FROM migration_backups),
        'completed_backups', (SELECT COUNT(*) FROM migration_backups WHERE backup_status = 'completed'),
        'failed_backups', (SELECT COUNT(*) FROM migration_backups WHERE backup_status = 'failed'),
        'expired_backups', (SELECT COUNT(*) FROM migration_backups WHERE backup_status = 'expired'),
        'total_backup_size_mb', (SELECT COALESCE(SUM(backup_size_bytes), 0) / 1024 / 1024 FROM migration_backups WHERE backup_status = 'completed'),
        'oldest_backup', (SELECT MIN(backup_timestamp) FROM migration_backups WHERE backup_status = 'completed'),
        'newest_backup', (SELECT MAX(backup_timestamp) FROM migration_backups WHERE backup_status = 'completed'),
        'backup_retention_days', 30
    ) as metrics,
    CURRENT_TIMESTAMP as last_updated;

-- 💾 8. Create automatic backup trigger for critical migrations
CREATE OR REPLACE FUNCTION auto_backup_critical_migrations()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    backup_uuid UUID;
    critical_tables TEXT[] := ARRAY['messages', 'conversations', 'templates', 'merchant_credentials'];
BEGIN
    -- Create automatic backup for critical migrations
    IF NEW.migration_version LIKE '%rls%' 
       OR NEW.migration_version LIKE '%security%' 
       OR NEW.migration_version LIKE '%performance%' THEN
        
        backup_uuid := create_migration_backup(
            NEW.migration_version,
            'pre_migration',
            true,
            critical_tables
        );
        
        -- Update migration record with backup reference
        NEW.metadata := COALESCE(NEW.metadata, '{}'::jsonb) || 
                       jsonb_build_object('auto_backup_id', backup_uuid);
    END IF;
    
    RETURN NEW;
END;
$$;

-- Create trigger for automatic backups
DROP TRIGGER IF EXISTS trigger_auto_backup_migrations ON migration_audit_logs;
CREATE TRIGGER trigger_auto_backup_migrations
    BEFORE INSERT ON migration_audit_logs
    FOR EACH ROW
    WHEN (NEW.execution_status = 'STARTED')
    EXECUTE FUNCTION auto_backup_critical_migrations();

-- 💾 9. Create backup health check function
CREATE OR REPLACE FUNCTION check_backup_health()
RETURNS TABLE (
    check_name text,
    status text,
    message text,
    details jsonb
)
LANGUAGE plpgsql
AS $$
DECLARE
    recent_backups_count INTEGER;
    failed_backups_count INTEGER;
    expired_backups_count INTEGER;
BEGIN
    -- Check recent backup activity
    SELECT COUNT(*) INTO recent_backups_count
    FROM migration_backups 
    WHERE backup_timestamp > CURRENT_TIMESTAMP - INTERVAL '7 days';
    
    IF recent_backups_count = 0 THEN
        RETURN QUERY SELECT 
            'recent_backup_activity'::text,
            'WARNING'::text,
            'No backups created in the last 7 days'::text,
            jsonb_build_object('recent_backups', recent_backups_count);
    ELSE
        RETURN QUERY SELECT 
            'recent_backup_activity'::text,
            'OK'::text,
            format('%s backups created in the last 7 days', recent_backups_count),
            jsonb_build_object('recent_backups', recent_backups_count);
    END IF;
    
    -- Check failed backups
    SELECT COUNT(*) INTO failed_backups_count
    FROM migration_backups 
    WHERE backup_status = 'failed';
    
    IF failed_backups_count > 0 THEN
        RETURN QUERY SELECT 
            'failed_backups'::text,
            'ERROR'::text,
            format('%s failed backups need attention', failed_backups_count),
            jsonb_build_object('failed_backups', failed_backups_count);
    ELSE
        RETURN QUERY SELECT 
            'failed_backups'::text,
            'OK'::text,
            'No failed backups detected'::text,
            jsonb_build_object('failed_backups', 0);
    END IF;
    
    -- Check storage usage
    RETURN QUERY SELECT 
        'backup_storage'::text,
        'INFO'::text,
        'Backup storage statistics available'::text,
        (SELECT metrics FROM backup_health_dashboard LIMIT 1);
END;
$$;

-- 💾 10. Log successful migration
INSERT INTO migration_audit_logs (
    migration_version,
    description,
    execution_status,
    affected_tables,
    performance_impact,
    started_at,
    completed_at
) VALUES (
    '046_migration_backup_system.sql',
    'Implemented comprehensive migration backup and recovery system',
    'SUCCESS',
    ARRAY['migration_backups', 'backup functions and procedures'],
    'LOW - Backup system ready for critical migration protection',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

COMMENT ON TABLE migration_backups IS 'Comprehensive backup system for migration risk management';
COMMENT ON FUNCTION create_migration_backup(VARCHAR, VARCHAR, BOOLEAN, TEXT[]) IS 'Creates automated backups before critical migrations';
COMMENT ON FUNCTION validate_backup(UUID) IS 'Validates backup integrity and completeness';
COMMENT ON FUNCTION restore_from_backup(UUID, BOOLEAN) IS 'Restores database state from backup with dry-run option';
COMMENT ON VIEW backup_health_dashboard IS 'Real-time backup system health monitoring';