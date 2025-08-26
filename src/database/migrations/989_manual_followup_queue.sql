-- Migration: Add manual followup queue table
-- Description: Creates table for tracking messages that need manual followup
-- Date: 2024-12-19

-- Create manual followup queue table
CREATE TABLE IF NOT EXISTS manual_followup_queue (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    customer_id VARCHAR(255) NOT NULL,
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    original_message TEXT NOT NULL,
    reason VARCHAR(100) NOT NULL,
    priority VARCHAR(20) DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
    status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ASSIGNED', 'COMPLETED', 'CANCELLED')),
    assigned_to UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    scheduled_for TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    notes TEXT
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_manual_followup_merchant ON manual_followup_queue (merchant_id);
CREATE INDEX IF NOT EXISTS idx_manual_followup_status ON manual_followup_queue (status, priority, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_manual_followup_assigned ON manual_followup_queue (assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_manual_followup_conversation ON manual_followup_queue (conversation_id) WHERE conversation_id IS NOT NULL;

-- Create function for updating timestamps
CREATE OR REPLACE FUNCTION update_manual_followup_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    -- Only update completed_at when status changes to COMPLETED
    IF NEW.status = 'COMPLETED' AND OLD.status != 'COMPLETED' THEN
        NEW.completed_at = NOW();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for updating timestamps
DROP TRIGGER IF EXISTS update_manual_followup_timestamp ON manual_followup_queue;
CREATE TRIGGER update_manual_followup_timestamp
    BEFORE UPDATE ON manual_followup_queue
    FOR EACH ROW EXECUTE FUNCTION update_manual_followup_timestamp();

-- Add RLS (Row Level Security) policies
ALTER TABLE manual_followup_queue ENABLE ROW LEVEL SECURITY;

-- Policy for merchants to see only their followup items
DROP POLICY IF EXISTS "Merchants can view their own followup items" ON manual_followup_queue;
CREATE POLICY "Merchants can view their own followup items" ON manual_followup_queue
    FOR SELECT USING (merchant_id = current_setting('app.current_merchant_id')::UUID);

-- Policy for merchants to insert their own followup items
DROP POLICY IF EXISTS "Merchants can insert their own followup items" ON manual_followup_queue;
CREATE POLICY "Merchants can insert their own followup items" ON manual_followup_queue
    FOR INSERT WITH CHECK (merchant_id = current_setting('app.current_merchant_id')::UUID);

-- Policy for merchants to update their own followup items
DROP POLICY IF EXISTS "Merchants can update their own followup items" ON manual_followup_queue;
CREATE POLICY "Merchants can update their own followup items" ON manual_followup_queue
    FOR UPDATE USING (merchant_id = current_setting('app.current_merchant_id')::UUID);

-- Policy for merchants to delete their own followup items
DROP POLICY IF EXISTS "Merchants can delete their own followup items" ON manual_followup_queue;
CREATE POLICY "Merchants can delete their own followup items" ON manual_followup_queue
    FOR DELETE USING (merchant_id = current_setting('app.current_merchant_id')::UUID);

-- Add comments for documentation
COMMENT ON TABLE manual_followup_queue IS 'Queue for tracking messages that require manual followup by staff';
COMMENT ON COLUMN manual_followup_queue.reason IS 'Reason why manual followup is needed (e.g., MESSAGE_WINDOW_EXPIRED, AI_FAILED, etc.)';
COMMENT ON COLUMN manual_followup_queue.priority IS 'Priority level for followup (LOW, MEDIUM, HIGH, URGENT)';
COMMENT ON COLUMN manual_followup_queue.status IS 'Current status of the followup item';
COMMENT ON COLUMN manual_followup_queue.assigned_to IS 'UUID of the staff member assigned to handle this followup';
COMMENT ON COLUMN manual_followup_queue.scheduled_for IS 'When this followup should be handled';
COMMENT ON COLUMN manual_followup_queue.completed_at IS 'When this followup was completed (auto-set when status changes to COMPLETED)';
