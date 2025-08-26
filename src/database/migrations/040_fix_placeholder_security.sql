-- ===============================================
-- Fix Placeholder Values and Security Configuration
-- Validates and secures configuration placeholders
-- Migration: 040_fix_placeholder_security.sql
-- ===============================================

-- 1. Create security configuration validation function
CREATE OR REPLACE FUNCTION validate_security_configuration()
RETURNS TABLE(
    config_key TEXT,
    is_valid BOOLEAN,
    risk_level TEXT,
    issue_description TEXT,
    recommended_action TEXT
) AS $$
DECLARE
    config_check RECORD;
BEGIN
    -- Define security configuration checks
    FOR config_check IN VALUES 
        ('JWT_SECRET', 'JWT Secret token'),
        ('ENCRYPTION_KEY', 'Data encryption key'),
        ('IG_APP_SECRET', 'Instagram App secret'),
        ('OPENAI_API_KEY', 'OpenAI API key'),
        ('IG_VERIFY_TOKEN', 'Instagram webhook verification token')
    LOOP
        -- Get current setting value (returns NULL if not set)
        DECLARE
            current_value TEXT;
            is_placeholder BOOLEAN := FALSE;
            validation_result BOOLEAN := TRUE;
            risk TEXT := 'LOW';
            issue TEXT := 'Configuration valid';
            action TEXT := 'No action required';
        BEGIN
            current_value := current_setting('app.' || config_check.column1, true);
            
            -- Check if value is set
            IF current_value IS NULL OR current_value = '' THEN
                validation_result := FALSE;
                risk := 'CRITICAL';
                issue := 'Configuration not set';
                action := 'Set ' || config_check.column2 || ' in environment variables';
            
            -- Check for common placeholder patterns
            ELSIF current_value ~* '(your_.*_here|placeholder|default|test|changeme|replace.*me|example|demo)' THEN
                validation_result := FALSE;
                risk := 'HIGH';
                issue := 'Using placeholder value';
                action := 'Replace with actual ' || config_check.column2;
                is_placeholder := TRUE;
            
            -- Check for insecure values
            ELSIF config_check.column1 = 'JWT_SECRET' AND (
                length(current_value) < 32 OR 
                current_value ~* '^(secret|default|test|admin|password|123|abc)' 
            ) THEN
                validation_result := FALSE;
                risk := 'HIGH';
                issue := 'JWT secret is too weak or insecure';
                action := 'Generate strong JWT secret (32+ characters)';
            
            ELSIF config_check.column1 = 'ENCRYPTION_KEY' AND (
                length(current_value) < 32 OR
                current_value ~* '^(key|secret|default|test|admin|password|123|abc)'
            ) THEN
                validation_result := FALSE;
                risk := 'CRITICAL';
                issue := 'Encryption key is too weak or insecure';
                action := 'Generate strong encryption key (32+ characters, random)';
            
            ELSIF config_check.column1 = 'OPENAI_API_KEY' AND NOT current_value ~* '^sk-[a-zA-Z0-9]{48}' THEN
                validation_result := FALSE;
                risk := 'HIGH';
                issue := 'Invalid OpenAI API key format';
                action := 'Set valid OpenAI API key starting with "sk-"';
            
            END IF;
            
            -- Log security check to audit
            INSERT INTO audit_logs (
                entity_type, entity_id, action, performed_by,
                details, created_at
            ) VALUES (
                'SECURITY_CONFIG_CHECK',
                config_check.column1,
                'VALIDATE',
                current_user,
                jsonb_build_object(
                    'config_key', config_check.column1,
                    'is_valid', validation_result,
                    'risk_level', risk,
                    'is_placeholder', is_placeholder,
                    'has_value', current_value IS NOT NULL AND current_value != '',
                    'value_length', COALESCE(length(current_value), 0)
                ),
                NOW()
            );
            
            RETURN QUERY SELECT 
                config_check.column1,
                validation_result,
                risk,
                issue,
                action;
        END;
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Create function to detect and replace insecure default values
CREATE OR REPLACE FUNCTION secure_default_credentials()
RETURNS TABLE(
    table_name TEXT,
    column_name TEXT,
    affected_rows BIGINT,
    action_taken TEXT
) AS $$
DECLARE
    check_result RECORD;
    update_count BIGINT;
