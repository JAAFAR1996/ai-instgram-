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
CREATE INDEX IF NOT EXISTS idx_products_search 
ON products USING GIN (
    to_tsvector('english', 
        COALESCE(name, '') || ' ' || 
        COALESCE(description, '') || ' ' || 
        COALESCE(category, '') || ' ' || 
        COALESCE(tags::text, '')
    )
);

-- Create trigram index for fuzzy search
CREATE INDEX IF NOT EXISTS idx_products_name_trgm 
ON products USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_products_description_trgm 
ON products USING GIN (description gin_trgm_ops);

-- Create function for product search ranking
CREATE OR REPLACE FUNCTION product_search_rank(
    search_query TEXT,
    product_name TEXT,
    product_description TEXT,
    product_category TEXT,
    product_tags JSONB
) RETURNS FLOAT AS $$
BEGIN
    RETURN (
        -- Name match (highest weight)
        ts_rank(to_tsvector('english', COALESCE(product_name, '')), plainto_tsquery('english', search_query)) * 4.0 +
        -- Description match (medium weight)
        ts_rank(to_tsvector('english', COALESCE(product_description, '')), plainto_tsquery('english', search_query)) * 2.0 +
        -- Category match (medium weight)
        ts_rank(to_tsvector('english', COALESCE(product_category, '')), plainto_tsquery('english', search_query)) * 2.0 +
        -- Tags match (lower weight)
        ts_rank(to_tsvector('english', COALESCE(product_tags::text, '')), plainto_tsquery('english', search_query)) * 1.0
    );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Create function for fuzzy product search
CREATE OR REPLACE FUNCTION fuzzy_product_search(
    search_term TEXT,
    similarity_threshold FLOAT DEFAULT 0.3
) RETURNS TABLE(
    id UUID,
    name TEXT,
    description TEXT,
    category TEXT,
    tags JSONB,
    similarity FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.id,
        p.name,
        p.description,
        p.category,
        p.tags,
        GREATEST(
            similarity(p.name, search_term),
            similarity(p.description, search_term),
            similarity(p.category, search_term)
        ) as similarity
    FROM products p
    WHERE 
        p.name % search_term OR
        p.description % search_term OR
        p.category % search_term
    ORDER BY similarity DESC;
END;
$$ LANGUAGE plpgsql STABLE;

-- Create view for product search results
CREATE OR REPLACE VIEW product_search_results AS
SELECT 
    p.id,
    p.name,
    p.description,
    p.category,
    p.tags,
    p.price,
    p.stock_quantity,
    p.created_at,
    p.updated_at,
    product_search_rank(
        'search_query_placeholder',
        p.name,
        p.description,
        p.category,
        p.tags
    ) as search_rank
FROM products p;

-- Add comments for documentation
COMMENT ON FUNCTION product_search_rank IS 'Calculate search relevance rank for products';
COMMENT ON FUNCTION fuzzy_product_search IS 'Perform fuzzy search on products with similarity scoring';
COMMENT ON VIEW product_search_results IS 'View for optimized product search results with ranking';

-- Grant permissions
GRANT EXECUTE ON FUNCTION product_search_rank TO app_user;
GRANT EXECUTE ON FUNCTION fuzzy_product_search TO app_user;
GRANT SELECT ON product_search_results TO app_user;
