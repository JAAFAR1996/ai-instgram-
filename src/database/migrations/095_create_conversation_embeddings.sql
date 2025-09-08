-- 095: Conversation semantic memory (embeddings + ANN indexes)
BEGIN;

-- Ensure pgvector extension is available (safe if already enabled)
DO $$ BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS vector;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'vector extension not available on this cluster';
  END;
END $$;

-- Create conversation_embeddings table for per-conversation semantic memory
CREATE TABLE IF NOT EXISTS public.conversation_embeddings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  embedding vector(1536) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Supporting btree indexes for filtering
CREATE INDEX IF NOT EXISTS idx_convemb_merchant_customer_time
  ON public.conversation_embeddings(merchant_id, customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_convemb_conversation_time
  ON public.conversation_embeddings(conversation_id, created_at DESC);

-- ANN index on the embedding vector (prefer HNSW; fallback to IVFFlat)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    BEGIN
      -- Try HNSW (pgvector >= 0.5)
      CREATE INDEX IF NOT EXISTS idx_convemb_embedding_hnsw
        ON public.conversation_embeddings USING hnsw (embedding vector_cosine_ops);
    EXCEPTION WHEN OTHERS THEN
      -- Fallback to IVFFlat (requires manual ANALYZE for best performance)
      BEGIN
        CREATE INDEX IF NOT EXISTS idx_convemb_embedding_ivfflat
          ON public.conversation_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Failed to create ANN index on conversation_embeddings.embedding';
      END;
    END;
  ELSE
    RAISE NOTICE 'pgvector not enabled; skipping ANN index creation';
  END IF;
END $$;

-- RLS: isolate by merchant (consistent with other tenant policies)
ALTER TABLE public.conversation_embeddings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conversation_embeddings_tenant_isolation ON public.conversation_embeddings;
CREATE POLICY conversation_embeddings_tenant_isolation ON public.conversation_embeddings
  FOR ALL USING (
    merchant_id::text = current_setting('app.current_merchant_id', true)
    OR COALESCE(current_setting('app.is_admin', true), 'false')::boolean = true
  );

COMMENT ON TABLE public.conversation_embeddings IS 'Semantic memory of conversation messages (embeddings per message).';
COMMENT ON COLUMN public.conversation_embeddings.embedding IS 'Vector(1536) embedding using cosine distance.';

COMMIT;

