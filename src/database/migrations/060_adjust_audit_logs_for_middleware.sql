-- ===============================================
-- 060: Adjust audit_logs schema to match middleware usage
-- Ensures columns referenced by src/middleware/security.ts exist
-- ===============================================

BEGIN;

-- Ensure audit_logs table exists (created in 042)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema='public' AND table_name='audit_logs'
  ) THEN
    RAISE EXCEPTION 'audit_logs table is missing. Apply migration 042 first.';
  END IF;
END $$;

-- Add columns expected by middleware (idempotent)
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS entity_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS details JSONB,
  ADD COLUMN IF NOT EXISTS trace_id UUID,
  ADD COLUMN IF NOT EXISTS request_path TEXT,
  ADD COLUMN IF NOT EXISTS request_method TEXT,
  ADD COLUMN IF NOT EXISTS execution_time_ms INTEGER,
  ADD COLUMN IF NOT EXISTS memory_usage_mb NUMERIC,
  ADD COLUMN IF NOT EXISTS success BOOLEAN;

-- Helpful indexes for query patterns
CREATE INDEX IF NOT EXISTS idx_audit_logs_trace ON public.audit_logs(trace_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_req ON public.audit_logs(request_method, request_path);

-- Comments for documentation
COMMENT ON COLUMN public.audit_logs.entity_type IS 'Logical entity type (matches middleware)';
COMMENT ON COLUMN public.audit_logs.details IS 'Request/response details payload (JSON)';
COMMENT ON COLUMN public.audit_logs.trace_id IS 'Request trace identifier (UUID)';
COMMENT ON COLUMN public.audit_logs.request_path IS 'HTTP request path';
COMMENT ON COLUMN public.audit_logs.request_method IS 'HTTP method';
COMMENT ON COLUMN public.audit_logs.execution_time_ms IS 'Request execution time in milliseconds';
COMMENT ON COLUMN public.audit_logs.memory_usage_mb IS 'Approximate heap memory MB at time of logging';
COMMENT ON COLUMN public.audit_logs.success IS 'Indicates success/failure of the request';

COMMIT;

