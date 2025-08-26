-- Fix constraints issues
BEGIN;

-- 1. Update delivery_status constraint to include more values
ALTER TABLE message_logs DROP CONSTRAINT IF EXISTS message_logs_delivery_status_check;
ALTER TABLE message_logs ADD CONSTRAINT message_logs_delivery_status_check 
CHECK (delivery_status IN ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'EXPIRED', 'PREPARING'));

-- 2. Make performed_by nullable in audit_logs
ALTER TABLE audit_logs ALTER COLUMN performed_by DROP NOT NULL;

COMMIT;

SELECT 'Constraints fixed successfully' as result;