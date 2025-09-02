-- 078: Additional prediction and analytics tables

-- Table for storing customer insights cache (performance optimization)
CREATE TABLE IF NOT EXISTS public.customer_insights_cache (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  customer_id text NOT NULL,
  insights jsonb NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT NOW(),
  expires_at timestamptz NOT NULL DEFAULT (NOW() + INTERVAL '6 hours'),
  UNIQUE(merchant_id, customer_id)
);

-- Table for tracking size issues and returns
CREATE TABLE IF NOT EXISTS public.size_issue_tracking (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  customer_id text NOT NULL,
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id text NOT NULL,
  predicted_size text,
  actual_size text,
  issue_type text CHECK (issue_type IN ('TOO_SMALL', 'TOO_LARGE', 'WRONG_FIT', 'RETURNED', 'EXCHANGED')),
  prediction_confidence float,
  issue_resolved boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

-- Table for churn prediction tracking
CREATE TABLE IF NOT EXISTS public.churn_prediction_tracking (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  customer_id text NOT NULL,
  predicted_churn_date timestamptz,
  churn_probability float NOT NULL,
  risk_factors jsonb,
  prevention_actions jsonb,
  actual_churn_date timestamptz,
  prevention_successful boolean,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

-- Table for proactive action results tracking
CREATE TABLE IF NOT EXISTS public.proactive_action_results (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  customer_id text NOT NULL,
  action_type text NOT NULL,
  message_sent text,
  sent_at timestamptz,
  customer_responded boolean DEFAULT false,
  response_time_minutes integer,
  conversion_achieved boolean DEFAULT false,
  conversion_value float,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

-- Table for storing ML model metadata and performance
CREATE TABLE IF NOT EXISTS public.ml_model_performance (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  model_type text NOT NULL CHECK (model_type IN ('SIZE_PREDICTION', 'CHURN_PREDICTION', 'TIMING_OPTIMIZATION')),
  merchant_id uuid REFERENCES public.merchants(id) ON DELETE CASCADE,
  model_version text NOT NULL,
  accuracy_score float,
  precision_score float,
  recall_score float,
  f1_score float,
  training_data_size integer,
  evaluation_date timestamptz NOT NULL,
  model_params jsonb,
  feature_importance jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_insights_cache_merchant ON public.customer_insights_cache(merchant_id);
CREATE INDEX IF NOT EXISTS idx_insights_cache_expires ON public.customer_insights_cache(expires_at);

CREATE INDEX IF NOT EXISTS idx_size_tracking_merchant ON public.size_issue_tracking(merchant_id);
CREATE INDEX IF NOT EXISTS idx_size_tracking_customer ON public.size_issue_tracking(customer_id);
CREATE INDEX IF NOT EXISTS idx_size_tracking_product ON public.size_issue_tracking(product_id);

CREATE INDEX IF NOT EXISTS idx_churn_tracking_merchant ON public.churn_prediction_tracking(merchant_id);
CREATE INDEX IF NOT EXISTS idx_churn_tracking_customer ON public.churn_prediction_tracking(customer_id);
CREATE INDEX IF NOT EXISTS idx_churn_tracking_date ON public.churn_prediction_tracking(predicted_churn_date);

CREATE INDEX IF NOT EXISTS idx_action_results_merchant ON public.proactive_action_results(merchant_id);
CREATE INDEX IF NOT EXISTS idx_action_results_customer ON public.proactive_action_results(customer_id);
CREATE INDEX IF NOT EXISTS idx_action_results_sent ON public.proactive_action_results(sent_at);

CREATE INDEX IF NOT EXISTS idx_ml_performance_type ON public.ml_model_performance(model_type);
CREATE INDEX IF NOT EXISTS idx_ml_performance_merchant ON public.ml_model_performance(merchant_id);

-- Function to clean up expired cache entries
CREATE OR REPLACE FUNCTION cleanup_expired_cache()
RETURNS void AS $$
BEGIN
  DELETE FROM public.customer_insights_cache 
  WHERE expires_at < NOW();
  
  -- Also cleanup old proactive messages (keep last 30 days)
  DELETE FROM public.proactive_messages 
  WHERE created_at < NOW() - INTERVAL '30 days' 
    AND status IN ('SENT', 'FAILED', 'CANCELLED');
    
  -- Cleanup old prediction tracking (keep last 90 days)
  DELETE FROM public.prediction_accuracy 
  WHERE created_at < NOW() - INTERVAL '90 days';
END;
$$ LANGUAGE plpgsql;

-- Function to automatically update proactive action results
CREATE OR REPLACE FUNCTION track_proactive_response()
RETURNS TRIGGER AS $$
DECLARE
  recent_message_id uuid;
  time_diff_minutes integer;
BEGIN
  -- Only track incoming messages (customer responses)
  IF NEW.direction = 'INCOMING' THEN
    -- Find recent proactive message to this customer
    SELECT pm.id INTO recent_message_id
    FROM proactive_messages pm
    WHERE pm.merchant_id = (SELECT c.merchant_id FROM conversations c WHERE c.id = NEW.conversation_id)
      AND pm.customer_id = (SELECT c.customer_instagram FROM conversations c WHERE c.id = NEW.conversation_id)
      AND pm.sent_at IS NOT NULL
      AND pm.sent_at >= NOW() - INTERVAL '24 hours'
    ORDER BY pm.sent_at DESC
    LIMIT 1;
    
    -- If we found a recent proactive message, update the results
    IF recent_message_id IS NOT NULL THEN
      SELECT EXTRACT(EPOCH FROM (NEW.created_at - pm.sent_at))/60 INTO time_diff_minutes
      FROM proactive_messages pm
      WHERE pm.id = recent_message_id;
      
      INSERT INTO proactive_action_results (
        merchant_id, customer_id, action_type, customer_responded, 
        response_time_minutes, sent_at
      )
      SELECT 
        pm.merchant_id,
        pm.customer_id,
        pm.type,
        true,
        time_diff_minutes,
        pm.sent_at
      FROM proactive_messages pm
      WHERE pm.id = recent_message_id
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for tracking proactive responses
DROP TRIGGER IF EXISTS trigger_track_proactive_response ON public.message_logs;
CREATE TRIGGER trigger_track_proactive_response
  AFTER INSERT ON public.message_logs
  FOR EACH ROW
  EXECUTE FUNCTION track_proactive_response();