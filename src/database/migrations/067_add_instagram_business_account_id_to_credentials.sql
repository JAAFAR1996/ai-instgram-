-- ===============================================
-- 067: Add instagram_business_account_id to merchant_credentials (compat)
-- ===============================================

ALTER TABLE public.merchant_credentials
  ADD COLUMN IF NOT EXISTS instagram_business_account_id TEXT;

-- Optional helper index
CREATE INDEX IF NOT EXISTS idx_mc_instagram_business_account_id
  ON public.merchant_credentials(instagram_business_account_id);