-- 080: Instagram interactions tables

-- Core table: story interactions
CREATE TABLE IF NOT EXISTS public.instagram_story_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  customer_id text NOT NULL,
  story_id text,
  interaction_type text NOT NULL CHECK (interaction_type IN ('reply','emoji','question')),
  content text,
  window_expires_at timestamptz,
  converted_to_sale boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

-- Default window expiry to 24h if not provided
CREATE OR REPLACE FUNCTION set_isi_window_expiry()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.window_expires_at IS NULL THEN
    NEW.window_expires_at := NOW() + INTERVAL '24 hours';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_set_isi_window_expiry ON public.instagram_story_interactions;
CREATE TRIGGER trigger_set_isi_window_expiry
  BEFORE INSERT ON public.instagram_story_interactions
  FOR EACH ROW
  EXECUTE FUNCTION set_isi_window_expiry();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_isi_merchant_created ON public.instagram_story_interactions(merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_isi_customer_created ON public.instagram_story_interactions(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_isi_type ON public.instagram_story_interactions(interaction_type);

-- Enable RLS and add tenant policy
ALTER TABLE public.instagram_story_interactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS isi_tenant_policy ON public.instagram_story_interactions;
CREATE POLICY isi_tenant_policy ON public.instagram_story_interactions
  FOR ALL USING (
    merchant_id = current_setting('app.current_merchant_id', true)::uuid
  );

