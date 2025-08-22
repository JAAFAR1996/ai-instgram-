/**
 * Migration 027: Add AI Configuration Column to Merchants Table
 * Adds ai_config JSONB column to store merchant-specific AI settings
 */

-- Add ai_config column to merchants table
ALTER TABLE merchants 
ADD COLUMN ai_config JSONB DEFAULT '{
  "model": "gpt-4o-mini",
  "maxTokens": 600,
  "temperature": 0.8,
  "language": "ar"
}'::jsonb;

-- Add index for performance on ai_config queries
CREATE INDEX idx_merchants_ai_config 
ON merchants USING GIN (ai_config);

-- Add constraint to ensure valid JSON structure
ALTER TABLE merchants 
ADD CONSTRAINT check_ai_config_structure 
CHECK (
  ai_config IS NULL OR (
    ai_config ? 'model' AND 
    ai_config ? 'maxTokens' AND 
    ai_config ? 'temperature' AND 
    ai_config ? 'language'
  )
);

-- Update existing merchants with default AI config
UPDATE merchants 
SET ai_config = '{
  "model": "gpt-4o-mini",
  "maxTokens": 600,
  "temperature": 0.8,
  "language": "ar"
}'::jsonb
WHERE ai_config IS NULL;

-- Add comment for documentation
COMMENT ON COLUMN merchants.ai_config IS 'AI configuration settings for merchant-specific AI behavior';