-- 081: Fix schema for Instagram analytics and order items
-- Adds missing columns and tables used by analytics and profiling code

-- Safety: ensure required extension exists
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1) Ensure conversations has customer_instagram (older DBs may miss it)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'conversations' AND column_name = 'customer_instagram'
  ) THEN
    ALTER TABLE public.conversations
      ADD COLUMN customer_instagram TEXT;
    -- Helpful index for lookups
    CREATE INDEX IF NOT EXISTS idx_conversations_customer_instagram
      ON public.conversations (customer_instagram, platform);
  END IF;
END $$;

-- 2) Ensure orders has customer_instagram (code uses it for joins)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'customer_instagram'
  ) THEN
    ALTER TABLE public.orders
      ADD COLUMN customer_instagram TEXT;
    -- Optional index to speed up per-customer analytics
    CREATE INDEX IF NOT EXISTS idx_orders_merchant_customer_instagram
      ON public.orders (merchant_id, customer_instagram);
  END IF;
END $$;

-- 3) Create order_items table if missing (some environments stored items JSON only)
CREATE TABLE IF NOT EXISTS public.order_items (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  price numeric(12,2),
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON public.order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON public.order_items(product_id);

-- 4) Minimal returns table to support LEFT JOINs used by analytics
CREATE TABLE IF NOT EXISTS public.returns (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  rating integer,
  reason text,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_returns_order ON public.returns(order_id);

-- Notes:
-- - Code expects joins like: orders o -> order_items oi -> products p, and optional returns r.
-- - This migration aligns DB schema with application queries without altering existing data.

