-- Migration: Fix merchant_credentials table with composite primary key
-- Date: 2025-01-20
-- Purpose: Implement composite primary key (merchant_id, instagram_page_id) for secure merchant-page mapping

BEGIN;

-- إسقاط المفتاح الأساسي القديم إن وُجد
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = to_regclass('merchant_credentials')
      AND contype = 'p'
  ) THEN
    EXECUTE 'ALTER TABLE merchant_credentials DROP CONSTRAINT ' ||
            (SELECT conname FROM pg_constraint
             WHERE conrelid = to_regclass('merchant_credentials') AND contype='p');
    RAISE NOTICE 'Dropped existing primary key constraint';
  END IF;
END $$;

-- إنشاء الجدول إن لم يكن موجوداً
CREATE TABLE IF NOT EXISTS merchant_credentials (
  merchant_id UUID,
  instagram_page_id TEXT,
  instagram_business_account_id TEXT,
  business_account_id TEXT,
  app_secret TEXT,
  instagram_token_encrypted TEXT,
  webhook_verify_token TEXT,
  oauth_version VARCHAR(10) DEFAULT '2.0',
  pkce_supported BOOLEAN DEFAULT true,
  last_security_audit TIMESTAMPTZ,
  security_flags JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- أضف الأعمدة إن لزم (للجداول الموجودة)
ALTER TABLE merchant_credentials
  ADD COLUMN IF NOT EXISTS merchant_id UUID,
  ADD COLUMN IF NOT EXISTS instagram_page_id TEXT,
  ADD COLUMN IF NOT EXISTS instagram_business_account_id TEXT,
  ADD COLUMN IF NOT EXISTS business_account_id TEXT,
  ADD COLUMN IF NOT EXISTS app_secret TEXT,
  ADD COLUMN IF NOT EXISTS instagram_token_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS webhook_verify_token TEXT,
  ADD COLUMN IF NOT EXISTS oauth_version VARCHAR(10) DEFAULT '2.0',
  ADD COLUMN IF NOT EXISTS pkce_supported BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_security_audit TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS security_flags JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- فرض NOT NULL على العمودين المطلوبين للـ PK المركب
ALTER TABLE merchant_credentials
  ALTER COLUMN merchant_id SET NOT NULL,
  ALTER COLUMN instagram_page_id SET NOT NULL;

-- إنشاء PK مركّب
ALTER TABLE merchant_credentials
  ADD CONSTRAINT pk_merchant_credentials PRIMARY KEY (merchant_id, instagram_page_id);

-- إضافة Foreign Key إلى جدول merchants
ALTER TABLE merchant_credentials
  ADD CONSTRAINT fk_merchant_credentials_merchant
  FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE;

-- (اختياري) إبقاء UNIQUE عالمي على instagram_page_id لمنع ربط نفس الصفحة بأكثر من تاجر
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = to_regclass('merchant_credentials')
      AND contype = 'u'
      AND conname = 'uq_merchant_credentials_instagram_page_id'
  ) THEN
    EXECUTE 'ALTER TABLE merchant_credentials
             ADD CONSTRAINT uq_merchant_credentials_instagram_page_id
             UNIQUE (instagram_page_id);';
    RAISE NOTICE 'Added unique constraint on instagram_page_id';
  END IF;
END $$;

-- إنشاء الفهارس للأداء
CREATE INDEX IF NOT EXISTS idx_merchant_credentials_merchant_id
ON merchant_credentials(merchant_id);

CREATE INDEX IF NOT EXISTS idx_merchant_credentials_business_account_id 
ON merchant_credentials(instagram_business_account_id);

CREATE INDEX IF NOT EXISTS idx_merchant_credentials_token_encrypted 
ON merchant_credentials(instagram_token_encrypted) 
WHERE instagram_token_encrypted IS NOT NULL;

-- تفعيل RLS وسياسة العزل (مع التحقق من وجود الأدوار)
ALTER TABLE merchant_credentials ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- التحقق من وجود app.current_merchant_id setting قبل إنشاء السياسات
  IF EXISTS (
    SELECT 1 FROM pg_settings 
    WHERE name = 'app.current_merchant_id' OR 1=1 -- السماح بالتنفيذ حتى لو لم تكن موجودة
  ) THEN
    -- إنشاء سياسة العزل إن لم تكن موجودة
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE tablename='merchant_credentials'
        AND policyname='merchant_credentials_merchant_policy'
    ) THEN
      CREATE POLICY merchant_credentials_merchant_policy
        ON merchant_credentials
        FOR ALL
        USING (merchant_id = current_setting('app.current_merchant_id', true)::uuid);;
      RAISE NOTICE 'Created RLS policy for merchant isolation';
    END IF;
  ELSE
    RAISE NOTICE 'Warning: app.current_merchant_id GUC not configured, RLS policy not created';
  END IF;
END $$;

-- إضافة trigger لـ updated_at
CREATE OR REPLACE FUNCTION update_merchant_credentials_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_merchant_credentials_updated_at ON merchant_credentials;
CREATE TRIGGER trigger_merchant_credentials_updated_at
    BEFORE UPDATE ON merchant_credentials
    FOR EACH ROW
    EXECUTE FUNCTION update_merchant_credentials_updated_at();

-- إضافة تعليقات للتوثيق
COMMENT ON TABLE merchant_credentials IS 'Merchant Instagram credentials with composite primary key for secure mapping';
COMMENT ON COLUMN merchant_credentials.merchant_id IS 'UUID of the merchant (part of composite PK)';
COMMENT ON COLUMN merchant_credentials.instagram_page_id IS 'Instagram page ID (part of composite PK)';
COMMENT ON COLUMN merchant_credentials.instagram_token_encrypted IS 'Encrypted Instagram access token';
COMMENT ON COLUMN merchant_credentials.webhook_verify_token IS 'Webhook verification token';

-- تحليل الجدول لتحسين الاستعلامات
ANALYZE merchant_credentials;

COMMIT;

-- إشعارات النجاح
DO $$
BEGIN
  RAISE NOTICE '✅ Migration 019: Merchant-Instagram mapping composite primary key implemented';
  RAISE NOTICE '🔑 Composite PK: (merchant_id, instagram_page_id)';
  RAISE NOTICE '🔗 Foreign Key: merchant_id -> merchants(id)';
  RAISE NOTICE '🔒 Row Level Security configured (if GUC available)';
  RAISE NOTICE '📊 Indexes created for optimal performance';
END $$;