-- ===============================================
-- Comprehensive RLS Enhancement Migration
-- Extends RLS coverage to all remaining tables
-- ===============================================

-- 1. Enable RLS on any remaining tables that need tenant isolation
ALTER TABLE IF EXISTS webhook_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS queue_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS instagram_stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS instagram_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS instagram_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS service_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS utility_messages ENABLE ROW LEVEL SECURITY;

-- 2. Create/Update RLS policies for webhook_logs
DROP POLICY IF EXISTS "webhook_logs_tenant_isolation" ON webhook_logs;
CREATE POLICY "webhook_logs_tenant_isolation" ON webhook_logs
  FOR ALL 
  TO ai_sales
  USING (merchant_id = current_merchant_id() OR is_admin_user());

DROP POLICY IF EXISTS "webhook_logs_insert_own" ON webhook_logs;
CREATE POLICY "webhook_logs_insert_own" ON webhook_logs
  FOR INSERT 
  TO ai_sales
  WITH CHECK (merchant_id = current_merchant_id() OR is_admin_user());

-- 3. Update webhook_events RLS policies to use consistent role
DROP POLICY IF EXISTS webhook_events_merchant_policy ON webhook_events;
CREATE POLICY "webhook_events_tenant_isolation" ON webhook_events
  FOR ALL 
  TO ai_sales
  USING (merchant_id = current_merchant_id() OR is_admin_user());

DROP POLICY IF EXISTS "webhook_events_insert_own" ON webhook_events;
CREATE POLICY "webhook_events_insert_own" ON webhook_events
  FOR INSERT 
  TO ai_sales
  WITH CHECK (merchant_id = current_merchant_id() OR is_admin_user());

-- 4. Create RLS policies for queue_jobs (if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'queue_jobs') THEN
    EXECUTE 'CREATE POLICY "queue_jobs_tenant_isolation" ON queue_jobs
      FOR ALL 
      TO ai_sales
      USING (merchant_id = current_merchant_id() OR is_admin_user())';
    
    EXECUTE 'CREATE POLICY "queue_jobs_insert_own" ON queue_jobs
      FOR INSERT 
      TO ai_sales
      WITH CHECK (merchant_id = current_merchant_id() OR is_admin_user())';
  END IF;
END $$;

-- 5. Create RLS policies for instagram_stories (if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'instagram_stories') THEN
    EXECUTE 'CREATE POLICY "instagram_stories_tenant_isolation" ON instagram_stories
      FOR ALL 
      TO ai_sales
      USING (merchant_id = current_merchant_id() OR is_admin_user())';
    
    EXECUTE 'CREATE POLICY "instagram_stories_insert_own" ON instagram_stories
      FOR INSERT 
      TO ai_sales
      WITH CHECK (merchant_id = current_merchant_id() OR is_admin_user())';
  END IF;
END $$;

-- 6. Create RLS policies for instagram_comments (if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'instagram_comments') THEN
    EXECUTE 'CREATE POLICY "instagram_comments_tenant_isolation" ON instagram_comments
      FOR ALL 
      TO ai_sales
      USING (merchant_id = current_merchant_id() OR is_admin_user())';
    
    EXECUTE 'CREATE POLICY "instagram_comments_insert_own" ON instagram_comments
      FOR INSERT 
      TO ai_sales
      WITH CHECK (merchant_id = current_merchant_id() OR is_admin_user())';
  END IF;
END $$;

-- 7. Create RLS policies for instagram_media (if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'instagram_media') THEN
    EXECUTE 'CREATE POLICY "instagram_media_tenant_isolation" ON instagram_media
      FOR ALL 
      TO ai_sales
      USING (merchant_id = current_merchant_id() OR is_admin_user())';
    
    EXECUTE 'CREATE POLICY "instagram_media_insert_own" ON instagram_media
      FOR INSERT 
      TO ai_sales
      WITH CHECK (merchant_id = current_merchant_id() OR is_admin_user())';
  END IF;
END $$;

-- 8. Create RLS policies for service_controls (if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'service_controls') THEN
    EXECUTE 'CREATE POLICY "service_controls_tenant_isolation" ON service_controls
      FOR ALL 
      TO ai_sales
      USING (merchant_id = current_merchant_id() OR is_admin_user())';
    
    EXECUTE 'CREATE POLICY "service_controls_insert_own" ON service_controls
      FOR INSERT 
      TO ai_sales
      WITH CHECK (merchant_id = current_merchant_id() OR is_admin_user())';
  END IF;
END $$;

-- 9. Create RLS policies for utility_messages (if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'utility_messages') THEN
    EXECUTE 'CREATE POLICY "utility_messages_tenant_isolation" ON utility_messages
      FOR ALL 
      TO ai_sales
      USING (merchant_id = current_merchant_id() OR is_admin_user())';
    
    EXECUTE 'CREATE POLICY "utility_messages_insert_own" ON utility_messages
      FOR INSERT 
      TO ai_sales
      WITH CHECK (merchant_id = current_merchant_id() OR is_admin_user())';
  END IF;
