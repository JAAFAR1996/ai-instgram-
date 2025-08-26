-- Update Instagram credentials with access token
BEGIN;

-- Update Instagram credentials to include access token (using placeholder for security)
UPDATE merchant_credentials 
SET 
    instagram_token_encrypted = 'placeholder_token_needs_real_value',
    webhook_verify_token = 'verify_token_placeholder',
    app_secret = 'app_secret_placeholder',
    updated_at = NOW()
WHERE instagram_page_id = '17841405545604018';

-- Verify the update
SELECT 
    merchant_id, 
    instagram_page_id, 
    business_account_id,
    CASE 
        WHEN instagram_token_encrypted IS NOT NULL THEN 'Token Present' 
        ELSE 'Token Missing' 
    END as token_status,
    is_active
FROM merchant_credentials;

COMMIT;

SELECT 'Instagram credentials updated (tokens need real values)' as result;