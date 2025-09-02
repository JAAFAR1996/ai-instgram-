-- 077: Proactive messaging system tables

-- Table for storing proactive messages
CREATE TABLE IF NOT EXISTS public.proactive_messages (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  customer_id text NOT NULL,
  type text NOT NULL CHECK (type IN ('SIZE_WARNING', 'RESTOCK_ALERT', 'FOLLOWUP_MESSAGE', 'LOYALTY_OFFER', 'SATISFACTION_CHECK')),
  message text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  sent_at timestamptz,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'CANCELLED')),
  context jsonb DEFAULT '{}'::jsonb,
  priority text NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

-- Table for merchant proactive settings
CREATE TABLE IF NOT EXISTS public.proactive_settings (
  merchant_id uuid PRIMARY KEY REFERENCES public.merchants(id) ON DELETE CASCADE,
  enable_proactive_messages boolean NOT NULL DEFAULT true,
  enable_follow_ups boolean NOT NULL DEFAULT true,
  enable_stock_alerts boolean NOT NULL DEFAULT true,
  enable_churn_prevention boolean NOT NULL DEFAULT true,
  max_messages_per_day integer NOT NULL DEFAULT 3,
  quiet_hours_start integer NOT NULL DEFAULT 22 CHECK (quiet_hours_start >= 0 AND quiet_hours_start <= 23),
  quiet_hours_end integer NOT NULL DEFAULT 6 CHECK (quiet_hours_end >= 0 AND quiet_hours_end <= 23),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

-- Table for tracking prediction accuracy (for ML improvement)
CREATE TABLE IF NOT EXISTS public.prediction_accuracy (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  customer_id text NOT NULL,
  prediction_type text NOT NULL CHECK (prediction_type IN ('SIZE_ISSUE', 'CHURN_RISK', 'PURCHASE_TIMING')),
  predicted_value jsonb NOT NULL,
  actual_outcome jsonb,
  accuracy_score float,
  prediction_date timestamptz NOT NULL,
  outcome_date timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

-- Table for customer interaction patterns (for timing optimization)
CREATE TABLE IF NOT EXISTS public.customer_interaction_patterns (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  customer_id text NOT NULL,
  interaction_hour integer NOT NULL CHECK (interaction_hour >= 0 AND interaction_hour <= 23),
  day_of_week integer NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  response_rate float NOT NULL DEFAULT 0,
  interaction_count integer NOT NULL DEFAULT 1,
  last_updated timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE(merchant_id, customer_id, interaction_hour, day_of_week)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_proactive_msg_merchant ON public.proactive_messages(merchant_id);
CREATE INDEX IF NOT EXISTS idx_proactive_msg_customer ON public.proactive_messages(customer_id);
CREATE INDEX IF NOT EXISTS idx_proactive_msg_scheduled ON public.proactive_messages(scheduled_at) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_proactive_msg_status ON public.proactive_messages(status);
CREATE INDEX IF NOT EXISTS idx_proactive_msg_priority ON public.proactive_messages(priority);

CREATE INDEX IF NOT EXISTS idx_prediction_accuracy_merchant ON public.prediction_accuracy(merchant_id);
CREATE INDEX IF NOT EXISTS idx_prediction_accuracy_type ON public.prediction_accuracy(prediction_type);
CREATE INDEX IF NOT EXISTS idx_prediction_accuracy_date ON public.prediction_accuracy(prediction_date);

CREATE INDEX IF NOT EXISTS idx_interaction_patterns_merchant ON public.customer_interaction_patterns(merchant_id);
CREATE INDEX IF NOT EXISTS idx_interaction_patterns_customer ON public.customer_interaction_patterns(customer_id);

-- Function to update interaction patterns automatically
CREATE OR REPLACE FUNCTION update_interaction_patterns()
RETURNS TRIGGER AS $$
BEGIN
  -- Only process incoming messages (customer responses)
  IF NEW.direction = 'INCOMING' THEN
    INSERT INTO public.customer_interaction_patterns (
      merchant_id, customer_id, interaction_hour, day_of_week, response_rate, interaction_count
    )
    SELECT 
      c.merchant_id,
      c.customer_instagram,
      EXTRACT(HOUR FROM NEW.created_at)::integer,
      EXTRACT(DOW FROM NEW.created_at)::integer,
      1.0,
      1
    FROM conversations c
    WHERE c.id = NEW.conversation_id
    ON CONFLICT (merchant_id, customer_id, interaction_hour, day_of_week)
    DO UPDATE SET
      interaction_count = customer_interaction_patterns.interaction_count + 1,
      response_rate = (customer_interaction_patterns.response_rate * customer_interaction_patterns.interaction_count + 1.0) / (customer_interaction_patterns.interaction_count + 1),
      last_updated = NOW();
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update interaction patterns
DROP TRIGGER IF EXISTS trigger_update_interaction_patterns ON public.message_logs;
CREATE TRIGGER trigger_update_interaction_patterns
  AFTER INSERT ON public.message_logs
  FOR EACH ROW
  EXECUTE FUNCTION update_interaction_patterns();

-- Insert default settings for existing merchants
INSERT INTO public.proactive_settings (merchant_id)
SELECT id FROM public.merchants
WHERE id NOT IN (SELECT merchant_id FROM public.proactive_settings)
ON CONFLICT (merchant_id) DO NOTHING;