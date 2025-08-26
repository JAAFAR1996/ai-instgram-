-- Test the exact JSON that's causing issues
-- This should produce a 42601 error
SELECT '{"type": "invite_dm", "template": "مرحباً! راح أرسلك رسالة خاصة بكل التفاصيل", "priority": 80}'::jsonb;