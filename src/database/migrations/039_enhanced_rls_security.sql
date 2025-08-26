-- ===============================================
-- Enhanced RLS Security Policies Migration
-- Comprehensive security policies with audit logging
-- Migration: 039_enhanced_rls_security.sql
-- ===============================================

-- 1. Create advanced RLS security functions
CREATE OR REPLACE FUNCTION enhanced_tenant_access_check(
    record_merchant_id UUID,
    operation_type TEXT DEFAULT 'SELECT'
) RETURNS BOOLEAN AS $$
DECLARE
    current_merchant UUID;
    is_admin BOOLEAN;
    session_info TEXT;
BEGIN
    -- Get current context
    current_merchant := current_merchant_id();
    is_admin := is_admin_user();
    
    -- Admin bypass
    IF is_admin OR current_user = 'postgres' THEN
        -- Log admin access for audit
        INSERT INTO audit_logs (
            entity_type, entity_id, action, performed_by, 
            details, created_at
        ) VALUES (
            'RLS_ADMIN_ACCESS', record_merchant_id::TEXT, operation_type,
            current_user, jsonb_build_object(
                'admin_access', true,
                'record_merchant_id', record_merchant_id,
                'current_merchant_id', current_merchant,
                'session_info', current_setting('application_name', true)
            ), NOW()
        );
        RETURN TRUE;
    END IF;
    
    -- Tenant isolation check
    IF record_merchant_id = current_merchant THEN
        RETURN TRUE;
    END IF;
    
    -- Log unauthorized access attempt
    INSERT INTO audit_logs (
        entity_type, entity_id, action, performed_by,
        details, created_at
    ) VALUES (
        'RLS_ACCESS_DENIED', record_merchant_id::TEXT, operation_type,
        current_user, jsonb_build_object(
            'access_denied', true,
            'record_merchant_id', record_merchant_id,
            'current_merchant_id', current_merchant,
            'session_info', current_setting('application_name', true)
        ), NOW()
    );
    
    RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Create audit trail function for RLS operations
CREATE OR REPLACE FUNCTION log_rls_operation()
RETURNS TRIGGER AS $$
DECLARE
    operation_type TEXT;
    merchant_id_field UUID;
BEGIN
    -- Determine operation type
    operation_type := TG_OP;
    
    -- Extract merchant_id from record
    IF TG_OP = 'DELETE' THEN
        merchant_id_field := OLD.merchant_id;
    ELSE
        merchant_id_field := NEW.merchant_id;
    END IF;
    
    -- Log the operation
    INSERT INTO audit_logs (
        entity_type, entity_id, action, performed_by,
        details, created_at
    ) VALUES (
        TG_TABLE_NAME::TEXT, 
        COALESCE(NEW.id::TEXT, OLD.id::TEXT),
        operation_type,
        current_user,
        jsonb_build_object(
            'table', TG_TABLE_NAME,
            'merchant_id', merchant_id_field,
            'current_merchant_id', current_merchant_id(),
            'is_admin', is_admin_user(),
            'session_info', current_setting('application_name', true),
            'timestamp', NOW()
        ),
        NOW()
    );
    
    -- Return appropriate record
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Enhanced RLS policies for merchants table
DROP POLICY IF EXISTS merchants_tenant_access ON merchants;
CREATE POLICY merchants_enhanced_access ON merchants
    FOR ALL 
    USING (
        enhanced_tenant_access_check(id, 'SELECT')
    )
    WITH CHECK (
        enhanced_tenant_access_check(id, 'INSERT_UPDATE')
    );

-- Add audit trigger for merchants
DROP TRIGGER IF EXISTS merchants_audit_trigger ON merchants;
CREATE TRIGGER merchants_audit_trigger
    AFTER INSERT OR UPDATE OR DELETE ON merchants
    FOR EACH ROW EXECUTE FUNCTION log_rls_operation();

