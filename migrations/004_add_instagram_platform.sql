BEGIN;
ALTER TABLE webhook_logs DROP CONSTRAINT IF EXISTS webhook_logs_platform_check;
ALTER TABLE webhook_logs
  ADD CONSTRAINT webhook_logs_platform_check
  CHECK (platform IN ('facebook','whatsapp','instagram'));
COMMIT;
