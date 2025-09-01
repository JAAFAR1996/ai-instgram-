-- Migration 059: Add ai_config to merchants
-- Ensures AI per-merchant configuration can be stored

ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS ai_config JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.merchants.ai_config IS 'Per-merchant AI configuration (model, temperature, maxTokens, language, etc.)';

