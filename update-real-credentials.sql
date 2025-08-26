-- Update with real Instagram credentials from environment variables
BEGIN;

-- Update Instagram credentials with real values
UPDATE merchant_credentials 
SET 
    instagram_token_encrypted = 'EAAPbu3a071cBPAAX4ySZBBKvy9RyCgLqkZC57LRZCyd5X0hGmbbKVLeRQjmbEfebW8t0BwsG7zPPZAWFrmbe01ZC3uZCs6rhyhQg1KIyUw8KrDpR18q54NgN237KZCDJWMVkGQhNPhYTzsv95fP0lYBZC4u7eYWQCaIQs2o23oX0Ij5oNMZAXQIik7t0mFZC4CkIIi',
    webhook_verify_token = '4b376d4e3970513276583862453577315a317955347341366446336841304c72',
    app_secret = '63c6b47d1f900d80557b36ebbcb04575',
    instagram_page_id = '17841405545604018',
    instagram_business_account_id = '17841405545604018',
    business_account_id = '17841405545604018',
    is_active = true,
    updated_at = NOW()
WHERE merchant_id = 'dd90061a-a1ad-42de-be9b-1c9760d0de02'::uuid;

-- Also insert/update with correct values if not exists
INSERT INTO merchant_credentials (
    merchant_id,
    instagram_page_id,
    instagram_business_account_id,
    business_account_id,
    instagram_token_encrypted,
    webhook_verify_token,
    app_secret,
    platform,
    is_active
) VALUES (
    'dd90061a-a1ad-42de-be9b-1c9760d0de02'::uuid,
    '17841405545604018',
    '17841405545604018', 
    '17841405545604018',
    'EAAPbu3a071cBPAAX4ySZBBKvy9RyCgLqkZC57LRZCyd5X0hGmbbKVLeRQjmbEfebW8t0BwsG7zPPZAWFrmbe01ZC3uZCs6rhyhQg1KIyUw8KrDpR18q54NgN237KZCDJWMVkGQhNPhYTzsv95fP0lYBZC4u7eYWQCaIQs2o23oX0Ij5oNMZAXQIik7t0mFZC4CkIIi',
    '4b376d4e3970513276583862453577315a317955347341366446336841304c72',
    '63c6b47d1f900d80557b36ebbcb04575',
    'instagram',
    true
) ON CONFLICT (merchant_id, instagram_page_id) DO UPDATE SET
    instagram_token_encrypted = EXCLUDED.instagram_token_encrypted,
    webhook_verify_token = EXCLUDED.webhook_verify_token,
    app_secret = EXCLUDED.app_secret,
    is_active = true,
    updated_at = NOW();

-- Verify the credentials are properly stored
SELECT 
    merchant_id,
    instagram_page_id,
    business_account_id,
    CASE 
        WHEN LENGTH(instagram_token_encrypted) > 50 THEN 'Real Token Present (' || LENGTH(instagram_token_encrypted) || ' chars)'
        ELSE 'Token Too Short'
    END as token_status,
    CASE 
        WHEN webhook_verify_token IS NOT NULL THEN 'Verify Token Present'
        ELSE 'Verify Token Missing'
    END as verify_token_status,
    CASE 
        WHEN app_secret IS NOT NULL THEN 'App Secret Present'
        ELSE 'App Secret Missing'
    END as app_secret_status,
    is_active
FROM merchant_credentials
WHERE merchant_id = 'dd90061a-a1ad-42de-be9b-1c9760d0de02'::uuid;

COMMIT;

SELECT '🎉 Real Instagram credentials updated successfully!' as result;