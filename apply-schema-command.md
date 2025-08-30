# 🚨 إصلاح قاعدة البيانات الإنتاجي - تطبيق فوري

## خطوات التطبيق في Render:

### 1. الدخول إلى Render Dashboard
- اذهب إلى: https://dashboard.render.com
- اختر PostgreSQL database: `ai_instgram`
- اضغط على "Console" أو "Query"

### 2. تطبيق Schema (نسخ ولصق):

```sql
-- Create messages table
CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    recipient_id TEXT,
    platform TEXT NOT NULL CHECK (platform IN ('instagram', 'whatsapp', 'facebook')),
    message_type TEXT DEFAULT 'text',
    content TEXT,
    status TEXT DEFAULT 'sent' CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create message_followups table  
CREATE TABLE IF NOT EXISTS message_followups (
    id SERIAL PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    message TEXT NOT NULL,
    interaction_type TEXT NOT NULL,
    platform TEXT NOT NULL CHECK (platform IN ('instagram', 'whatsapp', 'facebook')),
    scheduled_for TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'failed', 'cancelled')),
    retry_count INTEGER DEFAULT 0,
    last_retry_at TIMESTAMP,
    error_message TEXT
);

-- Create performance indexes
CREATE INDEX IF NOT EXISTS idx_messages_merchant_sender_platform ON messages(merchant_id, sender_id, platform);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_message_followups_merchant_customer ON message_followups(merchant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_message_followups_scheduled_for ON message_followups(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_message_followups_status ON message_followups(status);

-- Verify creation
SELECT 'SUCCESS: Tables created!' as status;
```

### 3. التحقق من النجاح:
```sql
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('messages', 'message_followups');
```

يجب أن ترى:
- messages
- message_followups

### 4. بعد التطبيق:
- اعد تشغيل التطبيق في Render (Deploy → Manual Deploy)
- راقب اللوقز للتأكد من اختفاء أخطاء "relation does not exist"

## 🎯 نتيجة متوقعة:
- ✅ اختفاء أخطاء Database schema
- ✅ تفعيل Message window checking
- ✅ تفعيل Follow-up scheduling
- ✅ عمل InstagramManyChatBridge بشكل كامل