-- ===============================================
-- Webhook Idempotency & Security Enhancements
-- منع تكرار الأحداث وتحسين الأمان
-- ===============================================

-- 1. إضافة Idempotency للويبهوك (منع التكرار)
ALTER TABLE webhook_logs
  ADD CONSTRAINT uq_webhook_dedup 
  UNIQUE (platform, entry_id, message_id) 
  DEFERRABLE INITIALLY DEFERRED;

-- 2. إضافة فهرس على created_at للتنظيف
CREATE INDEX IF NOT EXISTS idx_webhook_logs_created_at 
  ON webhook_logs(created_at);

-- 3. إضافة عمود لهاش verify_token (بدلاً من plaintext)
ALTER TABLE webhook_subscriptions
  ADD COLUMN IF NOT EXISTS verify_token_hash TEXT;

-- 4. إضافة عمود للتحقق من التوقيع
ALTER TABLE webhook_logs
  ADD COLUMN IF NOT EXISTS signature_verified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS signature_hash TEXT;

-- 5. فهرس للأحداث غير المعالجة
CREATE INDEX IF NOT EXISTS idx_webhook_logs_unprocessed 
  ON webhook_logs(platform, processed, created_at) 
  WHERE processed = false;

-- 6. فهرس للأحداث مع التوقيع غير المتحقق منه
CREATE INDEX IF NOT EXISTS idx_webhook_logs_unverified 
  ON webhook_logs(signature_verified, created_at) 
  WHERE signature_verified = false;

-- 7. جدول لتتبع معدلات الطلبات (Rate Limiting)
CREATE TABLE IF NOT EXISTS webhook_rate_limits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  platform TEXT NOT NULL,
  client_ip INET,
  requests_count INTEGER DEFAULT 1,
  window_start TIMESTAMPTZ DEFAULT now(),
  window_end TIMESTAMPTZ DEFAULT (now() + INTERVAL '1 hour'),
  blocked BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- فهرس لـ Rate Limiting
CREATE INDEX idx_webhook_rate_limits_window 
  ON webhook_rate_limits(platform, client_ip, window_end)
  WHERE blocked = false;

-- 8. دالة للتحقق من Rate Limiting
CREATE OR REPLACE FUNCTION check_webhook_rate_limit(
  p_platform TEXT,
  p_client_ip INET,
  p_max_requests INTEGER DEFAULT 100,
  p_window_minutes INTEGER DEFAULT 60
) RETURNS BOOLEAN AS $$
DECLARE
  current_count INTEGER;
  window_start TIMESTAMPTZ;
BEGIN
  window_start := now() - (p_window_minutes || ' minutes')::INTERVAL;
  
  -- حساب الطلبات الحالية في النافذة
  SELECT COALESCE(SUM(requests_count), 0)
  INTO current_count
  FROM webhook_rate_limits
  WHERE platform = p_platform
    AND client_ip = p_client_ip
    AND window_end > now()
    AND window_start >= window_start;
  
  -- إذا تجاوز الحد المسموح
  IF current_count >= p_max_requests THEN
    -- تحديث حالة الحظر
    UPDATE webhook_rate_limits
    SET blocked = true
    WHERE platform = p_platform
      AND client_ip = p_client_ip
      AND window_end > now();
    
    RETURN false;
  END IF;
  
  -- إضافة طلب جديد أو تحديث العدد
  INSERT INTO webhook_rate_limits (platform, client_ip, requests_count)
  VALUES (p_platform, p_client_ip, 1)
  ON CONFLICT (platform, client_ip)
  DO UPDATE SET 
    requests_count = webhook_rate_limits.requests_count + 1,
    window_end = GREATEST(webhook_rate_limits.window_end, now() + (p_window_minutes || ' minutes')::INTERVAL);
  
  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- 9. دالة للتنظيف التلقائي مع Rate Limiting
CREATE OR REPLACE FUNCTION cleanup_webhook_data() RETURNS INTEGER AS $$
DECLARE
  webhook_deleted INTEGER;
  rate_limit_deleted INTEGER;
BEGIN
  -- حذف webhook logs أقدم من 30 يوم
  DELETE FROM webhook_logs 
  WHERE created_at < (now() - INTERVAL '30 days');
  GET DIAGNOSTICS webhook_deleted = ROW_COUNT;
  
  -- حذف rate limit records منتهية الصلاحية
  DELETE FROM webhook_rate_limits 
  WHERE window_end < (now() - INTERVAL '1 day');
  GET DIAGNOSTICS rate_limit_deleted = ROW_COUNT;
  
  -- تسجيل النتائج
  INSERT INTO system_logs (operation, details)
  VALUES ('webhook_cleanup', jsonb_build_object(
    'webhook_logs_deleted', webhook_deleted,
    'rate_limits_deleted', rate_limit_deleted,
    'cleaned_at', now()
  ));
  
  RETURN webhook_deleted + rate_limit_deleted;
END;
$$ LANGUAGE plpgsql;

-- 10. جدول system_logs إذا لم يكن موجود
CREATE TABLE IF NOT EXISTS system_logs (
  id BIGSERIAL PRIMARY KEY,
  operation TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_logs_operation 
  ON system_logs(operation, created_at);

-- 11. تعليق على الجداول للتوثيق
COMMENT ON CONSTRAINT uq_webhook_dedup ON webhook_logs 
  IS 'منع تكرار نفس الحدث من Instagram/Meta';

COMMENT ON COLUMN webhook_subscriptions.verify_token_hash 
  IS 'SHA-256 hash لـ verify_token بدلاً من النص العادي';

COMMENT ON FUNCTION check_webhook_rate_limit 
  IS 'التحقق من حدود معدل الطلبات للويبهوك لمنع الإساءة';

COMMENT ON FUNCTION cleanup_webhook_data 
  IS 'تنظيف تلقائي للبيانات القديمة - يُشغل يومياً';