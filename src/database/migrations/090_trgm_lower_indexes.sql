-- Enable trigram extension (safe if already enabled)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram indexes on lower() to support case-insensitive LIKE
CREATE INDEX IF NOT EXISTS idx_products_name_ar_trgm_lower
  ON products USING gin (lower(name_ar) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_products_sku_trgm_lower
  ON products USING gin (lower(sku) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_products_category_trgm_lower
  ON products USING gin (lower(category) gin_trgm_ops);

