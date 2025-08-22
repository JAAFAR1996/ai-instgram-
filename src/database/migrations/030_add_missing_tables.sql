/**
 * Migration 030: Add Missing Tables for Tests
 * Creates webhook_events and service_errors tables needed for tests
 */

-- Create webhook_events table
CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL,
  platform VARCHAR(50) NOT NULL,
  webhook_id VARCHAR(255) UNIQUE NOT NULL,
  payload JSONB NOT NULL,
  processed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create service_errors table 
CREATE TABLE IF NOT EXISTS service_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
  service_name VARCHAR(100) NOT NULL,
  error_type VARCHAR(100) NOT NULL,
  error_message TEXT NOT NULL,
  error_context JSONB,
  resolved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add indexes for performance
CREATE INDEX idx_webhook_events_merchant_id ON webhook_events(merchant_id);
CREATE INDEX idx_webhook_events_webhook_id ON webhook_events(webhook_id);
CREATE INDEX idx_webhook_events_created_at ON webhook_events(created_at);
CREATE INDEX idx_service_errors_merchant_id ON service_errors(merchant_id);
CREATE INDEX idx_service_errors_service_name ON service_errors(service_name);
CREATE INDEX idx_service_errors_created_at ON service_errors(created_at);

-- Add RLS policies
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_errors ENABLE ROW LEVEL SECURITY;

-- RLS policy for webhook_events 
CREATE POLICY webhook_events_tenant_isolation ON webhook_events
  USING (
    current_setting('app.admin_mode', true) = 'true' OR 
    merchant_id::text = current_setting('app.current_merchant_id', true)
  );

-- RLS policy for service_errors
CREATE POLICY service_errors_tenant_isolation ON service_errors
  USING (
    current_setting('app.admin_mode', true) = 'true' OR 
    merchant_id IS NULL OR
    merchant_id::text = current_setting('app.current_merchant_id', true)
  );

-- Add comments for documentation
COMMENT ON TABLE webhook_events IS 'Webhook events received from platforms';
COMMENT ON TABLE service_errors IS 'Service errors and exceptions for monitoring';