BEGIN
    -- Check merchants table for default/placeholder values
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'merchants' AND table_schema = 'public') THEN
        -- Update default admin emails
        UPDATE merchants 
        SET email = 'admin-' || id::TEXT || '@' || COALESCE(business_name, 'business') || '.local'
        WHERE email IN ('admin@example.com', 'admin@test.com', 'test@example.com', 'placeholder@example.com')
        OR email LIKE '%placeholder%' OR email LIKE '%test%@example.%';
        
        GET DIAGNOSTICS update_count = ROW_COUNT;
        IF update_count > 0 THEN
            RETURN QUERY SELECT 'merchants'::TEXT, 'email'::TEXT, update_count, 'Updated placeholder emails with generated ones'::TEXT;
        END IF;
        
        -- Update default phone numbers
        UPDATE merchants 
        SET phone = '+1-555-' || LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0')
        WHERE phone IN ('+1234567890', '+0000000000', '1234567890', 'placeholder')
        OR phone LIKE '%placeholder%' OR phone LIKE '%test%' OR phone LIKE '%example%';
        
        GET DIAGNOSTICS update_count = ROW_COUNT;
        IF update_count > 0 THEN
            RETURN QUERY SELECT 'merchants'::TEXT, 'phone'::TEXT, update_count, 'Updated placeholder phone numbers with generated ones'::TEXT;
        END IF;
    END IF;
    
    -- Check merchant_credentials table for default/test values
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'merchant_credentials' AND table_schema = 'public') THEN
        -- Mark test/placeholder credentials as inactive
        UPDATE merchant_credentials 
        SET 
            is_active = FALSE,
            updated_at = NOW()
        WHERE 
            access_token LIKE '%test%' OR 
            access_token LIKE '%placeholder%' OR
            access_token LIKE '%example%' OR
            access_token LIKE '%demo%' OR
            page_access_token LIKE '%test%' OR
            page_access_token LIKE '%placeholder%';
            
        GET DIAGNOSTICS update_count = ROW_COUNT;
        IF update_count > 0 THEN
            RETURN QUERY SELECT 'merchant_credentials'::TEXT, 'access_token'::TEXT, update_count, 'Deactivated test/placeholder credentials'::TEXT;
        END IF;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Create environment validation function for production
CREATE OR REPLACE FUNCTION validate_production_environment()
RETURNS TABLE(
    category TEXT,
    check_name TEXT,
    status TEXT,
    details TEXT
) AS $$
BEGIN
    -- Database security checks
    RETURN QUERY SELECT 
        'DATABASE'::TEXT,
        'SSL Connection'::TEXT,
        CASE 
            WHEN current_setting('ssl', true) = 'on' THEN 'PASS'
            ELSE 'WARN'
        END,
        'Database SSL: ' || COALESCE(current_setting('ssl', true), 'unknown');
        
    RETURN QUERY SELECT 
        'DATABASE'::TEXT,
        'Password Authentication'::TEXT,
        CASE 
            WHEN EXISTS (
                SELECT 1 FROM pg_hba_file_rules 
                WHERE auth_method = 'md5' OR auth_method = 'scram-sha-256'
            ) THEN 'PASS'
            ELSE 'WARN'
        END,
        'Authentication methods configured';
        
    -- RLS Security checks
    RETURN QUERY SELECT 
        'SECURITY'::TEXT,
        'Row Level Security'::TEXT,
        CASE 
            WHEN (SELECT COUNT(*) FROM get_rls_security_report() WHERE rls_enabled = true) >= 5 THEN 'PASS'
            ELSE 'FAIL'
        END,
        'Tables with RLS: ' || (SELECT COUNT(*) FROM get_rls_security_report() WHERE rls_enabled = true)::TEXT;
        
    -- Application roles check
    RETURN QUERY SELECT 
        'SECURITY'::TEXT,
        'Application Roles'::TEXT,
        CASE 
            WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN 'PASS'
            ELSE 'FAIL'
        END,
        'app_user role exists: ' || EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user')::TEXT;
        
    -- Migration tracking
    RETURN QUERY SELECT 
        'MIGRATION'::TEXT,
        'Migration Tracking'::TEXT,
        CASE 
            WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'schema_migrations') THEN 'PASS'
            ELSE 'FAIL'
        END,
        'schema_migrations table exists';
        
    RETURN QUERY SELECT 
        'MIGRATION'::TEXT,
        'Critical Migrations'::TEXT,
        CASE 
            WHEN (SELECT COUNT(*) FROM schema_migrations WHERE success = true AND version LIKE '%rls%') >= 3 THEN 'PASS'
            ELSE 'WARN'
        END,
        'RLS migrations completed: ' || (SELECT COUNT(*) FROM schema_migrations WHERE success = true AND version LIKE '%rls%')::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Create security hardening function
