-- Migration 039: Enable UUID Extension
-- Date: 2025-08-26
-- Description: Enable uuid-ossp extension for uuid_generate_v4() function
-- Priority: CRITICAL - Required for all UUID generation in production

BEGIN;

-- Log migration start
INSERT INTO migration_log (migration_id, started_at, description) 
VALUES ('039', NOW(), 'Enable uuid-ossp extension for UUID generation')
ON CONFLICT (migration_id) DO UPDATE SET started_at = NOW();

-- Enable UUID extension (most PostgreSQL installations support this)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Test the extension works
DO $$
DECLARE
    test_uuid uuid;
BEGIN
    -- Test UUID generation
    SELECT uuid_generate_v4() INTO test_uuid;
    
    -- Verify UUID was generated
    IF test_uuid IS NULL THEN
        RAISE EXCEPTION 'UUID extension test failed - uuid_generate_v4() returned NULL';
    END IF;
    
    RAISE NOTICE 'UUID extension enabled successfully. Test UUID: %', test_uuid;
END $$;

-- Update migration log
UPDATE migration_log 
SET completed_at = NOW(), status = 'SUCCESS' 
WHERE migration_id = '039';

COMMIT;

-- Log success
\echo 'Migration 039: UUID extension enabled successfully ✅'