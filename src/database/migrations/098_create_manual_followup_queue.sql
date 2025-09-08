-- ===============================================
-- 098: Manual Followup Queue
-- Queue for human escalation and manual follow-ups
-- ===============================================

-- Requirements:
-- - merchants table must exist
-- - conversations table optional (FK is nullable)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='merchants'
  ) THEN
    RAISE EXCEPTION 'Migration 098 failed: merchants table missing. Run base migrations first.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.manual_followup_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL,
  conversation_id UUID NULL REFERENCES public.conversations(id) ON DELETE SET NULL,
  original_message TEXT NOT NULL,
  reason TEXT NOT NULL,
  -- status and priority stored in lower-case; allow only known values via checks
  status TEXT NOT NULL DEFAULT 'pending' CHECK (lower(status) IN ('pending','processing','completed','cancelled')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (lower(priority) IN ('low','normal','high','urgent')),
  assigned_to TEXT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ NULL,
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Helpful indexes for common queries
CREATE INDEX IF NOT EXISTS idx_mfq_merchant_status ON public.manual_followup_queue(merchant_id, status);
CREATE INDEX IF NOT EXISTS idx_mfq_priority_time ON public.manual_followup_queue(priority, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_mfq_scheduled_for ON public.manual_followup_queue(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_mfq_assigned_processing ON public.manual_followup_queue(assigned_to) WHERE status = 'processing';

-- RLS enablement (use app.current_merchant_id from earlier migrations)
ALTER TABLE public.manual_followup_queue ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='manual_followup_queue' AND policyname='mfq_tenant_isolation'
  ) THEN
    CREATE POLICY mfq_tenant_isolation ON public.manual_followup_queue
      FOR ALL USING (
        merchant_id = current_setting('app.current_merchant_id', true)::uuid
      );
  END IF;
END $$;

-- updated_at trigger using shared helper
CREATE OR REPLACE FUNCTION public.update_mfq_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_mfq_updated_at ON public.manual_followup_queue;
CREATE TRIGGER trigger_mfq_updated_at
  BEFORE UPDATE ON public.manual_followup_queue
  FOR EACH ROW EXECUTE FUNCTION public.update_mfq_updated_at();

-- Normalize status/priority to lower-case on insert/update to keep consistency
CREATE OR REPLACE FUNCTION public.normalize_mfq_values()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IS NOT NULL THEN NEW.status := lower(NEW.status); END IF;
  IF NEW.priority IS NOT NULL THEN NEW.priority := lower(NEW.priority); END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_mfq_normalize_ins ON public.manual_followup_queue;
CREATE TRIGGER trigger_mfq_normalize_ins
  BEFORE INSERT ON public.manual_followup_queue
  FOR EACH ROW EXECUTE FUNCTION public.normalize_mfq_values();

DROP TRIGGER IF EXISTS trigger_mfq_normalize_upd ON public.manual_followup_queue;
CREATE TRIGGER trigger_mfq_normalize_upd
  BEFORE UPDATE ON public.manual_followup_queue
  FOR EACH ROW EXECUTE FUNCTION public.normalize_mfq_values();

