-- ===============================================
-- Row Level Security (RLS) Migration - 2025 Standards
-- ✅ تفعيل أمان متعدد المستأجرين وحماية البيانات
-- ===============================================

-- 1. Create RLS helper functions
CREATE OR REPLACE FUNCTION current_merchant_id() 
RETURNS UUID AS $$
BEGIN
  -- الحصول على merchant_id من إعدادات الجلسة
  RETURN COALESCE(
    current_setting('app.current_merchant_id', true)::UUID,
    '00000000-0000-0000-0000-000000000000'::UUID
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Create admin bypass function
CREATE OR REPLACE FUNCTION is_admin_user()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN COALESCE(
    current_setting('app.is_admin', true)::BOOLEAN,
    false
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Enable RLS on all tenant-scoped tables
ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_metrics ENABLE ROW LEVEL SECURITY;

-- 4. Create RLS policies for merchants table
DROP POLICY IF EXISTS "merchants_tenant_isolation" ON merchants;
CREATE POLICY "merchants_tenant_isolation" ON merchants
  FOR ALL 
  TO ai_sales
  USING (id = current_merchant_id() OR is_admin_user());

DROP POLICY IF EXISTS "merchants_insert_own" ON merchants;
CREATE POLICY "merchants_insert_own" ON merchants
  FOR INSERT 
  TO ai_sales
  WITH CHECK (id = current_merchant_id() OR is_admin_user());

-- 5. Create RLS policies for merchant_credentials
DROP POLICY IF EXISTS "credentials_tenant_isolation" ON merchant_credentials;
CREATE POLICY "credentials_tenant_isolation" ON merchant_credentials
  FOR ALL 
  TO ai_sales
  USING (merchant_id = current_merchant_id() OR is_admin_user());

DROP POLICY IF EXISTS "credentials_insert_own" ON merchant_credentials;
CREATE POLICY "credentials_insert_own" ON merchant_credentials
  FOR INSERT 
  TO ai_sales
  WITH CHECK (merchant_id = current_merchant_id() OR is_admin_user());

-- 6. Create RLS policies for products
DROP POLICY IF EXISTS "products_tenant_isolation" ON products;
CREATE POLICY "products_tenant_isolation" ON products
  FOR ALL 
  TO ai_sales
  USING (merchant_id = current_merchant_id() OR is_admin_user());

DROP POLICY IF EXISTS "products_insert_own" ON products;
CREATE POLICY "products_insert_own" ON products
  FOR INSERT 
  TO ai_sales
  WITH CHECK (merchant_id = current_merchant_id() OR is_admin_user());

-- 7. Create RLS policies for orders
DROP POLICY IF EXISTS "orders_tenant_isolation" ON orders;
CREATE POLICY "orders_tenant_isolation" ON orders
  FOR ALL 
  TO ai_sales
  USING (merchant_id = current_merchant_id() OR is_admin_user());

DROP POLICY IF EXISTS "orders_insert_own" ON orders;
CREATE POLICY "orders_insert_own" ON orders
  FOR INSERT 
  TO ai_sales
  WITH CHECK (merchant_id = current_merchant_id() OR is_admin_user());

-- 8. Create RLS policies for conversations
DROP POLICY IF EXISTS "conversations_tenant_isolation" ON conversations;
CREATE POLICY "conversations_tenant_isolation" ON conversations
  FOR ALL 
  TO ai_sales
  USING (merchant_id = current_merchant_id() OR is_admin_user());

DROP POLICY IF EXISTS "conversations_insert_own" ON conversations;
CREATE POLICY "conversations_insert_own" ON conversations
  FOR INSERT 
  TO ai_sales
  WITH CHECK (merchant_id = current_merchant_id() OR is_admin_user());

-- 9. Create RLS policies for message_logs
DROP POLICY IF EXISTS "message_logs_tenant_isolation" ON message_logs;
CREATE POLICY "message_logs_tenant_isolation" ON message_logs
  FOR ALL 
  TO ai_sales
  USING (
    conversation_id IN (
      SELECT id FROM conversations 
      WHERE merchant_id = current_merchant_id()
    ) OR is_admin_user()
  );

DROP POLICY IF EXISTS "message_logs_insert_own" ON message_logs;
CREATE POLICY "message_logs_insert_own" ON message_logs
  FOR INSERT 
  TO ai_sales
  WITH CHECK (
    conversation_id IN (
      SELECT id FROM conversations 
      WHERE merchant_id = current_merchant_id()
    ) OR is_admin_user()
  );

-- 10. Create RLS policies for message_windows
DROP POLICY IF EXISTS "message_windows_tenant_isolation" ON message_windows;
CREATE POLICY "message_windows_tenant_isolation" ON message_windows
  FOR ALL 
  TO ai_sales
  USING (merchant_id = current_merchant_id() OR is_admin_user());

DROP POLICY IF EXISTS "message_windows_insert_own" ON message_windows;
CREATE POLICY "message_windows_insert_own" ON message_windows
  FOR INSERT 
  TO ai_sales
  WITH CHECK (merchant_id = current_merchant_id() OR is_admin_user());

-- 11. Create RLS policies for audit_logs
DROP POLICY IF EXISTS "audit_logs_tenant_isolation" ON audit_logs;
CREATE POLICY "audit_logs_tenant_isolation" ON audit_logs
  FOR ALL 
  TO ai_sales
  USING (
    merchant_id = current_merchant_id() 
    OR merchant_id IS NULL 
    OR is_admin_user()
  );

DROP POLICY IF EXISTS "audit_logs_insert_own" ON audit_logs;
CREATE POLICY "audit_logs_insert_own" ON audit_logs
  FOR INSERT 
  TO ai_sales
  WITH CHECK (
    merchant_id = current_merchant_id() 
    OR merchant_id IS NULL 
    OR is_admin_user()
  );

-- 12. Create RLS policies for quality_metrics
DROP POLICY IF EXISTS "quality_metrics_tenant_isolation" ON quality_metrics;
CREATE POLICY "quality_metrics_tenant_isolation" ON quality_metrics
  FOR ALL 
  TO ai_sales
  USING (merchant_id = current_merchant_id() OR is_admin_user());

DROP POLICY IF EXISTS "quality_metrics_insert_own" ON quality_metrics;
CREATE POLICY "quality_metrics_insert_own" ON quality_metrics
  FOR INSERT 
  TO ai_sales
  WITH CHECK (merchant_id = current_merchant_id() OR is_admin_user());

-- 13. Create helper function to set merchant context
CREATE OR REPLACE FUNCTION set_merchant_context(p_merchant_id UUID)
RETURNS VOID AS $$
BEGIN
  -- التحقق من صحة merchant_id
  IF p_merchant_id IS NULL THEN
    RAISE EXCEPTION 'merchant_id cannot be null';
  END IF;
  
  -- تحديد merchant_id للجلسة
  PERFORM set_config('app.current_merchant_id', p_merchant_id::TEXT, true);
  
  -- تسجيل في الأدوات
  PERFORM set_config('app.context_set_at', extract(epoch from now())::TEXT, true);
  
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 14. Create helper function to set admin context
CREATE OR REPLACE FUNCTION set_admin_context(p_is_admin BOOLEAN DEFAULT true)
RETURNS VOID AS $$
BEGIN
  PERFORM set_config('app.is_admin', p_is_admin::TEXT, true);
  
  IF p_is_admin THEN
    PERFORM set_config('app.admin_context_set_at', extract(epoch from now())::TEXT, true);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 15. Create function to clear security context
CREATE OR REPLACE FUNCTION clear_security_context()
RETURNS VOID AS $$
BEGIN
  PERFORM set_config('app.current_merchant_id', '', true);
  PERFORM set_config('app.is_admin', 'false', true);
  PERFORM set_config('app.context_set_at', '', true);
  PERFORM set_config('app.admin_context_set_at', '', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 16. Create validation function for RLS context
CREATE OR REPLACE FUNCTION validate_rls_context()
RETURNS TABLE(
  has_merchant_context BOOLEAN,
  merchant_id UUID,
  is_admin BOOLEAN,
  context_age_seconds NUMERIC
) AS $$
DECLARE
  ctx_set_at TEXT;
  ctx_timestamp NUMERIC;
BEGIN
  ctx_set_at := current_setting('app.context_set_at', true);
  
  IF ctx_set_at != '' THEN
    ctx_timestamp := ctx_set_at::NUMERIC;
  ELSE
    ctx_timestamp := 0;
  END IF;

  RETURN QUERY SELECT 
    current_setting('app.current_merchant_id', true) != '' as has_merchant_context,
    current_merchant_id() as merchant_id,
    is_admin_user() as is_admin,
    extract(epoch from now()) - ctx_timestamp as context_age_seconds;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 17. Create indexes for RLS performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_merchant_id_rls 
ON products (merchant_id) WHERE merchant_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_merchant_id_rls 
ON orders (merchant_id) WHERE merchant_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_merchant_id_rls 
ON conversations (merchant_id) WHERE merchant_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_message_windows_merchant_id_rls 
ON message_windows (merchant_id) WHERE merchant_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_merchant_id_rls 
ON audit_logs (merchant_id) WHERE merchant_id IS NOT NULL;

-- 18. Grant execute permissions on RLS functions
GRANT EXECUTE ON FUNCTION current_merchant_id() TO ai_sales;
GRANT EXECUTE ON FUNCTION is_admin_user() TO ai_sales;
GRANT EXECUTE ON FUNCTION set_merchant_context(UUID) TO ai_sales;
GRANT EXECUTE ON FUNCTION set_admin_context(BOOLEAN) TO ai_sales;
GRANT EXECUTE ON FUNCTION clear_security_context() TO ai_sales;
GRANT EXECUTE ON FUNCTION validate_rls_context() TO ai_sales;

-- 19. Create warning for missing context
CREATE OR REPLACE FUNCTION warn_missing_rls_context()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.current_merchant_id', true) = '' 
     AND NOT is_admin_user() THEN
    RAISE WARNING 'RLS context not set - queries may return empty results';
  END IF;
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 20. Add notices in logs
DO $$
BEGIN
  RAISE NOTICE '✅ RLS policies enabled on all tenant tables';
  RAISE NOTICE '✅ RLS helper functions created';
  RAISE NOTICE '✅ Performance indexes created';
  RAISE NOTICE '⚠️  Remember to call set_merchant_context() before queries';
  RAISE NOTICE '📚 Use validate_rls_context() to check current context';
END $$;