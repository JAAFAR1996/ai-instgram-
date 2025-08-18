BEGIN;

-- تأكد من وجود الأعمدة المطلوبة فقط
ALTER TABLE merchant_credentials
  ADD COLUMN IF NOT EXISTS instagram_page_id TEXT,
  ADD COLUMN IF NOT EXISTS instagram_business_account_id TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- فريد على instagram_page_id إذا لم يكن موجوداً (لا تغيّر الـ PK الحالي)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'uq_mc_instagram_page_id'
  ) THEN
    CREATE UNIQUE INDEX uq_mc_instagram_page_id
      ON merchant_credentials(instagram_page_id);
  END IF;
END $$;

COMMIT;