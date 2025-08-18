-- ===============================================
-- Migration 001: Initial Schema
-- Creates all core tables for AI Sales Platform
-- ===============================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Handle pgvector extension with fallback for clusters that don't support it
DO $$ BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS vector;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'vector extension not available on this cluster';
  END;
END $$;

CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- Create audit function for tracking changes
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create function for generating order numbers
CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TEXT AS $$
DECLARE
    next_num INTEGER;
    year_part TEXT;
BEGIN
    year_part := EXTRACT(YEAR FROM CURRENT_DATE)::TEXT;
    
    SELECT COALESCE(MAX(CAST(SUBSTRING(order_number FROM 6) AS INTEGER)), 0) + 1
    INTO next_num
    FROM orders
    WHERE order_number LIKE year_part || '%';
    
    RETURN year_part || LPAD(next_num::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;

-- ===============================================
-- MERCHANTS TABLE
-- ===============================================

CREATE TABLE merchants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_name VARCHAR(255) NOT NULL,
    business_category VARCHAR(100) DEFAULT 'general',
    business_address TEXT,
    
    -- Contact Information
    whatsapp_number VARCHAR(20) UNIQUE NOT NULL,
    whatsapp_number_id VARCHAR(100) UNIQUE,
    instagram_username VARCHAR(100),
    instagram_user_id VARCHAR(100),
    email VARCHAR(255),
    
    -- Subscription Management
    subscription_status TEXT DEFAULT 'ACTIVE' CHECK (subscription_status IN ('ACTIVE', 'SUSPENDED', 'EXPIRED', 'TRIAL')),
    subscription_tier TEXT DEFAULT 'BASIC' CHECK (subscription_tier IN ('BASIC', 'PREMIUM', 'ENTERPRISE')),
    subscription_started_at TIMESTAMPTZ DEFAULT NOW(),
    subscription_expires_at TIMESTAMPTZ,
    
    -- Business Settings
    settings JSONB DEFAULT '{
        "working_hours": {
            "enabled": true,
            "timezone": "Asia/Baghdad",
            "schedule": {
                "sunday": {"open": "09:00", "close": "22:00", "enabled": true},
                "monday": {"open": "09:00", "close": "22:00", "enabled": true},
                "tuesday": {"open": "09:00", "close": "22:00", "enabled": true},
                "wednesday": {"open": "09:00", "close": "22:00", "enabled": true},
                "thursday": {"open": "09:00", "close": "22:00", "enabled": true},
                "friday": {"open": "14:00", "close": "22:00", "enabled": true},
                "saturday": {"open": "09:00", "close": "22:00", "enabled": false}
            }
        },
        "payment_methods": ["COD", "ZAIN_CASH", "ASIA_HAWALA"],
        "delivery_fees": {
            "inside_baghdad": 0,
            "outside_baghdad": 5
        },
        "auto_responses": {
            "welcome_message": "أهلاً وسهلاً! كيف أقدر أساعدك؟",
            "outside_hours": "نعتذر، المحل مغلق حالياً. أوقات العمل: 9 صباحاً - 10 مساءً"
        }
    }'::JSONB,
    
    -- Audit fields
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_activity_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Search optimization
    search_vector tsvector
);

-- Create indexes for merchants
CREATE INDEX idx_merchants_whatsapp ON merchants (whatsapp_number);
CREATE INDEX idx_merchants_subscription ON merchants (subscription_status, subscription_expires_at);
CREATE INDEX idx_merchants_activity ON merchants (last_activity_at DESC);
CREATE INDEX idx_merchants_search ON merchants USING GIN (search_vector);
CREATE INDEX idx_merchants_settings ON merchants USING GIN (settings);

-- ===============================================
-- PRODUCTS TABLE
-- ===============================================

CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    
    -- Product Information
    sku VARCHAR(100) NOT NULL,
    name_ar TEXT NOT NULL,
    name_en TEXT,
    description_ar TEXT,
    description_en TEXT,
    category VARCHAR(100) DEFAULT 'general',
    
    -- Pricing
    price_usd DECIMAL(10,2) NOT NULL CHECK (price_usd >= 0),
    cost_usd DECIMAL(10,2) CHECK (cost_usd >= 0),
    discount_percentage DECIMAL(5,2) DEFAULT 0 CHECK (discount_percentage >= 0 AND discount_percentage <= 100),
    
    -- Inventory Management
    stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
    stock_reserved INTEGER DEFAULT 0 CHECK (stock_reserved >= 0),
    min_stock_alert INTEGER DEFAULT 5,
    max_stock_limit INTEGER,
    
    -- Product Attributes
    attributes JSONB DEFAULT '{}',
    variants JSONB DEFAULT '[]',
    
    -- Media
    images JSONB DEFAULT '[]',
    videos JSONB DEFAULT '[]',
    
    -- SEO and Marketing
    tags TEXT[],
    is_featured BOOLEAN DEFAULT false,
    is_on_sale BOOLEAN DEFAULT false,
    sale_price_usd DECIMAL(10,2),
    sale_starts_at TIMESTAMPTZ,
    sale_ends_at TIMESTAMPTZ,
    
    -- Status
    status TEXT DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'DRAFT', 'OUT_OF_STOCK', 'DISCONTINUED')),
    
    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Search optimization
    search_vector tsvector,
    
    -- Constraints
    UNIQUE(merchant_id, sku),
    CHECK (sale_price_usd IS NULL OR sale_price_usd < price_usd)
);

-- Create indexes for products
CREATE INDEX idx_products_merchant ON products (merchant_id, status);
CREATE INDEX idx_products_category ON products (merchant_id, category, status);
CREATE INDEX idx_products_stock ON products (merchant_id, stock_quantity) WHERE status = 'ACTIVE';
CREATE INDEX idx_products_featured ON products (merchant_id, is_featured) WHERE is_featured = true;
CREATE INDEX idx_products_sale ON products (merchant_id, is_on_sale, sale_ends_at) WHERE is_on_sale = true;
CREATE INDEX idx_products_search ON products USING GIN (search_vector);
CREATE INDEX idx_products_attributes ON products USING GIN (attributes);
CREATE INDEX idx_products_tags ON products USING GIN (tags);

-- ===============================================
-- ORDERS TABLE
-- ===============================================

CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_number TEXT UNIQUE NOT NULL DEFAULT generate_order_number(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
    
    -- Customer Information
    customer_phone VARCHAR(20) NOT NULL,
    customer_name VARCHAR(255),
    customer_address TEXT NOT NULL,
    customer_notes TEXT,
    
    -- Order Details
    items JSONB NOT NULL,
    
    -- Pricing
    subtotal_amount DECIMAL(10,2) NOT NULL CHECK (subtotal_amount >= 0),
    discount_amount DECIMAL(10,2) DEFAULT 0 CHECK (discount_amount >= 0),
    delivery_fee DECIMAL(10,2) DEFAULT 0 CHECK (delivery_fee >= 0),
    total_amount DECIMAL(10,2) NOT NULL CHECK (total_amount >= 0),
    
    -- Order Management
    status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED')),
    payment_method TEXT DEFAULT 'COD' CHECK (payment_method IN ('COD', 'ZAIN_CASH', 'ASIA_HAWALA', 'BANK_TRANSFER')),
    payment_status TEXT DEFAULT 'PENDING' CHECK (payment_status IN ('PENDING', 'PAID', 'FAILED', 'REFUNDED')),
    
    -- Source Tracking
    order_source TEXT DEFAULT 'WHATSAPP' CHECK (order_source IN ('WHATSAPP', 'INSTAGRAM', 'MANUAL', 'WEBSITE')),
    conversation_id UUID,
    
    -- Delivery Information
    delivery_date DATE,
    delivery_time_slot TEXT,
    delivery_instructions TEXT,
    tracking_number TEXT,
    
    -- Internal Notes
    merchant_notes TEXT,
    admin_notes TEXT,
    
    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ,
    shipped_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    
    -- Check constraints
    CHECK (
        (status = 'CONFIRMED' AND confirmed_at IS NOT NULL) OR
        (status != 'CONFIRMED')
    ),
    CHECK (
        (status = 'SHIPPED' AND shipped_at IS NOT NULL) OR
        (status != 'SHIPPED')
    ),
    CHECK (
        (status = 'DELIVERED' AND delivered_at IS NOT NULL) OR
        (status != 'DELIVERED')
    ),
    CHECK (
        (status = 'CANCELLED' AND cancelled_at IS NOT NULL) OR
        (status != 'CANCELLED')
    )
);