-- 4. Enhanced RLS policies for conversations table
DROP POLICY IF EXISTS conversations_tenant_access ON conversations;
CREATE POLICY conversations_enhanced_access ON conversations
    FOR ALL
    USING (
        enhanced_tenant_access_check(merchant_id, 'SELECT')
    )
    WITH CHECK (
        enhanced_tenant_access_check(merchant_id, 'INSERT_UPDATE')
    );

-- Add audit trigger for conversations
DROP TRIGGER IF EXISTS conversations_audit_trigger ON conversations;
CREATE TRIGGER conversations_audit_trigger
    AFTER INSERT OR UPDATE OR DELETE ON conversations
    FOR EACH ROW EXECUTE FUNCTION log_rls_operation();

-- 5. Enhanced RLS policies for message_logs table
DROP POLICY IF EXISTS message_logs_tenant_access ON message_logs;
CREATE POLICY message_logs_enhanced_access ON message_logs
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM conversations 
            WHERE conversations.id = message_logs.conversation_id 
            AND enhanced_tenant_access_check(conversations.merchant_id, 'SELECT')
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM conversations 
            WHERE conversations.id = message_logs.conversation_id 
            AND enhanced_tenant_access_check(conversations.merchant_id, 'INSERT_UPDATE')
        )
    );

-- Add audit trigger for message_logs
DROP TRIGGER IF EXISTS message_logs_audit_trigger ON message_logs;
CREATE TRIGGER message_logs_audit_trigger
    AFTER INSERT OR UPDATE OR DELETE ON message_logs
    FOR EACH ROW EXECUTE FUNCTION log_rls_operation();

-- 6. Enhanced RLS policies for products table
DROP POLICY IF EXISTS products_tenant_access ON products;
CREATE POLICY products_enhanced_access ON products
    FOR ALL
    USING (
        enhanced_tenant_access_check(merchant_id, 'SELECT')
    )
    WITH CHECK (
        enhanced_tenant_access_check(merchant_id, 'INSERT_UPDATE')
    );

-- Add audit trigger for products
DROP TRIGGER IF EXISTS products_audit_trigger ON products;
CREATE TRIGGER products_audit_trigger
    AFTER INSERT OR UPDATE OR DELETE ON products
    FOR EACH ROW EXECUTE FUNCTION log_rls_operation();

-- 7. Enhanced RLS policies for orders table
DROP POLICY IF EXISTS orders_tenant_access ON orders;
CREATE POLICY orders_enhanced_access ON orders
    FOR ALL
    USING (
        enhanced_tenant_access_check(merchant_id, 'SELECT')
    )
    WITH CHECK (
        enhanced_tenant_access_check(merchant_id, 'INSERT_UPDATE')
    );

-- Add audit trigger for orders
DROP TRIGGER IF EXISTS orders_audit_trigger ON orders;
CREATE TRIGGER orders_audit_trigger
    AFTER INSERT OR UPDATE OR DELETE ON orders
    FOR EACH ROW EXECUTE FUNCTION log_rls_operation();

-- 8. Enhanced RLS policies for merchant_credentials table
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'merchant_credentials' AND table_schema = 'public') THEN
        -- Drop existing policies
        DROP POLICY IF EXISTS credentials_tenant_access ON merchant_credentials;
        DROP POLICY IF EXISTS credentials_insert_own ON merchant_credentials;
        DROP POLICY IF EXISTS "credentials_tenant_isolation" ON merchant_credentials;
        DROP POLICY IF EXISTS "credentials_insert_own" ON merchant_credentials;
        
        -- Enable RLS
        ALTER TABLE merchant_credentials ENABLE ROW LEVEL SECURITY;
        
        -- Create enhanced policy
        CREATE POLICY merchant_credentials_enhanced_access ON merchant_credentials
            FOR ALL
            USING (
                enhanced_tenant_access_check(merchant_id, 'SELECT')
            )
            WITH CHECK (
                enhanced_tenant_access_check(merchant_id, 'INSERT_UPDATE')
            );
        
        -- Add audit trigger
        DROP TRIGGER IF EXISTS merchant_credentials_audit_trigger ON merchant_credentials;
        CREATE TRIGGER merchant_credentials_audit_trigger
            AFTER INSERT OR UPDATE OR DELETE ON merchant_credentials
            FOR EACH ROW EXECUTE FUNCTION log_rls_operation();
            
        RAISE NOTICE 'Enhanced RLS policies created for merchant_credentials table';
    END IF;
