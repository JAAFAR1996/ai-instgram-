-- 072: Merchant discounts, effective prices view (IQD), and customer vaults with TTL

-- 1) Discounts table per-merchant
CREATE TABLE IF NOT EXISTS public.merchant_discounts (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  -- Either percent_off (0..100) or fixed amount_off_iqd (in IQD)
  percent_off numeric CHECK (percent_off >= 0 AND percent_off <= 100),
  amount_off_iqd numeric CHECK (amount_off_iqd >= 0),
  starts_at timestamptz NOT NULL DEFAULT NOW(),
  ends_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discounts_active ON public.merchant_discounts(merchant_id, is_active, starts_at, ends_at);

-- 2) Effective prices view in IQD with discount applied
-- Requires fx_rates(base, quote, rate) to convert from price_currency -> IQD
CREATE OR REPLACE VIEW public.products_effective_prices AS
WITH base_price AS (
  SELECT
    p.id,
    p.merchant_id,
    p.sku,
    p.name_ar,
    p.category,
    p.stock_quantity,
    COALESCE(p.sale_price_amount, p.price_amount) AS base_amount,
    UPPER(p.price_currency) AS price_currency
  FROM public.products p
),
to_iqd AS (
  SELECT b.*, 
    CASE 
      WHEN b.price_currency = 'IQD' THEN b.base_amount
      ELSE b.base_amount * COALESCE((SELECT rate FROM public.fx_rates WHERE base = b.price_currency AND quote = 'IQD' LIMIT 1), 1)
    END AS base_price_iqd
  FROM base_price b
),
active_discount AS (
  SELECT d.* FROM public.merchant_discounts d
  WHERE d.is_active = true
    AND (d.starts_at IS NULL OR d.starts_at <= NOW())
    AND (d.ends_at IS NULL OR d.ends_at >= NOW())
)
SELECT 
  t.id,
  t.merchant_id,
  t.sku,
  t.name_ar,
  t.category,
  t.stock_quantity,
  t.base_price_iqd,
  -- Choose amount_off_iqd first if present; otherwise percent_off
  GREATEST(0, 
    t.base_price_iqd - COALESCE(
      (SELECT amount_off_iqd FROM active_discount ad WHERE ad.merchant_id = t.merchant_id LIMIT 1),
      (SELECT (t.base_price_iqd * (ad2.percent_off/100.0)) FROM active_discount ad2 WHERE ad2.merchant_id = t.merchant_id LIMIT 1),
      0
    )
  ) AS final_price_iqd
FROM to_iqd t;

COMMENT ON VIEW public.products_effective_prices IS 'Per-merchant effective IQD prices with discounts applied';

-- 3) Customer vaults for per-customer per-merchant context with TTL
CREATE TABLE IF NOT EXISTS public.customer_vaults (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  customer_id text NOT NULL,
  conversation_id uuid,
  status text DEFAULT 'active',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  purge_after timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (merchant_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_vaults_merchant_customer ON public.customer_vaults(merchant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_vaults_purge ON public.customer_vaults(purge_after);

-- RLS
ALTER TABLE public.customer_vaults ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customer_vaults_tenant_isolation ON public.customer_vaults;
CREATE POLICY customer_vaults_tenant_isolation ON public.customer_vaults
  FOR ALL USING (
    merchant_id::text = current_setting('app.current_merchant_id', true)
    OR COALESCE(current_setting('app.is_admin', true), 'false')::boolean = true
  );

-- Purge job function (to be scheduled externally every 10 minutes)
CREATE OR REPLACE FUNCTION public.cleanup_customer_vaults()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.customer_vaults WHERE purge_after IS NOT NULL AND purge_after <= NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

