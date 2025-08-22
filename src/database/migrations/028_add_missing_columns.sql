/**
 * Migration 028: Add Missing Columns for Tests
 * Adds is_active columns to merchants and conversations tables
 */

-- Add is_active column to merchants table
ALTER TABLE merchants 
ADD COLUMN is_active BOOLEAN DEFAULT true;

-- Update existing merchants to be active
UPDATE merchants 
SET is_active = true
WHERE is_active IS NULL;

-- Add is_active column to conversations table  
ALTER TABLE conversations
ADD COLUMN is_active BOOLEAN DEFAULT true;

-- Update existing conversations to be active
UPDATE conversations
SET is_active = true  
WHERE is_active IS NULL;

-- Add indexes for performance
CREATE INDEX idx_merchants_is_active ON merchants(is_active);
CREATE INDEX idx_conversations_is_active ON conversations(is_active);

-- Add comments for documentation
COMMENT ON COLUMN merchants.is_active IS 'Whether this merchant account is active';
COMMENT ON COLUMN conversations.is_active IS 'Whether this conversation is currently active';