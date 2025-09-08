-- Ensure a safe default for audit_logs.resource_type compatible with constraints
BEGIN;
  ALTER TABLE public.audit_logs
    ALTER COLUMN resource_type SET DEFAULT 'SYSTEM';
COMMIT;

