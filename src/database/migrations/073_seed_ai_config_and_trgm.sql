-- 073: Seed merchants.ai_config defaults and add trigram index for product names

-- Ensure pg_trgm extension exists (for trigram index)
DO $$ BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_trgm extension not available';
  END;
END $$;

-- Add trigram index on products.name_ar for faster fuzzy search
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON public.products USING gin (name_ar gin_trgm_ops);
  ELSE
    RAISE NOTICE 'pg_trgm not enabled; skipping trigram index';
  END IF;
END $$;

-- Seed ai_config for merchants that have NULL or missing synonyms
UPDATE public.merchants
SET ai_config = COALESCE(ai_config, '{}'::jsonb) || '{
  "synonyms": {"جزمه": ["حذاء","بوت"], "رجاي": ["رجالي"]},
  "categories": [],
  "colors": [],
  "genders": [],
  "sizeAliases": {}
}'::jsonb
WHERE ai_config IS NULL 
   OR (ai_config ? 'synonyms') = false;

COMMENT ON COLUMN public.merchants.ai_config IS 'Per-merchant AI hints (synonyms/categories/etc). Seeded with Arabic defaults when missing.';