CREATE OR REPLACE FUNCTION apply_security_hardening()
RETURNS TABLE(
    category TEXT,
    action TEXT,
    result TEXT
) AS $$
DECLARE
    hardening_result TEXT;
BEGIN
    -- Revoke unnecessary permissions from public
    BEGIN
        REVOKE ALL ON SCHEMA public FROM PUBLIC;
        GRANT USAGE ON SCHEMA public TO app_user;
        hardening_result := 'SUCCESS';
    EXCEPTION WHEN OTHERS THEN
        hardening_result := 'FAILED: ' || SQLERRM;
    END;
    RETURN QUERY SELECT 'PERMISSIONS'::TEXT, 'Restrict public schema access'::TEXT, hardening_result;
    
    -- Ensure sensitive functions are SECURITY DEFINER
    BEGIN
        -- Update existing functions to be SECURITY DEFINER if they aren't
        DECLARE
            func_record RECORD;
        BEGIN
            FOR func_record IN 
                SELECT proname FROM pg_proc 
                WHERE proname IN ('current_merchant_id', 'is_admin_user', 'set_merchant_context', 'clear_context')
                AND NOT prosecdef
            LOOP
                EXECUTE format('ALTER FUNCTION %I() SECURITY DEFINER', func_record.proname);
            END LOOP;
            hardening_result := 'SUCCESS';
        END;
    EXCEPTION WHEN OTHERS THEN
        hardening_result := 'FAILED: ' || SQLERRM;
    END;
    RETURN QUERY SELECT 'FUNCTIONS'::TEXT, 'Ensure SECURITY DEFINER on RLS functions'::TEXT, hardening_result;
    
    -- Create security monitoring role (read-only for monitoring)
    BEGIN
        DROP ROLE IF EXISTS security_monitor;
        CREATE ROLE security_monitor;
        GRANT SELECT ON audit_logs TO security_monitor;
        GRANT SELECT ON rls_security_dashboard TO security_monitor;
        GRANT EXECUTE ON FUNCTION get_rls_security_report() TO security_monitor;
        GRANT EXECUTE ON FUNCTION detect_rls_bypass_attempts(INTEGER) TO security_monitor;
        hardening_result := 'SUCCESS';
    EXCEPTION WHEN OTHERS THEN
        hardening_result := 'FAILED: ' || SQLERRM;
    END;
    RETURN QUERY SELECT 'ROLES'::TEXT, 'Create security monitoring role'::TEXT, hardening_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Create comprehensive security audit function
