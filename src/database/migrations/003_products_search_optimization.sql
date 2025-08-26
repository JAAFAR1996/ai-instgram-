-- Migration 003: Products Search Optimization - Simplified
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create basic search index for products
CREATE INDEX IF NOT EXISTS idx_products_search_basic 
ON products USING GIN (
    to_tsvector('simple', 
        COALESCE(name_ar, '') || ' ' || 
        COALESCE(name_en, '') || ' ' || 
        COALESCE(category, '')
    )
);

-- Create simple trigram index for Arabic names only (most important)
CREATE INDEX IF NOT EXISTS idx_products_name_ar_trgm 
ON products USING GIN (name_ar gin_trgm_ops);

-- Note: Permissions will be granted in later migration after app_user role is created

-- Record this migration
INSERT INTO migrations (name, filename) VALUES ('Products Search Optimization', '003_products_search_optimization.sql')
WHERE NOT EXISTS (
    SELECT 1 FROM migrations WHERE filename = '003_products_search_optimization.sql'
);