END $$;

-- 10. Enhanced tenant context function with validation
CREATE OR REPLACE FUNCTION set_tenant_context(p_tenant_id UUID)
RETURNS VOID AS $$
DECLARE
  tenant_exists BOOLEAN;
BEGIN
  -- Validate that tenant exists
  SELECT EXISTS(SELECT 1 FROM merchants WHERE id = p_tenant_id) INTO tenant_exists;
  
  IF NOT tenant_exists THEN
    RAISE EXCEPTION 'Invalid tenant_id: %', p_tenant_id;
  END IF;
  
  -- Set the context
  PERFORM set_config('app.current_merchant_id', p_tenant_id::TEXT, true);
  PERFORM set_config('app.tenant_context_set_at', extract(epoch from now())::TEXT, true);
  
  RAISE NOTICE 'Tenant context set to: %', p_tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 11. Create function to validate all RLS policies
CREATE OR REPLACE FUNCTION validate_all_rls_policies()
RETURNS TABLE(
  table_name TEXT,
  rls_enabled BOOLEAN,
  policy_count INTEGER,
  has_tenant_isolation BOOLEAN,
  has_insert_check BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    t.tablename::TEXT,
    t.rowsecurity as rls_enabled,
    COALESCE(p.policy_count, 0) as policy_count,
    COALESCE(p.has_tenant_policy, false) as has_tenant_isolation,
    COALESCE(p.has_insert_policy, false) as has_insert_check
  FROM pg_tables t
  LEFT JOIN (
    SELECT 
      tablename,
      COUNT(*) as policy_count,
      COUNT(*) FILTER (WHERE policyname LIKE '%tenant_isolation%') > 0 as has_tenant_policy,
      COUNT(*) FILTER (WHERE policyname LIKE '%insert%') > 0 as has_insert_policy
    FROM pg_policies 
    WHERE schemaname = 'public'
    GROUP BY tablename
  ) p ON t.tablename = p.tablename
  WHERE t.schemaname = 'public'
    AND t.tablename NOT IN ('migrations', 'spatial_ref_sys')
  ORDER BY t.tablename;
END;
$$ LANGUAGE plpgsql;

-- 12. Create monitoring function for RLS context usage
CREATE OR REPLACE FUNCTION monitor_rls_context()
RETURNS TABLE(
  current_merchant UUID,
  is_admin BOOLEAN,
  context_set_at TIMESTAMPTZ,
  context_age_minutes NUMERIC,
  queries_count INTEGER
) AS $$
DECLARE
  ctx_set_at TEXT;
  ctx_timestamp NUMERIC;
BEGIN
  ctx_set_at := current_setting('app.tenant_context_set_at', true);
  
  IF ctx_set_at != '' THEN
    ctx_timestamp := ctx_set_at::NUMERIC;
  ELSE
    ctx_timestamp := extract(epoch from now());
  END IF;

  RETURN QUERY SELECT 
    current_merchant_id(),
    is_admin_user(),
    to_timestamp(ctx_timestamp),
    (extract(epoch from now()) - ctx_timestamp) / 60,
    0; -- Placeholder for query count - would need pg_stat_statements
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 13. Create additional performance indexes for RLS
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webhook_logs_merchant_id_rls 
ON webhook_logs (merchant_id) WHERE merchant_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webhook_events_merchant_id_rls 
ON webhook_events (merchant_id) WHERE merchant_id IS NOT NULL;

-- 14. Grant execute permissions on new functions
GRANT EXECUTE ON FUNCTION set_tenant_context(UUID) TO ai_sales;
GRANT EXECUTE ON FUNCTION validate_all_rls_policies() TO ai_sales;
GRANT EXECUTE ON FUNCTION monitor_rls_context() TO ai_sales;

-- 15. Create utility to reset all security context
CREATE OR REPLACE FUNCTION reset_security_context()
RETURNS VOID AS $$
BEGIN
  PERFORM clear_security_context();
  PERFORM set_config('app.tenant_context_set_at', '', true);
  
  RAISE NOTICE 'All security context cleared';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION reset_security_context() TO ai_sales;

-- 16. Log completion
DO $$
BEGIN
  RAISE NOTICE '✅ Comprehensive RLS enhancement completed';
  RAISE NOTICE '✅ All tenant tables now have RLS policies';
  RAISE NOTICE '✅ Enhanced context management functions created';
  RAISE NOTICE '📊 Run validate_all_rls_policies() to check coverage';
  RAISE NOTICE '🔍 Use monitor_rls_context() to monitor usage';
END $$;

-- Record this migration
INSERT INTO migrations (name, filename) VALUES ('Comprehensive RLS Enhancement', '020_comprehensive_rls_enhancement.sql')
ON CONFLICT (filename) DO NOTHING;