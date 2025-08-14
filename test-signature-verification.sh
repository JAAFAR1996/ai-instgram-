#!/bin/bash

# ===============================================
# Test Instagram Webhook Signature Verification
# ===============================================

echo "🔐 اختبار التوقيع الحاسم..."
echo "=================================="

# Worker URL
WORKER_URL="https://ai-sales-instagram-webhook.jaferaliraq95.workers.dev/webhooks/instagram"

# App Secret (placeholder - يجب استخدام القيمة الحقيقية)
APP_SECRET="instagram-app-secret-placeholder-12345"

# Test payload (Instagram webhook format)
PAYLOAD='{
  "object": "instagram",
  "entry": [
    {
      "id": "test-business-account-123",
      "messaging": [
        {
          "sender": {"id": "user-456"},
          "recipient": {"id": "test-business-account-123"},
          "timestamp": '$(date +%s)'000,
          "message": {
            "mid": "test-message-789",
            "text": "مرحبا! هذا اختبار للتوقيع"
          }
        }
      ]
    }
  ]
}'

echo "📝 Test Payload:"
echo "$PAYLOAD" | jq .

echo ""
echo "🔑 Computing HMAC-SHA256 signature..."

# حساب التوقيع
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$APP_SECRET" | awk '{print $2}')

echo "📊 App Secret: $APP_SECRET"
echo "🔐 Computed Signature: sha256=$SIGNATURE"

echo ""
echo "🧪 Test 1: اختبار توقيع صحيح (يجب أن يرجع 200)..."

RESPONSE1=$(curl -s -w "HTTPSTATUS:%{http_code}" \
  -X POST \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=$SIGNATURE" \
  -d "$PAYLOAD" \
  "$WORKER_URL")

HTTP_STATUS1=$(echo $RESPONSE1 | tr -d '\n' | sed -e 's/.*HTTPSTATUS://')
BODY1=$(echo $RESPONSE1 | sed -e 's/HTTPSTATUS:.*//g')

echo "📈 HTTP Status: $HTTP_STATUS1"
echo "📋 Response: $BODY1"

if [ "$HTTP_STATUS1" = "200" ]; then
    echo "✅ SUCCESS: Valid signature accepted!"
else
    echo "❌ FAILED: Valid signature rejected (Status: $HTTP_STATUS1)"
fi

echo ""
echo "🧪 Test 2: اختبار توقيع خاطئ (يجب أن يرجع 401)..."

# توقيع خاطئ عمداً
WRONG_SIGNATURE="1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"

RESPONSE2=$(curl -s -w "HTTPSTATUS:%{http_code}" \
  -X POST \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=$WRONG_SIGNATURE" \
  -d "$PAYLOAD" \
  "$WORKER_URL")

HTTP_STATUS2=$(echo $RESPONSE2 | tr -d '\n' | sed -e 's/.*HTTPSTATUS://')
BODY2=$(echo $RESPONSE2 | sed -e 's/HTTPSTATUS:.*//g')

echo "📈 HTTP Status: $HTTP_STATUS2"
echo "📋 Response: $BODY2"

if [ "$HTTP_STATUS2" = "401" ]; then
    echo "✅ SUCCESS: Invalid signature rejected!"
else
    echo "❌ FAILED: Invalid signature accepted (Status: $HTTP_STATUS2)"
fi

echo ""
echo "🧪 Test 3: اختبار بدون توقيع (يجب أن يرجع 401)..."

RESPONSE3=$(curl -s -w "HTTPSTATUS:%{http_code}" \
  -X POST \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  "$WORKER_URL")

HTTP_STATUS3=$(echo $RESPONSE3 | tr -d '\n' | sed -e 's/.*HTTPSTATUS://')
BODY3=$(echo $RESPONSE3 | sed -e 's/HTTPSTATUS:.*//g')

echo "📈 HTTP Status: $HTTP_STATUS3"
echo "📋 Response: $BODY3"

if [ "$HTTP_STATUS3" = "401" ]; then
    echo "✅ SUCCESS: Missing signature rejected!"
else
    echo "❌ FAILED: Missing signature accepted (Status: $HTTP_STATUS3)"
fi

echo ""
echo "📊 ============================="
echo "📊 Summary - نتائج الاختبار:"
echo "📊 ============================="

TOTAL=3
PASSED=0

if [ "$HTTP_STATUS1" = "200" ]; then PASSED=$((PASSED+1)); fi
if [ "$HTTP_STATUS2" = "401" ]; then PASSED=$((PASSED+1)); fi  
if [ "$HTTP_STATUS3" = "401" ]; then PASSED=$((PASSED+1)); fi

echo "✅ Passed: $PASSED/$TOTAL"
echo "❌ Failed: $((TOTAL-PASSED))/$TOTAL"
echo "📈 Success Rate: $(( (PASSED*100) / TOTAL ))%"

echo ""
if [ "$PASSED" = "$TOTAL" ]; then
    echo "🎉 =================================="
    echo "🎉 ALL SIGNATURE TESTS PASSED!"
    echo "🎉 =================================="
    echo "✅ Valid signature: ACCEPTED ✅"
    echo "✅ Invalid signature: REJECTED ✅" 
    echo "✅ Missing signature: REJECTED ✅"
    echo "🔒 Security validation is WORKING!"
    echo "🎯 Worker ready for production!"
else
    echo "⚠️ Some signature tests failed!"
    echo "🔧 Check signature verification logic"
fi

echo ""
echo "🔗 Worker URL: $WORKER_URL"
echo "🔑 Test with your own App Secret from Meta Developer Console"