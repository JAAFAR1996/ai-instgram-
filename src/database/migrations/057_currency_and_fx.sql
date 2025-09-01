-- ===============================================
-- 057: Merchant currency & optional FX rates
-- ===============================================

-- Merchant currency (ISO 4217), default IQD
ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS currency CHAR(3) NOT NULL DEFAULT 'IQD';

COMMENT ON COLUMN public.merchants.currency IS 'Default ISO 4217 currency code for pricing/formatting';

-- Optional FX rates table (for future dynamic pricing)
CREATE TABLE IF NOT EXISTS public.fx_rates (
  base CHAR(3) NOT NULL,
  quote CHAR(3) NOT NULL,
  rate NUMERIC(18,8) NOT NULL,
  as_of TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(base, quote)
);

COMMENT ON TABLE public.fx_rates IS 'Optional FX rates for currency conversion';
