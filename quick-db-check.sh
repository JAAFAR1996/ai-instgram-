#!/bin/bash

# Quick database connection check
echo "🔍 Checking database connection in production..."

# Test internal endpoint that uses database
curl -s https://ai-instgram.onrender.com/internal/test/rls | jq .

echo ""
echo "📊 If you see 'rls_working: true', database is connected"
echo "📊 If you see error or empty response, DATABASE_URL is missing"