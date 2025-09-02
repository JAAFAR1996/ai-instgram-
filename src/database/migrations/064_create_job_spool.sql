-- ===============================================
-- 064: Create job_spool table + minimal RLS
-- ===============================================

CREATE TABLE IF NOT EXISTS public.job_spool (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id text NOT NULL UNIQUE,
  job_type text NOT NULL,
  job_data jsonb,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  scheduled_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  processed_at timestamptz
);

-- Helpful indexes for scheduler and stats
CREATE INDEX IF NOT EXISTS idx_job_spool_pending ON public.job_spool (scheduled_at, created_at)
  WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_job_spool_priority ON public.job_spool (priority, created_at)
  WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_job_spool_type ON public.job_spool (job_type)
  WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_job_spool_merchant ON public.job_spool (merchant_id);

-- Minimal RLS: allow tenant rows or admin mode
ALTER TABLE public.job_spool ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='job_spool' AND policyname='job_spool_tenant_isolation'
  ) THEN
    EXECUTE 'CREATE POLICY job_spool_tenant_isolation ON public.job_spool '
            'FOR ALL TO PUBLIC '
            'USING (merchant_id = public.current_merchant_id() '
            '       OR COALESCE(current_setting(''app.admin_mode'', true), ''false'')::boolean '
            '       OR public.is_admin_user()) '
            'WITH CHECK (merchant_id = public.current_merchant_id() '
            '       OR COALESCE(current_setting(''app.admin_mode'', true), ''false'')::boolean '
            '       OR public.is_admin_user())';
  END IF;
END $$;