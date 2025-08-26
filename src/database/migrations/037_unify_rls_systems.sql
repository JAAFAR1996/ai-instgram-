-- ===============================================
-- Unified RLS System Migration
-- Consolidates multiple RLS implementations into one consistent system
-- Migration: 037_unify_rls_systems.sql
-- ===============================================

-- 1. Create or ensure unified app_user role exists
DO $$
BEGIN
    -- Create app_user role if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user;
        RAISE NOTICE 'Created unified app_user role';
    END IF;
    
    -- Grant basic schema access
    GRANT USAGE ON SCHEMA public TO app_user;
    GRANT CONNECT ON DATABASE postgres TO app_user;
END $$;

-- 2. Create unified RLS helper functions (replacing any existing ones)
CREATE OR REPLACE FUNCTION current_merchant_id() 
RETURNS UUID AS $$
DECLARE
    merchant_id_str TEXT;
BEGIN
    -- Get merchant ID from session variable with proper error handling
    merchant_id_str := current_setting('app.current_merchant_id', true);
    
    -- Return NULL if not set or empty
    IF merchant_id_str IS NULL OR merchant_id_str = '' THEN
        RETURN NULL;
    END IF;
    
    -- Convert to UUID with proper error handling
    BEGIN
        RETURN merchant_id_str::UUID;
    EXCEPTION 
        WHEN OTHERS THEN
            RAISE WARNING 'Invalid merchant_id format: %', merchant_id_str;
            RETURN NULL;
    END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_admin_user()
RETURNS BOOLEAN AS $$
DECLARE
    admin_str TEXT;
BEGIN
    -- Get admin flag from session variable
    admin_str := current_setting('app.is_admin', true);
    
    -- Default to false if not set or invalid
    BEGIN
        RETURN COALESCE(admin_str::BOOLEAN, false);
    EXCEPTION
        WHEN OTHERS THEN
            RETURN false;
    END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- 3. Create context management functions
CREATE OR REPLACE FUNCTION set_merchant_context(p_merchant_id UUID)
RETURNS VOID AS $$
BEGIN
    IF p_merchant_id IS NULL THEN
        RAISE EXCEPTION 'merchant_id cannot be null';
    END IF;
    
    -- Set merchant context for session
    PERFORM set_config('app.current_merchant_id', p_merchant_id::TEXT, false);
    PERFORM set_config('app.context_set_at', extract(epoch from now())::TEXT, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION set_admin_context(p_is_admin BOOLEAN DEFAULT true)
RETURNS VOID AS $$
BEGIN
    PERFORM set_config('app.is_admin', p_is_admin::TEXT, false);
    
    IF p_is_admin THEN
        PERFORM set_config('app.admin_context_set_at', extract(epoch from now())::TEXT, false);
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION clear_context()
RETURNS VOID AS $$
BEGIN
    PERFORM set_config('app.current_merchant_id', '', false);
    PERFORM set_config('app.is_admin', 'false', false);
    PERFORM set_config('app.context_set_at', '', false);
    PERFORM set_config('app.admin_context_set_at', '', false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Grant permissions on unified functions
GRANT EXECUTE ON FUNCTION current_merchant_id() TO app_user, postgres;
GRANT EXECUTE ON FUNCTION is_admin_user() TO app_user, postgres;
GRANT EXECUTE ON FUNCTION set_merchant_context(UUID) TO app_user, postgres;
GRANT EXECUTE ON FUNCTION set_admin_context(BOOLEAN) TO app_user, postgres;
GRANT EXECUTE ON FUNCTION clear_context() TO app_user, postgres;

-- 5. Drop and recreate all RLS policies with unified approach
-- This ensures consistent policy naming and logic across all tables

-- Merchants table
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'merchants' AND table_schema = 'public') THEN
        ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
        
        -- Drop all existing policies
        DROP POLICY IF EXISTS merchants_tenant_isolation ON merchants;
        DROP POLICY IF EXISTS merchants_insert_own ON merchants;
        DROP POLICY IF EXISTS "merchants_tenant_isolation" ON merchants;
        DROP POLICY IF EXISTS "merchants_insert_own" ON merchants;
        DROP POLICY IF EXISTS merchants_admin_access ON merchants;
        
        -- Create unified policies
        CREATE POLICY merchants_tenant_access ON merchants 
            FOR ALL 
            USING (
                id = current_merchant_id() 
                OR is_admin_user()
                OR current_user = 'postgres'
            );
            
        RAISE NOTICE 'Unified RLS policies created for merchants table';
    END IF;
END $$;

-- Conversations table  
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'conversations' AND table_schema = 'public') THEN
        ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
        
        -- Drop all existing policies
        DROP POLICY IF EXISTS conversations_tenant_isolation ON conversations;
        DROP POLICY IF EXISTS conversations_insert_own ON conversations;
        DROP POLICY IF EXISTS "conversations_tenant_isolation" ON conversations;
        DROP POLICY IF EXISTS "conversations_insert_own" ON conversations;
        DROP POLICY IF EXISTS conversations_admin_access ON conversations;
        
        -- Create unified policy
        CREATE POLICY conversations_tenant_access ON conversations 
            FOR ALL 
            USING (
                merchant_id = current_merchant_id() 
                OR is_admin_user()
                OR current_user = 'postgres'
            );
            
        RAISE NOTICE 'Unified RLS policies created for conversations table';
    END IF;
