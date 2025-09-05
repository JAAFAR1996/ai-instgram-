-- Migration 083: Add sales_style column to merchants
-- Adds a column to store preferred AI sales style per merchant

ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS sales_style TEXT DEFAULT 'neutral';

COMMENT ON COLUMN public.merchants.sales_style IS 'Preferred sales style or tone for AI responses (e.g., consultative, enthusiastic, casual).';