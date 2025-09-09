-- ===============================================
-- Dynamic Templates Database Tables
-- جداول القوالب الديناميكية - كل شيء من قاعدة البيانات
-- ===============================================

-- جدول قوالب الردود الديناميكية
CREATE TABLE IF NOT EXISTS dynamic_response_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    template_type VARCHAR(50) NOT NULL, -- greeting, fallback, error, etc.
    content TEXT NOT NULL,
    variables TEXT[] DEFAULT '{}', -- متغيرات القالب مثل {{business_name}}
    priority INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT true,
    language VARCHAR(10) DEFAULT 'ar',
    usage_count INTEGER DEFAULT 0,
    success_rate DECIMAL(3,2) DEFAULT 0.0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- فهرس على نوع القالب والتاجر
CREATE INDEX IF NOT EXISTS idx_dynamic_templates_merchant_type 
ON dynamic_response_templates(merchant_id, template_type, is_active);

-- جدول إعدادات الذكاء الاصطناعي الديناميكية
CREATE TABLE IF NOT EXISTS dynamic_ai_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    setting_name VARCHAR(100) NOT NULL, -- model, temperature, max_tokens, etc.
    setting_value TEXT NOT NULL,
    setting_type VARCHAR(20) DEFAULT 'string', -- string, number, boolean, json
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(merchant_id, setting_name)
);

-- فهرس على التاجر ونوع الإعداد
CREATE INDEX IF NOT EXISTS idx_dynamic_ai_settings_merchant_name 
ON dynamic_ai_settings(merchant_id, setting_name, is_active);

-- جدول القيم الافتراضية الديناميكية
CREATE TABLE IF NOT EXISTS dynamic_defaults (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    default_type VARCHAR(50) NOT NULL, -- business_name, currency, merchant_type, etc.
    default_value TEXT NOT NULL,
    fallback_value TEXT, -- قيمة احتياطية في حالة عدم وجود القيمة الأساسية
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(merchant_id, default_type)
);

-- فهرس على التاجر ونوع القيمة الافتراضية
CREATE INDEX IF NOT EXISTS idx_dynamic_defaults_merchant_type 
ON dynamic_defaults(merchant_id, default_type, is_active);

-- جدول رسائل الخطأ الديناميكية
CREATE TABLE IF NOT EXISTS dynamic_error_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    error_type VARCHAR(50) NOT NULL, -- fallback, timeout, api_error, etc.
    message_template TEXT NOT NULL,
    variables TEXT[] DEFAULT '{}',
    priority INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT true,
    usage_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- فهرس على التاجر ونوع الخطأ
CREATE INDEX IF NOT EXISTS idx_dynamic_error_messages_merchant_type 
ON dynamic_error_messages(merchant_id, error_type, is_active);

-- جدول إعدادات النظام الديناميكية
CREATE TABLE IF NOT EXISTS dynamic_system_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    setting_category VARCHAR(50) NOT NULL, -- ai, business, ui, etc.
    setting_key VARCHAR(100) NOT NULL,
    setting_value TEXT NOT NULL,
    setting_type VARCHAR(20) DEFAULT 'string',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(merchant_id, setting_category, setting_key)
);

-- فهرس على التاجر والفئة
CREATE INDEX IF NOT EXISTS idx_dynamic_system_settings_merchant_category 
ON dynamic_system_settings(merchant_id, setting_category, is_active);

-- إنشاء دالة لتحديث updated_at تلقائياً
CREATE OR REPLACE FUNCTION update_dynamic_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- تطبيق الدالة على الجداول
CREATE TRIGGER update_dynamic_templates_updated_at 
    BEFORE UPDATE ON dynamic_response_templates 
    FOR EACH ROW EXECUTE FUNCTION update_dynamic_updated_at_column();

CREATE TRIGGER update_dynamic_ai_settings_updated_at 
    BEFORE UPDATE ON dynamic_ai_settings 
    FOR EACH ROW EXECUTE FUNCTION update_dynamic_updated_at_column();

CREATE TRIGGER update_dynamic_defaults_updated_at 
    BEFORE UPDATE ON dynamic_defaults 
    FOR EACH ROW EXECUTE FUNCTION update_dynamic_updated_at_column();

CREATE TRIGGER update_dynamic_error_messages_updated_at 
    BEFORE UPDATE ON dynamic_error_messages 
    FOR EACH ROW EXECUTE FUNCTION update_dynamic_updated_at_column();

CREATE TRIGGER update_dynamic_system_settings_updated_at 
    BEFORE UPDATE ON dynamic_system_settings 
    FOR EACH ROW EXECUTE FUNCTION update_dynamic_updated_at_column();

-- إدراج بيانات افتراضية للتجار الجدد
INSERT INTO dynamic_response_templates (merchant_id, template_type, content, variables, priority) 
SELECT 
    m.id,
    'greeting',
    'مرحباً بك في ' || COALESCE(m.business_name, 'متجرنا') || '! كيف يمكنني مساعدتك اليوم؟',
    ARRAY['business_name'],
    1
FROM merchants m
WHERE NOT EXISTS (
    SELECT 1 FROM dynamic_response_templates drt 
    WHERE drt.merchant_id = m.id AND drt.template_type = 'greeting'
);

