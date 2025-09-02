-- ===============================================
-- 068: Create merchant_service_status table
-- ===============================================

CREATE TABLE IF NOT EXISTS public.merchant_service_status (
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  service_name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (merchant_id, service_name)
);

CREATE INDEX IF NOT EXISTS idx_mss_merchant ON public.merchant_service_status(merchant_id);

-- Maintain updated_at
CREATE OR REPLACE FUNCTION public.update_mss_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mss_updated ON public.merchant_service_status;
CREATE TRIGGER trg_mss_updated
  BEFORE UPDATE ON public.merchant_service_status
  FOR EACH ROW EXECUTE FUNCTION public.update_mss_updated_at();

-- Minimal RLS
ALTER TABLE public.merchant_service_status ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='merchant_service_status' AND policyname='mss_tenant'
  ) THEN
    EXECUTE 'CREATE POLICY mss_tenant ON public.merchant_service_status '
            'FOR ALL TO PUBLIC '
            'USING (merchant_id = public.current_merchant_id() OR public.is_admin_user()) '
            'WITH CHECK (merchant_id = public.current_merchant_id() OR public.is_admin_user())';
  END IF;
END $$;