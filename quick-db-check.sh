#!/bin/bash

# Quick database connection check
echo "🔍 Checking database connection in production..."

BASE_URL=${BASE_URL:-http://localhost:10000}
curl -s "$BASE_URL/internal/test/rls" | jq .

echo ""
echo "📊 If you see 'rls_working: true', database is connected"
echo "📊 If you see error or empty response, DATABASE_URL is missing"