-- ===============================================
-- 062: Minimal RLS enablement using app context
-- Safe policies with TO PUBLIC, driven by app.current_merchant_id
-- ===============================================

-- Helper functions
CREATE OR REPLACE FUNCTION public.current_merchant_id()
RETURNS uuid AS $$
BEGIN
  RETURN COALESCE(current_setting('app.current_merchant_id', true)::uuid,
                  '00000000-0000-0000-0000-000000000000'::uuid);
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS boolean AS $$
BEGIN
  RETURN COALESCE(current_setting('app.is_admin', true)::boolean, false);
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.set_merchant_context(p_merchant_id uuid)
RETURNS void AS $$
BEGIN
  IF p_merchant_id IS NULL THEN
    RAISE EXCEPTION 'merchant_id cannot be null';
  END IF;
  PERFORM set_config('app.current_merchant_id', p_merchant_id::text, true);
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.set_admin_context(p_is_admin boolean DEFAULT true)
RETURNS void AS $$
BEGIN
  PERFORM set_config('app.is_admin', COALESCE(p_is_admin,false)::text, true);
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.clear_security_context()
RETURNS void AS $$
BEGIN
  PERFORM set_config('app.current_merchant_id', '', true);
  PERFORM set_config('app.is_admin', 'false', true);
END; $$ LANGUAGE plpgsql;

-- Enable RLS and create policies if tables exist
DO $$
BEGIN
  -- merchants
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='merchants') THEN
    EXECUTE 'ALTER TABLE public.merchants ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS merchants_tenant_isolation ON public.merchants';
    EXECUTE 'CREATE POLICY merchants_tenant_isolation ON public.merchants '
            'FOR ALL TO PUBLIC '
            'USING (id = public.current_merchant_id() OR public.is_admin_user()) '
            'WITH CHECK (id = public.current_merchant_id() OR public.is_admin_user())';
  END IF;

  -- merchant_credentials
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='merchant_credentials') THEN
    EXECUTE 'ALTER TABLE public.merchant_credentials ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS merchant_credentials_tenant_isolation ON public.merchant_credentials';
    EXECUTE 'CREATE POLICY merchant_credentials_tenant_isolation ON public.merchant_credentials '
            'FOR ALL TO PUBLIC '
            'USING (merchant_id = public.current_merchant_id() OR public.is_admin_user()) '
            'WITH CHECK (merchant_id = public.current_merchant_id() OR public.is_admin_user())';
  END IF;

  -- products
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='products') THEN
    EXECUTE 'ALTER TABLE public.products ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS products_tenant_isolation ON public.products';
    EXECUTE 'CREATE POLICY products_tenant_isolation ON public.products '
            'FOR ALL TO PUBLIC '
            'USING (merchant_id = public.current_merchant_id() OR public.is_admin_user()) '
            'WITH CHECK (merchant_id = public.current_merchant_id() OR public.is_admin_user())';
  END IF;

  -- orders
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='orders') THEN
    EXECUTE 'ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS orders_tenant_isolation ON public.orders';
    EXECUTE 'CREATE POLICY orders_tenant_isolation ON public.orders '
            'FOR ALL TO PUBLIC '
            'USING (merchant_id = public.current_merchant_id() OR public.is_admin_user()) '
            'WITH CHECK (merchant_id = public.current_merchant_id() OR public.is_admin_user())';
  END IF;

  -- conversations
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='conversations') THEN
    EXECUTE 'ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS conversations_tenant_isolation ON public.conversations';
    EXECUTE 'CREATE POLICY conversations_tenant_isolation ON public.conversations '
            'FOR ALL TO PUBLIC '
            'USING (merchant_id = public.current_merchant_id() OR public.is_admin_user()) '
            'WITH CHECK (merchant_id = public.current_merchant_id() OR public.is_admin_user())';
  END IF;

  -- message_logs (via conversation)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='message_logs') THEN
    EXECUTE 'ALTER TABLE public.message_logs ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS message_logs_tenant_isolation ON public.message_logs';
    EXECUTE 'CREATE POLICY message_logs_tenant_isolation ON public.message_logs '
            'FOR ALL TO PUBLIC '
            'USING (conversation_id IN (SELECT id FROM public.conversations WHERE merchant_id = public.current_merchant_id()) OR public.is_admin_user()) '
            'WITH CHECK (conversation_id IN (SELECT id FROM public.conversations WHERE merchant_id = public.current_merchant_id()) OR public.is_admin_user())';
  END IF;

  -- message_windows
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='message_windows') THEN
    EXECUTE 'ALTER TABLE public.message_windows ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS message_windows_tenant_isolation ON public.message_windows';
    EXECUTE 'CREATE POLICY message_windows_tenant_isolation ON public.message_windows '
            'FOR ALL TO PUBLIC '
            'USING (merchant_id = public.current_merchant_id() OR public.is_admin_user()) '
            'WITH CHECK (merchant_id = public.current_merchant_id() OR public.is_admin_user())';
  END IF;

  -- manychat_subscribers
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='manychat_subscribers') THEN
    EXECUTE 'ALTER TABLE public.manychat_subscribers ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS manychat_subscribers_tenant_isolation ON public.manychat_subscribers';
    EXECUTE 'CREATE POLICY manychat_subscribers_tenant_isolation ON public.manychat_subscribers '
            'FOR ALL TO PUBLIC '
            'USING (merchant_id = public.current_merchant_id() OR public.is_admin_user()) '
            'WITH CHECK (merchant_id = public.current_merchant_id() OR public.is_admin_user())';
  END IF;

  -- manychat_logs
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='manychat_logs') THEN
    EXECUTE 'ALTER TABLE public.manychat_logs ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS manychat_logs_tenant_isolation ON public.manychat_logs';
    EXECUTE 'CREATE POLICY manychat_logs_tenant_isolation ON public.manychat_logs '
            'FOR ALL TO PUBLIC '
            'USING (merchant_id = public.current_merchant_id() OR public.is_admin_user()) '
            'WITH CHECK (merchant_id = public.current_merchant_id() OR public.is_admin_user())';
  END IF;

  -- audit_logs
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='audit_logs') THEN
    EXECUTE 'ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS audit_logs_tenant_isolation ON public.audit_logs';
    EXECUTE 'CREATE POLICY audit_logs_tenant_isolation ON public.audit_logs '
            'FOR ALL TO PUBLIC '
            'USING (merchant_id = public.current_merchant_id() OR merchant_id IS NULL OR public.is_admin_user()) '
            'WITH CHECK (merchant_id = public.current_merchant_id() OR merchant_id IS NULL OR public.is_admin_user())';
  END IF;

  -- quality_metrics
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='quality_metrics') THEN
    EXECUTE 'ALTER TABLE public.quality_metrics ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS quality_metrics_tenant_isolation ON public.quality_metrics';
    EXECUTE 'CREATE POLICY quality_metrics_tenant_isolation ON public.quality_metrics '
            'FOR ALL TO PUBLIC '
            'USING (merchant_id = public.current_merchant_id() OR public.is_admin_user()) '
            'WITH CHECK (merchant_id = public.current_merchant_id() OR public.is_admin_user())';
  END IF;
END $$;
