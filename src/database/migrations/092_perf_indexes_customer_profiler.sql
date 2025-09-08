-- Performance indexes for customer profiler queries
BEGIN;
  -- Speeds lookups by merchant + customer Instagram on conversations
  CREATE INDEX IF NOT EXISTS idx_conversations_merchant_customer_instagram
    ON public.conversations(merchant_id, customer_instagram);
COMMIT;

