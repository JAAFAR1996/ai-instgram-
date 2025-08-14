#!/bin/bash

# ===============================================
# Test Deployed Worker Status
# ===============================================

echo "🧪 اختبار Worker المُنشر..."
echo "=================================="

# Possible Worker URLs to try
WORKER_URLS=(
  "https://ai-sales-instagram-webhook.jafar.workers.dev"
  "https://ai-sales-instagram-webhook.437b94b7c116f757f2a1f76afdccc81c.workers.dev"  
  "https://437b94b7c116f757f2a1f76afdccc81c.cloudflare.workers.dev/ai-sales-instagram-webhook"
)

# Test each URL
for url in "${WORKER_URLS[@]}"; do
    echo ""
    echo "🔍 Testing: $url"
    
    # Test health endpoint
    echo "📊 Health check..."
    if response=$(curl -s -w "%{http_code}" --max-time 10 "$url/health" 2>/dev/null); then
        http_code="${response: -3}"
        body="${response%???}"
        
        if [ "$http_code" = "200" ]; then
            echo "✅ Health check PASSED ($http_code)"
            echo "📋 Response: $body"
            echo ""
            echo "🎉 Worker URL FOUND: $url"
            echo "=================================="
            echo ""
            
            # Test other endpoints
            echo "🔍 Testing other endpoints..."
            
            echo "📡 API Status:"
            curl -s --max-time 5 "$url/api/status" 2>/dev/null | head -3
            
            echo ""
            echo "🔗 Webhook verification:"
            curl -s --max-time 5 "$url/webhooks/instagram?hub.mode=subscribe&hub.challenge=test123&hub.verify_token=verify-token-12345" 2>/dev/null
            
            echo ""
            echo "🎯 Worker is ACTIVE and READY!"
            echo "Use this URL: $url"
            exit 0
        else
            echo "❌ Health check FAILED ($http_code)"
        fi
    else
        echo "❌ Connection FAILED"
    fi
done

echo ""
echo "⚠️  Could not find active Worker URL"
echo "📋 Next steps:"
echo "1. Check Cloudflare Dashboard"
echo "2. Verify subdomain registration"
echo "3. Try: npx wrangler tail (to see logs)"

# Show worker info
echo ""
echo "📊 Worker deployment info:"
npx wrangler deployments list --latest 2>/dev/null | head -10