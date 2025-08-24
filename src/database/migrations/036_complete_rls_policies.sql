-- ===============================================
-- Complete RLS Policies Migration
-- Adds missing RLS policies for security compliance
-- Migration: 036_complete_rls_policies.sql
-- ===============================================

-- Enable RLS for job_spool table
DO $$
BEGIN
    -- Check if table exists and RLS is not already enabled
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'job_spool' AND table_schema = 'public') THEN
        -- Enable RLS
        ALTER TABLE job_spool ENABLE ROW LEVEL SECURITY;
        
        -- Drop existing policy if it exists
        DROP POLICY IF EXISTS job_spool_tenant_isolation ON job_spool;
        
        -- Create tenant isolation policy
        CREATE POLICY job_spool_tenant_isolation ON job_spool 
            FOR ALL 
            USING (
                merchant_id::text = current_setting('app.current_merchant_id', true)
                OR current_setting('app.is_admin', true)::boolean = true
            );
            
        -- Create policy for admin users
        DROP POLICY IF EXISTS job_spool_admin_access ON job_spool;
        CREATE POLICY job_spool_admin_access ON job_spool
            FOR ALL
            TO postgres
            USING (true);
        
        RAISE NOTICE 'RLS policies created for job_spool table';
    ELSE
        RAISE NOTICE 'job_spool table does not exist, skipping RLS setup';
    END IF;
END $$;

-- Enable RLS for queue_jobs table if it exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'queue_jobs' AND table_schema = 'public') THEN
        -- Enable RLS
        ALTER TABLE queue_jobs ENABLE ROW LEVEL SECURITY;
        
        -- Drop existing policy if it exists
        DROP POLICY IF EXISTS queue_jobs_tenant_isolation ON queue_jobs;
        
        -- Create tenant isolation policy (assuming payload contains merchantId)
        CREATE POLICY queue_jobs_tenant_isolation ON queue_jobs 
            FOR ALL 
            USING (
                (payload->>'merchantId')::text = current_setting('app.current_merchant_id', true)
                OR current_setting('app.is_admin', true)::boolean = true
            );
            
        -- Create policy for admin users
        DROP POLICY IF EXISTS queue_jobs_admin_access ON queue_jobs;
        CREATE POLICY queue_jobs_admin_access ON queue_jobs
            FOR ALL
            TO postgres
            USING (true);
        
        RAISE NOTICE 'RLS policies created for queue_jobs table';
    ELSE
        RAISE NOTICE 'queue_jobs table does not exist, skipping RLS setup';
    END IF;
END $$;

-- Enable RLS for products table if not already enabled
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'products' AND table_schema = 'public') THEN
        -- Enable RLS
        ALTER TABLE products ENABLE ROW LEVEL SECURITY;
        
        -- Drop existing policy if it exists
        DROP POLICY IF EXISTS products_tenant_isolation ON products;
        
        -- Create tenant isolation policy
        CREATE POLICY products_tenant_isolation ON products 
            FOR ALL 
            USING (
                merchant_id::text = current_setting('app.current_merchant_id', true)
                OR current_setting('app.is_admin', true)::boolean = true
            );
            
        -- Create policy for admin users
        DROP POLICY IF EXISTS products_admin_access ON products;
        CREATE POLICY products_admin_access ON products
            FOR ALL
            TO postgres
            USING (true);
        
        RAISE NOTICE 'RLS policies created for products table';
    ELSE
        RAISE NOTICE 'products table does not exist, skipping RLS setup';
    END IF;
END $$;

-- Enable RLS for orders table if not already enabled
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'orders' AND table_schema = 'public') THEN
        -- Enable RLS
        ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
        
        -- Drop existing policy if it exists
        DROP POLICY IF EXISTS orders_tenant_isolation ON orders;
        
        -- Create tenant isolation policy
        CREATE POLICY orders_tenant_isolation ON orders 
            FOR ALL 
            USING (
                merchant_id::text = current_setting('app.current_merchant_id', true)
                OR current_setting('app.is_admin', true)::boolean = true
            );
            
        -- Create policy for admin users
        DROP POLICY IF EXISTS orders_admin_access ON orders;
        CREATE POLICY orders_admin_access ON orders
            FOR ALL
            TO postgres
            USING (true);
        
        RAISE NOTICE 'RLS policies created for orders table';
    ELSE
        RAISE NOTICE 'orders table does not exist, skipping RLS setup';
    END IF;
END $$;

-- Validate RLS configuration
DO $$
DECLARE
    rls_table RECORD;
    policy_count INTEGER;
BEGIN
    -- Check all tables with RLS enabled
    FOR rls_table IN 
        SELECT tablename 
        FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename IN ('merchants', 'conversations', 'message_logs', 'products', 'orders', 'job_spool', 'queue_jobs')
    LOOP
        -- Count policies for each table
        SELECT COUNT(*) INTO policy_count
        FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = rls_table.tablename;
        
        IF policy_count = 0 THEN
            RAISE WARNING 'Table % has RLS enabled but no policies defined', rls_table.tablename;
        ELSE
            RAISE NOTICE 'Table % has % RLS policies configured', rls_table.tablename, policy_count;
        END IF;
    END LOOP;
    
    RAISE NOTICE 'RLS validation completed successfully';
END $$;

-- Create helper function to check RLS status
CREATE OR REPLACE FUNCTION check_rls_status()
RETURNS TABLE(
    table_name TEXT,
    rls_enabled BOOLEAN,
    policy_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        t.tablename::TEXT,
        (SELECT relrowsecurity FROM pg_class WHERE relname = t.tablename AND relnamespace = 'public'::regnamespace) AS rls_enabled,
        (SELECT COUNT(*) FROM pg_policies p WHERE p.tablename = t.tablename AND p.schemaname = 'public') AS policy_count
    FROM pg_tables t
    WHERE t.schemaname = 'public'
    AND t.tablename IN ('merchants', 'conversations', 'message_logs', 'products', 'orders', 'job_spool', 'queue_jobs')
    ORDER BY t.tablename;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION check_rls_status() TO PUBLIC;

-- Log migration completion
INSERT INTO migration_log (migration_name, executed_at, status) 
VALUES ('036_complete_rls_policies.sql', NOW(), 'SUCCESS')
ON CONFLICT (migration_name) DO UPDATE SET 
    executed_at = NOW(), 
    status = 'SUCCESS';