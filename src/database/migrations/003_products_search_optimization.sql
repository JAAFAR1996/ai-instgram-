-- Migration 003: Products Search Optimization - Minimal

-- Create simple btree index on product names for basic search
CREATE INDEX IF NOT EXISTS idx_products_name_ar ON products (name_ar);
CREATE INDEX IF NOT EXISTS idx_products_name_en ON products (name_en) WHERE name_en IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_category ON products (category);

-- Note: Migration tracking is handled automatically by the migration runner
