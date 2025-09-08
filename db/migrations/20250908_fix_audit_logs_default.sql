-- Backfill & default for audit_logs.resource_type to avoid NOT NULL errors
BEGIN;
  ALTER TABLE public.audit_logs
    ALTER COLUMN resource_type SET DEFAULT 'SYSTEM';

  UPDATE public.audit_logs
    SET resource_type = 'SYSTEM'
  WHERE resource_type IS NULL;
COMMIT;

