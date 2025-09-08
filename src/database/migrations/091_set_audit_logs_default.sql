-- Ensure audit_logs.resource_type has a safe default and backfill nulls
BEGIN;

  -- Set default to an allowed value per constraint
  ALTER TABLE public.audit_logs
    ALTER COLUMN resource_type SET DEFAULT 'SYSTEM';

  -- Backfill any legacy nulls if present
  UPDATE public.audit_logs
    SET resource_type = 'SYSTEM'
  WHERE resource_type IS NULL;

COMMIT;

