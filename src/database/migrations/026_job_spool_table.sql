-- Migration 026: Job Spool Table for Redis Fallback
-- When Redis is rate limited, jobs are spooled to database

CREATE TABLE IF NOT EXISTS job_spool (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id VARCHAR(255) UNIQUE NOT NULL,
  job_type VARCHAR(100) NOT NULL,
  job_data JSONB NOT NULL,
  priority VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
  merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ NULL,
  
  CONSTRAINT valid_priority CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')),
  CONSTRAINT valid_job_type CHECK (job_type IN (
    'WEBHOOK_PROCESSING',
    'AI_RESPONSE_GENERATION', 
    'MESSAGE_DELIVERY',
    'CONVERSATION_CLEANUP',
    'ANALYTICS_PROCESSING',
    'NOTIFICATION_SEND',
    'DATA_EXPORT',
    'SYSTEM_MAINTENANCE'
  ))
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_job_spool_scheduled ON job_spool(scheduled_at, priority) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_job_spool_merchant ON job_spool(merchant_id) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_job_spool_type ON job_spool(job_type) WHERE processed_at IS NULL;

-- Enable RLS for tenant isolation
ALTER TABLE job_spool ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only see jobs for their merchant
DROP POLICY IF EXISTS job_spool_tenant_isolation ON job_spool;
CREATE POLICY job_spool_tenant_isolation ON job_spool
  USING (
    merchant_id::text = current_setting('app.current_merchant_id', true)
    OR current_setting('app.admin_mode', true) = 'true'
  );

-- RLS Policy: Tenant insert/update access
DROP POLICY IF EXISTS job_spool_tenant_modify ON job_spool;
CREATE POLICY job_spool_tenant_modify ON job_spool
  FOR ALL
  USING (
    merchant_id::text = current_setting('app.current_merchant_id', true)
    OR current_setting('app.admin_mode', true) = 'true'
  );

COMMENT ON TABLE job_spool IS 'Database fallback spool for jobs when Redis is unavailable or rate limited';