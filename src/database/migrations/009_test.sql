-- Test minimal version of migration 009
CREATE TABLE IF NOT EXISTS comment_interactions_test (
    id VARCHAR(255) PRIMARY KEY,
    merchant_id UUID NOT NULL,
    content TEXT NOT NULL
);