END $$;

-- Message logs table
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'message_logs' AND table_schema = 'public') THEN
        ALTER TABLE message_logs ENABLE ROW LEVEL SECURITY;
        
        -- Drop all existing policies
        DROP POLICY IF EXISTS message_logs_tenant_isolation ON message_logs;
        DROP POLICY IF EXISTS message_logs_insert_own ON message_logs;
        DROP POLICY IF EXISTS "message_logs_tenant_isolation" ON message_logs;
        DROP POLICY IF EXISTS "message_logs_insert_own" ON message_logs;
        DROP POLICY IF EXISTS message_logs_admin_access ON message_logs;
        
        -- Create unified policy (via conversation relationship)
        CREATE POLICY message_logs_tenant_access ON message_logs 
            FOR ALL 
            USING (
                EXISTS (
                    SELECT 1 FROM conversations 
                    WHERE conversations.id = message_logs.conversation_id 
                    AND conversations.merchant_id = current_merchant_id()
                )
                OR is_admin_user()
                OR current_user = 'postgres'
            );
            
        RAISE NOTICE 'Unified RLS policies created for message_logs table';
    END IF;
END $$;

-- Products table
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'products' AND table_schema = 'public') THEN
        ALTER TABLE products ENABLE ROW LEVEL SECURITY;
        
        -- Drop all existing policies
        DROP POLICY IF EXISTS products_tenant_isolation ON products;
        DROP POLICY IF EXISTS products_insert_own ON products;
        DROP POLICY IF EXISTS "products_tenant_isolation" ON products;
        DROP POLICY IF EXISTS "products_insert_own" ON products;
        DROP POLICY IF EXISTS products_admin_access ON products;
        
        -- Create unified policy
        CREATE POLICY products_tenant_access ON products 
            FOR ALL 
            USING (
                merchant_id = current_merchant_id() 
                OR is_admin_user()
                OR current_user = 'postgres'
            );
            
        RAISE NOTICE 'Unified RLS policies created for products table';
    END IF;
END $$;

-- Orders table
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'orders' AND table_schema = 'public') THEN
        ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
        
        -- Drop all existing policies  
        DROP POLICY IF EXISTS orders_tenant_isolation ON orders;
        DROP POLICY IF EXISTS orders_insert_own ON orders;
        DROP POLICY IF EXISTS "orders_tenant_isolation" ON orders;
        DROP POLICY IF EXISTS "orders_insert_own" ON orders;
        DROP POLICY IF EXISTS orders_admin_access ON orders;
        
        -- Create unified policy
        CREATE POLICY orders_tenant_access ON orders 
            FOR ALL 
            USING (
                merchant_id = current_merchant_id() 
                OR is_admin_user()
                OR current_user = 'postgres'
            );
            
        RAISE NOTICE 'Unified RLS policies created for orders table';
    END IF;