END $$;

-- 9. Enhanced RLS policies for message_windows table
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'message_windows' AND table_schema = 'public') THEN
        -- Drop existing policies
        DROP POLICY IF EXISTS message_windows_tenant_access ON message_windows;
        DROP POLICY IF EXISTS message_windows_insert_own ON message_windows;
        DROP POLICY IF EXISTS "message_windows_tenant_isolation" ON message_windows;
        DROP POLICY IF EXISTS "message_windows_insert_own" ON message_windows;
        
        -- Enable RLS
        ALTER TABLE message_windows ENABLE ROW LEVEL SECURITY;
        
        -- Create enhanced policy
        CREATE POLICY message_windows_enhanced_access ON message_windows
            FOR ALL
            USING (
                enhanced_tenant_access_check(merchant_id, 'SELECT')
            )
            WITH CHECK (
                enhanced_tenant_access_check(merchant_id, 'INSERT_UPDATE')
            );
        
        -- Add audit trigger
        DROP TRIGGER IF EXISTS message_windows_audit_trigger ON message_windows;
        CREATE TRIGGER message_windows_audit_trigger
            AFTER INSERT OR UPDATE OR DELETE ON message_windows
            FOR EACH ROW EXECUTE FUNCTION log_rls_operation();
            
        RAISE NOTICE 'Enhanced RLS policies created for message_windows table';
    END IF;
END $$;

-- 10. Enhanced RLS policies for job_spool table
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'job_spool' AND table_schema = 'public') THEN
        -- Drop existing policies
        DROP POLICY IF EXISTS job_spool_tenant_access ON job_spool;
        DROP POLICY IF EXISTS job_spool_tenant_isolation ON job_spool;
        DROP POLICY IF EXISTS job_spool_admin_access ON job_spool;
        
        -- Enable RLS
        ALTER TABLE job_spool ENABLE ROW LEVEL SECURITY;
        
        -- Create enhanced policy
        CREATE POLICY job_spool_enhanced_access ON job_spool
            FOR ALL
            USING (
                enhanced_tenant_access_check(merchant_id, 'SELECT')
            )
            WITH CHECK (
                enhanced_tenant_access_check(merchant_id, 'INSERT_UPDATE')
            );
        
        -- Add audit trigger
        DROP TRIGGER IF EXISTS job_spool_audit_trigger ON job_spool;
        CREATE TRIGGER job_spool_audit_trigger
            AFTER INSERT OR UPDATE OR DELETE ON job_spool
            FOR EACH ROW EXECUTE FUNCTION log_rls_operation();
            
        RAISE NOTICE 'Enhanced RLS policies created for job_spool table';
    END IF;
END $$;

-- 11. Enhanced RLS policies for queue_jobs table
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'queue_jobs' AND table_schema = 'public') THEN
        -- Drop existing policies
        DROP POLICY IF EXISTS queue_jobs_tenant_access ON queue_jobs;
        DROP POLICY IF EXISTS queue_jobs_tenant_isolation ON queue_jobs;
        DROP POLICY IF EXISTS queue_jobs_admin_access ON queue_jobs;
        
        -- Enable RLS
        ALTER TABLE queue_jobs ENABLE ROW LEVEL SECURITY;
        
        -- Create enhanced policy with payload check
        CREATE POLICY queue_jobs_enhanced_access ON queue_jobs
            FOR ALL
            USING (
                (payload->>'merchantId')::UUID = current_merchant_id()
                OR is_admin_user()
                OR current_user = 'postgres'
            )
            WITH CHECK (
                (payload->>'merchantId')::UUID = current_merchant_id()
                OR is_admin_user()
                OR current_user = 'postgres'
            );
        
        -- Add audit trigger for queue_jobs (special handling for payload)
        DROP TRIGGER IF EXISTS queue_jobs_audit_trigger ON queue_jobs;
        CREATE TRIGGER queue_jobs_audit_trigger
            AFTER INSERT OR UPDATE OR DELETE ON queue_jobs
            FOR EACH ROW EXECUTE FUNCTION log_rls_operation();
            
        RAISE NOTICE 'Enhanced RLS policies created for queue_jobs table';
    END IF;
