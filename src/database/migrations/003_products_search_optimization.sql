/**
 * ===============================================
 * Migration 003: Products Search Optimization
 * ===============================================
 * 
 * This migration adds search optimization features for products:
 * - Full-text search indexes
 * - Search ranking functions
 * - Product categorization improvements
 * - Performance optimizations for product queries
 */

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create product search index
CREATE INDEX IF NOT EXISTS idx_products_search_custom 
ON products USING GIN (
    to_tsvector('simple', 
        COALESCE(name_ar, '') || ' ' || 
        COALESCE(name_en, '') || ' ' || 
        COALESCE(description_ar, '') || ' ' || 
        COALESCE(description_en, '') || ' ' || 
        COALESCE(category, '') || ' ' || 
        COALESCE(array_to_string(tags, ' '), '')
    )
);

-- Create trigram index for fuzzy search
CREATE INDEX IF NOT EXISTS idx_products_name_ar_trgm 
ON products USING GIN (name_ar gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_products_name_en_trgm 
ON products USING GIN (name_en gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_products_description_ar_trgm 
ON products USING GIN (description_ar gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_products_description_en_trgm 
ON products USING GIN (description_en gin_trgm_ops);

-- Create function for product search ranking
CREATE OR REPLACE FUNCTION product_search_rank(
    search_query TEXT,
    product_name_ar TEXT,
    product_name_en TEXT,
    product_description_ar TEXT,
    product_description_en TEXT,
    product_category TEXT,
    product_tags TEXT[]
) RETURNS FLOAT AS $$
BEGIN
    RETURN (
        -- Arabic name match (highest weight)
        ts_rank(to_tsvector('simple', COALESCE(product_name_ar, '')), plainto_tsquery('simple', search_query)) * 4.0 +
        -- English name match (highest weight)
        ts_rank(to_tsvector('simple', COALESCE(product_name_en, '')), plainto_tsquery('simple', search_query)) * 4.0 +
        -- Arabic description match (medium weight)
        ts_rank(to_tsvector('simple', COALESCE(product_description_ar, '')), plainto_tsquery('simple', search_query)) * 2.0 +
        -- English description match (medium weight)
        ts_rank(to_tsvector('simple', COALESCE(product_description_en, '')), plainto_tsquery('simple', search_query)) * 2.0 +
        -- Category match (medium weight)
        ts_rank(to_tsvector('simple', COALESCE(product_category, '')), plainto_tsquery('simple', search_query)) * 2.0 +
        -- Tags match (lower weight)
        ts_rank(to_tsvector('simple', COALESCE(array_to_string(product_tags, ' '), '')), plainto_tsquery('simple', search_query)) * 1.0
    );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Create function for fuzzy product search
CREATE OR REPLACE FUNCTION fuzzy_product_search(
    search_term TEXT,
    similarity_threshold FLOAT DEFAULT 0.3
) RETURNS TABLE(
    id UUID,
    name_ar TEXT,
    name_en TEXT,
    description_ar TEXT,
    description_en TEXT,
    category TEXT,
    tags TEXT[],
    similarity FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.id,
        p.name_ar,
        p.name_en,
        p.description_ar,
        p.description_en,
        p.category,
        p.tags,
        GREATEST(
            COALESCE(similarity(p.name_ar, search_term), 0),
            COALESCE(similarity(p.name_en, search_term), 0),
            COALESCE(similarity(p.description_ar, search_term), 0),
            COALESCE(similarity(p.description_en, search_term), 0),
            COALESCE(similarity(p.category, search_term), 0)
        ) as similarity
    FROM products p
    WHERE 
        p.name_ar % search_term OR
        p.name_en % search_term OR
        p.description_ar % search_term OR
        p.description_en % search_term OR
        p.category % search_term
    ORDER BY similarity DESC;
END;
$$ LANGUAGE plpgsql STABLE;

-- Create view for product search results
CREATE OR REPLACE VIEW product_search_results AS
SELECT 
    p.id,
    p.name_ar,
    p.name_en,
    p.description_ar,
    p.description_en,
    p.category,
    p.tags,
    p.price_usd,
    p.stock_quantity,
    p.created_at,
    p.updated_at,
    product_search_rank(
        'search_query_placeholder',
        p.name_ar,
        p.name_en,
        p.description_ar,
        p.description_en,
        p.category,
        p.tags
    ) as search_rank
FROM products p;

-- Add comments for documentation
COMMENT ON FUNCTION product_search_rank IS 'Calculate search relevance rank for products';
COMMENT ON FUNCTION fuzzy_product_search IS 'Perform fuzzy search on products with similarity scoring';
COMMENT ON VIEW product_search_results IS 'View for optimized product search results with ranking';

-- Note: Permissions will be granted in later migration after app_user role is created

-- Record this migration
INSERT INTO migrations (name, filename) VALUES ('Products Search Optimization', '003_products_search_optimization.sql')
WHERE NOT EXISTS (
    SELECT 1 FROM migrations WHERE filename = '003_products_search_optimization.sql'
);
