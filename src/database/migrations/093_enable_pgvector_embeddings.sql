-- 093: Enable pgvector and add embedding columns for semantic search
BEGIN;

-- Enable pgvector extension (safe if already enabled)
DO $$ BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS vector;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'vector extension not available';
  END;
END $$;

-- Add embedding columns to products (1536 dims for text-embedding-3-small)
ALTER TABLE IF EXISTS public.products
  ADD COLUMN IF NOT EXISTS name_embedding vector(1536),
  ADD COLUMN IF NOT EXISTS description_embedding vector(1536);

-- Create ANN indexes when pgvector is present (use cosine distance)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    BEGIN
      CREATE INDEX IF NOT EXISTS idx_products_name_embedding_ivfflat
        ON public.products USING ivfflat (name_embedding vector_cosine_ops) WITH (lists = 100);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Failed to create ivfflat index for name_embedding (pgvector < 0.5?)';
    END;

    BEGIN
      CREATE INDEX IF NOT EXISTS idx_products_desc_embedding_ivfflat
        ON public.products USING ivfflat (description_embedding vector_cosine_ops) WITH (lists = 100);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Failed to create ivfflat index for description_embedding';
    END;
  ELSE
    RAISE NOTICE 'pgvector not enabled; skipping ANN indexes';
  END IF;
END $$;

COMMENT ON COLUMN public.products.name_embedding IS 'Vector embedding of product name (cosine, 1536)';
COMMENT ON COLUMN public.products.description_embedding IS 'Vector embedding of description (cosine, 1536)';

COMMIT;

