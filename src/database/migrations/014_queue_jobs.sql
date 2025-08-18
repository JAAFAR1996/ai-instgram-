-- ===============================================
-- Queue Jobs Table - Async Job Processing
-- Stores background jobs for async processing
-- ===============================================

-- Create queue jobs table
CREATE TABLE IF NOT EXISTS queue_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    priority VARCHAR(20) NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'RETRYING')),
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    failed_at TIMESTAMP WITH TIME ZONE,
    error TEXT,
    result JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_queue_jobs_status_priority ON queue_jobs (status, priority, scheduled_at) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_queue_jobs_type ON queue_jobs (type);
CREATE INDEX IF NOT EXISTS idx_queue_jobs_created_at ON queue_jobs (created_at);
CREATE INDEX IF NOT EXISTS idx_queue_jobs_scheduled_at ON queue_jobs (scheduled_at);
CREATE INDEX IF NOT EXISTS idx_queue_jobs_status ON queue_jobs (status);

-- Partial index for active jobs
CREATE INDEX IF NOT EXISTS idx_queue_jobs_active ON queue_jobs (scheduled_at, priority) 
WHERE status IN ('PENDING', 'PROCESSING', 'RETRYING');

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_queue_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER queue_jobs_updated_at_trigger
    BEFORE UPDATE ON queue_jobs
    FOR EACH ROW
    EXECUTE FUNCTION update_queue_jobs_updated_at();

-- Create function to get next job for processing
CREATE OR REPLACE FUNCTION get_next_queue_job()
RETURNS SETOF queue_jobs AS $$
BEGIN
    RETURN QUERY
    UPDATE queue_jobs 
    SET 
        status = 'PROCESSING',
        started_at = NOW(),
        updated_at = NOW()
    WHERE id = (
        SELECT id FROM queue_jobs
        WHERE status = 'PENDING'
        AND scheduled_at <= NOW()
        AND attempts < max_attempts
        ORDER BY 
            CASE priority
                WHEN 'CRITICAL' THEN 1
                WHEN 'HIGH' THEN 2
                WHEN 'NORMAL' THEN 3
                WHEN 'LOW' THEN 4
            END,
            created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
    )
    RETURNING *;
END;
$$ LANGUAGE plpgsql;

-- Create function to cleanup old completed jobs
CREATE OR REPLACE FUNCTION cleanup_old_queue_jobs(older_than_days INTEGER DEFAULT 7)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM queue_jobs
    WHERE status IN ('COMPLETED', 'FAILED')
    AND updated_at < NOW() - INTERVAL '1 day' * older_than_days;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Create function to retry failed jobs
CREATE OR REPLACE FUNCTION retry_failed_queue_jobs(job_type_filter VARCHAR DEFAULT NULL)
RETURNS INTEGER AS $$
DECLARE
    retried_count INTEGER;
BEGIN
    UPDATE queue_jobs
    SET 
        status = 'PENDING',
        scheduled_at = NOW(),
        error = NULL,
        updated_at = NOW()
    WHERE status = 'FAILED'
    AND attempts < max_attempts
    AND (job_type_filter IS NULL OR type = job_type_filter);
    
    GET DIAGNOSTICS retried_count = ROW_COUNT;
    
    RETURN retried_count;
END;
$$ LANGUAGE plpgsql;

-- Create view for queue statistics
CREATE OR REPLACE VIEW queue_stats AS
SELECT 
    COUNT(*) as total_jobs,
    COUNT(*) FILTER (WHERE status = 'PENDING') as pending_jobs,
    COUNT(*) FILTER (WHERE status = 'PROCESSING') as processing_jobs,
    COUNT(*) FILTER (WHERE status = 'COMPLETED') as completed_jobs,
    COUNT(*) FILTER (WHERE status = 'FAILED') as failed_jobs,
    COUNT(*) FILTER (WHERE status = 'RETRYING') as retrying_jobs,
    AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000) FILTER (WHERE status = 'COMPLETED') as avg_processing_time_ms,
    ROUND(
        (COUNT(*) FILTER (WHERE status = 'FAILED')::DECIMAL / NULLIF(COUNT(*), 0)) * 100, 2
    ) as error_rate_percent
FROM queue_jobs
WHERE created_at >= NOW() - INTERVAL '24 hours';

-- Create function to get queue statistics by type
CREATE OR REPLACE FUNCTION get_queue_stats_by_type()
RETURNS TABLE (
    job_type VARCHAR,
    total_jobs BIGINT,
    pending_jobs BIGINT,
    processing_jobs BIGINT,
    completed_jobs BIGINT,
    failed_jobs BIGINT,
    avg_processing_time_ms NUMERIC,
    error_rate_percent NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        type as job_type,
        COUNT(*) as total_jobs,
        COUNT(*) FILTER (WHERE status = 'PENDING') as pending_jobs,
        COUNT(*) FILTER (WHERE status = 'PROCESSING') as processing_jobs,
        COUNT(*) FILTER (WHERE status = 'COMPLETED') as completed_jobs,
        COUNT(*) FILTER (WHERE status = 'FAILED') as failed_jobs,
        AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000) FILTER (WHERE status = 'COMPLETED') as avg_processing_time_ms,
        ROUND(
            (COUNT(*) FILTER (WHERE status = 'FAILED')::DECIMAL / NULLIF(COUNT(*), 0)) * 100, 2
        ) as error_rate_percent
    FROM queue_jobs
    WHERE created_at >= NOW() - INTERVAL '24 hours'
    GROUP BY type
    ORDER BY total_jobs DESC;
END;
$$ LANGUAGE plpgsql;

-- Add comment for documentation
COMMENT ON TABLE queue_jobs IS 'Background job queue for async processing of webhooks, AI responses, and maintenance tasks';
COMMENT ON COLUMN queue_jobs.type IS 'Type of job (WEBHOOK_PROCESSING, AI_RESPONSE_GENERATION, etc.)';
COMMENT ON COLUMN queue_jobs.payload IS 'Job-specific data and parameters';
COMMENT ON COLUMN queue_jobs.priority IS 'Job priority for processing order';
COMMENT ON COLUMN queue_jobs.status IS 'Current job status';
COMMENT ON COLUMN queue_jobs.attempts IS 'Number of processing attempts';
COMMENT ON COLUMN queue_jobs.max_attempts IS 'Maximum retry attempts before marking as failed';
COMMENT ON COLUMN queue_jobs.scheduled_at IS 'When the job should be processed';
COMMENT ON COLUMN queue_jobs.error IS 'Error message if job failed';
COMMENT ON COLUMN queue_jobs.result IS 'Job processing result data';

-- Example usage:
-- INSERT INTO queue_jobs (type, payload, priority) VALUES ('WEBHOOK_PROCESSING', '{"platform": "INSTAGRAM", "merchantId": "123"}', 'HIGH');
-- SELECT * FROM get_next_queue_job();
-- SELECT * FROM queue_stats;
-- SELECT cleanup_old_queue_jobs(7);
-- SELECT retry_failed_queue_jobs('AI_RESPONSE_GENERATION');