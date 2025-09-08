-- 096: DB tuning - pgvector/pg_trgm/pgcrypto + search indexes + encrypted token column
BEGIN;

-- Enable required extensions (safe if already enabled)
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Trigram indexes for fuzzy Arabic search on products
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='products'
  ) THEN
    CREATE INDEX IF NOT EXISTS products_name_ar_trgm_idx ON public.products USING gin (name_ar gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS products_sku_trgm_idx ON public.products USING gin (sku gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS products_category_trgm_idx ON public.products USING gin (category gin_trgm_ops);
  END IF;
END $$;

-- Conversation embeddings ANN index (ivfflat with cosine)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='conversation_embeddings'
  ) THEN
    BEGIN
      CREATE INDEX IF NOT EXISTS conv_embed_cosine_idx
        ON public.conversation_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skipping conv_embed_cosine_idx creation: %', SQLERRM;
    END;
    -- Support requested btree index name (may overlap with existing functionally-similar index)
    BEGIN
      CREATE INDEX IF NOT EXISTS idx_convem_mem
        ON public.conversation_embeddings (merchant_id, customer_id, created_at DESC);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skipping idx_convem_mem creation: %', SQLERRM;
    END;
  END IF;
END $$;

-- Add encrypted_access_token column to merchant_credentials using pgcrypto (BYTEA)
ALTER TABLE IF EXISTS public.merchant_credentials
  ADD COLUMN IF NOT EXISTS encrypted_access_token BYTEA;

COMMIT;

