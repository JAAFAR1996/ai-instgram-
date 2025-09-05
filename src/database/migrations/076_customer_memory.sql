-- 076: Customer memory (preferences + behavior history)

CREATE TABLE IF NOT EXISTS public.customer_preferences (
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  customer_id text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (merchant_id, customer_id)
);

CREATE TABLE IF NOT EXISTS public.customer_behavior_history (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  customer_id text NOT NULL,
  event_type text NOT NULL,
  product_id text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cust_behavior_merchant ON public.customer_behavior_history(merchant_id);
CREATE INDEX IF NOT EXISTS idx_cust_behavior_customer ON public.customer_behavior_history(customer_id);

