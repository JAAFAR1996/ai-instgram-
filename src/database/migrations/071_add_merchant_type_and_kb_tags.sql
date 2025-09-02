-- 071: Add merchant_type enum, merchants.merchant_type, and KB tags

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'merchant_type') THEN
    CREATE TYPE public.merchant_type AS ENUM (
      'home','electric','fashion','grocery','pharmacy','toys','beauty','sports','books','auto','other'
    );
  END IF;
END $$;

ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS merchant_type public.merchant_type NOT NULL DEFAULT 'other';

COMMENT ON COLUMN public.merchants.merchant_type IS 'Merchant vertical for per-tenant tuning (multi-vertical support)';

-- KB tags for filtering (e.g., {"type":"electric","policy":"returns"})
ALTER TABLE public.merchant_kb_docs
  ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '{}'::jsonb;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_products_mrch_cat ON public.products(merchant_id, category);
CREATE INDEX IF NOT EXISTS idx_products_mrch_sku ON public.products(merchant_id, sku);
CREATE INDEX IF NOT EXISTS idx_kb_docs_tags_gin ON public.merchant_kb_docs USING GIN (tags);

-- Re-affirm RLS on key tables (no-op if already enabled)
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_logs ENABLE ROW LEVEL SECURITY;
-- products_priced is a VIEW backed by products; RLS enforced on base table