-- Create indexes for orders
CREATE INDEX idx_orders_merchant ON orders (merchant_id, created_at DESC);
CREATE INDEX idx_orders_status ON orders (merchant_id, status, created_at DESC);
CREATE INDEX idx_orders_customer ON orders (merchant_id, customer_phone);
CREATE INDEX idx_orders_source ON orders (merchant_id, order_source, created_at DESC);
CREATE INDEX idx_orders_number ON orders (order_number);
CREATE INDEX idx_orders_delivery ON orders (delivery_date, status) WHERE status IN ('CONFIRMED', 'PROCESSING', 'SHIPPED');

-- ===============================================
-- CONVERSATIONS TABLE
-- ===============================================

CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    
    -- Customer Identification
    customer_phone VARCHAR(20),
    customer_instagram VARCHAR(100),
    customer_name VARCHAR(255),
    
    -- Platform Information
    platform TEXT NOT NULL CHECK (platform IN ('WHATSAPP', 'INSTAGRAM')),
    platform_thread_id TEXT,
    
    -- Conversation State
    conversation_stage TEXT DEFAULT 'GREETING' CHECK (
        conversation_stage IN (
            'GREETING', 'BROWSING', 'PRODUCT_INQUIRY', 'INTERESTED', 
            'NEGOTIATING', 'CONFIRMING', 'COLLECTING_INFO', 'COMPLETED', 
            'ABANDONED', 'SUPPORT'
        )
    ),
    
    -- AI Context
    session_data JSONB DEFAULT '{
        "cart": [],
        "preferences": {},
        "context": {},
        "intent": null,
        "last_product_viewed": null,
        "interaction_count": 0
    }'::JSONB,
    
    -- Conversation Metrics
    message_count INTEGER DEFAULT 0,
    ai_response_count INTEGER DEFAULT 0,
    avg_response_time_ms INTEGER,
    
    -- Outcome Tracking
    converted_to_order BOOLEAN DEFAULT false,
    order_id UUID REFERENCES orders(id),
    abandonment_reason TEXT,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_message_at TIMESTAMPTZ DEFAULT NOW(),
    last_ai_response_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    
    -- Ensure customer identification
    CHECK (customer_phone IS NOT NULL OR customer_instagram IS NOT NULL)
);

-- Create indexes for conversations
CREATE INDEX idx_conversations_merchant ON conversations (merchant_id, last_message_at DESC);
CREATE INDEX idx_conversations_platform ON conversations (merchant_id, platform, conversation_stage);
CREATE INDEX idx_conversations_customer_phone ON conversations (customer_phone, platform) WHERE customer_phone IS NOT NULL;
CREATE INDEX idx_conversations_customer_instagram ON conversations (customer_instagram, platform) WHERE customer_instagram IS NOT NULL;
CREATE INDEX idx_conversations_stage ON conversations (merchant_id, conversation_stage, last_message_at DESC);
CREATE INDEX idx_conversations_converted ON conversations (merchant_id, converted_to_order, created_at DESC);

-- ===============================================
-- MESSAGE_LOGS TABLE
-- ===============================================

