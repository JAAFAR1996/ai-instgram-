-- Fix remaining missing columns
BEGIN;

-- 1. Add missing columns to conversations table
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS customer_whatsapp VARCHAR(20);
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255);

-- 2. Add ai_config column to merchants table
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS ai_config JSONB DEFAULT '{"model": "gpt-4o-mini", "temperature": 0.3, "max_tokens": 200}';

-- 3. Add execution_time_ms column to audit_logs table
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS execution_time_ms INTEGER;

-- 4. Update conversation_stage constraint to include more values
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_conversation_stage_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_conversation_stage_check 
CHECK (conversation_stage IN (
    'GREETING', 'PRODUCT_INQUIRY', 'ORDER_PROCESSING', 'PAYMENT', 'SUPPORT', 
    'COMPLETED', 'ABANDONED', 'ESCALATED', 'FOLLOW_UP', 'CLOSING',
    'AI_RESPONSE', 'WAITING_RESPONSE', 'PROCESSING'
));

-- 5. Create indexes for new columns
CREATE INDEX IF NOT EXISTS idx_conversations_customer_whatsapp ON conversations (customer_whatsapp) WHERE customer_whatsapp IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_customer_name ON conversations (customer_name) WHERE customer_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_merchants_ai_config ON merchants USING GIN (ai_config);
CREATE INDEX IF NOT EXISTS idx_audit_logs_execution_time ON audit_logs (execution_time_ms) WHERE execution_time_ms IS NOT NULL;

-- 6. Update existing conversations to have proper customer mapping
UPDATE conversations 
SET 
    customer_whatsapp = customer_phone,
    customer_name = COALESCE(customer_name, 'Instagram User')
WHERE customer_whatsapp IS NULL AND customer_phone IS NOT NULL;

-- 7. Add comments for documentation
COMMENT ON COLUMN conversations.customer_whatsapp IS 'WhatsApp phone number for cross-platform support';
COMMENT ON COLUMN merchants.ai_config IS 'AI model configuration (temperature, model, tokens, etc.)';
COMMENT ON COLUMN audit_logs.execution_time_ms IS 'Execution time for the logged operation in milliseconds';

COMMIT;

SELECT 'All missing columns added and constraints fixed!' as result;