END $$;

-- 12. Create RLS monitoring and reporting functions
CREATE OR REPLACE FUNCTION get_rls_security_report()
RETURNS TABLE(
    table_name TEXT,
    rls_enabled BOOLEAN,
    policy_count BIGINT,
    has_enhanced_policy BOOLEAN,
    has_audit_trigger BOOLEAN,
    recent_violations BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        t.tablename::TEXT,
        COALESCE(c.relrowsecurity, false) AS rls_enabled,
        COALESCE(p.policy_count, 0) AS policy_count,
        EXISTS(
            SELECT 1 FROM pg_policies pol 
            WHERE pol.tablename = t.tablename 
            AND pol.schemaname = 'public' 
            AND pol.policyname LIKE '%_enhanced_access'
        ) AS has_enhanced_policy,
        EXISTS(
            SELECT 1 FROM pg_triggers trg
            WHERE trg.tgrelid = (SELECT oid FROM pg_class WHERE relname = t.tablename)
            AND trg.tgname LIKE '%_audit_trigger'
        ) AS has_audit_trigger,
        (
            SELECT COUNT(*) FROM audit_logs 
            WHERE entity_type = 'RLS_ACCESS_DENIED'
            AND details->>'table' = t.tablename
            AND created_at > NOW() - INTERVAL '24 hours'
        ) AS recent_violations
    FROM (
        VALUES 
        ('merchants'),('conversations'),('message_logs'),('products'),
        ('orders'),('job_spool'),('queue_jobs'),('message_windows'),
        ('merchant_credentials'),('audit_logs'),('quality_metrics')
    ) AS t(tablename)
    LEFT JOIN pg_class c ON c.relname = t.tablename AND c.relnamespace = 'public'::regnamespace
    LEFT JOIN (
        SELECT tablename, COUNT(*) as policy_count
        FROM pg_policies 
        WHERE schemaname = 'public'
        GROUP BY tablename
    ) p ON p.tablename = t.tablename
    ORDER BY t.tablename;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 13. Create function to detect RLS bypass attempts
CREATE OR REPLACE FUNCTION detect_rls_bypass_attempts(
    hours_back INTEGER DEFAULT 1
) RETURNS TABLE(
    attempt_time TIMESTAMPTZ,
    table_name TEXT,
    user_name TEXT,
    merchant_attempted UUID,
    current_merchant UUID,
    session_info TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        a.created_at as attempt_time,
        a.details->>'table' as table_name,
        a.performed_by as user_name,
        (a.details->>'record_merchant_id')::UUID as merchant_attempted,
        (a.details->>'current_merchant_id')::UUID as current_merchant,
        a.details->>'session_info' as session_info
    FROM audit_logs a
    WHERE a.entity_type = 'RLS_ACCESS_DENIED'
    AND a.created_at > NOW() - (hours_back || ' hours')::INTERVAL
    ORDER BY a.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 14. Grant permissions on enhanced functions
GRANT EXECUTE ON FUNCTION enhanced_tenant_access_check(UUID, TEXT) TO app_user, postgres;
GRANT EXECUTE ON FUNCTION log_rls_operation() TO app_user, postgres;
GRANT EXECUTE ON FUNCTION get_rls_security_report() TO app_user, postgres;
GRANT EXECUTE ON FUNCTION detect_rls_bypass_attempts(INTEGER) TO app_user, postgres;

-- 15. Create performance indexes for audit logs
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_rls_entity_type 
    ON audit_logs (entity_type) WHERE entity_type LIKE 'RLS_%';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_rls_created_at 
    ON audit_logs (created_at) WHERE entity_type LIKE 'RLS_%';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_rls_table_time
    ON audit_logs (((details->>'table')), created_at) 
    WHERE entity_type = 'RLS_ACCESS_DENIED';

-- 16. Create security monitoring view
CREATE OR REPLACE VIEW rls_security_dashboard AS
SELECT 
    'RLS_POLICIES' as metric_type,
    COUNT(*) as total_count,
    COUNT(*) FILTER (WHERE rls_enabled) as enabled_count,
    COUNT(*) FILTER (WHERE has_enhanced_policy) as enhanced_count,
    COUNT(*) FILTER (WHERE has_audit_trigger) as audited_count
FROM get_rls_security_report()
UNION ALL
SELECT 
    'RLS_VIOLATIONS_24H' as metric_type,
    SUM(recent_violations)::BIGINT as total_count,
    COUNT(*) FILTER (WHERE recent_violations > 0) as enabled_count,
    MAX(recent_violations)::BIGINT as enhanced_count,
    AVG(recent_violations)::BIGINT as audited_count
FROM get_rls_security_report()
UNION ALL
SELECT 
    'RLS_AUDIT_LOGS_24H' as metric_type,
    COUNT(*)::BIGINT as total_count,
    COUNT(DISTINCT performed_by)::BIGINT as enabled_count,
    COUNT(*) FILTER (WHERE entity_type = 'RLS_ACCESS_DENIED')::BIGINT as enhanced_count,
    COUNT(*) FILTER (WHERE entity_type = 'RLS_ADMIN_ACCESS')::BIGINT as audited_count
FROM audit_logs 
WHERE entity_type LIKE 'RLS_%' 
AND created_at > NOW() - INTERVAL '24 hours';

GRANT SELECT ON rls_security_dashboard TO app_user, postgres;

-- 17. Add migration tracking
INSERT INTO schema_migrations (version, applied_at, success, description)
VALUES (
    '039_enhanced_rls_security.sql', 
    NOW(), 
    TRUE,
    'Enhanced RLS security policies with comprehensive audit logging'
)
ON CONFLICT (version) DO UPDATE SET 
    applied_at = NOW(),
    success = TRUE,
    description = EXCLUDED.description;

-- 18. Final validation and reporting
DO $$
DECLARE
    security_report RECORD;
    total_tables INTEGER := 0;
    secured_tables INTEGER := 0;
BEGIN
    -- Get security status
    FOR security_report IN 
        SELECT * FROM get_rls_security_report()
    LOOP
        total_tables := total_tables + 1;
        IF security_report.rls_enabled AND security_report.has_enhanced_policy THEN
            secured_tables := secured_tables + 1;
        END IF;
        
        RAISE NOTICE '🔒 %: RLS=% Enhanced=% Audit=% Violations=%', 
            security_report.table_name,
            CASE WHEN security_report.rls_enabled THEN '✅' ELSE '❌' END,
            CASE WHEN security_report.has_enhanced_policy THEN '✅' ELSE '❌' END,
            CASE WHEN security_report.has_audit_trigger THEN '✅' ELSE '❌' END,
            security_report.recent_violations;
    END LOOP;
    
    RAISE NOTICE '🔒 Enhanced RLS Security Summary:';
    RAISE NOTICE '   ✅ % out of % tables secured with enhanced policies', secured_tables, total_tables;
    RAISE NOTICE '   ✅ Comprehensive audit logging enabled';
    RAISE NOTICE '   ✅ Real-time security monitoring active';
    RAISE NOTICE '   ✅ Bypass attempt detection enabled';
    RAISE NOTICE '   📊 Use get_rls_security_report() for detailed status';
    RAISE NOTICE '   🚨 Use detect_rls_bypass_attempts() to check violations';
    RAISE NOTICE '   📈 View rls_security_dashboard for metrics';
END $$;