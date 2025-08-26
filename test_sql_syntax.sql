-- Test SQL syntax that's causing 42601 error
SELECT '{"type": "keyword", "value": "سعر|price|كم|how much|متوفر|available|أريد|want", "operator": "contains"}' as test_json;

SELECT '{"type": "invite_dm", "template": "مرحباً! راح أرسلك رسالة خاصة بكل التفاصيل", "priority": 80}' as test_template;