-- ===============================================
-- 058: Generic pricing (currency-agnostic)
-- Adds price_amount / sale_price_amount / price_currency to products
-- and backfills from USD fields. Keeps legacy USD fields for compatibility.
-- ===============================================

-- 1) Add generic pricing columns
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS price_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sale_price_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS price_currency CHAR(3) NOT NULL DEFAULT 'USD';

COMMENT ON COLUMN public.products.price_amount IS 'Generic price amount in price_currency';
COMMENT ON COLUMN public.products.sale_price_amount IS 'Generic sale price amount in price_currency';
COMMENT ON COLUMN public.products.price_currency IS 'ISO 4217 currency for price_amount';

-- 2) Backfill price_currency from merchants.currency when available
UPDATE public.products p
SET price_currency = m.currency
FROM public.merchants m
WHERE p.merchant_id = m.id
  AND m.currency IS NOT NULL
  AND m.currency <> ''
  AND p.price_currency = 'USD';

-- 3) Backfill amounts from USD using fx_rates when present; otherwise copy
-- price_amount
UPDATE public.products p
SET price_amount = CASE
  WHEN p.price_currency = 'USD' THEN p.price_usd
  ELSE COALESCE(p.price_usd * fx.rate, p.price_usd)
END
FROM (
  SELECT base, quote, rate FROM public.fx_rates
) fx
WHERE (fx.base = 'USD' AND fx.quote = p.price_currency)
  OR p.price_currency = 'USD';

-- If no fx_rate row matched, ensure price_amount still set
UPDATE public.products
SET price_amount = price_usd
WHERE price_amount = 0;

-- sale_price_amount
UPDATE public.products p
SET sale_price_amount = CASE
  WHEN p.sale_price_usd IS NULL THEN NULL
  WHEN p.price_currency = 'USD' THEN p.sale_price_usd
  ELSE COALESCE(p.sale_price_usd * fx.rate, p.sale_price_usd)
END
FROM (
  SELECT base, quote, rate FROM public.fx_rates
) fx
WHERE p.sale_price_usd IS NOT NULL
  AND ((fx.base = 'USD' AND fx.quote = p.price_currency) OR p.price_currency = 'USD');

-- 4) View exposing effective pricing (for reads)
CREATE OR REPLACE VIEW public.products_priced AS
SELECT
  p.id,
  p.merchant_id,
  p.sku,
  p.name_ar,
  p.category,
  p.price_amount,
  p.sale_price_amount,
  p.price_currency,
  (CASE WHEN p.sale_price_amount IS NOT NULL THEN p.sale_price_amount ELSE p.price_amount END) as effective_price,
  p.stock_quantity,
  p.updated_at,
  p.created_at
FROM public.products p;

COMMENT ON VIEW public.products_priced IS 'Readable view for generic pricing per product';

