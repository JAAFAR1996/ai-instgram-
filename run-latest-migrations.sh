#!/bin/bash

# Run latest migrations for AI Sales Platform
# This script runs the pgvector fix and webhook normalization migrations

echo "🚀 Running latest database migrations..."

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
  echo "❌ DATABASE_URL not set. Please export it first."
  exit 1
fi

echo "📊 Current migration status:"
psql "$DATABASE_URL" -c "SELECT name, filename, executed_at FROM migrations ORDER BY executed_at DESC LIMIT 5;"

echo ""
echo "🔧 Applying migration 001 pgvector fix..."
# The pgvector fix is already in 001_initial_schema.sql, no separate migration needed

echo ""
echo "🔧 Applying migration 016: Webhook Status Normalization..."
psql "$DATABASE_URL" -f src/database/migrations/016_webhook_status_normalization.sql

if [ $? -eq 0 ]; then
  echo "✅ Migration 016 applied successfully"
else
  echo "⚠️ Migration 016 may have already been applied or encountered an error"
fi

echo ""
echo "📊 Updated migration status:"
psql "$DATABASE_URL" -c "SELECT name, filename, executed_at FROM migrations ORDER BY executed_at DESC LIMIT 5;"

echo ""
echo "🔍 Verifying webhook_logs constraint:"
psql "$DATABASE_URL" -c "
SELECT 
  conname as constraint_name,
  pg_get_constraintdef(oid) as definition
FROM pg_constraint
WHERE conrelid = 'webhook_logs'::regclass
  AND conname LIKE '%status%';"

echo ""
echo "✅ Migrations complete!"