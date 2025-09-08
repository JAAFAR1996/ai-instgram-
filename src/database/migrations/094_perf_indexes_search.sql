-- 094: Performance indexes for search and joins (trgm + common WHERE/JOIN)
BEGIN;

-- Ensure pg_trgm is enabled (for safety)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram indexes on lower() fields (if not already created in 090)
CREATE INDEX IF NOT EXISTS idx_products_name_trgm_lower2
  ON public.products USING gin (lower(name_ar) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_sku_trgm_lower2
  ON public.products USING gin (lower(sku) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_category_trgm_lower2
  ON public.products USING gin (lower(category) gin_trgm_ops);

-- Common WHERE/JOIN accelerators used in analytics and profiling
CREATE INDEX IF NOT EXISTS idx_orders_merchant_customer_time
  ON public.orders(merchant_id, customer_instagram, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_order_items_order
  ON public.order_items(order_id);

-- Additional filter on message_logs for conversation views
CREATE INDEX IF NOT EXISTS idx_message_logs_conv_dir_time
  ON public.message_logs(conversation_id, direction, created_at DESC);

-- Pricing lookup accelerators
CREATE INDEX IF NOT EXISTS idx_products_priced_id
  ON public.products_priced(id);

COMMIT;