CREATE TABLE message_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    
    -- Message Information
    direction TEXT NOT NULL CHECK (direction IN ('INCOMING', 'OUTGOING')),
    platform TEXT NOT NULL CHECK (platform IN ('WHATSAPP', 'INSTAGRAM')),
    message_type TEXT DEFAULT 'TEXT' CHECK (
        message_type IN ('TEXT', 'IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT', 'STICKER', 'LOCATION', 'CONTACT')
    ),
    
    -- Message Content
    content TEXT,
    media_url TEXT,
    media_caption TEXT,
    media_metadata JSONB,
    
    -- Platform-specific IDs
    platform_message_id TEXT,
    reply_to_message_id TEXT,
    
    -- AI Processing
    ai_processed BOOLEAN DEFAULT false,
    ai_response_time_ms INTEGER,
    ai_model_used TEXT,
    ai_tokens_used INTEGER,
    
    -- Status
    delivery_status TEXT DEFAULT 'PENDING' CHECK (
        delivery_status IN ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED')
    ),
    
    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    
    -- Search
    content_search tsvector
);

-- Create indexes for message_logs
CREATE INDEX idx_message_logs_conversation ON message_logs (conversation_id, created_at DESC);
CREATE INDEX idx_message_logs_platform ON message_logs (platform, direction, created_at DESC);
CREATE INDEX idx_message_logs_unprocessed ON message_logs (ai_processed, created_at) WHERE ai_processed = false AND direction = 'INCOMING';
CREATE INDEX idx_message_logs_search ON message_logs USING GIN (content_search);

-- ===============================================
-- TRIGGERS
-- ===============================================

-- Update search vector for merchants
CREATE OR REPLACE FUNCTION update_merchant_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector := 
        setweight(to_tsvector('arabic', COALESCE(NEW.business_name, '')), 'A') ||
        setweight(to_tsvector('arabic', COALESCE(NEW.business_category, '')), 'B') ||
        setweight(to_tsvector('simple', COALESCE(NEW.whatsapp_number, '')), 'C');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_merchant_search_vector
    BEFORE INSERT OR UPDATE ON merchants
    FOR EACH ROW EXECUTE FUNCTION update_merchant_search_vector();

-- Update search vector for products
CREATE OR REPLACE FUNCTION update_product_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector := 
        setweight(to_tsvector('arabic', COALESCE(NEW.name_ar, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.name_en, '')), 'A') ||
        setweight(to_tsvector('arabic', COALESCE(NEW.description_ar, '')), 'B') ||
        setweight(to_tsvector('arabic', COALESCE(NEW.category, '')), 'C') ||
        setweight(to_tsvector('simple', COALESCE(NEW.sku, '')), 'D') ||
        setweight(to_tsvector('arabic', array_to_string(NEW.tags, ' ')), 'D');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_product_search_vector
    BEFORE INSERT OR UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION update_product_search_vector();

-- Update content search for messages
CREATE OR REPLACE FUNCTION update_message_content_search()
RETURNS TRIGGER AS $$
BEGIN
    NEW.content_search := to_tsvector('arabic', COALESCE(NEW.content, '') || ' ' || COALESCE(NEW.media_caption, ''));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_message_content_search
    BEFORE INSERT OR UPDATE ON message_logs
    FOR EACH ROW EXECUTE FUNCTION update_message_content_search();

-- Updated_at triggers
CREATE TRIGGER trigger_merchants_updated_at
    BEFORE UPDATE ON merchants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_products_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_orders_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_conversations_updated_at
    BEFORE UPDATE ON conversations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ===============================================
-- MIGRATIONS TRACKING TABLE
-- ===============================================

CREATE TABLE IF NOT EXISTS migrations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    filename VARCHAR(255) NOT NULL,
    executed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Record this migration
INSERT INTO migrations (name, filename) VALUES ('Initial Schema', '001_initial_schema.sql');