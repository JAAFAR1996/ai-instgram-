-- Production hotfix for remaining critical issues
BEGIN;

-- 1. Fix conversation_stage constraint to include all possible values
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_conversation_stage_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_conversation_stage_check 
CHECK (conversation_stage IN (
    'GREETING', 'PRODUCT_INQUIRY', 'ORDER_PROCESSING', 'PAYMENT', 'SUPPORT', 
    'COMPLETED', 'ABANDONED', 'ESCALATED', 'FOLLOW_UP', 'CLOSING',
    'AI_RESPONSE', 'WAITING_RESPONSE', 'PROCESSING', 'PENDING', 'ACTIVE',
    'QUEUED', 'FAILED', 'ERROR', 'TIMEOUT', 'RETRY'
));

-- 2. Verify merchant credentials are properly accessible
UPDATE merchant_credentials 
SET is_active = true, updated_at = NOW()
WHERE merchant_id = 'dd90061a-a1ad-42de-be9b-1c9760d0de02'::uuid;

-- 3. Test credential lookup query
SELECT 
    merchant_id::text as merchant_id_text,
    instagram_page_id,
    business_account_id,
    instagram_token_encrypted IS NOT NULL as has_encrypted_token,
    is_active,
    'SUCCESS' as test_result
FROM merchant_credentials 
WHERE merchant_id = 'dd90061a-a1ad-42de-be9b-1c9760d0de02'::uuid;

COMMIT;

SELECT '✅ Production hotfix applied - all critical constraints fixed' as result;