CREATE OR REPLACE FUNCTION run_comprehensive_security_audit()
RETURNS TABLE(
    audit_category TEXT,
    check_name TEXT,
    status TEXT,
    risk_level TEXT,
    details TEXT,
    recommendation TEXT
) AS $$
BEGIN
    -- Configuration validation
    RETURN QUERY
    SELECT 
        'CONFIGURATION'::TEXT,
        s.config_key,
        CASE WHEN s.is_valid THEN 'PASS' ELSE 'FAIL' END,
        s.risk_level,
        s.issue_description,
        s.recommended_action
    FROM validate_security_configuration() s;
    
    -- Environment validation
    RETURN QUERY
    SELECT 
        e.category,
        e.check_name,
        e.status,
        CASE 
            WHEN e.status = 'FAIL' THEN 'HIGH'
            WHEN e.status = 'WARN' THEN 'MEDIUM'
            ELSE 'LOW'
        END,
        e.details,
        CASE 
            WHEN e.status = 'FAIL' THEN 'Immediate action required'
            WHEN e.status = 'WARN' THEN 'Review and consider fixing'
            ELSE 'No action needed'
        END
    FROM validate_production_environment() e;
    
    -- Recent security events
    RETURN QUERY
    SELECT 
        'SECURITY_EVENTS'::TEXT,
        'RLS Violations (24h)'::TEXT,
        CASE 
            WHEN COUNT(*) = 0 THEN 'PASS'
            WHEN COUNT(*) < 10 THEN 'WARN' 
            ELSE 'FAIL'
        END,
        CASE 
            WHEN COUNT(*) = 0 THEN 'LOW'
            WHEN COUNT(*) < 10 THEN 'MEDIUM'
            ELSE 'HIGH'
        END,
        'Access violations in last 24 hours: ' || COUNT(*)::TEXT,
        CASE 
            WHEN COUNT(*) > 0 THEN 'Investigate access violation patterns'
            ELSE 'Continue monitoring'
        END
    FROM audit_logs 
    WHERE entity_type = 'RLS_ACCESS_DENIED' 
    AND created_at > NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Grant permissions on new security functions
GRANT EXECUTE ON FUNCTION validate_security_configuration() TO app_user, postgres;
GRANT EXECUTE ON FUNCTION secure_default_credentials() TO app_user, postgres;
GRANT EXECUTE ON FUNCTION validate_production_environment() TO app_user, postgres;
GRANT EXECUTE ON FUNCTION apply_security_hardening() TO postgres; -- Only postgres can run hardening
GRANT EXECUTE ON FUNCTION run_comprehensive_security_audit() TO app_user, postgres;

-- 7. Run immediate security fixes
DO $$
DECLARE
    fix_result RECORD;
    audit_result RECORD;
    total_fixes INTEGER := 0;
BEGIN
    -- Fix placeholder credentials
    RAISE NOTICE '🔒 Fixing placeholder values...';
    FOR fix_result IN SELECT * FROM secure_default_credentials()
    LOOP
        total_fixes := total_fixes + fix_result.affected_rows::INTEGER;
        RAISE NOTICE '   ✅ %: % (% rows)', fix_result.table_name, fix_result.action_taken, fix_result.affected_rows;
    END LOOP;
    
    IF total_fixes = 0 THEN
        RAISE NOTICE '   ✅ No placeholder values found to fix';
    ELSE
        RAISE NOTICE '   ✅ Fixed % placeholder values total', total_fixes;
    END IF;
    
    -- Run security audit
    RAISE NOTICE '🔍 Running security audit...';
    FOR audit_result IN 
        SELECT * FROM run_comprehensive_security_audit() 
        WHERE status != 'PASS' 
        ORDER BY 
            CASE risk_level 
                WHEN 'CRITICAL' THEN 1 
                WHEN 'HIGH' THEN 2 
                WHEN 'MEDIUM' THEN 3 
                ELSE 4 
            END
    LOOP
        RAISE NOTICE '   %️ [%] %: % - %', 
            CASE audit_result.risk_level 
                WHEN 'CRITICAL' THEN '🚨'
                WHEN 'HIGH' THEN '⚠️'
                WHEN 'MEDIUM' THEN '⚠'
                ELSE 'ℹ'
            END,
            audit_result.risk_level,
            audit_result.check_name,
            audit_result.status,
            audit_result.details;
    END LOOP;
