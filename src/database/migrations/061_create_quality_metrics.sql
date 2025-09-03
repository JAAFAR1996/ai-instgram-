-- ===============================================
-- 061: Create quality_metrics table (production-safe)
-- ===============================================

CREATE TABLE IF NOT EXISTS public.quality_metrics (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('instagram','whatsapp','facebook')),

  quality_rating numeric,
  messaging_quality_score numeric,

  messages_sent_24h integer DEFAULT 0,
  messages_delivered_24h integer DEFAULT 0,
  messages_read_24h integer DEFAULT 0,
  user_initiated_conversations_24h integer DEFAULT 0,
  business_initiated_conversations_24h integer DEFAULT 0,
  block_rate_24h numeric DEFAULT 0,
  report_rate_24h numeric DEFAULT 0,
  avg_response_time_minutes numeric DEFAULT 0,
  response_rate_24h numeric DEFAULT 0,
  template_violations_24h integer DEFAULT 0,
  policy_violations_24h integer DEFAULT 0,

  status text DEFAULT 'OK' CHECK (status IN ('OK','WARNING','CRITICAL')),
  last_quality_check timestamptz,

  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  metric_date date NOT NULL DEFAULT CURRENT_DATE,

  UNIQUE (merchant_id, platform, metric_date)
);

CREATE INDEX IF NOT EXISTS idx_quality_metrics_merchant_platform_date
  ON public.quality_metrics(merchant_id, platform, metric_date);

-- Maintain updated_at
CREATE OR REPLACE FUNCTION public.update_quality_metrics_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_quality_metrics_updated_at ON public.quality_metrics;
CREATE TRIGGER trigger_quality_metrics_updated_at
  BEFORE UPDATE ON public.quality_metrics
  FOR EACH ROW EXECUTE FUNCTION public.update_quality_metrics_updated_at();

-- Keep metric_date in sync with created_at on insert/update
CREATE OR REPLACE FUNCTION public.sync_quality_metrics_metric_date()
RETURNS TRIGGER AS $$
BEGIN
  NEW.metric_date := (NEW.created_at)::date;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_quality_metrics_metric_date_ins ON public.quality_metrics;
CREATE TRIGGER trg_quality_metrics_metric_date_ins
  BEFORE INSERT ON public.quality_metrics
  FOR EACH ROW EXECUTE FUNCTION public.sync_quality_metrics_metric_date();

DROP TRIGGER IF EXISTS trg_quality_metrics_metric_date_upd ON public.quality_metrics;
CREATE TRIGGER trg_quality_metrics_metric_date_upd
  BEFORE UPDATE OF created_at ON public.quality_metrics
  FOR EACH ROW EXECUTE FUNCTION public.sync_quality_metrics_metric_date();
