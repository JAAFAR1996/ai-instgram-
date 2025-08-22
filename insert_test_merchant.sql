-- ===============================================
-- Insert Test Merchant Data
-- إدراج بيانات التاجر التجريبي لربط Instagram Page
-- ===============================================

-- Insert test merchant
INSERT INTO merchants (
  id, 
  business_name, 
  business_category,
  whatsapp_number, 
  instagram_username,
  email,
  subscription_status,
  subscription_tier,
  settings,
  ai_config,
  is_active
) VALUES (
  'dd90061a-a1ad-42de-be9b-1c9760d0de02',
  'Test Store', 
  'retail',
  '+9647701234567',
  'test_store',
  'test@example.com',
  'ACTIVE',
  'BASIC',
  '{
    "working_hours": {
      "enabled": true,
      "timezone": "Asia/Baghdad",
      "schedule": {
        "sunday": {"open": "09:00", "close": "22:00", "enabled": true},
        "monday": {"open": "09:00", "close": "22:00", "enabled": true},
        "tuesday": {"open": "09:00", "close": "22:00", "enabled": true},
        "wednesday": {"open": "09:00", "close": "22:00", "enabled": true},
        "thursday": {"open": "09:00", "close": "22:00", "enabled": true},
        "friday": {"open": "14:00", "close": "22:00", "enabled": true},
        "saturday": {"open": "09:00", "close": "22:00", "enabled": false}
      }
    },
    "payment_methods": ["COD", "ZAIN_CASH"],
    "auto_responses": {
      "welcome_message": "أهلاً وسهلاً! كيف أقدر أساعدك؟",
      "outside_hours": "نعتذر، المحل مغلق حالياً"
    }
  }'::JSONB,
  '{
    "model": "gpt-4o-mini",
    "temperature": 0.7,
    "max_tokens": 500,
    "personality": "friendly",
    "language": "arabic"
  }'::JSONB,
  true
) ON CONFLICT (id) DO UPDATE SET
  business_name = EXCLUDED.business_name,
  instagram_username = EXCLUDED.instagram_username,
  updated_at = NOW();

-- Insert merchant credentials for Instagram
INSERT INTO merchant_credentials (
  merchant_id, 
  platform,
  instagram_page_id, 
  instagram_business_account_id,
  business_account_id,
  created_at,
  updated_at
) VALUES (
  'dd90061a-a1ad-42de-be9b-1c9760d0de02',
  'INSTAGRAM',
  '17841405545604018',
  '17841405545604018',
  '17841405545604018',
  NOW(),
  NOW()
) ON CONFLICT (merchant_id, instagram_page_id) DO UPDATE SET
  instagram_business_account_id = EXCLUDED.instagram_business_account_id,
  business_account_id = EXCLUDED.business_account_id,
  platform = EXCLUDED.platform,
  updated_at = NOW();

-- Verify the insertion
SELECT 
  m.id,
  m.business_name,
  m.instagram_username,
  mc.platform,
  mc.instagram_page_id,
  mc.instagram_business_account_id,
  mc.created_at
FROM merchants m
LEFT JOIN merchant_credentials mc ON m.id = mc.merchant_id
WHERE m.id = 'dd90061a-a1ad-42de-be9b-1c9760d0de02';

-- Display summary
SELECT 
  'Merchant Data' as table_name,
  COUNT(*) as records_count
FROM merchants 
WHERE id = 'dd90061a-a1ad-42de-be9b-1c9760d0de02'

UNION ALL

SELECT 
  'Credentials Data' as table_name,
  COUNT(*) as records_count  
FROM merchant_credentials
WHERE merchant_id = 'dd90061a-a1ad-42de-be9b-1c9760d0de02';

-- Log the operation
INSERT INTO webhook_logs (
  merchant_id,
  platform,
  event_type,
  status,
  details,
  processed_at
) VALUES (
  'dd90061a-a1ad-42de-be9b-1c9760d0de02'::uuid,
  'instagram',
  'MERCHANT_SETUP',
  'SUCCESS',
  '{"action": "test_merchant_created", "page_id": "17841405545604018"}'::jsonb,
  NOW()
) ON CONFLICT DO NOTHING;

-- Success message
DO $$ 
BEGIN 
  RAISE NOTICE '✅ Test merchant data inserted successfully!';
  RAISE NOTICE '   • Merchant ID: dd90061a-a1ad-42de-be9b-1c9760d0de02';
  RAISE NOTICE '   • Instagram Page ID: 17841405545604018';
  RAISE NOTICE '   • Business Name: Test Store';
  RAISE NOTICE '   • Platform: INSTAGRAM';
END $$;