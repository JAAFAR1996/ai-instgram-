-- 069: Create per-merchant knowledge base docs with pgvector

DO $$ BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS vector;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'vector extension not available on this cluster';
  END;
END $$;

CREATE TABLE IF NOT EXISTS public.merchant_kb_docs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  chunk TEXT NOT NULL,
  embedding vector(1536),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_kb_docs_merchant ON public.merchant_kb_docs (merchant_id);
DO $$ BEGIN
  -- HNSW index only if extension available
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'vector'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_kb_docs_embedding ON public.merchant_kb_docs USING hnsw (embedding vector_cosine_ops);
  ELSE
    RAISE NOTICE 'pgvector not enabled; similarity search fallback will be used.';
  END IF;
END $$;

-- RLS
ALTER TABLE public.merchant_kb_docs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kb_docs_tenant_isolation ON public.merchant_kb_docs;
CREATE POLICY kb_docs_tenant_isolation ON public.merchant_kb_docs
  FOR ALL USING (
    merchant_id::text = current_setting('app.current_merchant_id', true)
    OR COALESCE(current_setting('app.is_admin', true), 'false')::boolean = true
  );