END $$;

-- Job spool table
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'job_spool' AND table_schema = 'public') THEN
        ALTER TABLE job_spool ENABLE ROW LEVEL SECURITY;
        
        -- Drop all existing policies
        DROP POLICY IF EXISTS job_spool_tenant_isolation ON job_spool;
        DROP POLICY IF EXISTS job_spool_admin_access ON job_spool;
        
        -- Create unified policy
        CREATE POLICY job_spool_tenant_access ON job_spool 
            FOR ALL 
            USING (
                merchant_id = current_merchant_id() 
                OR is_admin_user()
                OR current_user = 'postgres'
            );
            
        RAISE NOTICE 'Unified RLS policies created for job_spool table';
    END IF;
END $$;

-- Queue jobs table  
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'queue_jobs' AND table_schema = 'public') THEN
        ALTER TABLE queue_jobs ENABLE ROW LEVEL SECURITY;
        
        -- Drop all existing policies
        DROP POLICY IF EXISTS queue_jobs_tenant_isolation ON queue_jobs;
        DROP POLICY IF EXISTS queue_jobs_admin_access ON queue_jobs;
        
        -- Create unified policy (using payload merchantId)
        CREATE POLICY queue_jobs_tenant_access ON queue_jobs 
            FOR ALL 
            USING (
                (payload->>'merchantId') = current_merchant_id()::TEXT
                OR is_admin_user()
                OR current_user = 'postgres'
            );
            
        RAISE NOTICE 'Unified RLS policies created for queue_jobs table';
    END IF;
END $$;

-- Message windows table
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'message_windows' AND table_schema = 'public') THEN
        ALTER TABLE message_windows ENABLE ROW LEVEL SECURITY;
        
        -- Drop all existing policies
        DROP POLICY IF EXISTS message_windows_tenant_isolation ON message_windows;
        DROP POLICY IF EXISTS message_windows_insert_own ON message_windows;
        DROP POLICY IF EXISTS "message_windows_tenant_isolation" ON message_windows;
        DROP POLICY IF EXISTS "message_windows_insert_own" ON message_windows;
        
        -- Create unified policy
        CREATE POLICY message_windows_tenant_access ON message_windows 
            FOR ALL 
            USING (
                merchant_id = current_merchant_id() 
                OR is_admin_user()
                OR current_user = 'postgres'
            );
            
        RAISE NOTICE 'Unified RLS policies created for message_windows table';
    END IF;
END $$;

-- Manual followup queue table
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'manual_followup_queue' AND table_schema = 'public') THEN
        ALTER TABLE manual_followup_queue ENABLE ROW LEVEL SECURITY;
        
        -- Drop all existing policies
        DROP POLICY IF EXISTS manual_followup_tenant_isolation ON manual_followup_queue;
        
        -- Create unified policy
        CREATE POLICY manual_followup_tenant_access ON manual_followup_queue 
            FOR ALL 
            USING (
                merchant_id = current_merchant_id() 
                OR is_admin_user()
                OR current_user = 'postgres'
            );
            
        RAISE NOTICE 'Unified RLS policies created for manual_followup_queue table';
    END IF;
END $$;

-- 6. Create unified context validation function
CREATE OR REPLACE FUNCTION validate_rls_context()
RETURNS TABLE(
    has_merchant_context BOOLEAN,
    merchant_id UUID,
    is_admin BOOLEAN,
    context_age_seconds NUMERIC,
    recommendations TEXT[]
) AS $$
DECLARE
    ctx_set_at TEXT;
    ctx_timestamp NUMERIC;
    rec TEXT[];
