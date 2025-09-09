-- إنشاء الجداول الديناميكية المطلوبة
-- Dynamic Tables Creation

-- جدول قوالب الردود الديناميكية
CREATE TABLE IF NOT EXISTS dynamic_response_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL,
    template_type VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    variables TEXT[] DEFAULT '{}',
    priority INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT true,
    language VARCHAR(10) DEFAULT 'ar',
    usage_count INTEGER DEFAULT 0,
    success_rate DECIMAL(3,2) DEFAULT 0.0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- جدول إعدادات الذكاء الاصطناعي الديناميكية
CREATE TABLE IF NOT EXISTS dynamic_ai_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL,
    setting_name VARCHAR(100) NOT NULL,
    setting_value TEXT NOT NULL,
    setting_type VARCHAR(20) DEFAULT 'string',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(merchant_id, setting_name)
);

-- جدول القيم الافتراضية الديناميكية
CREATE TABLE IF NOT EXISTS dynamic_defaults (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL,
    default_type VARCHAR(50) NOT NULL,
    default_value TEXT NOT NULL,
    fallback_value TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(merchant_id, default_type)
);

-- جدول رسائل الخطأ الديناميكية
CREATE TABLE IF NOT EXISTS dynamic_error_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL,
    error_type VARCHAR(50) NOT NULL,
    message_template TEXT NOT NULL,
    variables TEXT[] DEFAULT '{}',
    priority INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT true,
    usage_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- إدراج بيانات افتراضية للتاجر الموجود
INSERT INTO dynamic_response_templates (merchant_id, template_type, content, variables, priority) 
VALUES (
    'dd90061a-a1ad-42de-be9b-1c9760d0de02'::uuid,
    'greeting',
    'مرحباً بك في متجرنا! كيف يمكنني مساعدتك اليوم؟',
    ARRAY['business_name'],
    1
) ON CONFLICT DO NOTHING;

-- إدراج إعدادات الذكاء الاصطناعي الافتراضية
INSERT INTO dynamic_ai_settings (merchant_id, setting_name, setting_value, setting_type) 
VALUES 
    ('dd90061a-a1ad-42de-be9b-1c9760d0de02'::uuid, 'model', 'gpt-4o', 'string'),
    ('dd90061a-a1ad-42de-be9b-1c9760d0de02'::uuid, 'temperature', '0.7', 'number'),
    ('dd90061a-a1ad-42de-be9b-1c9760d0de02'::uuid, 'max_tokens', '800', 'number'),
    ('dd90061a-a1ad-42de-be9b-1c9760d0de02'::uuid, 'language', 'ar', 'string')
ON CONFLICT (merchant_id, setting_name) DO NOTHING;

-- إدراج القيم الافتراضية
INSERT INTO dynamic_defaults (merchant_id, default_type, default_value, fallback_value) 
VALUES 
    ('dd90061a-a1ad-42de-be9b-1c9760d0de02'::uuid, 'business_name', 'متجر الأزياء الراقية', 'متجرنا'),
    ('dd90061a-a1ad-42de-be9b-1c9760d0de02'::uuid, 'currency', 'IQD', 'IQD'),
    ('dd90061a-a1ad-42de-be9b-1c9760d0de02'::uuid, 'merchant_type', 'fashion', 'other')
ON CONFLICT (merchant_id, default_type) DO NOTHING;

-- إدراج رسائل الخطأ الافتراضية
INSERT INTO dynamic_error_messages (merchant_id, error_type, message_template, variables, priority) 
VALUES 
    ('dd90061a-a1ad-42de-be9b-1c9760d0de02'::uuid, 'fallback', 'واضح! أعطيني تفاصيل أكثر (اسم المنتج/الكود أو اللي يدور ببالك) وأنا أجاوبك فوراً بمعلومة محددة.', '{}', 1),
    ('dd90061a-a1ad-42de-be9b-1c9760d0de02'::uuid, 'fallback', 'ممتاز! أخبرني أكثر عن ما تبحث عنه (النوع/المقاس/اللون) وسأساعدك بسرعة.', '{}', 2),
    ('dd90061a-a1ad-42de-be9b-1c9760d0de02'::uuid, 'fallback', 'رائع! وضح لي احتياجاتك بالتفصيل وسأجد لك الأنسب فوراً.', '{}', 3)
ON CONFLICT DO NOTHING;

-- إدراج قوالب ردود المنتجات
INSERT INTO dynamic_response_templates (merchant_id, template_type, content, variables, priority) 
VALUES 
    ('dd90061a-a1ad-42de-be9b-1c9760d0de02'::uuid, 'product_inquiry', 'لدينا {{product_name}} بسعر {{price}} {{currency}}. تحب تعرف تفاصيل أكثر عنه؟', ARRAY['product_name', 'price', 'currency'], 1),
    ('dd90061a-a1ad-42de-be9b-1c9760d0de02'::uuid, 'product_details', 'تفاصيل {{product_name}}:\n- السعر: {{price}} {{currency}}\n- المقاس: {{size}}\n- اللون: {{color}}\n- المادة: {{material}}\n\nتحب تضيفه للسلة؟', ARRAY['product_name', 'price', 'currency', 'size', 'color', 'material'], 1)
ON CONFLICT DO NOTHING;

COMMIT;
