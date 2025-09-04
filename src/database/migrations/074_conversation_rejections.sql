-- 074: Conversation rejections table for objection handling analytics

CREATE TABLE IF NOT EXISTS public.conversation_rejections (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  customer_id text NOT NULL,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  rejection_type text NOT NULL CHECK (rejection_type IN ('price','quality','timing','other')),
  rejection_reason text,
  customer_message text,
  ai_strategies_used jsonb,
  context_data jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

ALTER TABLE public.conversation_rejections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conversation_rejections_tenant_isolation ON public.conversation_rejections;
CREATE POLICY conversation_rejections_tenant_isolation ON public.conversation_rejections
  FOR ALL USING (
    merchant_id::text = current_setting('app.current_merchant_id', true)
    OR COALESCE(current_setting('app.is_admin', true), 'false')::boolean = true
  );

CREATE INDEX IF NOT EXISTS idx_conv_reject_merchant_created ON public.conversation_rejections(merchant_id, created_at DESC);

