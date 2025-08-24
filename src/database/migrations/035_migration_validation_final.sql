/**
 * ===============================================
 * Migration 035: Migration Validation Final
 * ===============================================
 * 
 * This migration performs final validation of all previous migrations
 * and ensures system integrity before marking the migration system
 * as production-ready.
 * 
 * Validations performed:
 * - Check all required tables exist
 * - Verify RLS functions are working
 * - Ensure proper constraints are in place
 * - Validate migration tracking is consistent
 */

-- Create validation function
CREATE OR REPLACE FUNCTION validate_migration_system()
RETURNS TABLE(
    check_name TEXT,
    status TEXT,
    details TEXT
) AS $$
BEGIN
    -- Check 1: Verify schema_migrations table exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'schema_migrations') THEN
        RETURN QUERY SELECT 'schema_migrations table'::TEXT, 'PASS'::TEXT, 'Table exists and is accessible'::TEXT;
    ELSE
        RETURN QUERY SELECT 'schema_migrations table'::TEXT, 'FAIL'::TEXT, 'Table does not exist'::TEXT;
    END IF;
    
    -- Check 2: Verify RLS functions exist
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'current_merchant_id') THEN
        RETURN QUERY SELECT 'current_merchant_id function'::TEXT, 'PASS'::TEXT, 'Function exists'::TEXT;
    ELSE
        RETURN QUERY SELECT 'current_merchant_id function'::TEXT, 'FAIL'::TEXT, 'Function missing'::TEXT;
    END IF;
    
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_admin_user') THEN
        RETURN QUERY SELECT 'is_admin_user function'::TEXT, 'PASS'::TEXT, 'Function exists'::TEXT;
    ELSE
        RETURN QUERY SELECT 'is_admin_user function'::TEXT, 'FAIL'::TEXT, 'Function missing'::TEXT;
    END IF;
    
    -- Check 3: Verify core tables exist
    DECLARE
        required_tables TEXT[] := ARRAY['merchants', 'products', 'orders', 'customers', 'merchant_credentials'];
        table_name TEXT;
    BEGIN
        FOREACH table_name IN ARRAY required_tables
        LOOP
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = table_name) THEN
                RETURN QUERY SELECT (table_name || ' table')::TEXT, 'PASS'::TEXT, 'Table exists'::TEXT;
            ELSE
                RETURN QUERY SELECT (table_name || ' table')::TEXT, 'FAIL'::TEXT, 'Table missing'::TEXT;
            END IF;
        END LOOP;
    END;
    
    -- Check 4: Verify migration sequence is correct
    DECLARE
        migration_count INTEGER;
        expected_count INTEGER := 35; -- Including this migration
    BEGIN
        SELECT COUNT(*) INTO migration_count FROM schema_migrations WHERE success = TRUE;
        IF migration_count >= expected_count THEN
            RETURN QUERY SELECT 'Migration count'::TEXT, 'PASS'::TEXT, 
                ('Found ' || migration_count || ' successful migrations')::TEXT;
        ELSE
            RETURN QUERY SELECT 'Migration count'::TEXT, 'WARN'::TEXT, 
                ('Expected ' || expected_count || ', found ' || migration_count)::TEXT;
        END IF;
    END;
    
    -- Check 5: Verify no duplicate migration numbers
    DECLARE
        duplicate_count INTEGER;
    BEGIN
        SELECT COUNT(*) INTO duplicate_count
        FROM (
            SELECT version, COUNT(*) as cnt
            FROM schema_migrations
            GROUP BY version
            HAVING COUNT(*) > 1
        ) duplicates;
        
        IF duplicate_count = 0 THEN
            RETURN QUERY SELECT 'No duplicate migrations'::TEXT, 'PASS'::TEXT, 'All migrations unique'::TEXT;
        ELSE
            RETURN QUERY SELECT 'No duplicate migrations'::TEXT, 'FAIL'::TEXT, 
                ('Found ' || duplicate_count || ' duplicate migrations')::TEXT;
        END IF;
    END;
    
    -- Check 6: Verify app_user role exists
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        RETURN QUERY SELECT 'app_user role'::TEXT, 'PASS'::TEXT, 'Role exists'::TEXT;
    ELSE
        RETURN QUERY SELECT 'app_user role'::TEXT, 'FAIL'::TEXT, 'Role missing'::TEXT;
    END IF;
    
    -- Check 7: Verify whatsapp_number constraints
    DECLARE
        constraint_exists BOOLEAN;
    BEGIN
        SELECT EXISTS (
            SELECT 1 FROM information_schema.check_constraints 
            WHERE constraint_name = 'check_merchant_contact_method'
        ) INTO constraint_exists;
        
        IF constraint_exists THEN
            RETURN QUERY SELECT 'WhatsApp constraints'::TEXT, 'PASS'::TEXT, 'Contact method constraint exists'::TEXT;
        ELSE
            RETURN QUERY SELECT 'WhatsApp constraints'::TEXT, 'WARN'::TEXT, 'Contact method constraint missing'::TEXT;
        END IF;
    END;
    
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create view for migration system status
CREATE OR REPLACE VIEW migration_system_status AS
SELECT 
    check_name,
    status,
    details,
    CASE 
        WHEN status = 'PASS' THEN '✅'
        WHEN status = 'WARN' THEN '⚠️'
        WHEN status = 'FAIL' THEN '❌'
        ELSE '❓'
    END as status_icon