-- إدراج إعدادات الذكاء الاصطناعي الافتراضية
INSERT INTO dynamic_ai_settings (merchant_id, setting_name, setting_value, setting_type) 
SELECT 
    m.id,
    'model',
    'gpt-4o-mini',
    'string'
FROM merchants m
WHERE NOT EXISTS (
    SELECT 1 FROM dynamic_ai_settings das 
    WHERE das.merchant_id = m.id AND das.setting_name = 'model'
);

INSERT INTO dynamic_ai_settings (merchant_id, setting_name, setting_value, setting_type) 
SELECT 
    m.id,
    'temperature',
    '0.8',
    'number'
FROM merchants m
WHERE NOT EXISTS (
    SELECT 1 FROM dynamic_ai_settings das 
    WHERE das.merchant_id = m.id AND das.setting_name = 'temperature'
);

INSERT INTO dynamic_ai_settings (merchant_id, setting_name, setting_value, setting_type) 
SELECT 
    m.id,
    'max_tokens',
    '600',
    'number'
FROM merchants m
WHERE NOT EXISTS (
    SELECT 1 FROM dynamic_ai_settings das 
    WHERE das.merchant_id = m.id AND das.setting_name = 'max_tokens'
);

INSERT INTO dynamic_ai_settings (merchant_id, setting_name, setting_value, setting_type) 
SELECT 
    m.id,
    'language',
    'ar',
    'string'
FROM merchants m
WHERE NOT EXISTS (
    SELECT 1 FROM dynamic_ai_settings das 
    WHERE das.merchant_id = m.id AND das.setting_name = 'language'
);

-- إدراج القيم الافتراضية
INSERT INTO dynamic_defaults (merchant_id, default_type, default_value, fallback_value) 
SELECT 
    m.id,
    'business_name',
    COALESCE(m.business_name, 'متجرنا'),
    'متجرنا'
FROM merchants m
WHERE NOT EXISTS (
    SELECT 1 FROM dynamic_defaults dd 
    WHERE dd.merchant_id = m.id AND dd.default_type = 'business_name'
);

INSERT INTO dynamic_defaults (merchant_id, default_type, default_value, fallback_value) 
SELECT 
    m.id,
    'currency',
    COALESCE(m.currency, 'IQD'),
    'IQD'
FROM merchants m
WHERE NOT EXISTS (
    SELECT 1 FROM dynamic_defaults dd 
    WHERE dd.merchant_id = m.id AND dd.default_type = 'currency'
);

INSERT INTO dynamic_defaults (merchant_id, default_type, default_value, fallback_value) 
SELECT 
    m.id,
    'merchant_type',
    COALESCE(m.merchant_type::text, 'other'),
    'other'
FROM merchants m
WHERE NOT EXISTS (
    SELECT 1 FROM dynamic_defaults dd 
    WHERE dd.merchant_id = m.id AND dd.default_type = 'merchant_type'
);

-- إدراج رسائل الخطأ الافتراضية
INSERT INTO dynamic_error_messages (merchant_id, error_type, message_template, variables, priority) 
SELECT 
    m.id,
    'fallback',
    'واضح! أعطيني تفاصيل أكثر (اسم المنتج/الكود أو اللي يدور ببالك) وأنا أجاوبك فوراً بمعلومة محددة.',
    '{}',
    1
FROM merchants m
WHERE NOT EXISTS (
    SELECT 1 FROM dynamic_error_messages dem 
    WHERE dem.merchant_id = m.id AND dem.error_type = 'fallback'
);

INSERT INTO dynamic_error_messages (merchant_id, error_type, message_template, variables, priority) 
SELECT 
    m.id,
    'timeout',
    'عذراً، واجهت مشكلة تقنية بسيطة. حاول مرة أخرى أو أخبرني بما تحتاجه وسأساعدك فوراً.',
    '{}',
    1
FROM merchants m
WHERE NOT EXISTS (
    SELECT 1 FROM dynamic_error_messages dem 
    WHERE dem.merchant_id = m.id AND dem.error_type = 'timeout'
);

INSERT INTO dynamic_error_messages (merchant_id, error_type, message_template, variables, priority) 
SELECT 
    m.id,
    'api_error',
    'حدث خطأ تقني مؤقت. يرجى المحاولة مرة أخرى أو التواصل معنا مباشرة.',
    '{}',
    1
FROM merchants m
WHERE NOT EXISTS (
    SELECT 1 FROM dynamic_error_messages dem 
    WHERE dem.merchant_id = m.id AND dem.error_type = 'api_error'
);

-- تعليقات على الجداول
COMMENT ON TABLE dynamic_response_templates IS 'قوالب الردود الديناميكية للتجار';
COMMENT ON TABLE dynamic_ai_settings IS 'إعدادات الذكاء الاصطناعي الديناميكية';
COMMENT ON TABLE dynamic_defaults IS 'القيم الافتراضية الديناميكية';
COMMENT ON TABLE dynamic_error_messages IS 'رسائل الخطأ الديناميكية';
COMMENT ON TABLE dynamic_system_settings IS 'إعدادات النظام الديناميكية';
