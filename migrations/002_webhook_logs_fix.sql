BEGIN;

ALTER TABLE webhook_logs
  ADD COLUMN IF NOT EXISTS event_id VARCHAR(255);

ALTER TABLE webhook_logs
  DROP CONSTRAINT IF EXISTS uq_webhook_logs_platform_event_id;

ALTER TABLE webhook_logs
  ADD CONSTRAINT uq_webhook_logs_platform_event_id UNIQUE (platform, event_id);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_event_id ON webhook_logs(event_id);

COMMIT;