FROM validate_migration_system()
ORDER BY 
    CASE status 
        WHEN 'FAIL' THEN 1 
        WHEN 'WARN' THEN 2 
        WHEN 'PASS' THEN 3 
        ELSE 4 
    END,
    check_name;

-- Grant permissions
GRANT EXECUTE ON FUNCTION validate_migration_system() TO app_user;
GRANT SELECT ON migration_system_status TO app_user;

-- Create function to get migration summary
CREATE OR REPLACE FUNCTION get_migration_summary()
RETURNS TABLE(
    total_migrations INTEGER,
    successful_migrations INTEGER,
    failed_migrations INTEGER,
    last_migration TEXT,
    last_migration_time TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*)::INTEGER as total_migrations,
        COUNT(*) FILTER (WHERE success = TRUE)::INTEGER as successful_migrations,
        COUNT(*) FILTER (WHERE success = FALSE)::INTEGER as failed_migrations,
        version as last_migration,
        applied_at as last_migration_time
    FROM schema_migrations
    WHERE applied_at = (SELECT MAX(applied_at) FROM schema_migrations);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_migration_summary() TO app_user;

-- Add comments for documentation
COMMENT ON FUNCTION validate_migration_system() IS 'Validates the migration system integrity and returns status of all checks';
COMMENT ON VIEW migration_system_status IS 'View showing the current status of all migration system validations';
COMMENT ON FUNCTION get_migration_summary() IS 'Returns summary statistics about the migration system';

-- Insert migration record
INSERT INTO schema_migrations (version, applied_at, success)
VALUES ('035_migration_validation_final.sql', NOW(), TRUE)
ON CONFLICT (version) DO NOTHING;

-- Log validation results
DO $$
DECLARE
    validation_result RECORD;
    pass_count INTEGER := 0;
    warn_count INTEGER := 0;
    fail_count INTEGER := 0;
BEGIN
    FOR validation_result IN SELECT * FROM validate_migration_system()
    LOOP
        CASE validation_result.status
            WHEN 'PASS' THEN pass_count := pass_count + 1;
            WHEN 'WARN' THEN warn_count := warn_count + 1;
            WHEN 'FAIL' THEN fail_count := fail_count + 1;
        END CASE;
    END LOOP;
    
    RAISE NOTICE 'Migration System Validation Complete: % PASS, % WARN, % FAIL', 
        pass_count, warn_count, fail_count;
    
    IF fail_count > 0 THEN
        RAISE WARNING 'Migration system has % critical issues that need attention', fail_count;
    END IF;
    
    IF warn_count > 0 THEN
        RAISE NOTICE 'Migration system has % warnings that should be reviewed', warn_count;
    END IF;
    
    IF pass_count > 0 AND fail_count = 0 THEN
        RAISE NOTICE 'Migration system is ready for production use';
    END IF;
END $$;