BEGIN
    ctx_set_at := current_setting('app.context_set_at', true);
    
    IF ctx_set_at != '' AND ctx_set_at IS NOT NULL THEN
        ctx_timestamp := ctx_set_at::NUMERIC;
    ELSE
        ctx_timestamp := 0;
        rec := array_append(rec, 'Context timestamp not set - call set_merchant_context()');
    END IF;

    IF current_merchant_id() IS NULL AND NOT is_admin_user() THEN
        rec := array_append(rec, 'No merchant context and not admin - queries may return empty results');
    END IF;

    IF extract(epoch from now()) - ctx_timestamp > 3600 THEN
        rec := array_append(rec, 'Context is older than 1 hour - consider refreshing');
    END IF;

    RETURN QUERY SELECT 
        current_merchant_id() IS NOT NULL as has_merchant_context,
        current_merchant_id() as merchant_id,
        is_admin_user() as is_admin,
        CASE 
            WHEN ctx_timestamp > 0 THEN extract(epoch from now()) - ctx_timestamp 
            ELSE NULL 
        END as context_age_seconds,
        COALESCE(rec, ARRAY[]::TEXT[]) as recommendations;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Create unified RLS status check function
CREATE OR REPLACE FUNCTION check_unified_rls_status()
RETURNS TABLE(
    table_name TEXT,
    rls_enabled BOOLEAN,
    policy_count BIGINT,
    has_unified_policy BOOLEAN
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
            AND pol.policyname LIKE '%_tenant_access'
        ) AS has_unified_policy
    FROM (
        VALUES 
        ('merchants'),('conversations'),('message_logs'),('products'),
        ('orders'),('job_spool'),('queue_jobs'),('message_windows'),
        ('manual_followup_queue'),('merchant_credentials'),('audit_logs'),
        ('quality_metrics')
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

-- 8. Grant permissions on utility functions
GRANT EXECUTE ON FUNCTION validate_rls_context() TO app_user, postgres;
GRANT EXECUTE ON FUNCTION check_unified_rls_status() TO app_user, postgres;

-- 9. Create performance indexes for unified RLS
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_merchant_rls 
    ON conversations (merchant_id) WHERE merchant_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_merchant_rls 
    ON products (merchant_id) WHERE merchant_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_merchant_rls 
    ON orders (merchant_id) WHERE merchant_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_message_windows_merchant_rls 
    ON message_windows (merchant_id) WHERE merchant_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_spool_merchant_rls 
    ON job_spool (merchant_id) WHERE merchant_id IS NOT NULL;

-- 10. Create view for current unified context
CREATE OR REPLACE VIEW unified_context AS
SELECT 
    current_merchant_id() as merchant_id,
    is_admin_user() as is_admin,
    current_setting('app.current_merchant_id', true) as merchant_id_raw,
    current_setting('app.is_admin', true) as admin_raw,
    current_setting('app.context_set_at', true) as context_set_at,
    current_user as database_user;

GRANT SELECT ON unified_context TO app_user, postgres;

-- 11. Add migration tracking
INSERT INTO schema_migrations (version, applied_at, success, description)
VALUES (
    '037_unify_rls_systems.sql', 
    NOW(), 
    TRUE,
    'Unified all RLS systems into consistent implementation with app_user role'
)
ON CONFLICT (version) DO UPDATE SET 
    applied_at = NOW(),
    success = TRUE,
    description = EXCLUDED.description;

-- 12. Final validation and notices
DO $$
DECLARE
    status_record RECORD;
    total_tables INTEGER := 0;
    unified_tables INTEGER := 0;
BEGIN
    -- Count unified tables
    FOR status_record IN 
        SELECT * FROM check_unified_rls_status() 
        WHERE rls_enabled = true
    LOOP
        total_tables := total_tables + 1;
        IF status_record.has_unified_policy THEN
            unified_tables := unified_tables + 1;
        END IF;
    END LOOP;
    
    RAISE NOTICE '✅ RLS unification completed';
    RAISE NOTICE '✅ Unified app_user role created and configured';  
    RAISE NOTICE '✅ % out of % tables have unified RLS policies', unified_tables, total_tables;
    RAISE NOTICE '✅ Context management functions unified';
    RAISE NOTICE '✅ Performance indexes created';
    RAISE NOTICE '📋 Use validate_rls_context() to check session context';
    RAISE NOTICE '📋 Use check_unified_rls_status() to verify RLS configuration';
END $$;