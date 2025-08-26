-- ===============================================
-- Migration 011: Analytics Events Table
-- Stores raw analytics events for aggregation
-- ===============================================

CREATE TABLE IF NOT EXISTS analytics_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type TEXT NOT NULL,
    merchant_id UUID NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for faster aggregation queries
CREATE INDEX IF NOT EXISTS idx_analytics_events_type ON analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_events_merchant ON analytics_events(merchant_id);

INSERT INTO migrations (name, filename) VALUES ('Analytics Events Table', '011_analytics_events_table.sql')
ON CONFLICT (name) DO NOTHING;