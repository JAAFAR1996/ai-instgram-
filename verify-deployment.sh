#!/bin/bash

echo "🔍 Verifying deployment status..."
echo ""

# 1. Check health
echo "1️⃣ Health check:"
curl -s https://ai-instgram.onrender.com/health | jq -r '.status'

# 2. Check database connection
echo ""
echo "2️⃣ Database check:"
RESPONSE=$(curl -s https://ai-instgram.onrender.com/internal/test/rls)
if echo "$RESPONSE" | grep -q "rls_working"; then
  echo "✅ Database connected!"
else
  echo "❌ Database NOT connected"
fi

# 3. Test webhook
echo ""
echo "3️⃣ Webhook test:"
PAGE_ID="772043875986598"
META_APP_SECRET=${META_APP_SECRET:-"test"}

# Create payload
cat > test.json << EOF
{"object":"instagram","entry":[{"id":"$PAGE_ID","time":$(date +%s),"changes":[{"field":"messages","value":{"text":"verify-$(date +%s)"}}]}]}
EOF

# Calculate signature
SIG=$(node -e "
const fs = require('fs');
const crypto = require('crypto');
const body = fs.readFileSync('test.json');
console.log('sha256=' + crypto.createHmac('sha256', '$META_APP_SECRET').update(body).digest('hex'));
")

# Send request
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST https://ai-instgram.onrender.com/webhooks/instagram \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: $SIG" \
  --data-binary @test.json)

echo "Response code: $HTTP_CODE"

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ Webhook responding correctly"
else
  echo "❌ Webhook error"
fi

rm -f test.json

echo ""
echo "📋 Summary:"
echo "If database is connected AND webhook returns 200, check Render logs for:"
echo "  - '📊 Processing webhook event:'"
echo "  - '🔍 Merchant lookup:'"
echo "  - '✅ New webhook event logged:'"