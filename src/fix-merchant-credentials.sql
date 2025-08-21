-- إنشاء جدول merchant_credentials المفقود
CREATE TABLE IF NOT EXISTS merchant_credentials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL,
    platform VARCHAR(20) NOT NULL CHECK (platform IN ('INSTAGRAM', 'WHATSAPP')),
    
    -- Instagram credentials
    instagram_user_id VARCHAR(100),
    instagram_page_id VARCHAR(100),
    instagram_token_encrypted TEXT,
    instagram_token_expires_at TIMESTAMPTZ,
    
    -- WhatsApp credentials  
    whatsapp_phone_number_id VARCHAR(100),
    whatsapp_access_token TEXT,
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    last_verified_at TIMESTAMPTZ,
    
    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Constraints
    UNIQUE(merchant_id, platform),
    UNIQUE(instagram_page_id) WHERE instagram_page_id IS NOT NULL,
    UNIQUE(whatsapp_phone_number_id) WHERE whatsapp_phone_number_id IS NOT NULL
);

-- إنشاء فهارس
CREATE INDEX IF NOT EXISTS idx_merchant_credentials_merchant_id ON merchant_credentials(merchant_id);
CREATE INDEX IF NOT EXISTS idx_merchant_credentials_instagram_page ON merchant_credentials(instagram_page_id) WHERE instagram_page_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_merchant_credentials_platform ON merchant_credentials(platform, is_active);