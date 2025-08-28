#!/usr/bin/env node

/**
 * ManyChat Migration Runner (CommonJS)
 * تشغيل migration جداول ManyChat في قاعدة البيانات
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// قراءة DATABASE_URL من البيئة
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://ai_instgram_user:rTAH6gFMveMhoSrFu3l9FmrqGYd1ZFdw@dpg-d2f0pije5dus73bi4ac0-a.frankfurt-postgres.render.com/ai_instgram';

console.log('🚀 ManyChat Migration Runner Started');
console.log('====================================\n');

async function runMigration() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    console.log('🔄 Connecting to database...');
    await client.connect();
    console.log('✅ Connected to database\n');

    // 1. التحقق من الجداول الحالية
    console.log('📋 Current ManyChat tables:');
    const currentTables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name LIKE 'manychat_%'
      ORDER BY table_name
    `);
    
    if (currentTables.rows.length === 0) {
      console.log('  ❌ No ManyChat tables found');
    } else {
      currentTables.rows.forEach(row => {
        console.log(`  ✅ ${row.table_name}`);
      });
    }

    // 2. التحقق من manual_followup_queue
    const followupCheck = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'manual_followup_queue'
    `);
    
    if (followupCheck.rows.length === 0) {
      console.log('  ❌ manual_followup_queue (missing)');
    } else {
      console.log('  ✅ manual_followup_queue');
    }

    console.log('\n' + '='.repeat(50));
    console.log('🔧 Running ManyChat Migration...\n');

    // 3. تنفيذ SQL مباشرة بدلاً من قراءة الملف
    const migrationSQL = `
-- إضافة عمود ManyChat config إلى جدول merchants
ALTER TABLE merchants 
ADD COLUMN IF NOT EXISTS manychat_config JSONB DEFAULT '{}';

-- إنشاء جدول migration_logs إذا لم يكن موجود
CREATE TABLE IF NOT EXISTS migration_logs (
    id SERIAL PRIMARY KEY,
    migration_name VARCHAR(255) NOT NULL,
    migration_version VARCHAR(50) NOT NULL,
    applied_at TIMESTAMPTZ DEFAULT NOW(),
    status VARCHAR(20) DEFAULT 'pending',
    details TEXT
);

-- إنشاء جدول manychat_logs
CREATE TABLE IF NOT EXISTS manychat_logs (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    subscriber_id VARCHAR(255) NOT NULL,
    message_id VARCHAR(255),
    action VARCHAR(50) NOT NULL CHECK (action IN (
        'send_message', 'create_subscriber', 'update_subscriber', 
        'add_tag', 'remove_tag', 'get_info', 'local_ai_response', 
        'fallback_response', 'webhook_received'
    )),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'success', 'failed', 'retrying'
    )),
    response_data JSONB DEFAULT '{}',
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    processing_time_ms INTEGER,
    platform VARCHAR(20) DEFAULT 'manychat' CHECK (platform IN (
        'manychat', 'local_ai', 'fallback', 'instagram'
    )),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- إنشاء جدول manychat_subscribers
CREATE TABLE IF NOT EXISTS manychat_subscribers (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    manychat_subscriber_id VARCHAR(255) NOT NULL,
    instagram_customer_id VARCHAR(255),
    whatsapp_customer_id VARCHAR(255),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    phone VARCHAR(20),
    email VARCHAR(255),
    language VARCHAR(10) DEFAULT 'ar',
    timezone VARCHAR(50) DEFAULT 'Asia/Baghdad',
    tags TEXT[] DEFAULT '{}',
    custom_fields JSONB DEFAULT '{}',
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN (
        'active', 'inactive', 'blocked', 'unsubscribed'
    )),
    engagement_score INTEGER DEFAULT 0,
    last_interaction_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- إنشاء جدول manychat_flows
CREATE TABLE IF NOT EXISTS manychat_flows (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    flow_name VARCHAR(255) NOT NULL,
    flow_id VARCHAR(255) NOT NULL,
    flow_type VARCHAR(50) NOT NULL CHECK (flow_type IN (
        'welcome', 'ai_response', 'comment_response', 'story_response',
        'purchase_intent', 'price_inquiry', 'customer_support', 'custom'
    )),
    is_active BOOLEAN DEFAULT true,
    priority INTEGER DEFAULT 0,
    trigger_conditions JSONB DEFAULT '{}',
    default_message TEXT,
    ai_prompt TEXT,
    tags_to_add TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- إنشاء جدول manychat_webhooks
CREATE TABLE IF NOT EXISTS manychat_webhooks (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    webhook_url TEXT NOT NULL,
    webhook_secret VARCHAR(255),
    webhook_type VARCHAR(50) NOT NULL CHECK (webhook_type IN (
        'subscriber_created', 'message_received', 'flow_completed',
        'tag_added', 'tag_removed', 'custom'
    )),
    is_active BOOLEAN DEFAULT true,
    last_triggered_at TIMESTAMPTZ,
    success_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- إنشاء جدول manual_followup_queue المفقود
CREATE TABLE IF NOT EXISTS manual_followup_queue (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    customer_id VARCHAR(255) NOT NULL,
    original_message TEXT NOT NULL,
    reason VARCHAR(100) NOT NULL,
    priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'cancelled')),
    assigned_to VARCHAR(255),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    scheduled_for TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- إضافة indexes للأداء
CREATE INDEX IF NOT EXISTS idx_manychat_logs_merchant_id ON manychat_logs(merchant_id);
CREATE INDEX IF NOT EXISTS idx_manychat_logs_subscriber_id ON manychat_logs(subscriber_id);
CREATE INDEX IF NOT EXISTS idx_manychat_logs_created_at ON manychat_logs(created_at);

CREATE INDEX IF NOT EXISTS idx_manychat_subscribers_merchant_id ON manychat_subscribers(merchant_id);
CREATE INDEX IF NOT EXISTS idx_manychat_subscribers_manychat_id ON manychat_subscribers(manychat_subscriber_id);
CREATE INDEX IF NOT EXISTS idx_manychat_subscribers_instagram_id ON manychat_subscribers(instagram_customer_id);

CREATE INDEX IF NOT EXISTS idx_manual_followup_queue_merchant_id ON manual_followup_queue(merchant_id);
CREATE INDEX IF NOT EXISTS idx_manual_followup_queue_status ON manual_followup_queue(status);

-- Function لتحديث updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- إضافة triggers للـ updated_at
DROP TRIGGER IF EXISTS update_manychat_logs_updated_at ON manychat_logs;
CREATE TRIGGER update_manychat_logs_updated_at 
    BEFORE UPDATE ON manychat_logs 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_manychat_subscribers_updated_at ON manychat_subscribers;
CREATE TRIGGER update_manychat_subscribers_updated_at 
    BEFORE UPDATE ON manychat_subscribers 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- تسجيل تنفيذ الـ migration
INSERT INTO migration_logs (
    migration_name,
    migration_version,
    applied_at,
    status,
    details
) VALUES (
    '053_manychat_integration',
    '053',
    NOW(),
    'completed',
    'ManyChat integration tables created via direct execution'
) ON CONFLICT DO NOTHING;
    `;

    console.log('⚡ Executing migration SQL...');
    await client.query(migrationSQL);
    console.log('✅ Migration SQL executed successfully!\n');

    // 4. التحقق من النتائج
    console.log('🔍 Verifying results...\n');
    
    const finalCheck = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND (table_name LIKE 'manychat_%' OR table_name = 'manual_followup_queue')
      ORDER BY table_name
    `);

    console.log('📋 Tables after migration:');
    finalCheck.rows.forEach(row => {
      console.log(`  ✅ ${row.table_name}`);
    });

    // 5. التحقق من عمود merchants
    const merchantCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'merchants' 
      AND column_name = 'manychat_config'
    `);

    if (merchantCheck.rows.length > 0) {
      console.log('  ✅ merchants.manychat_config column');
    }

    console.log('\n🎉 ManyChat Migration Completed Successfully!');
    console.log('💡 Next: Restart your application to reset Circuit Breaker');

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    
    if (error.message.includes('already exists')) {
      console.log('ℹ️  Some objects already exist - this is normal');
    }
    
    console.error('\n📝 Full error details:', error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('\n🔚 Database connection closed');
  }
}

// تشغيل الـ migration
runMigration().catch(console.error);