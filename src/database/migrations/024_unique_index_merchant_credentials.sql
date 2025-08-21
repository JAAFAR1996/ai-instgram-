-- Migration 024: Add unique index for merchant credentials ON CONFLICT
-- This ensures PostgreSQL can match the ON CONFLICT specification

DO $$
BEGIN
  -- Check if the unique index exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE indexname = 'ux_mc_merchant_page'
  ) THEN
    -- Create the unique index for ON CONFLICT constraint matching
    CREATE UNIQUE INDEX ux_mc_merchant_page
    ON merchant_credentials (merchant_id, instagram_page_id);
    
    RAISE NOTICE 'Created unique index ux_mc_merchant_page on merchant_credentials (merchant_id, instagram_page_id)';
  ELSE
    RAISE NOTICE 'Unique index ux_mc_merchant_page already exists, skipping';
  END IF;
END $$;

-- Add comment for documentation
COMMENT ON INDEX ux_mc_merchant_page IS 'Unique constraint for merchant credentials per Instagram page - required for ON CONFLICT clauses';