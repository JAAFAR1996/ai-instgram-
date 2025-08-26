-- Migration 003: Products Search Optimization - Minimal

-- Create simple btree index on product names for basic search
CREATE INDEX IF NOT EXISTS idx_products_name_ar ON products (name_ar);
CREATE INDEX IF NOT EXISTS idx_products_name_en ON products (name_en);
CREATE INDEX IF NOT EXISTS idx_products_category ON products (category);

-- Record this migration
INSERT INTO migrations (name, filename) VALUES ('Products Search Optimization', '003_products_search_optimization.sql')
WHERE NOT EXISTS (
    SELECT 1 FROM migrations WHERE filename = '003_products_search_optimization.sql'
);