END $$;

-- 8. Create security monitoring triggers
CREATE OR REPLACE FUNCTION monitor_security_sensitive_changes()
RETURNS TRIGGER AS $$
BEGIN
    -- Monitor changes to security-sensitive tables
    IF TG_TABLE_NAME IN ('merchant_credentials', 'merchants') THEN
        INSERT INTO audit_logs (
            entity_type, entity_id, action, performed_by,
            details, created_at
        ) VALUES (
            'SECURITY_SENSITIVE_CHANGE',
            COALESCE(NEW.id::TEXT, OLD.id::TEXT),
            TG_OP,
            current_user,
            jsonb_build_object(
                'table', TG_TABLE_NAME,
                'merchant_id', COALESCE(NEW.merchant_id, OLD.merchant_id),
                'change_type', TG_OP,
                'current_merchant_context', current_merchant_id(),
                'is_admin', is_admin_user()
            ),
            NOW()
        );
    END IF;
    
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Apply security monitoring triggers
DROP TRIGGER IF EXISTS merchant_credentials_security_monitor ON merchant_credentials;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'merchant_credentials' AND table_schema = 'public') THEN
        CREATE TRIGGER merchant_credentials_security_monitor
            AFTER INSERT OR UPDATE OR DELETE ON merchant_credentials
            FOR EACH ROW EXECUTE FUNCTION monitor_security_sensitive_changes();
    END IF;
END $$;

DROP TRIGGER IF EXISTS merchants_security_monitor ON merchants;
CREATE TRIGGER merchants_security_monitor
    AFTER INSERT OR UPDATE OR DELETE ON merchants
    FOR EACH ROW EXECUTE FUNCTION monitor_security_sensitive_changes();

-- 9. Add migration tracking
INSERT INTO schema_migrations (version, applied_at, success, description)
VALUES (
    '040_fix_placeholder_security.sql', 
    NOW(), 
    TRUE,
    'Fixed placeholder values and enhanced security configuration validation'
)
ON CONFLICT (version) DO UPDATE SET 
    applied_at = NOW(),
    success = TRUE,
    description = EXCLUDED.description;

-- 10. Final security status report
DO $$
DECLARE
    security_summary RECORD;
    issue_count INTEGER := 0;
BEGIN
    RAISE NOTICE '🔒 Security Configuration Summary:';
    
    FOR security_summary IN 
        SELECT 
            audit_category,
            COUNT(*) as total_checks,
            COUNT(*) FILTER (WHERE status = 'PASS') as passed,
            COUNT(*) FILTER (WHERE status = 'FAIL') as failed,
            COUNT(*) FILTER (WHERE status = 'WARN') as warnings
        FROM run_comprehensive_security_audit()
        GROUP BY audit_category
        ORDER BY audit_category
    LOOP
        issue_count := issue_count + security_summary.failed + security_summary.warnings;
        RAISE NOTICE '   📋 %: % passed, % failed, % warnings', 
            security_summary.audit_category,
            security_summary.passed,
            security_summary.failed,
            security_summary.warnings;
    END LOOP;
    
    IF issue_count = 0 THEN
        RAISE NOTICE '   ✅ All security checks passed!';
    ELSE
        RAISE NOTICE '   ⚠️  % security issues found - run run_comprehensive_security_audit() for details', issue_count;
    END IF;
    
    RAISE NOTICE '📊 Use run_comprehensive_security_audit() for detailed security analysis';
    RAISE NOTICE '🔧 Use apply_security_hardening() to apply additional security measures';
    RAISE NOTICE '🔍 Use validate_security_configuration() to check configuration values';
END $$;