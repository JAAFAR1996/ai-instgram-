#!/bin/bash

# Test webhook with correct signature
PAYLOAD='{"entry":[{"id":"772043875986598","time":1705600000,"changes":[{"field":"messages","value":{"messaging":[{"sender":{"id":"123456"},"recipient":{"id":"772043875986598"},"timestamp":1705600000,"message":{"mid":"m_test","text":"Hello"}}]}}]}],"object":"instagram"}'

# Calculate signature
SECRET="3b41e5421706802fbc1156f9aa84247e"
SIGNATURE="sha256=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" -binary | xxd -p -c 256)"

echo "📝 Payload: $PAYLOAD"
echo "🔐 Signature: $SIGNATURE"
echo ""
echo "📤 Sending webhook..."

curl -X POST http://localhost:10000/webhooks/instagram \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: $SIGNATURE" \
  -H "X-App-Id: 1086023127068503" \
  -d "$PAYLOAD"

echo ""
echo "✅ Done"
