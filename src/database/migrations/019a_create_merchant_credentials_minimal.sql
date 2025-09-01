-- ===============================================
-- 019a: Create merchant_credentials (minimal, fresh install)
-- Provides base table so later migrations (013, 023, 024, 025, 055) can alter safely
-- ===============================================

CREATE TABLE IF NOT EXISTS public.merchant_credentials (
  merchant_id UUID NOT NULL,
  instagram_page_id TEXT NOT NULL,
  -- minimal fields used by code; later migrations add more
  instagram_token_encrypted TEXT,
  whatsapp_token_encrypted TEXT,
  whatsapp_phone_number_id TEXT,
  webhook_verify_token TEXT,
  business_account_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pk_merchant_credentials PRIMARY KEY (merchant_id, instagram_page_id)
);

-- FK to merchants
ALTER TABLE public.merchant_credentials
  ADD CONSTRAINT fk_merchant_credentials_merchant
  FOREIGN KEY (merchant_id) REFERENCES public.merchants(id) ON DELETE CASCADE;

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_merchant_credentials_merchant_id 
  ON public.merchant_credentials(merchant_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_mc_merchant_page
  ON public.merchant_credentials (merchant_id, instagram_page_id);

-- Enable RLS (policies added in later migrations)
ALTER TABLE public.merchant_credentials ENABLE ROW LEVEL SECURITY;

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.update_mc_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_mc_updated_at ON public.merchant_credentials;
CREATE TRIGGER trigger_mc_updated_at
  BEFORE UPDATE ON public.merchant_credentials
  FOR EACH ROW
  EXECUTE FUNCTION public.update_mc_updated_at();

