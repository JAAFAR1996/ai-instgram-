-- Add more missing columns to message_logs
BEGIN;

-- Add updated_at column
ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Add error_message column  
ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS error_message TEXT;

-- Update existing rows to have updated_at value
UPDATE message_logs SET updated_at = created_at WHERE updated_at IS NULL;

-- Add delivery status SENDING to constraint
ALTER TABLE message_logs DROP CONSTRAINT IF EXISTS message_logs_delivery_status_check;
ALTER TABLE message_logs ADD CONSTRAINT message_logs_delivery_status_check 
CHECK (delivery_status IN ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'EXPIRED', 'PREPARING', 'SENDING'));

COMMIT;

SELECT 'Additional columns added successfully' as result;