-- 099: Create merchant_udids table for per-merchant UDID tracking
BEGIN;

-- Use a dedicated table to ensure uniqueness and fast lookup
CREATE TABLE IF NOT EXISTS public.merchant_udids (
  merchant_id UUID PRIMARY KEY REFERENCES public.merchants(id) ON DELETE CASCADE,
  udid UUID NOT NULL UNIQUE,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Keep updated_at fresh on modification, if helper exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'update_updated_at_column' AND n.nspname = 'public'
  ) THEN
    BEGIN
      CREATE TRIGGER trg_merchant_udids_updated_at
        BEFORE UPDATE ON public.merchant_udids
        FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
    EXCEPTION WHEN duplicate_object THEN
      -- Trigger already exists; ignore
    END;
  END IF;
END $$;

COMMIT;

