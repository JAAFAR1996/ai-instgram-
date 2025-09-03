-- ===============================================
-- Full Schema Single-Transaction Bundle (auto-generated)
-- Generated: 2025-09-03T03:19:23.1599521+03:00
-- Source directory: src/database/migrations
-- Files count: 53
-- ===============================================
SET client_min_messages TO WARNING;
SET search_path TO public;
BEGIN;

-- ==== File: 001_initial_schema.sql ====\r\n
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

CREATE TABLE IF NOT EXISTS merchants (
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
            "welcome_message": "Ø£Ù‡Ù„Ø§Ù‹ ÙˆØ³Ù‡Ù„Ø§Ù‹! ÙƒÙŠÙ Ø£Ù‚Ø¯Ø± Ø£Ø³Ø§Ø¹Ø¯ÙƒØŸ",
            "outside_hours": "Ù†Ø¹ØªØ°Ø±ØŒ Ø§Ù„Ù…Ø­Ù„ Ù…ØºÙ„Ù‚ Ø­Ø§Ù„ÙŠØ§Ù‹. Ø£ÙˆÙ‚Ø§Øª Ø§Ù„Ø¹Ù…Ù„: 9 ØµØ¨Ø§Ø­Ø§Ù‹ - 10 Ù…Ø³Ø§Ø¡Ù‹"
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
CREATE INDEX IF NOT EXISTS idx_merchants_whatsapp ON merchants (whatsapp_number);
CREATE INDEX IF NOT EXISTS idx_merchants_subscription ON merchants (subscription_status, subscription_expires_at);
CREATE INDEX IF NOT EXISTS idx_merchants_activity ON merchants (last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_merchants_search ON merchants USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_merchants_settings ON merchants USING GIN (settings);

-- ===============================================
-- PRODUCTS TABLE
-- ===============================================

CREATE TABLE IF NOT EXISTS products (
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
CREATE INDEX IF NOT EXISTS idx_products_merchant ON products (merchant_id, status);
CREATE INDEX IF NOT EXISTS idx_products_category ON products (merchant_id, category, status);
CREATE INDEX IF NOT EXISTS idx_products_stock ON products (merchant_id, stock_quantity) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_products_featured ON products (merchant_id, is_featured) WHERE is_featured = true;
CREATE INDEX IF NOT EXISTS idx_products_sale ON products (merchant_id, is_on_sale, sale_ends_at) WHERE is_on_sale = true;
CREATE INDEX IF NOT EXISTS idx_products_search ON products USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_products_attributes ON products USING GIN (attributes);
CREATE INDEX IF NOT EXISTS idx_products_tags ON products USING GIN (tags);

-- ===============================================
-- ORDERS TABLE
-- ===============================================

CREATE TABLE IF NOT EXISTS orders (
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
CREATE INDEX IF NOT EXISTS idx_orders_merchant ON orders (merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (merchant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders (merchant_id, customer_phone);
CREATE INDEX IF NOT EXISTS idx_orders_source ON orders (merchant_id, order_source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_number ON orders (order_number);
CREATE INDEX IF NOT EXISTS idx_orders_delivery ON orders (delivery_date, status) WHERE status IN ('CONFIRMED', 'PROCESSING', 'SHIPPED');

-- ===============================================
-- CONVERSATIONS TABLE
-- ===============================================

CREATE TABLE IF NOT EXISTS conversations (
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
CREATE INDEX IF NOT EXISTS idx_conversations_merchant ON conversations (merchant_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_platform ON conversations (merchant_id, platform, conversation_stage);
CREATE INDEX IF NOT EXISTS idx_conversations_customer_phone ON conversations (customer_phone, platform) WHERE customer_phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_customer_instagram ON conversations (customer_instagram, platform) WHERE customer_instagram IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_stage ON conversations (merchant_id, conversation_stage, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_converted ON conversations (merchant_id, converted_to_order, created_at DESC);

-- ===============================================
-- MESSAGE_LOGS TABLE
-- ===============================================

CREATE TABLE IF NOT EXISTS message_logs (
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
CREATE INDEX IF NOT EXISTS idx_message_logs_conversation ON message_logs (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_logs_platform ON message_logs (platform, direction, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_logs_unprocessed ON message_logs (ai_processed, created_at) WHERE ai_processed = false AND direction = 'INCOMING';
CREATE INDEX IF NOT EXISTS idx_message_logs_search ON message_logs USING GIN (content_search);

-- ===============================================
-- TRIGGERS
-- ===============================================

-- Update search vector for merchants
CREATE OR REPLACE FUNCTION update_merchant_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector := 
        setweight(to_tsvector('simple', COALESCE(NEW.business_name, '')), 'A') ||
        setweight(to_tsvector('simple', COALESCE(NEW.business_category, '')), 'B') ||
        setweight(to_tsvector('simple', COALESCE(NEW.whatsapp_number, '')), 'C');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_merchant_search_vector ON merchants;
CREATE TRIGGER trigger_update_merchant_search_vector
    BEFORE INSERT OR UPDATE ON merchants
    FOR EACH ROW EXECUTE FUNCTION update_merchant_search_vector();

-- Update search vector for products
CREATE OR REPLACE FUNCTION update_product_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector := 
        setweight(to_tsvector('simple', COALESCE(NEW.name_ar, '')), 'A') ||
        setweight(to_tsvector('simple', COALESCE(NEW.name_en, '')), 'A') ||
        setweight(to_tsvector('simple', COALESCE(NEW.description_ar, '')), 'B') ||
        setweight(to_tsvector('simple', COALESCE(NEW.category, '')), 'C') ||
        setweight(to_tsvector('simple', COALESCE(NEW.sku, '')), 'D') ||
        setweight(to_tsvector('simple', array_to_string(NEW.tags, ' ')), 'D');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_product_search_vector ON products;
CREATE TRIGGER trigger_update_product_search_vector
    BEFORE INSERT OR UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION update_product_search_vector();

-- Update content search for messages
CREATE OR REPLACE FUNCTION update_message_content_search()
RETURNS TRIGGER AS $$
BEGIN
    NEW.content_search := to_tsvector('simple', COALESCE(NEW.content, '') || ' ' || COALESCE(NEW.media_caption, ''));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_message_content_search ON message_logs;
CREATE TRIGGER trigger_update_message_content_search
    BEFORE INSERT OR UPDATE ON message_logs
    FOR EACH ROW EXECUTE FUNCTION update_message_content_search();

-- Updated_at triggers
DROP TRIGGER IF EXISTS trigger_merchants_updated_at ON merchants;
CREATE TRIGGER trigger_merchants_updated_at
    BEFORE UPDATE ON merchants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_products_updated_at ON products;
CREATE TRIGGER trigger_products_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_orders_updated_at ON orders;
CREATE TRIGGER trigger_orders_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_conversations_updated_at ON conversations;
CREATE TRIGGER trigger_conversations_updated_at
    BEFORE UPDATE ON conversations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ===============================================
-- MIGRATIONS TRACKING TABLE
-- ===============================================

CREATE TABLE IF NOT EXISTS migrations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    filename VARCHAR(255) NOT NULL UNIQUE,
    executed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Record this migration

\r\n-- ==== End of: 001_initial_schema.sql ====\r\n
-- ==== File: 004_webhook_infrastructure.sql ====\r\n
-- ===============================================
-- Migration 004: Webhook Infrastructure - Production Ready
-- AI Sales Platform - Complete webhook system implementation
-- ===============================================

-- Prerequisites validation
DO $$
BEGIN
    -- Ensure merchants table exists (dependency from migration 001)
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'merchants') THEN
        RAISE EXCEPTION 'Migration 004 failed: merchants table missing. Run migration 001 first.';
    END IF;
    
    -- Ensure uuid-ossp extension is available
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'uuid-ossp') THEN
        RAISE EXCEPTION 'Migration 004 failed: uuid-ossp extension missing. Create extension first.';
    END IF;
    
    RAISE NOTICE 'Migration 004: Prerequisites validated successfully';
END $$;

-- ===============================================
-- 1. WEBHOOK_LOGS TABLE - Core event tracking
-- ===============================================

CREATE TABLE IF NOT EXISTS webhook_logs (
    -- Primary identification
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    
    -- Platform configuration (based on migration 017 requirements)
    platform VARCHAR(20) NOT NULL CHECK (platform IN ('facebook', 'whatsapp', 'instagram', 'meta', 'messenger')),
    
    -- Event identification and classification
    event_type VARCHAR(50) NOT NULL,
    event_id VARCHAR(100), -- For idempotency (from migration 007)
    
    -- Status tracking (based on migration 016 requirements)
    status VARCHAR(20) NOT NULL DEFAULT 'RECEIVED' 
        CHECK (status IN ('RECEIVED', 'PROCESSED', 'SUCCESS', 'FAILED', 'PENDING')),
    
    -- Payload and metadata storage
    details JSONB,
    payload JSONB, -- Raw webhook payload for debugging
    
    -- Instagram/Meta specific fields (from original migration 004)
    entry_id VARCHAR(100), -- Meta webhook entry ID
    message_id VARCHAR(100), -- Message ID from platform
    customer_id VARCHAR(100), -- Customer/sender ID from platform
    
    -- Processing metrics
    processing_time_ms INTEGER,
    retry_count INTEGER DEFAULT 0,
    
    -- Timestamps
    processed_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===============================================
-- 2. WEBHOOK_SUBSCRIPTIONS TABLE - Platform integration management
-- ===============================================

CREATE TABLE IF NOT EXISTS webhook_subscriptions (
    -- Primary identification
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    
    -- Platform configuration
    platform VARCHAR(20) NOT NULL CHECK (platform IN ('facebook', 'whatsapp', 'instagram', 'meta', 'messenger')),
    
    -- Webhook configuration
    webhook_url TEXT NOT NULL,
    verify_token VARCHAR(255) NOT NULL,
    subscription_fields TEXT[], -- Array of subscribed webhook fields
    app_secret VARCHAR(255), -- Platform app secret for validation
    
    -- Status management
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' 
        CHECK (status IN ('ACTIVE', 'INACTIVE', 'FAILED', 'PENDING')),
    
    -- Health and monitoring
    last_verified_at TIMESTAMPTZ,
    last_event_received_at TIMESTAMPTZ,
    error_count INTEGER DEFAULT 0,
    consecutive_failures INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===============================================
-- 3. WEBHOOK_DELIVERY_ATTEMPTS TABLE - Retry mechanism
-- ===============================================

CREATE TABLE IF NOT EXISTS webhook_delivery_attempts (
    -- Primary identification
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    webhook_log_id UUID NOT NULL REFERENCES webhook_logs(id) ON DELETE CASCADE,
    
    -- Retry configuration
    attempt_number INTEGER NOT NULL DEFAULT 1,
    max_retries INTEGER DEFAULT 3,
    
    -- Response tracking
    response_status INTEGER, -- HTTP status code
    response_body TEXT,
    response_headers JSONB,
    response_time_ms INTEGER,
    
    -- Error handling
    error_message TEXT,
    error_type VARCHAR(50), -- 'timeout', 'network', 'server_error', etc.
    error_details JSONB,
    
    -- Scheduling
    attempted_at TIMESTAMPTZ DEFAULT NOW(),
    next_retry_at TIMESTAMPTZ, -- When to retry next
    
    -- Success tracking
    success BOOLEAN DEFAULT FALSE,
    final_attempt BOOLEAN DEFAULT FALSE
);

-- ===============================================
-- PERFORMANCE INDEXES
-- ===============================================

-- webhook_logs indexes
CREATE INDEX IF NOT EXISTS idx_webhook_logs_merchant_platform 
ON webhook_logs (merchant_id, platform);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_status 
ON webhook_logs (status);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_processed_at 
ON webhook_logs (processed_at DESC);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_platform_time 
ON webhook_logs (platform, processed_at DESC);

-- Instagram/Meta specific indexes
CREATE INDEX IF NOT EXISTS idx_webhook_logs_entry_id 
ON webhook_logs (entry_id) WHERE entry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_webhook_logs_message_id 
ON webhook_logs (message_id) WHERE message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_webhook_logs_customer_id 
ON webhook_logs (customer_id) WHERE customer_id IS NOT NULL;

-- Idempotency index (from migration 007)
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_logs_platform_event_unique 
ON webhook_logs (platform, event_id) WHERE event_id IS NOT NULL;

-- Performance composite index
CREATE INDEX IF NOT EXISTS idx_webhook_logs_merchant_platform_status 
ON webhook_logs (merchant_id, platform, status, processed_at DESC);

-- webhook_subscriptions indexes
CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_merchant 
ON webhook_subscriptions (merchant_id);

CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_platform 
ON webhook_subscriptions (platform);

CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_status 
ON webhook_subscriptions (status);

CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_active 
ON webhook_subscriptions (merchant_id, platform) WHERE status = 'ACTIVE';

-- webhook_delivery_attempts indexes
CREATE INDEX IF NOT EXISTS idx_webhook_delivery_webhook_log 
ON webhook_delivery_attempts (webhook_log_id);

CREATE INDEX IF NOT EXISTS idx_webhook_delivery_attempted_at 
ON webhook_delivery_attempts (attempted_at DESC);

CREATE INDEX IF NOT EXISTS idx_webhook_delivery_next_retry 
ON webhook_delivery_attempts (next_retry_at) WHERE next_retry_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_webhook_delivery_failed_retries 
ON webhook_delivery_attempts (webhook_log_id, success) WHERE success = FALSE;

-- ===============================================
-- TRIGGERS AND FUNCTIONS
-- ===============================================

-- Function to update webhook_subscriptions updated_at timestamp
CREATE OR REPLACE FUNCTION update_webhook_subscription_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to update webhook_logs updated_at timestamp
CREATE OR REPLACE FUNCTION update_webhook_logs_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers
DROP TRIGGER IF EXISTS trigger_webhook_subscriptions_updated_at ON webhook_subscriptions;
CREATE TRIGGER trigger_webhook_subscriptions_updated_at
    BEFORE UPDATE ON webhook_subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION update_webhook_subscription_timestamp();

DROP TRIGGER IF EXISTS trigger_webhook_logs_updated_at ON webhook_logs;
CREATE TRIGGER trigger_webhook_logs_updated_at
    BEFORE UPDATE ON webhook_logs
    FOR EACH ROW
    EXECUTE FUNCTION update_webhook_logs_timestamp();

-- ===============================================
-- BUSINESS LOGIC FUNCTIONS
-- ===============================================

-- Function to clean up old webhook logs (retention policy)
CREATE OR REPLACE FUNCTION cleanup_old_webhook_logs(retention_days INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- Delete webhook logs older than retention period
    DELETE FROM webhook_logs 
    WHERE created_at < NOW() - (retention_days || ' days')::INTERVAL;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    -- Delete orphaned delivery attempts
    DELETE FROM webhook_delivery_attempts 
    WHERE webhook_log_id NOT IN (SELECT id FROM webhook_logs);
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to get webhook statistics
CREATE OR REPLACE FUNCTION get_webhook_stats(
    p_merchant_id UUID DEFAULT NULL,
    p_hours_back INTEGER DEFAULT 24
) RETURNS TABLE(
    platform VARCHAR(20),
    total_events BIGINT,
    successful_events BIGINT,
    failed_events BIGINT,
    pending_events BIGINT,
    success_rate NUMERIC,
    avg_processing_time_ms NUMERIC,
    last_event_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        wl.platform,
        COUNT(*) as total_events,
        COUNT(CASE WHEN wl.status = 'SUCCESS' THEN 1 END) as successful_events,
        COUNT(CASE WHEN wl.status IN ('FAILED', 'ERROR') THEN 1 END) as failed_events,
        COUNT(CASE WHEN wl.status = 'PENDING' THEN 1 END) as pending_events,
        CASE 
            WHEN COUNT(*) > 0 THEN 
                ROUND(
                    (COUNT(CASE WHEN wl.status = 'SUCCESS' THEN 1 END)::NUMERIC / COUNT(*)::NUMERIC) * 100, 
                    2
                )
            ELSE 0 
        END as success_rate,
        AVG(wl.processing_time_ms) as avg_processing_time_ms,
        MAX(wl.processed_at) as last_event_at
    FROM webhook_logs wl
    WHERE 
        (p_merchant_id IS NULL OR wl.merchant_id = p_merchant_id)
        AND wl.processed_at >= NOW() - (p_hours_back || ' hours')::INTERVAL
    GROUP BY wl.platform
    ORDER BY total_events DESC;
END;
$$ LANGUAGE plpgsql;

-- ===============================================
-- ROW LEVEL SECURITY (RLS) - Tenant Isolation
-- ===============================================

-- Enable RLS on all webhook tables
ALTER TABLE webhook_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_delivery_attempts ENABLE ROW LEVEL SECURITY;

-- RLS Policies for webhook_logs
DROP POLICY IF EXISTS webhook_logs_tenant_policy ON webhook_logs;
CREATE POLICY webhook_logs_tenant_policy ON webhook_logs
    FOR ALL USING (
        merchant_id = current_setting('app.current_merchant_id', true)::UUID
        OR current_setting('app.admin_mode', true) = 'true'
    );

-- RLS Policies for webhook_subscriptions
DROP POLICY IF EXISTS webhook_subscriptions_tenant_policy ON webhook_subscriptions;
CREATE POLICY webhook_subscriptions_tenant_policy ON webhook_subscriptions
    FOR ALL USING (
        merchant_id = current_setting('app.current_merchant_id', true)::UUID
        OR current_setting('app.admin_mode', true) = 'true'
    );

-- RLS Policies for webhook_delivery_attempts
DROP POLICY IF EXISTS webhook_delivery_attempts_tenant_policy ON webhook_delivery_attempts;
CREATE POLICY webhook_delivery_attempts_tenant_policy ON webhook_delivery_attempts
    FOR ALL USING (
        webhook_log_id IN (
            SELECT id FROM webhook_logs 
            WHERE merchant_id = current_setting('app.current_merchant_id', true)::UUID
        )
        OR current_setting('app.admin_mode', true) = 'true'
    );

-- ===============================================
-- MONITORING VIEWS
-- ===============================================

-- View for webhook statistics (from original migration)
CREATE OR REPLACE VIEW webhook_stats_view AS
SELECT 
    ws.merchant_id,
    ws.platform,
    ws.status as subscription_status,
    COUNT(wl.id) as total_events_24h,
    COUNT(CASE WHEN wl.status = 'SUCCESS' THEN 1 END) as successful_events_24h,
    COUNT(CASE WHEN wl.status IN ('FAILED', 'ERROR') THEN 1 END) as failed_events_24h,
    COUNT(CASE WHEN wl.status = 'RECEIVED' THEN 1 END) as received_events_24h,
    COUNT(CASE WHEN wl.status = 'PENDING' THEN 1 END) as pending_events_24h,
    CASE 
        WHEN COUNT(wl.id) > 0 THEN 
            ROUND(
                (COUNT(CASE WHEN wl.status IN ('SUCCESS', 'PROCESSED') THEN 1 END)::NUMERIC / COUNT(wl.id)::NUMERIC) * 100, 
                2
            )
        ELSE 0 
    END as success_rate_24h,
    MAX(wl.processed_at) as last_event_at,
    ws.last_verified_at,
    ws.webhook_url,
    ws.error_count,
    AVG(wl.processing_time_ms) as avg_processing_time_ms
FROM webhook_subscriptions ws
LEFT JOIN webhook_logs wl ON (
    ws.merchant_id = wl.merchant_id 
    AND ws.platform = wl.platform 
    AND wl.processed_at >= NOW() - INTERVAL '24 hours'
)
GROUP BY 
    ws.merchant_id, ws.platform, ws.status, 
    ws.last_verified_at, ws.webhook_url, ws.error_count;

-- View for webhook health monitoring
CREATE OR REPLACE VIEW webhook_health_view AS
SELECT 
    m.id as merchant_id,
    m.business_name,
    ws.platform,
    ws.status as subscription_status,
    CASE 
        WHEN ws.status = 'ACTIVE' AND ws.error_count = 0 THEN 'healthy'
        WHEN ws.status = 'ACTIVE' AND ws.error_count < 5 THEN 'degraded'
        WHEN ws.status = 'ACTIVE' AND ws.error_count >= 5 THEN 'critical'
        ELSE 'inactive'
    END as health_status,
    ws.last_event_received_at,
    ws.error_count,
    ws.consecutive_failures,
    CASE 
        WHEN ws.last_event_received_at IS NULL THEN 'never'
        WHEN ws.last_event_received_at < NOW() - INTERVAL '24 hours' THEN 'stale'
        WHEN ws.last_event_received_at < NOW() - INTERVAL '1 hour' THEN 'recent'
        ELSE 'active'
    END as activity_status
FROM merchants m
LEFT JOIN webhook_subscriptions ws ON m.id = ws.merchant_id
WHERE m.subscription_status = 'ACTIVE';

-- ===============================================
-- DOCUMENTATION AND COMMENTS
-- ===============================================

-- Table comments
COMMENT ON TABLE webhook_logs IS 'Core webhook event tracking for all platform integrations';
COMMENT ON TABLE webhook_subscriptions IS 'Active webhook subscriptions and their configuration';
COMMENT ON TABLE webhook_delivery_attempts IS 'Retry mechanism tracking for failed webhook deliveries';

-- Column comments
COMMENT ON COLUMN webhook_logs.event_id IS 'Unique event identifier for idempotency (SHA256 hash of raw payload)';
COMMENT ON COLUMN webhook_logs.entry_id IS 'Meta/Instagram webhook entry ID';
COMMENT ON COLUMN webhook_logs.message_id IS 'Platform-specific message identifier';
COMMENT ON COLUMN webhook_logs.customer_id IS 'Customer/sender ID from the platform';
COMMENT ON COLUMN webhook_subscriptions.subscription_fields IS 'Array of subscribed webhook fields (messages, messaging_postbacks, etc.)';

-- Function comments
COMMENT ON FUNCTION cleanup_old_webhook_logs(INTEGER) IS 'Cleanup function for webhook log retention policy';
COMMENT ON FUNCTION get_webhook_stats(UUID, INTEGER) IS 'Get comprehensive webhook statistics for monitoring';

-- View comments
COMMENT ON VIEW webhook_stats_view IS 'Comprehensive webhook statistics for dashboard display';
COMMENT ON VIEW webhook_health_view IS 'Webhook health monitoring for alerts and diagnostics';

-- ===============================================
-- MIGRATION COMPLETION
-- ===============================================

-- Analyze tables for query optimizer
ANALYZE webhook_logs;
ANALYZE webhook_subscriptions;
ANALYZE webhook_delivery_attempts;

-- Final validation
DO $$
DECLARE
    table_count INTEGER;
    index_count INTEGER;
    trigger_count INTEGER;
BEGIN
    -- Verify tables were created
    SELECT COUNT(*) INTO table_count
    FROM information_schema.tables 
    WHERE table_name IN ('webhook_logs', 'webhook_subscriptions', 'webhook_delivery_attempts');
    
    -- Verify indexes were created
    SELECT COUNT(*) INTO index_count
    FROM pg_indexes 
    WHERE tablename IN ('webhook_logs', 'webhook_subscriptions', 'webhook_delivery_attempts');
    
    -- Verify triggers were created
    SELECT COUNT(*) INTO trigger_count
    FROM information_schema.triggers 
    WHERE trigger_name IN ('trigger_webhook_subscriptions_updated_at', 'trigger_webhook_logs_updated_at');
    
    IF table_count < 3 THEN
        RAISE EXCEPTION 'Migration 004 failed: Expected 3 tables, found %', table_count;
    END IF;
    
    IF index_count < 10 THEN
        RAISE EXCEPTION 'Migration 004 failed: Insufficient indexes created, found %', index_count;
    END IF;
    
    IF trigger_count < 2 THEN
        RAISE EXCEPTION 'Migration 004 failed: Expected 2 triggers, found %', trigger_count;
    END IF;
    
    RAISE NOTICE 'Migration 004 completed successfully:';
    RAISE NOTICE '  - Tables created: %', table_count;
    RAISE NOTICE '  - Indexes created: %', index_count;
    RAISE NOTICE '  - Triggers created: %', trigger_count;
    RAISE NOTICE '  - RLS policies enabled: 3 tables';
    RAISE NOTICE '  - Views created: webhook_stats_view, webhook_health_view';
    RAISE NOTICE '  - Functions created: cleanup_old_webhook_logs, get_webhook_stats';
END $$;

\r\n-- ==== End of: 004_webhook_infrastructure.sql ====\r\n
-- ==== File: 005_message_logs_enhancements.sql ====\r\n
-- Message Logs Enhancements for Instagram Integration
-- Add AI-related and Instagram-specific columns

-- Add AI-related columns
ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS ai_confidence DECIMAL(3,2);
ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS ai_intent VARCHAR(50);
ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS processing_time_ms INTEGER;
ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Add indexes for new columns
CREATE INDEX IF NOT EXISTS idx_message_logs_ai_confidence ON message_logs (ai_confidence);
CREATE INDEX IF NOT EXISTS idx_message_logs_ai_intent ON message_logs (ai_intent);
CREATE INDEX IF NOT EXISTS idx_message_logs_metadata ON message_logs USING GIN (metadata);

-- Add comments for documentation
COMMENT ON COLUMN message_logs.ai_confidence IS 'AI confidence score (0.00-1.00) for generated responses';
COMMENT ON COLUMN message_logs.ai_intent IS 'Detected customer intent from AI analysis';
COMMENT ON COLUMN message_logs.processing_time_ms IS 'Time taken to process message in milliseconds';
COMMENT ON COLUMN message_logs.metadata IS 'Additional metadata (media info, quick replies, etc.)';

-- Update message_logs table constraints for Instagram message types (if not already updated)
ALTER TABLE message_logs DROP CONSTRAINT IF EXISTS message_logs_message_type_check;

ALTER TABLE message_logs ADD CONSTRAINT message_logs_message_type_check 
CHECK (message_type IN (
  'TEXT', 
  'IMAGE', 
  'VIDEO', 
  'AUDIO', 
  'DOCUMENT', 
  'STICKER', 
  'LOCATION', 
  'CONTACT',
  'STORY_REPLY',
  'STORY_MENTION', 
  'COMMENT',
  'TEMPLATE'
));

-- Add delivery status constraint if not exists
ALTER TABLE message_logs DROP CONSTRAINT IF EXISTS message_logs_delivery_status_check;

ALTER TABLE message_logs ADD CONSTRAINT message_logs_delivery_status_check 
CHECK (delivery_status IN (
  'PENDING',
  'SENT', 
  'DELIVERED',
  'READ',
  'FAILED',
  'EXPIRED'
));

-- Create view for AI message analytics
CREATE OR REPLACE VIEW ai_message_analytics AS
SELECT 
  m.id as merchant_id,
  m.business_name,
  c.platform,
  ml.ai_intent,
  COUNT(*) as message_count,
  AVG(ml.ai_confidence) as avg_confidence,
  AVG(ml.processing_time_ms) as avg_processing_time,
  COUNT(CASE WHEN ml.delivery_status = 'DELIVERED' THEN 1 END) as delivered_count,
  COUNT(CASE WHEN ml.delivery_status = 'READ' THEN 1 END) as read_count,
  ROUND(
    COUNT(CASE WHEN ml.delivery_status IN ('DELIVERED', 'READ') THEN 1 END)::numeric / 
    COUNT(*)::numeric * 100, 2
  ) as delivery_success_rate
FROM merchants m
JOIN conversations c ON m.id = c.merchant_id
JOIN message_logs ml ON c.id = ml.conversation_id
WHERE ml.direction = 'OUTGOING'
AND ml.ai_processed = true
GROUP BY m.id, m.business_name, c.platform, ml.ai_intent;

-- Create view for Instagram message statistics
CREATE OR REPLACE VIEW instagram_message_stats AS
SELECT 
  m.id as merchant_id,
  m.business_name,
  COUNT(*) as total_messages,
  COUNT(CASE WHEN ml.direction = 'OUTGOING' THEN 1 END) as sent_messages,
  COUNT(CASE WHEN ml.direction = 'INCOMING' THEN 1 END) as received_messages,
  COUNT(DISTINCT c.customer_instagram) as unique_customers,
  COUNT(CASE WHEN ml.message_type = 'TEXT' THEN 1 END) as text_messages,
  COUNT(CASE WHEN ml.message_type IN ('IMAGE', 'VIDEO', 'AUDIO') THEN 1 END) as media_messages,
  COUNT(CASE WHEN ml.message_type = 'TEMPLATE' THEN 1 END) as template_messages,
  COUNT(CASE WHEN ml.message_type IN ('STORY_REPLY', 'STORY_MENTION') THEN 1 END) as story_interactions,
  COUNT(CASE WHEN ml.message_type = 'COMMENT' THEN 1 END) as comment_interactions,
  AVG(LENGTH(ml.content)) as avg_message_length,
  MAX(ml.created_at) as last_message_at
FROM merchants m
JOIN conversations c ON m.id = c.merchant_id
JOIN message_logs ml ON c.id = ml.conversation_id
WHERE c.platform = 'INSTAGRAM'
GROUP BY m.id, m.business_name;

-- Create function to get message window status with Instagram support
CREATE OR REPLACE FUNCTION get_instagram_message_window_status(
  p_merchant_id UUID,
  p_customer_instagram VARCHAR(100)
)
RETURNS TABLE(
  can_send BOOLEAN,
  window_expires_at TIMESTAMPTZ,
  time_remaining_hours INTEGER,
  message_count INTEGER,
  response_count INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    mw.window_expires_at > NOW() as can_send,
    mw.window_expires_at,
    GREATEST(0, EXTRACT(EPOCH FROM (mw.window_expires_at - NOW()))/3600)::INTEGER as time_remaining_hours,
    mw.message_count_in_window,
    mw.merchant_response_count
  FROM message_windows mw
  WHERE mw.merchant_id = p_merchant_id
  AND mw.customer_instagram = p_customer_instagram
  AND mw.platform = 'INSTAGRAM'
  ORDER BY mw.updated_at DESC
  LIMIT 1;
  
  -- If no window found, return default values
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::TIMESTAMPTZ, 0, 0, 0;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Create function to update message delivery status
CREATE OR REPLACE FUNCTION update_message_delivery_status(
  p_platform_message_id VARCHAR(255),
  p_new_status VARCHAR(20)
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE message_logs 
  SET 
    delivery_status = p_new_status,
    updated_at = NOW()
  WHERE platform_message_id = p_platform_message_id;
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Note: Migration tracking is handled automatically by the migration runner

\r\n-- ==== End of: 005_message_logs_enhancements.sql ====\r\n
-- ==== File: 006_add_instagram_username_to_manychat.sql ====\r\n
-- ===============================================
-- Migration: Add instagram_username column to manychat_subscribers
-- Fixes missing column error for ManyChat integration
-- ===============================================

ALTER TABLE manychat_subscribers 
ADD COLUMN IF NOT EXISTS instagram_username VARCHAR(255);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_manychat_instagram_username 
ON manychat_subscribers(instagram_username);

-- Add comment for documentation
COMMENT ON COLUMN manychat_subscribers.instagram_username IS 'Instagram username (without @) for mapping between Instagram and ManyChat';
\r\n-- ==== End of: 006_add_instagram_username_to_manychat.sql ====\r\n
-- ==== File: 007_webhook_idempotency.sql ====\r\n
-- Migration: Add idempotency and performance optimizations to webhook_logs
-- Date: 2025-01-16
-- Purpose: Prevent duplicate webhook processing and optimize query performance

-- 1. Add event_id column for idempotency
ALTER TABLE webhook_logs 
ADD COLUMN IF NOT EXISTS event_id text;

-- 2. Create unique index for idempotency (platform + event_id must be unique)
CREATE UNIQUE INDEX IF NOT EXISTS ux_webhook_event 
ON webhook_logs(platform, event_id);

-- 3. Create performance indexes
CREATE INDEX IF NOT EXISTS idx_webhook_logs_merchant_id 
ON webhook_logs(merchant_id);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_processed_at 
ON webhook_logs(processed_at);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_event_type 
ON webhook_logs(event_type);

-- 4. Create composite index for common queries
CREATE INDEX IF NOT EXISTS idx_webhook_logs_merchant_platform_event 
ON webhook_logs(merchant_id, platform, event_type);

-- 5. Add comment to document the event_id column
COMMENT ON COLUMN webhook_logs.event_id IS 'SHA256 hash of raw webhook body for idempotency';

-- 6. Analyze table for query planner optimization
ANALYZE webhook_logs;
\r\n-- ==== End of: 007_webhook_idempotency.sql ====\r\n
-- ==== File: 011_instagram_production_features.sql ====\r\n
-- ===============================================
-- Instagram Production Features Migration
-- Production-safe features only - NO TESTING TABLES
-- ===============================================

-- Create hashtag_mentions table (production feature)
CREATE TABLE IF NOT EXISTS hashtag_mentions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id VARCHAR(255) NOT NULL,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    hashtag VARCHAR(255),
    mentioned_user VARCHAR(255),
    content TEXT NOT NULL,
    source VARCHAR(50) NOT NULL CHECK (source IN ('comment', 'dm', 'story', 'post')),
    sentiment VARCHAR(20) DEFAULT 'neutral' CHECK (sentiment IN ('positive', 'neutral', 'negative')),
    category VARCHAR(50) DEFAULT 'generic' CHECK (category IN ('product', 'brand', 'trend', 'event', 'generic')),
    mention_type VARCHAR(50) DEFAULT 'generic' CHECK (mention_type IN ('customer', 'influencer', 'competitor', 'brand', 'generic')),
    marketing_value VARCHAR(20) DEFAULT 'medium' CHECK (marketing_value IN ('low', 'medium', 'high')),
    engagement_potential VARCHAR(20) DEFAULT 'medium' CHECK (engagement_potential IN ('low', 'medium', 'high')),
    engagement_score DECIMAL(5,2) DEFAULT 50,
    user_id VARCHAR(255) NOT NULL,
    processing_status VARCHAR(20) DEFAULT 'processed' CHECK (processing_status IN ('pending', 'processed', 'failed')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(message_id, hashtag),
    UNIQUE(message_id, mentioned_user)
);

-- Create indexes for hashtag_mentions
CREATE INDEX IF NOT EXISTS idx_hashtag_mentions_merchant ON hashtag_mentions(merchant_id);
CREATE INDEX IF NOT EXISTS idx_hashtag_mentions_hashtag ON hashtag_mentions(hashtag) WHERE hashtag IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hashtag_mentions_user ON hashtag_mentions(mentioned_user) WHERE mentioned_user IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hashtag_mentions_source ON hashtag_mentions(source);
CREATE INDEX IF NOT EXISTS idx_hashtag_mentions_sentiment ON hashtag_mentions(sentiment);
CREATE INDEX IF NOT EXISTS idx_hashtag_mentions_marketing_value ON hashtag_mentions(marketing_value);

-- Create hashtag_strategies table for hashtag monitoring strategies
CREATE TABLE IF NOT EXISTS hashtag_strategies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    target_hashtags JSONB NOT NULL DEFAULT '[]',
    monitoring_keywords JSONB NOT NULL DEFAULT '[]',
    auto_response_rules JSONB NOT NULL DEFAULT '[]',
    campaign_goals JSONB NOT NULL DEFAULT '[]',
    success_metrics JSONB NOT NULL DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    last_executed_at TIMESTAMP WITH TIME ZONE,
    execution_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for hashtag_strategies
CREATE INDEX IF NOT EXISTS idx_hashtag_strategies_merchant ON hashtag_strategies(merchant_id);
CREATE INDEX IF NOT EXISTS idx_hashtag_strategies_active ON hashtag_strategies(is_active) WHERE is_active = TRUE;

-- Create hashtag_trends table for tracking hashtag popularity trends
CREATE TABLE IF NOT EXISTS hashtag_trends (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    hashtag VARCHAR(255) NOT NULL,
    date DATE NOT NULL,
    usage_count INTEGER DEFAULT 1,
    unique_users INTEGER DEFAULT 1,
    engagement_score DECIMAL(5,2) DEFAULT 0,
    sentiment_breakdown JSONB DEFAULT '{"positive": 0, "neutral": 0, "negative": 0}',
    growth_rate DECIMAL(5,2) DEFAULT 0, -- percentage change from previous period
    trending_score DECIMAL(5,2) DEFAULT 0,
    peak_usage_hour INTEGER, -- 0-23
    associated_keywords JSONB DEFAULT '[]',
    competitor_usage INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(merchant_id, hashtag, date)
);

-- Create indexes for hashtag_trends
CREATE INDEX IF NOT EXISTS idx_hashtag_trends_merchant ON hashtag_trends(merchant_id);
CREATE INDEX IF NOT EXISTS idx_hashtag_trends_hashtag ON hashtag_trends(hashtag);
CREATE INDEX IF NOT EXISTS idx_hashtag_trends_date ON hashtag_trends(date DESC);
CREATE INDEX IF NOT EXISTS idx_hashtag_trends_trending_score ON hashtag_trends(trending_score DESC);
CREATE INDEX IF NOT EXISTS idx_hashtag_trends_growth ON hashtag_trends(growth_rate DESC);

-- Create marketing_opportunities table for tracking marketing leads
CREATE TABLE IF NOT EXISTS marketing_opportunities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    opportunity_type VARCHAR(100) NOT NULL,
    source_platform VARCHAR(50) NOT NULL CHECK (source_platform IN ('INSTAGRAM', 'WHATSAPP', 'TELEGRAM')),
    source_content TEXT,
    hashtags JSONB DEFAULT '[]',
    mentions JSONB DEFAULT '[]',
    priority VARCHAR(20) DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
    status VARCHAR(20) DEFAULT 'NEW' CHECK (status IN ('NEW', 'REVIEWING', 'ACTIVE', 'COMPLETED', 'DISMISSED')),
    estimated_value DECIMAL(10,2),
    conversion_probability DECIMAL(5,2),
    assigned_to UUID REFERENCES merchants(id),
    action_items JSONB DEFAULT '[]',
    notes TEXT,
    deadline TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for marketing_opportunities
CREATE INDEX IF NOT EXISTS idx_marketing_opportunities_merchant ON marketing_opportunities(merchant_id);
CREATE INDEX IF NOT EXISTS idx_marketing_opportunities_priority ON marketing_opportunities(priority);
CREATE INDEX IF NOT EXISTS idx_marketing_opportunities_status ON marketing_opportunities(status);
CREATE INDEX IF NOT EXISTS idx_marketing_opportunities_platform ON marketing_opportunities(source_platform);
CREATE INDEX IF NOT EXISTS idx_marketing_opportunities_created ON marketing_opportunities(created_at DESC);

-- Create production-safe monitoring functions
CREATE OR REPLACE FUNCTION calculate_hashtag_engagement_score(
    merchant_uuid UUID,
    hashtag_name VARCHAR(255)
) RETURNS DECIMAL(5,2) AS $$
DECLARE
    engagement_score DECIMAL(5,2) := 0;
    mention_count INTEGER;
    positive_sentiment INTEGER;
    total_sentiment INTEGER;
BEGIN
    -- Count total mentions
    SELECT COUNT(*) INTO mention_count
    FROM hashtag_mentions
    WHERE merchant_id = merchant_uuid
    AND hashtag = hashtag_name;
    
    -- Count positive sentiment
    SELECT COUNT(*) INTO positive_sentiment
    FROM hashtag_mentions
    WHERE merchant_id = merchant_uuid
    AND hashtag = hashtag_name
    AND sentiment = 'positive';
    
    SELECT COUNT(*) INTO total_sentiment
    FROM hashtag_mentions
    WHERE merchant_id = merchant_uuid
    AND hashtag = hashtag_name
    AND sentiment IS NOT NULL;
    
    -- Calculate engagement score based on mentions and sentiment
    IF mention_count > 0 THEN
        engagement_score := mention_count * 10;
        
        IF total_sentiment > 0 THEN
            engagement_score := engagement_score + ((positive_sentiment::DECIMAL / total_sentiment) * 50);
        END IF;
    END IF;
    
    RETURN LEAST(100, engagement_score);
END;
$$ LANGUAGE plpgsql;

-- Create marketing opportunity assessment function
CREATE OR REPLACE FUNCTION assess_marketing_opportunity(
    merchant_uuid UUID,
    content TEXT,
    source_platform VARCHAR(50)
) RETURNS JSONB AS $$
DECLARE
    assessment JSONB;
    hashtag_count INTEGER;
    mention_count INTEGER;
    priority VARCHAR(20) := 'LOW';
    estimated_value DECIMAL(10,2) := 0;
BEGIN
    -- Count hashtags in content
    SELECT (LENGTH(content) - LENGTH(REPLACE(content, '#', ''))) INTO hashtag_count;
    
    -- Count mentions in content
    SELECT (LENGTH(content) - LENGTH(REPLACE(content, '@', ''))) INTO mention_count;
    
    -- Assess priority based on content analysis
    IF hashtag_count >= 3 OR mention_count >= 2 THEN
        priority := 'HIGH';
        estimated_value := 100.00;
    ELSIF hashtag_count >= 1 OR mention_count >= 1 THEN
        priority := 'MEDIUM';
        estimated_value := 50.00;
    ELSE
        priority := 'LOW';
        estimated_value := 10.00;
    END IF;
    
    -- Build assessment JSON
    assessment := jsonb_build_object(
        'priority', priority,
        'estimated_value', estimated_value,
        'hashtag_count', hashtag_count,
        'mention_count', mention_count,
        'conversion_probability', CASE 
            WHEN priority = 'HIGH' THEN 75
            WHEN priority = 'MEDIUM' THEN 50
            ELSE 25
        END,
        'recommended_actions', CASE
            WHEN priority = 'HIGH' THEN '["immediate_response", "engagement", "follow_up"]'::jsonb
            WHEN priority = 'MEDIUM' THEN '["response", "monitoring"]'::jsonb
            ELSE '["monitoring"]'::jsonb
        END
    );
    
    RETURN assessment;
END;
$$ LANGUAGE plpgsql;

-- Create production monitoring views
CREATE OR REPLACE VIEW hashtag_performance_dashboard AS
SELECT 
    hm.merchant_id,
    m.business_name,
    hm.hashtag,
    COUNT(*) as mention_count,
    COUNT(CASE WHEN hm.sentiment = 'positive' THEN 1 END) as positive_mentions,
    COUNT(CASE WHEN hm.sentiment = 'negative' THEN 1 END) as negative_mentions,
    AVG(hm.engagement_score) as avg_engagement_score,
    calculate_hashtag_engagement_score(hm.merchant_id, hm.hashtag) as calculated_engagement_score,
    MAX(hm.created_at) as last_mention,
    COUNT(DISTINCT hm.user_id) as unique_users
FROM hashtag_mentions hm
JOIN merchants m ON hm.merchant_id = m.id
WHERE hm.hashtag IS NOT NULL
GROUP BY hm.merchant_id, m.business_name, hm.hashtag
ORDER BY mention_count DESC, calculated_engagement_score DESC;

CREATE OR REPLACE VIEW marketing_opportunities_dashboard AS
SELECT 
    mo.merchant_id,
    m.business_name,
    mo.opportunity_type,
    mo.priority,
    mo.status,
    mo.source_platform,
    mo.estimated_value,
    mo.conversion_probability,
    mo.created_at,
    CASE 
        WHEN mo.deadline IS NOT NULL AND mo.deadline < NOW() THEN 'overdue'
        WHEN mo.deadline IS NOT NULL AND mo.deadline < NOW() + INTERVAL '24 hours' THEN 'urgent'
        ELSE 'normal'
    END as urgency_status
FROM marketing_opportunities mo
JOIN merchants m ON mo.merchant_id = m.id
WHERE mo.status NOT IN ('COMPLETED', 'DISMISSED')
ORDER BY 
    CASE mo.priority 
        WHEN 'URGENT' THEN 1
        WHEN 'HIGH' THEN 2
        WHEN 'MEDIUM' THEN 3
        ELSE 4
    END,
    mo.created_at DESC;

-- Add comments for documentation
COMMENT ON TABLE hashtag_mentions IS 'Production hashtag mentions tracking and sentiment analysis';
COMMENT ON TABLE hashtag_strategies IS 'Merchant hashtag monitoring and response strategies';
COMMENT ON TABLE hashtag_trends IS 'Hashtag popularity trends and growth analytics';
COMMENT ON TABLE marketing_opportunities IS 'Marketing leads and opportunities from social interactions';

-- Note: Migration tracking is handled automatically by the migration runner
\r\n-- ==== End of: 011_instagram_production_features.sql ====\r\n
-- ==== File: 013_add_utility_messages_tables.sql ====\r\n
-- ===============================================
-- Migration: Add Utility Messages Tables (2025 Feature)
-- Instagram Utility Messages: Order updates, notifications, reminders
-- ===============================================

-- Utility Message Templates Table
CREATE TABLE IF NOT EXISTS utility_message_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('ORDER_UPDATE', 'ACCOUNT_NOTIFICATION', 'APPOINTMENT_REMINDER', 'DELIVERY_NOTIFICATION', 'PAYMENT_UPDATE')),
    content TEXT NOT NULL,
    variables JSONB DEFAULT '[]'::jsonb,
    approved BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Indexes for performance
    CONSTRAINT utility_template_unique_name UNIQUE (merchant_id, name)
);

-- Create indexes for utility_message_templates
CREATE INDEX IF NOT EXISTS idx_utility_templates_merchant ON utility_message_templates(merchant_id);
CREATE INDEX IF NOT EXISTS idx_utility_templates_type ON utility_message_templates(type);
CREATE INDEX IF NOT EXISTS idx_utility_templates_approved ON utility_message_templates(approved);

-- Utility Message Logs Table (for compliance tracking)
CREATE TABLE IF NOT EXISTS utility_message_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    recipient_id VARCHAR(255) NOT NULL,
    template_id UUID NOT NULL REFERENCES utility_message_templates(id),
    message_id VARCHAR(255),
    message_type VARCHAR(50) NOT NULL,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for utility_message_logs
CREATE INDEX IF NOT EXISTS idx_utility_logs_merchant ON utility_message_logs(merchant_id);
CREATE INDEX IF NOT EXISTS idx_utility_logs_recipient ON utility_message_logs(recipient_id);
CREATE INDEX IF NOT EXISTS idx_utility_logs_template ON utility_message_logs(template_id);
CREATE INDEX IF NOT EXISTS idx_utility_logs_type ON utility_message_logs(message_type);
CREATE INDEX IF NOT EXISTS idx_utility_logs_sent_at ON utility_message_logs(sent_at);

-- Enhanced OAuth Security Table (2025 Enhancement)
CREATE TABLE IF NOT EXISTS oauth_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    state VARCHAR(255) NOT NULL,
    code_verifier VARCHAR(255),
    code_challenge VARCHAR(255),
    pkce_method VARCHAR(10) DEFAULT 'S256',
    redirect_uri TEXT NOT NULL,
    scopes TEXT[] DEFAULT ARRAY[]::TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '1 hour'),
    used BOOLEAN DEFAULT false,
    
    -- Security constraints
    CONSTRAINT oauth_state_unique UNIQUE (state),
    CONSTRAINT oauth_pkce_method_check CHECK (pkce_method IN ('S256', 'plain'))
);

-- Create indexes for oauth_sessions
CREATE INDEX IF NOT EXISTS idx_oauth_sessions_merchant ON oauth_sessions(merchant_id);
CREATE INDEX IF NOT EXISTS idx_oauth_sessions_state ON oauth_sessions(state);
CREATE INDEX IF NOT EXISTS idx_oauth_sessions_expires ON oauth_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_sessions_used ON oauth_sessions(used);

-- Update merchant_credentials table to support enhanced OAuth
ALTER TABLE merchant_credentials 
ADD COLUMN IF NOT EXISTS oauth_version VARCHAR(10) DEFAULT '2.0',
ADD COLUMN IF NOT EXISTS pkce_supported BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS last_security_audit TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS security_flags JSONB DEFAULT '{}'::jsonb;

-- Enhanced Instagram Integration Table
CREATE TABLE IF NOT EXISTS instagram_business_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    instagram_business_id VARCHAR(255) NOT NULL,
    instagram_username VARCHAR(255) NOT NULL,
    account_name VARCHAR(255),
    profile_picture_url TEXT,
    followers_count INTEGER DEFAULT 0,
    media_count INTEGER DEFAULT 0,
    access_token_encrypted TEXT NOT NULL,
    scopes TEXT[] DEFAULT ARRAY[]::TEXT[],
    token_expires_at TIMESTAMP WITH TIME ZONE,
    last_token_refresh TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    business_login_enabled BOOLEAN DEFAULT true, -- 2025 feature
    utility_messages_enabled BOOLEAN DEFAULT true, -- 2025 feature
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Unique constraints
    CONSTRAINT ig_business_unique UNIQUE (merchant_id),
    CONSTRAINT ig_business_id_unique UNIQUE (instagram_business_id)
);

-- Create indexes for instagram_business_accounts
CREATE INDEX IF NOT EXISTS idx_ig_business_merchant ON instagram_business_accounts(merchant_id);
CREATE INDEX IF NOT EXISTS idx_ig_business_username ON instagram_business_accounts(instagram_username);
CREATE INDEX IF NOT EXISTS idx_ig_business_token_expires ON instagram_business_accounts(token_expires_at);

-- Compliance Tracking Table (2025 Requirement)
CREATE TABLE IF NOT EXISTS compliance_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    compliance_type VARCHAR(50) NOT NULL CHECK (compliance_type IN ('WEBHOOK_VERIFICATION', 'OAUTH_SECURITY', 'DATA_ENCRYPTION', 'TOKEN_REFRESH', 'UTILITY_MESSAGE')),
    event_data JSONB NOT NULL,
    status VARCHAR(20) DEFAULT 'SUCCESS' CHECK (status IN ('SUCCESS', 'FAILED', 'WARNING')),
    meta_api_version VARCHAR(10) DEFAULT 'v23.0',
    security_level VARCHAR(20) DEFAULT 'STANDARD' CHECK (security_level IN ('BASIC', 'STANDARD', 'ENHANCED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for compliance_logs
CREATE INDEX IF NOT EXISTS idx_compliance_merchant ON compliance_logs(merchant_id);
CREATE INDEX IF NOT EXISTS idx_compliance_type ON compliance_logs(compliance_type);
CREATE INDEX IF NOT EXISTS idx_compliance_status ON compliance_logs(status);
CREATE INDEX IF NOT EXISTS idx_compliance_created ON compliance_logs(created_at);

-- Row Level Security (RLS) for all new tables
ALTER TABLE utility_message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE utility_message_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE instagram_business_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for utility_message_templates
DROP POLICY IF EXISTS utility_templates_merchant_access ON utility_message_templates;
CREATE POLICY utility_templates_merchant_access ON utility_message_templates
    FOR ALL USING (merchant_id = current_setting('app.current_merchant_id')::uuid);

-- RLS Policies for utility_message_logs
DROP POLICY IF EXISTS utility_logs_merchant_access ON utility_message_logs;
CREATE POLICY utility_logs_merchant_access ON utility_message_logs
    FOR ALL USING (merchant_id = current_setting('app.current_merchant_id')::uuid);

-- RLS Policies for oauth_sessions
DROP POLICY IF EXISTS oauth_sessions_merchant_access ON oauth_sessions;
CREATE POLICY oauth_sessions_merchant_access ON oauth_sessions
    FOR ALL USING (merchant_id = current_setting('app.current_merchant_id')::uuid);

-- RLS Policies for instagram_business_accounts
DROP POLICY IF EXISTS ig_business_merchant_access ON instagram_business_accounts;
CREATE POLICY ig_business_merchant_access ON instagram_business_accounts
    FOR ALL USING (merchant_id = current_setting('app.current_merchant_id')::uuid);

-- RLS Policies for compliance_logs
DROP POLICY IF EXISTS compliance_logs_merchant_access ON compliance_logs;
CREATE POLICY compliance_logs_merchant_access ON compliance_logs
    FOR ALL USING (merchant_id = current_setting('app.current_merchant_id')::uuid);

-- Admin policies (bypass RLS for admin users)
DROP POLICY IF EXISTS utility_templates_admin_access ON utility_message_templates;
CREATE POLICY utility_templates_admin_access ON utility_message_templates
    FOR ALL USING (current_setting('app.current_role', true) = 'admin');

DROP POLICY IF EXISTS utility_logs_admin_access ON utility_message_logs;
CREATE POLICY utility_logs_admin_access ON utility_message_logs
    FOR ALL USING (current_setting('app.current_role', true) = 'admin');

DROP POLICY IF EXISTS oauth_sessions_admin_access ON oauth_sessions;
CREATE POLICY oauth_sessions_admin_access ON oauth_sessions
    FOR ALL USING (current_setting('app.current_role', true) = 'admin');

DROP POLICY IF EXISTS ig_business_admin_access ON instagram_business_accounts;
CREATE POLICY ig_business_admin_access ON instagram_business_accounts
    FOR ALL USING (current_setting('app.current_role', true) = 'admin');

DROP POLICY IF EXISTS compliance_logs_admin_access ON compliance_logs;
CREATE POLICY compliance_logs_admin_access ON compliance_logs
    FOR ALL USING (current_setting('app.current_role', true) = 'admin');

-- Functions for automated maintenance
CREATE OR REPLACE FUNCTION cleanup_expired_oauth_sessions()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM oauth_sessions 
    WHERE expires_at < NOW() 
    OR (used = true AND created_at < NOW() - INTERVAL '24 hours');
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    INSERT INTO compliance_logs (
        merchant_id,
        compliance_type,
        event_data,
        status
    ) VALUES (
        '00000000-0000-0000-0000-000000000000'::uuid, -- System user
        'OAUTH_SECURITY',
        jsonb_build_object('deleted_sessions', deleted_count, 'cleanup_type', 'expired_oauth'),
        'SUCCESS'
    );
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply the trigger to relevant tables
DROP TRIGGER IF EXISTS update_utility_templates_updated_at ON utility_message_templates;
CREATE TRIGGER update_utility_templates_updated_at
    BEFORE UPDATE ON utility_message_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_ig_business_updated_at ON instagram_business_accounts;
CREATE TRIGGER update_ig_business_updated_at
    BEFORE UPDATE ON instagram_business_accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create a view for merchant dashboard (utility messages summary)
CREATE OR REPLACE VIEW merchant_utility_messages_summary AS
SELECT 
    m.id as merchant_id,
    m.business_name,
    COUNT(DISTINCT ut.id) as total_templates,
    COUNT(DISTINCT CASE WHEN ut.approved = true THEN ut.id END) as approved_templates,
    COUNT(DISTINCT ul.id) as total_sent,
    COUNT(DISTINCT CASE WHEN ul.sent_at >= NOW() - INTERVAL '30 days' THEN ul.id END) as sent_last_30_days,
    COUNT(DISTINCT CASE WHEN ul.sent_at >= NOW() - INTERVAL '7 days' THEN ul.id END) as sent_last_7_days,
    COUNT(DISTINCT CASE WHEN ul.sent_at >= CURRENT_DATE THEN ul.id END) as sent_today
FROM merchants m
LEFT JOIN utility_message_templates ut ON m.id = ut.merchant_id
LEFT JOIN utility_message_logs ul ON m.id = ul.merchant_id
GROUP BY m.id, m.business_name;

-- Grant appropriate permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON utility_message_templates TO authenticated;
GRANT SELECT, INSERT ON utility_message_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON oauth_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON instagram_business_accounts TO authenticated;
GRANT SELECT, INSERT ON compliance_logs TO authenticated;
GRANT SELECT ON merchant_utility_messages_summary TO authenticated;

-- Comments for documentation
COMMENT ON TABLE utility_message_templates IS 'Templates for Instagram utility messages (order updates, notifications, reminders) - 2025 Meta feature';
COMMENT ON TABLE utility_message_logs IS 'Compliance tracking for sent utility messages';
COMMENT ON TABLE oauth_sessions IS 'Enhanced OAuth sessions with PKCE support for 2025 security standards';
COMMENT ON TABLE instagram_business_accounts IS 'Instagram Business account details with 2025 Business Login features';
COMMENT ON TABLE compliance_logs IS 'Compliance tracking for Meta 2025 requirements';

-- Migration complete notification
DO $$
BEGIN
    RAISE NOTICE 'âœ… Migration 013: Utility Messages & Enhanced OAuth Security (2025) completed successfully';
    RAISE NOTICE 'ðŸ“Š Added tables: utility_message_templates, utility_message_logs, oauth_sessions, instagram_business_accounts, compliance_logs';
    RAISE NOTICE 'ðŸ”’ Applied Row Level Security policies to all new tables';
    RAISE NOTICE 'âš¡ Created indexes for optimal performance';
    RAISE NOTICE 'ðŸŽ¯ Ready for Instagram Utility Messages and enhanced OAuth 2025 features';
END $$;
\r\n-- ==== End of: 013_add_utility_messages_tables.sql ====\r\n
-- ==== File: 015_enable_rls.sql ====\r\n
-- ===============================================
-- Row Level Security (RLS) Migration - 2025 Standards
-- âœ… ØªÙØ¹ÙŠÙ„ Ø£Ù…Ø§Ù† Ù…ØªØ¹Ø¯Ø¯ Ø§Ù„Ù…Ø³ØªØ£Ø¬Ø±ÙŠÙ† ÙˆØ­Ù…Ø§ÙŠØ© Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª
-- ===============================================

-- 1. Create RLS helper functions
CREATE OR REPLACE FUNCTION current_merchant_id() 
RETURNS UUID AS $$
BEGIN
  -- Ø§Ù„Ø­ØµÙˆÙ„ Ø¹Ù„Ù‰ merchant_id Ù…Ù† Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Ø§Ù„Ø¬Ù„Ø³Ø©
  RETURN COALESCE(
    current_setting('app.current_merchant_id', true)::UUID,
    '00000000-0000-0000-0000-000000000000'::UUID
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Create admin bypass function
CREATE OR REPLACE FUNCTION is_admin_user()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN COALESCE(
    current_setting('app.is_admin', true)::BOOLEAN,
    false
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Enable RLS on all tenant-scoped tables
ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_metrics ENABLE ROW LEVEL SECURITY;

-- 4. Create RLS policies for merchants table
DROP POLICY IF EXISTS "merchants_tenant_isolation" ON merchants;
CREATE POLICY "merchants_tenant_isolation" ON merchants
  FOR ALL 
  TO ai_sales
  USING (id = current_merchant_id() OR is_admin_user());

DROP POLICY IF EXISTS "merchants_insert_own" ON merchants;
CREATE POLICY "merchants_insert_own" ON merchants
  FOR INSERT 
  TO ai_sales
  WITH CHECK (id = current_merchant_id() OR is_admin_user());

-- 5. Create RLS policies for merchant_credentials
DROP POLICY IF EXISTS "credentials_tenant_isolation" ON merchant_credentials;
CREATE POLICY "credentials_tenant_isolation" ON merchant_credentials
  FOR ALL 
  TO ai_sales
  USING (merchant_id = current_merchant_id() OR is_admin_user());

DROP POLICY IF EXISTS "credentials_insert_own" ON merchant_credentials;
CREATE POLICY "credentials_insert_own" ON merchant_credentials
  FOR INSERT 
  TO ai_sales
  WITH CHECK (merchant_id = current_merchant_id() OR is_admin_user());

-- 6. Create RLS policies for products
DROP POLICY IF EXISTS "products_tenant_isolation" ON products;
CREATE POLICY "products_tenant_isolation" ON products
  FOR ALL 
  TO ai_sales
  USING (merchant_id = current_merchant_id() OR is_admin_user());

DROP POLICY IF EXISTS "products_insert_own" ON products;
CREATE POLICY "products_insert_own" ON products
  FOR INSERT 
  TO ai_sales
  WITH CHECK (merchant_id = current_merchant_id() OR is_admin_user());

-- 7. Create RLS policies for orders
DROP POLICY IF EXISTS "orders_tenant_isolation" ON orders;
CREATE POLICY "orders_tenant_isolation" ON orders
  FOR ALL 
  TO ai_sales
  USING (merchant_id = current_merchant_id() OR is_admin_user());

DROP POLICY IF EXISTS "orders_insert_own" ON orders;
CREATE POLICY "orders_insert_own" ON orders
  FOR INSERT 
  TO ai_sales
  WITH CHECK (merchant_id = current_merchant_id() OR is_admin_user());

-- 8. Create RLS policies for conversations
DROP POLICY IF EXISTS "conversations_tenant_isolation" ON conversations;
CREATE POLICY "conversations_tenant_isolation" ON conversations
  FOR ALL 
  TO ai_sales
  USING (merchant_id = current_merchant_id() OR is_admin_user());

DROP POLICY IF EXISTS "conversations_insert_own" ON conversations;
CREATE POLICY "conversations_insert_own" ON conversations
  FOR INSERT 
  TO ai_sales
  WITH CHECK (merchant_id = current_merchant_id() OR is_admin_user());

-- 9. Create RLS policies for message_logs
DROP POLICY IF EXISTS "message_logs_tenant_isolation" ON message_logs;
CREATE POLICY "message_logs_tenant_isolation" ON message_logs
  FOR ALL 
  TO ai_sales
  USING (
    conversation_id IN (
      SELECT id FROM conversations 
      WHERE merchant_id = current_merchant_id()
    ) OR is_admin_user()
  );

DROP POLICY IF EXISTS "message_logs_insert_own" ON message_logs;
CREATE POLICY "message_logs_insert_own" ON message_logs
  FOR INSERT 
  TO ai_sales
  WITH CHECK (
    conversation_id IN (
      SELECT id FROM conversations 
      WHERE merchant_id = current_merchant_id()
    ) OR is_admin_user()
  );

-- 10. Create RLS policies for message_windows
DROP POLICY IF EXISTS "message_windows_tenant_isolation" ON message_windows;
CREATE POLICY "message_windows_tenant_isolation" ON message_windows
  FOR ALL 
  TO ai_sales
  USING (merchant_id = current_merchant_id() OR is_admin_user());

DROP POLICY IF EXISTS "message_windows_insert_own" ON message_windows;
CREATE POLICY "message_windows_insert_own" ON message_windows
  FOR INSERT 
  TO ai_sales
  WITH CHECK (merchant_id = current_merchant_id() OR is_admin_user());

-- 11. Create RLS policies for audit_logs
DROP POLICY IF EXISTS "audit_logs_tenant_isolation" ON audit_logs;
CREATE POLICY "audit_logs_tenant_isolation" ON audit_logs
  FOR ALL 
  TO ai_sales
  USING (
    merchant_id = current_merchant_id() 
    OR merchant_id IS NULL 
    OR is_admin_user()
  );

DROP POLICY IF EXISTS "audit_logs_insert_own" ON audit_logs;
CREATE POLICY "audit_logs_insert_own" ON audit_logs
  FOR INSERT 
  TO ai_sales
  WITH CHECK (
    merchant_id = current_merchant_id() 
    OR merchant_id IS NULL 
    OR is_admin_user()
  );

-- 12. Create RLS policies for quality_metrics
DROP POLICY IF EXISTS "quality_metrics_tenant_isolation" ON quality_metrics;
CREATE POLICY "quality_metrics_tenant_isolation" ON quality_metrics
  FOR ALL 
  TO ai_sales
  USING (merchant_id = current_merchant_id() OR is_admin_user());

DROP POLICY IF EXISTS "quality_metrics_insert_own" ON quality_metrics;
CREATE POLICY "quality_metrics_insert_own" ON quality_metrics
  FOR INSERT 
  TO ai_sales
  WITH CHECK (merchant_id = current_merchant_id() OR is_admin_user());

-- 13. Create helper function to set merchant context
CREATE OR REPLACE FUNCTION set_merchant_context(p_merchant_id UUID)
RETURNS VOID AS $$
BEGIN
  -- Ø§Ù„ØªØ­Ù‚Ù‚ Ù…Ù† ØµØ­Ø© merchant_id
  IF p_merchant_id IS NULL THEN
    RAISE EXCEPTION 'merchant_id cannot be null';
  END IF;
  
  -- ØªØ­Ø¯ÙŠØ¯ merchant_id Ù„Ù„Ø¬Ù„Ø³Ø©
  PERFORM set_config('app.current_merchant_id', p_merchant_id::TEXT, true);
  
  -- ØªØ³Ø¬ÙŠÙ„ ÙÙŠ Ø§Ù„Ø£Ø¯ÙˆØ§Øª
  PERFORM set_config('app.context_set_at', extract(epoch from now())::TEXT, true);
  
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 14. Create helper function to set admin context
CREATE OR REPLACE FUNCTION set_admin_context(p_is_admin BOOLEAN DEFAULT true)
RETURNS VOID AS $$
BEGIN
  PERFORM set_config('app.is_admin', p_is_admin::TEXT, true);
  
  IF p_is_admin THEN
    PERFORM set_config('app.admin_context_set_at', extract(epoch from now())::TEXT, true);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 15. Create function to clear security context
CREATE OR REPLACE FUNCTION clear_security_context()
RETURNS VOID AS $$
BEGIN
  PERFORM set_config('app.current_merchant_id', '', true);
  PERFORM set_config('app.is_admin', 'false', true);
  PERFORM set_config('app.context_set_at', '', true);
  PERFORM set_config('app.admin_context_set_at', '', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 16. Create validation function for RLS context
CREATE OR REPLACE FUNCTION validate_rls_context()
RETURNS TABLE(
  has_merchant_context BOOLEAN,
  merchant_id UUID,
  is_admin BOOLEAN,
  context_age_seconds NUMERIC
) AS $$
DECLARE
  ctx_set_at TEXT;
  ctx_timestamp NUMERIC;
BEGIN
  ctx_set_at := current_setting('app.context_set_at', true);
  
  IF ctx_set_at != '' THEN
    ctx_timestamp := ctx_set_at::NUMERIC;
  ELSE
    ctx_timestamp := 0;
  END IF;

  RETURN QUERY SELECT 
    current_setting('app.current_merchant_id', true) != '' as has_merchant_context,
    current_merchant_id() as merchant_id,
    is_admin_user() as is_admin,
    extract(epoch from now()) - ctx_timestamp as context_age_seconds;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 17. Create indexes for RLS performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_merchant_id_rls 
ON products (merchant_id) WHERE merchant_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_merchant_id_rls 
ON orders (merchant_id) WHERE merchant_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_merchant_id_rls 
ON conversations (merchant_id) WHERE merchant_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_message_windows_merchant_id_rls 
ON message_windows (merchant_id) WHERE merchant_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_merchant_id_rls 
ON audit_logs (merchant_id) WHERE merchant_id IS NOT NULL;

-- 18. Grant execute permissions on RLS functions
GRANT EXECUTE ON FUNCTION current_merchant_id() TO ai_sales;
GRANT EXECUTE ON FUNCTION is_admin_user() TO ai_sales;
GRANT EXECUTE ON FUNCTION set_merchant_context(UUID) TO ai_sales;
GRANT EXECUTE ON FUNCTION set_admin_context(BOOLEAN) TO ai_sales;
GRANT EXECUTE ON FUNCTION clear_security_context() TO ai_sales;
GRANT EXECUTE ON FUNCTION validate_rls_context() TO ai_sales;

-- 19. Create warning for missing context
CREATE OR REPLACE FUNCTION warn_missing_rls_context()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.current_merchant_id', true) = '' 
     AND NOT is_admin_user() THEN
    RAISE WARNING 'RLS context not set - queries may return empty results';
  END IF;
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 20. Add notices in logs
DO $$
BEGIN
  RAISE NOTICE 'âœ… RLS policies enabled on all tenant tables';
  RAISE NOTICE 'âœ… RLS helper functions created';
  RAISE NOTICE 'âœ… Performance indexes created';
  RAISE NOTICE 'âš ï¸  Remember to call set_merchant_context() before queries';
  RAISE NOTICE 'ðŸ“š Use validate_rls_context() to check current context';
END $$;
\r\n-- ==== End of: 015_enable_rls.sql ====\r\n
-- ==== File: 016_webhook_status_normalization.sql ====\r\n
-- ===============================================
-- Migration 016: Webhook Status Normalization
-- Normalizes webhook_logs status values to consistent format
-- ===============================================

-- Drop existing constraint if it exists
ALTER TABLE webhook_logs DROP CONSTRAINT IF EXISTS webhook_logs_status_check;

-- Add new constraint with normalized status values
ALTER TABLE webhook_logs
ADD CONSTRAINT webhook_logs_status_check
CHECK (status IN ('RECEIVED','PROCESSED','SUCCESS','FAILED','PENDING'));

-- Record this migration

\r\n-- ==== End of: 016_webhook_status_normalization.sql ====\r\n
-- ==== File: 017_fix_platform_case_sensitivity.sql ====\r\n
-- Migration 017: Fix Platform Case Sensitivity and Add Instagram Support
-- Date: 2025-08-18
-- Description: Update webhook_logs platform constraint to use lowercase and add missing platforms

BEGIN;

-- Log migration start
INSERT INTO migration_log (migration_id, started_at, description) 
VALUES ('017', NOW(), 'Fix platform case sensitivity and add Instagram support')
ON CONFLICT (migration_id) DO UPDATE SET started_at = NOW();

-- Step 1: Update existing data to lowercase (if any exists)
UPDATE webhook_logs 
SET platform = LOWER(platform)
WHERE platform IN ('INSTAGRAM', 'WHATSAPP', 'FACEBOOK', 'META');

UPDATE webhook_subscriptions 
SET platform = LOWER(platform)
WHERE platform IN ('INSTAGRAM', 'WHATSAPP', 'FACEBOOK', 'META');

-- Step 2: Drop existing constraints
ALTER TABLE webhook_logs 
DROP CONSTRAINT IF EXISTS webhook_logs_platform_check;

ALTER TABLE webhook_subscriptions 
DROP CONSTRAINT IF EXISTS webhook_subscriptions_platform_check;

-- Step 3: Add updated constraints with lowercase and extended platform support
ALTER TABLE webhook_logs 
ADD CONSTRAINT webhook_logs_platform_check 
CHECK (platform IN (
    'facebook',
    'whatsapp', 
    'instagram',
    'meta',
    'messenger'
));

ALTER TABLE webhook_subscriptions 
ADD CONSTRAINT webhook_subscriptions_platform_check 
CHECK (platform IN (
    'facebook',
    'whatsapp', 
    'instagram',
    'meta',
    'messenger'
));

-- Step 4: Add event_id column for idempotency (if not exists)
ALTER TABLE webhook_logs 
ADD COLUMN IF NOT EXISTS event_id VARCHAR(100);

-- Add unique constraint for idempotency
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_logs_platform_event_unique 
ON webhook_logs(platform, event_id);

-- Step 5: Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_webhook_logs_platform_status_new 
ON webhook_logs(platform, status, processed_at DESC);

-- Step 6: Verify the migration with test inserts
DO $
BEGIN
    -- Test lowercase platform values
    INSERT INTO webhook_logs (
        merchant_id, platform, event_type, event_id, status, details, processed_at
    ) VALUES (
        uuid_generate_v4(), 'instagram', 'test_event', 'migration-test-017-ig', 'TEST', '{"test": true}', NOW()
    ), (
        uuid_generate_v4(), 'whatsapp', 'test_event', 'migration-test-017-wa', 'TEST', '{"test": true}', NOW()
    ), (
        uuid_generate_v4(), 'facebook', 'test_event', 'migration-test-017-fb', 'TEST', '{"test": true}', NOW()
    );
    
    -- Clean up test data
    DELETE FROM webhook_logs WHERE event_id LIKE 'migration-test-017-%';
    
    RAISE NOTICE 'Platform case sensitivity fixed and verified successfully';
END $;

-- Step 7: Add helpful comments
COMMENT ON CONSTRAINT webhook_logs_platform_check ON webhook_logs 
IS 'Supported webhook platforms (lowercase): facebook, whatsapp, instagram, meta, messenger';

COMMENT ON CONSTRAINT webhook_subscriptions_platform_check ON webhook_subscriptions 
IS 'Supported webhook platforms (lowercase): facebook, whatsapp, instagram, meta, messenger';

-- Step 8: Update the view to handle new platforms
CREATE OR REPLACE VIEW webhook_stats_view AS
SELECT 
    ws.merchant_id,
    ws.platform,
    ws.status as subscription_status,
    COUNT(wl.id) as total_events_24h,
    COUNT(CASE WHEN wl.status = 'SUCCESS' THEN 1 END) as successful_events_24h,
    COUNT(CASE WHEN wl.status = 'ERROR' THEN 1 END) as failed_events_24h,
    COUNT(CASE WHEN wl.status = 'RECEIVED' THEN 1 END) as received_events_24h,
    CASE 
        WHEN COUNT(wl.id) > 0 THEN 
            ROUND((COUNT(CASE WHEN wl.status IN ('SUCCESS', 'RECEIVED') THEN 1 END)::numeric / COUNT(wl.id)::numeric) * 100, 2)
        ELSE 0 
    END as success_rate_24h,
    MAX(wl.processed_at) as last_event_at,
    ws.last_verified_at,
    ws.webhook_url
FROM webhook_subscriptions ws
LEFT JOIN webhook_logs wl ON ws.merchant_id = wl.merchant_id 
    AND ws.platform = wl.platform 
    AND wl.processed_at >= NOW() - INTERVAL '24 hours'
GROUP BY ws.merchant_id, ws.platform, ws.status, ws.last_verified_at, ws.webhook_url;

-- Update migration log
UPDATE migration_log 
SET completed_at = NOW(), status = 'SUCCESS' 
WHERE migration_id = '017';

COMMIT;

-- Log success
\echo 'Migration 017: Platform case sensitivity fixed and Instagram support added âœ…'
\r\n-- ==== End of: 017_fix_platform_case_sensitivity.sql ====\r\n
-- ==== File: 018_webhook_events_idempotency.sql ====\r\n
-- Migration: Create webhook_events table for idempotency
-- Date: 2025-01-20
-- Purpose: Implement production-grade webhook idempotency with composite primary key

-- Create webhook_events table with composite primary key for idempotency
CREATE TABLE IF NOT EXISTS webhook_events (
  event_id text NOT NULL,
  merchant_id uuid NOT NULL,
  platform varchar(20) NOT NULL CHECK (platform IN ('INSTAGRAM', 'WHATSAPP')),
  body_hash text NOT NULL,
  processed_at timestamp,
  created_at timestamp DEFAULT NOW() NOT NULL,
  
  -- Composite primary key ensures uniqueness per merchant+platform+event
  CONSTRAINT pk_webhook_events PRIMARY KEY (merchant_id, platform, event_id)
);

-- Index for faster lookups by event_id
CREATE INDEX IF NOT EXISTS idx_webhook_events_event_id 
ON webhook_events(event_id);

-- Index for processed_at queries
CREATE INDEX IF NOT EXISTS idx_webhook_events_processed_at 
ON webhook_events(processed_at);

-- Index for cleanup operations (created_at)
CREATE INDEX IF NOT EXISTS idx_webhook_events_created_at 
ON webhook_events(created_at);

-- Foreign key constraint to merchants table
ALTER TABLE webhook_events 
ADD CONSTRAINT fk_webhook_events_merchant 
FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE;

-- Add Row Level Security
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

-- RLS policy for merchant isolation
DROP POLICY IF EXISTS webhook_events_merchant_policy ON webhook_events;
CREATE POLICY webhook_events_merchant_policy ON webhook_events
FOR ALL 
TO authenticated_role
USING (merchant_id = current_setting('app.current_merchant_id')::uuid);

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON webhook_events TO authenticated_role;

-- Add comments for documentation
COMMENT ON TABLE webhook_events IS 'Webhook events tracking for idempotency - prevents duplicate processing';
COMMENT ON COLUMN webhook_events.event_id IS 'SHA256 hash of merchant_id + body for uniqueness';
COMMENT ON COLUMN webhook_events.body_hash IS 'SHA256 hash of request body for integrity';
COMMENT ON COLUMN webhook_events.processed_at IS 'When webhook processing completed successfully';

-- Analyze table for query optimization
ANALYZE webhook_events;

-- Create function to cleanup old webhook events (older than 7 days)
CREATE OR REPLACE FUNCTION cleanup_old_webhook_events() RETURNS void AS $$
BEGIN
  DELETE FROM webhook_events 
  WHERE created_at < NOW() - INTERVAL '7 days';
  
  RAISE NOTICE 'Cleaned up old webhook events older than 7 days';
END;
$$ LANGUAGE plpgsql;

-- Optional: Create scheduled cleanup (requires pg_cron extension)
-- SELECT cron.schedule('webhook-cleanup', '0 2 * * *', 'SELECT cleanup_old_webhook_events();');
\r\n-- ==== End of: 018_webhook_events_idempotency.sql ====\r\n
-- ==== File: 019_merchant_instagram_mapping_composite_key.sql ====\r\n
-- Migration: Fix merchant_credentials table with composite primary key
-- Date: 2025-01-20
-- Purpose: Implement composite primary key (merchant_id, instagram_page_id) for secure merchant-page mapping

BEGIN;

-- Ø¥Ø³Ù‚Ø§Ø· Ø§Ù„Ù…ÙØªØ§Ø­ Ø§Ù„Ø£Ø³Ø§Ø³ÙŠ Ø§Ù„Ù‚Ø¯ÙŠÙ… Ø¥Ù† ÙˆÙØ¬Ø¯
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'merchant_credentials'::regclass
      AND contype = 'p'
  ) THEN
    EXECUTE 'ALTER TABLE merchant_credentials DROP CONSTRAINT ' ||
            (SELECT conname FROM pg_constraint
             WHERE conrelid = 'merchant_credentials'::regclass AND contype='p');
    RAISE NOTICE 'Dropped existing primary key constraint';
  END IF;
END $$;

-- Ø¥Ù†Ø´Ø§Ø¡ Ø§Ù„Ø¬Ø¯ÙˆÙ„ Ø¥Ù† Ù„Ù… ÙŠÙƒÙ† Ù…ÙˆØ¬ÙˆØ¯Ø§Ù‹
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

-- Ø£Ø¶Ù Ø§Ù„Ø£Ø¹Ù…Ø¯Ø© Ø¥Ù† Ù„Ø²Ù… (Ù„Ù„Ø¬Ø¯Ø§ÙˆÙ„ Ø§Ù„Ù…ÙˆØ¬ÙˆØ¯Ø©)
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

-- ÙØ±Ø¶ NOT NULL Ø¹Ù„Ù‰ Ø§Ù„Ø¹Ù…ÙˆØ¯ÙŠÙ† Ø§Ù„Ù…Ø·Ù„ÙˆØ¨ÙŠÙ† Ù„Ù„Ù€ PK Ø§Ù„Ù…Ø±ÙƒØ¨
ALTER TABLE merchant_credentials
  ALTER COLUMN merchant_id SET NOT NULL,
  ALTER COLUMN instagram_page_id SET NOT NULL;

-- Ø¥Ù†Ø´Ø§Ø¡ PK Ù…Ø±ÙƒÙ‘Ø¨
ALTER TABLE merchant_credentials
  ADD CONSTRAINT pk_merchant_credentials PRIMARY KEY (merchant_id, instagram_page_id);

-- Ø¥Ø¶Ø§ÙØ© Foreign Key Ø¥Ù„Ù‰ Ø¬Ø¯ÙˆÙ„ merchants
ALTER TABLE merchant_credentials
  ADD CONSTRAINT fk_merchant_credentials_merchant
  FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE;

-- (Ø§Ø®ØªÙŠØ§Ø±ÙŠ) Ø¥Ø¨Ù‚Ø§Ø¡ UNIQUE Ø¹Ø§Ù„Ù…ÙŠ Ø¹Ù„Ù‰ instagram_page_id Ù„Ù…Ù†Ø¹ Ø±Ø¨Ø· Ù†ÙØ³ Ø§Ù„ØµÙØ­Ø© Ø¨Ø£ÙƒØ«Ø± Ù…Ù† ØªØ§Ø¬Ø±
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'merchant_credentials'::regclass
      AND contype = 'u'
      AND conname = 'uq_merchant_credentials_instagram_page_id'
  ) THEN
    EXECUTE 'ALTER TABLE merchant_credentials
             ADD CONSTRAINT uq_merchant_credentials_instagram_page_id
             UNIQUE (instagram_page_id);';
    RAISE NOTICE 'Added unique constraint on instagram_page_id';
  END IF;
END $$;

-- Ø¥Ù†Ø´Ø§Ø¡ Ø§Ù„ÙÙ‡Ø§Ø±Ø³ Ù„Ù„Ø£Ø¯Ø§Ø¡
CREATE INDEX IF NOT EXISTS idx_merchant_credentials_merchant_id
ON merchant_credentials(merchant_id);

CREATE INDEX IF NOT EXISTS idx_merchant_credentials_business_account_id 
ON merchant_credentials(instagram_business_account_id);

CREATE INDEX IF NOT EXISTS idx_merchant_credentials_token_encrypted 
ON merchant_credentials(instagram_token_encrypted) 
WHERE instagram_token_encrypted IS NOT NULL;

-- ØªÙØ¹ÙŠÙ„ RLS ÙˆØ³ÙŠØ§Ø³Ø© Ø§Ù„Ø¹Ø²Ù„ (Ù…Ø¹ Ø§Ù„ØªØ­Ù‚Ù‚ Ù…Ù† ÙˆØ¬ÙˆØ¯ Ø§Ù„Ø£Ø¯ÙˆØ§Ø±)
ALTER TABLE merchant_credentials ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Ø§Ù„ØªØ­Ù‚Ù‚ Ù…Ù† ÙˆØ¬ÙˆØ¯ app.current_merchant_id setting Ù‚Ø¨Ù„ Ø¥Ù†Ø´Ø§Ø¡ Ø§Ù„Ø³ÙŠØ§Ø³Ø§Øª
  IF EXISTS (
    SELECT 1 FROM pg_settings 
    WHERE name = 'app.current_merchant_id' OR 1=1 -- Ø§Ù„Ø³Ù…Ø§Ø­ Ø¨Ø§Ù„ØªÙ†ÙÙŠØ° Ø­ØªÙ‰ Ù„Ùˆ Ù„Ù… ØªÙƒÙ† Ù…ÙˆØ¬ÙˆØ¯Ø©
  ) THEN
    -- Ø¥Ù†Ø´Ø§Ø¡ Ø³ÙŠØ§Ø³Ø© Ø§Ù„Ø¹Ø²Ù„ Ø¥Ù† Ù„Ù… ØªÙƒÙ† Ù…ÙˆØ¬ÙˆØ¯Ø©
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE tablename='merchant_credentials'
        AND policyname='merchant_credentials_merchant_policy'
    ) THEN
      EXECUTE $$p$
        CREATE POLICY merchant_credentials_merchant_policy
        ON merchant_credentials
        FOR ALL
        USING (merchant_id = current_setting('app.current_merchant_id', true)::uuid);
      $$p$;
      RAISE NOTICE 'Created RLS policy for merchant isolation';
    END IF;
  ELSE
    RAISE NOTICE 'Warning: app.current_merchant_id GUC not configured, RLS policy not created';
  END IF;
END $$;

-- Ø¥Ø¶Ø§ÙØ© trigger Ù„Ù€ updated_at
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

-- Ø¥Ø¶Ø§ÙØ© ØªØ¹Ù„ÙŠÙ‚Ø§Øª Ù„Ù„ØªÙˆØ«ÙŠÙ‚
COMMENT ON TABLE merchant_credentials IS 'Merchant Instagram credentials with composite primary key for secure mapping';
COMMENT ON COLUMN merchant_credentials.merchant_id IS 'UUID of the merchant (part of composite PK)';
COMMENT ON COLUMN merchant_credentials.instagram_page_id IS 'Instagram page ID (part of composite PK)';
COMMENT ON COLUMN merchant_credentials.instagram_token_encrypted IS 'Encrypted Instagram access token';
COMMENT ON COLUMN merchant_credentials.webhook_verify_token IS 'Webhook verification token';

-- ØªØ­Ù„ÙŠÙ„ Ø§Ù„Ø¬Ø¯ÙˆÙ„ Ù„ØªØ­Ø³ÙŠÙ† Ø§Ù„Ø§Ø³ØªØ¹Ù„Ø§Ù…Ø§Øª
ANALYZE merchant_credentials;

COMMIT;

-- Ø¥Ø´Ø¹Ø§Ø±Ø§Øª Ø§Ù„Ù†Ø¬Ø§Ø­
DO $$
BEGIN
  RAISE NOTICE 'âœ… Migration 019: Merchant-Instagram mapping composite primary key implemented';
  RAISE NOTICE 'ðŸ”‘ Composite PK: (merchant_id, instagram_page_id)';
  RAISE NOTICE 'ðŸ”— Foreign Key: merchant_id -> merchants(id)';
  RAISE NOTICE 'ðŸ”’ Row Level Security configured (if GUC available)';
  RAISE NOTICE 'ðŸ“Š Indexes created for optimal performance';
END $$;
\r\n-- ==== End of: 019_merchant_instagram_mapping_composite_key.sql ====\r\n
-- ==== File: 019a_create_merchant_credentials_minimal.sql ====\r\n
-- ===============================================
-- 019a: Create merchant_credentials (minimal, fresh install)
-- Provides base table so later migrations (013, 023, 024, 025, 055) can alter safely
-- ===============================================

CREATE TABLE IF NOT EXISTS public.merchant_credentials (
  merchant_id UUID NOT NULL,
  instagram_page_id TEXT NOT NULL,
  -- minimal fields used by code; later migrations add more
  instagram_token_encrypted TEXT,
  whatsapp_token_encrypted TEXT,
  whatsapp_phone_number_id TEXT,
  webhook_verify_token TEXT,
  business_account_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pk_merchant_credentials PRIMARY KEY (merchant_id, instagram_page_id)
);

-- FK to merchants
ALTER TABLE public.merchant_credentials
  ADD CONSTRAINT fk_merchant_credentials_merchant
  FOREIGN KEY (merchant_id) REFERENCES public.merchants(id) ON DELETE CASCADE;

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_merchant_credentials_merchant_id 
  ON public.merchant_credentials(merchant_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_mc_merchant_page
  ON public.merchant_credentials (merchant_id, instagram_page_id);

-- Enable RLS (policies added in later migrations)
ALTER TABLE public.merchant_credentials ENABLE ROW LEVEL SECURITY;

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.update_mc_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_mc_updated_at ON public.merchant_credentials;
CREATE TRIGGER trigger_mc_updated_at
  BEFORE UPDATE ON public.merchant_credentials
  FOR EACH ROW
  EXECUTE FUNCTION public.update_mc_updated_at();


\r\n-- ==== End of: 019a_create_merchant_credentials_minimal.sql ====\r\n
-- ==== File: 020_comprehensive_rls_enhancement.sql ====\r\n
-- ===============================================
-- Comprehensive RLS Enhancement Migration
-- Extends RLS coverage to all remaining tables
-- ===============================================

-- 1. Enable RLS on any remaining tables that need tenant isolation
ALTER TABLE IF EXISTS webhook_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS queue_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS instagram_stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS instagram_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS instagram_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS service_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS utility_messages ENABLE ROW LEVEL SECURITY;

-- 2. Create/Update RLS policies for webhook_logs
DROP POLICY IF EXISTS "webhook_logs_tenant_isolation" ON webhook_logs;
CREATE POLICY "webhook_logs_tenant_isolation" ON webhook_logs
  FOR ALL 
  TO ai_sales
  USING (merchant_id = current_merchant_id() OR is_admin_user());

DROP POLICY IF EXISTS "webhook_logs_insert_own" ON webhook_logs;
CREATE POLICY "webhook_logs_insert_own" ON webhook_logs
  FOR INSERT 
  TO ai_sales
  WITH CHECK (merchant_id = current_merchant_id() OR is_admin_user());

-- 3. Update webhook_events RLS policies to use consistent role
DROP POLICY IF EXISTS webhook_events_merchant_policy ON webhook_events;
CREATE POLICY "webhook_events_tenant_isolation" ON webhook_events
  FOR ALL 
  TO ai_sales
  USING (merchant_id = current_merchant_id() OR is_admin_user());

DROP POLICY IF EXISTS "webhook_events_insert_own" ON webhook_events;
CREATE POLICY "webhook_events_insert_own" ON webhook_events
  FOR INSERT 
  TO ai_sales
  WITH CHECK (merchant_id = current_merchant_id() OR is_admin_user());

-- 4. Create RLS policies for queue_jobs (if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'queue_jobs') THEN
    EXECUTE 'CREATE POLICY "queue_jobs_tenant_isolation" ON queue_jobs
      FOR ALL 
      TO ai_sales
      USING (merchant_id = current_merchant_id() OR is_admin_user())';
    
    EXECUTE 'CREATE POLICY "queue_jobs_insert_own" ON queue_jobs
      FOR INSERT 
      TO ai_sales
      WITH CHECK (merchant_id = current_merchant_id() OR is_admin_user())';
  END IF;
END $$;

-- 5. Create RLS policies for instagram_stories (if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'instagram_stories') THEN
    EXECUTE 'CREATE POLICY "instagram_stories_tenant_isolation" ON instagram_stories
      FOR ALL 
      TO ai_sales
      USING (merchant_id = current_merchant_id() OR is_admin_user())';
    
    EXECUTE 'CREATE POLICY "instagram_stories_insert_own" ON instagram_stories
      FOR INSERT 
      TO ai_sales
      WITH CHECK (merchant_id = current_merchant_id() OR is_admin_user())';
  END IF;
END $$;

-- 6. Create RLS policies for instagram_comments (if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'instagram_comments') THEN
    EXECUTE 'CREATE POLICY "instagram_comments_tenant_isolation" ON instagram_comments
      FOR ALL 
      TO ai_sales
      USING (merchant_id = current_merchant_id() OR is_admin_user())';
    
    EXECUTE 'CREATE POLICY "instagram_comments_insert_own" ON instagram_comments
      FOR INSERT 
      TO ai_sales
      WITH CHECK (merchant_id = current_merchant_id() OR is_admin_user())';
  END IF;
END $$;

-- 7. Create RLS policies for instagram_media (if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'instagram_media') THEN
    EXECUTE 'CREATE POLICY "instagram_media_tenant_isolation" ON instagram_media
      FOR ALL 
      TO ai_sales
      USING (merchant_id = current_merchant_id() OR is_admin_user())';
    
    EXECUTE 'CREATE POLICY "instagram_media_insert_own" ON instagram_media
      FOR INSERT 
      TO ai_sales
      WITH CHECK (merchant_id = current_merchant_id() OR is_admin_user())';
  END IF;
END $$;

-- 8. Create RLS policies for service_controls (if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'service_controls') THEN
    EXECUTE 'CREATE POLICY "service_controls_tenant_isolation" ON service_controls
      FOR ALL 
      TO ai_sales
      USING (merchant_id = current_merchant_id() OR is_admin_user())';
    
    EXECUTE 'CREATE POLICY "service_controls_insert_own" ON service_controls
      FOR INSERT 
      TO ai_sales
      WITH CHECK (merchant_id = current_merchant_id() OR is_admin_user())';
  END IF;
END $$;

-- 9. Create RLS policies for utility_messages (if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'utility_messages') THEN
    EXECUTE 'CREATE POLICY "utility_messages_tenant_isolation" ON utility_messages
      FOR ALL 
      TO ai_sales
      USING (merchant_id = current_merchant_id() OR is_admin_user())';
    
    EXECUTE 'CREATE POLICY "utility_messages_insert_own" ON utility_messages
      FOR INSERT 
      TO ai_sales
      WITH CHECK (merchant_id = current_merchant_id() OR is_admin_user())';
  END IF;
END $$;

-- 10. Enhanced tenant context function with validation
CREATE OR REPLACE FUNCTION set_tenant_context(p_tenant_id UUID)
RETURNS VOID AS $$
DECLARE
  tenant_exists BOOLEAN;
BEGIN
  -- Validate that tenant exists
  SELECT EXISTS(SELECT 1 FROM merchants WHERE id = p_tenant_id) INTO tenant_exists;
  
  IF NOT tenant_exists THEN
    RAISE EXCEPTION 'Invalid tenant_id: %', p_tenant_id;
  END IF;
  
  -- Set the context
  PERFORM set_config('app.current_merchant_id', p_tenant_id::TEXT, true);
  PERFORM set_config('app.tenant_context_set_at', extract(epoch from now())::TEXT, true);
  
  RAISE NOTICE 'Tenant context set to: %', p_tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 11. Create function to validate all RLS policies
CREATE OR REPLACE FUNCTION validate_all_rls_policies()
RETURNS TABLE(
  table_name TEXT,
  rls_enabled BOOLEAN,
  policy_count INTEGER,
  has_tenant_isolation BOOLEAN,
  has_insert_check BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    t.tablename::TEXT,
    t.rowsecurity as rls_enabled,
    COALESCE(p.policy_count, 0) as policy_count,
    COALESCE(p.has_tenant_policy, false) as has_tenant_isolation,
    COALESCE(p.has_insert_policy, false) as has_insert_check
  FROM pg_tables t
  LEFT JOIN (
    SELECT 
      tablename,
      COUNT(*) as policy_count,
      COUNT(*) FILTER (WHERE policyname LIKE '%tenant_isolation%') > 0 as has_tenant_policy,
      COUNT(*) FILTER (WHERE policyname LIKE '%insert%') > 0 as has_insert_policy
    FROM pg_policies 
    WHERE schemaname = 'public'
    GROUP BY tablename
  ) p ON t.tablename = p.tablename
  WHERE t.schemaname = 'public'
    AND t.tablename NOT IN ('migrations', 'spatial_ref_sys')
  ORDER BY t.tablename;
END;
$$ LANGUAGE plpgsql;

-- 12. Create monitoring function for RLS context usage
CREATE OR REPLACE FUNCTION monitor_rls_context()
RETURNS TABLE(
  current_merchant UUID,
  is_admin BOOLEAN,
  context_set_at TIMESTAMPTZ,
  context_age_minutes NUMERIC,
  queries_count INTEGER
) AS $$
DECLARE
  ctx_set_at TEXT;
  ctx_timestamp NUMERIC;
BEGIN
  ctx_set_at := current_setting('app.tenant_context_set_at', true);
  
  IF ctx_set_at != '' THEN
    ctx_timestamp := ctx_set_at::NUMERIC;
  ELSE
    ctx_timestamp := extract(epoch from now());
  END IF;

  RETURN QUERY SELECT 
    current_merchant_id(),
    is_admin_user(),
    to_timestamp(ctx_timestamp),
    (extract(epoch from now()) - ctx_timestamp) / 60,
    0; -- Placeholder for query count - would need pg_stat_statements
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 13. Create additional performance indexes for RLS
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webhook_logs_merchant_id_rls 
ON webhook_logs (merchant_id) WHERE merchant_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webhook_events_merchant_id_rls 
ON webhook_events (merchant_id) WHERE merchant_id IS NOT NULL;

-- 14. Grant execute permissions on new functions
GRANT EXECUTE ON FUNCTION set_tenant_context(UUID) TO ai_sales;
GRANT EXECUTE ON FUNCTION validate_all_rls_policies() TO ai_sales;
GRANT EXECUTE ON FUNCTION monitor_rls_context() TO ai_sales;

-- 15. Create utility to reset all security context
CREATE OR REPLACE FUNCTION reset_security_context()
RETURNS VOID AS $$
BEGIN
  PERFORM clear_security_context();
  PERFORM set_config('app.tenant_context_set_at', '', true);
  
  RAISE NOTICE 'All security context cleared';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION reset_security_context() TO ai_sales;

-- 16. Log completion
DO $$
BEGIN
  RAISE NOTICE 'âœ… Comprehensive RLS enhancement completed';
  RAISE NOTICE 'âœ… All tenant tables now have RLS policies';
  RAISE NOTICE 'âœ… Enhanced context management functions created';
  RAISE NOTICE 'ðŸ“Š Run validate_all_rls_policies() to check coverage';
  RAISE NOTICE 'ðŸ” Use monitor_rls_context() to monitor usage';
END $$;

-- Record this migration

\r\n-- ==== End of: 020_comprehensive_rls_enhancement.sql ====\r\n
-- ==== File: 021_conversation_unique_index.sql ====\r\n
-- Migration 021: Ensure unique conversations per merchant/customer/platform
-- Adds unique index on (merchant_id, customer_instagram, platform)
BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'uq_conversations_merchant_instagram_platform'
    ) THEN
        CREATE UNIQUE INDEX IF NOT EXISTS uq_conversations_merchant_instagram_platform
        ON conversations(merchant_id, customer_instagram, platform)
        WHERE customer_instagram IS NOT NULL;
    END IF;
END $$;

COMMIT;
\r\n-- ==== End of: 021_conversation_unique_index.sql ====\r\n
-- ==== File: 022_pkce_verifiers_fallback.sql ====\r\n
-- Fallback table for PKCE verifiers when Redis is unavailable
CREATE TABLE IF NOT EXISTS pkce_verifiers (
    state VARCHAR(255) PRIMARY KEY,
    code_verifier VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '10 minutes')
);

CREATE INDEX IF NOT EXISTS idx_pkce_verifiers_expires ON pkce_verifiers(expires_at);

COMMENT ON TABLE pkce_verifiers IS 'Fallback storage for PKCE code verifiers when Redis is unavailable';
\r\n-- ==== End of: 022_pkce_verifiers_fallback.sql ====\r\n
-- ==== File: 023_add_business_account_id_to_merchant_credentials.sql ====\r\n
-- Migration 023: Add business_account_id and platform to merchant_credentials
ALTER TABLE merchant_credentials
  ADD COLUMN IF NOT EXISTS business_account_id TEXT,
  ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'INSTAGRAM' CHECK (platform IN ('INSTAGRAM', 'WHATSAPP'));

-- Update existing records to have INSTAGRAM platform if null
UPDATE merchant_credentials 
SET platform = 'INSTAGRAM' 
WHERE platform IS NULL;

-- Make platform NOT NULL after setting default values
ALTER TABLE merchant_credentials 
  ALTER COLUMN platform SET NOT NULL;

-- Create unique index for ON CONFLICT support
CREATE UNIQUE INDEX IF NOT EXISTS ux_mc_merchant_page
  ON merchant_credentials (merchant_id, instagram_page_id);


\r\n-- ==== End of: 023_add_business_account_id_to_merchant_credentials.sql ====\r\n
-- ==== File: 024_unique_index_merchant_credentials.sql ====\r\n
-- Migration 024: Add unique index for merchant credentials ON CONFLICT
-- This ensures PostgreSQL can match the ON CONFLICT specification

DO $$
BEGIN
  -- Check if the unique index exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE indexname = 'ux_mc_merchant_page'
  ) THEN
    -- Create the unique index for ON CONFLICT constraint matching
CREATE UNIQUE INDEX IF NOT EXISTS ux_mc_merchant_page
    ON merchant_credentials (merchant_id, instagram_page_id);
    
    RAISE NOTICE 'Created unique index ux_mc_merchant_page on merchant_credentials (merchant_id, instagram_page_id)';
  ELSE
    RAISE NOTICE 'Unique index ux_mc_merchant_page already exists, skipping';
  END IF;
END $$;

-- Add comment for documentation
COMMENT ON INDEX ux_mc_merchant_page IS 'Unique constraint for merchant credentials per Instagram page - required for ON CONFLICT clauses';
\r\n-- ==== End of: 024_unique_index_merchant_credentials.sql ====\r\n
-- ==== File: 025_implement_rls_policies.sql ====\r\n
-- Migration 025: Implement RLS policies with SET LOCAL tenant isolation
-- Production-grade row-level security for multi-tenant isolation

DO $$
BEGIN
  -- Enable RLS on core tenant tables
  ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
  ALTER TABLE merchant_credentials ENABLE ROW LEVEL SECURITY;
  ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
  ALTER TABLE message_logs ENABLE ROW LEVEL SECURITY;
  ALTER TABLE products ENABLE ROW LEVEL SECURITY;
  ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
  ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;
  ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
  ALTER TABLE instagram_stories ENABLE ROW LEVEL SECURITY;
  ALTER TABLE instagram_comments ENABLE ROW LEVEL SECURITY;
  ALTER TABLE instagram_media ENABLE ROW LEVEL SECURITY;
  ALTER TABLE utility_messages ENABLE ROW LEVEL SECURITY;
  
  RAISE NOTICE 'Enabled RLS on all tenant tables';
END $$;

-- Create RLS policies for merchants table
DROP POLICY IF EXISTS tenant_isolation_merchants ON merchants;
CREATE POLICY tenant_isolation_merchants ON merchants
  FOR ALL
  USING (id::text = current_setting('app.current_merchant_id', true));

-- Create RLS policies for merchant_credentials table  
DROP POLICY IF EXISTS tenant_isolation_merchant_credentials ON merchant_credentials;
CREATE POLICY tenant_isolation_merchant_credentials ON merchant_credentials
  FOR ALL  
  USING (merchant_id::text = current_setting('app.current_merchant_id', true));

-- Create RLS policies for conversations table
DROP POLICY IF EXISTS tenant_isolation_conversations ON conversations;
CREATE POLICY tenant_isolation_conversations ON conversations
  FOR ALL
  USING (merchant_id::text = current_setting('app.current_merchant_id', true));

-- Create RLS policies for message_logs table
DROP POLICY IF EXISTS tenant_isolation_message_logs ON message_logs;
CREATE POLICY tenant_isolation_message_logs ON message_logs
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM conversations c 
      WHERE c.id = message_logs.conversation_id 
      AND c.merchant_id::text = current_setting('app.current_merchant_id', true)
    )
  );

-- Create RLS policies for products table
DROP POLICY IF EXISTS tenant_isolation_products ON products;
CREATE POLICY tenant_isolation_products ON products
  FOR ALL
  USING (merchant_id::text = current_setting('app.current_merchant_id', true));

-- Create RLS policies for orders table  
DROP POLICY IF EXISTS tenant_isolation_orders ON orders;
CREATE POLICY tenant_isolation_orders ON orders
  FOR ALL
  USING (merchant_id::text = current_setting('app.current_merchant_id', true));

-- Create RLS policies for analytics_events table
DROP POLICY IF EXISTS tenant_isolation_analytics_events ON analytics_events;
CREATE POLICY tenant_isolation_analytics_events ON analytics_events
  FOR ALL
  USING (merchant_id::text = current_setting('app.current_merchant_id', true));

-- Create RLS policies for webhook_events table
DROP POLICY IF EXISTS tenant_isolation_webhook_events ON webhook_events;
CREATE POLICY tenant_isolation_webhook_events ON webhook_events
  FOR ALL
  USING (merchant_id::text = current_setting('app.current_merchant_id', true));

-- Create RLS policies for instagram_stories table
DROP POLICY IF EXISTS tenant_isolation_instagram_stories ON instagram_stories;
CREATE POLICY tenant_isolation_instagram_stories ON instagram_stories
  FOR ALL
  USING (merchant_id::text = current_setting('app.current_merchant_id', true));

-- Create RLS policies for instagram_comments table
DROP POLICY IF EXISTS tenant_isolation_instagram_comments ON instagram_comments;
CREATE POLICY tenant_isolation_instagram_comments ON instagram_comments
  FOR ALL
  USING (merchant_id::text = current_setting('app.current_merchant_id', true));

-- Create RLS policies for instagram_media table
DROP POLICY IF EXISTS tenant_isolation_instagram_media ON instagram_media;
CREATE POLICY tenant_isolation_instagram_media ON instagram_media
  FOR ALL
  USING (merchant_id::text = current_setting('app.current_merchant_id', true));

-- Create RLS policies for utility_messages table
DROP POLICY IF EXISTS tenant_isolation_utility_messages ON utility_messages;
CREATE POLICY tenant_isolation_utility_messages ON utility_messages
  FOR ALL
  USING (merchant_id::text = current_setting('app.current_merchant_id', true));

-- Add admin bypass policy for all tables
DO $$
DECLARE
  table_name TEXT;
  table_names TEXT[] := ARRAY[
    'merchants', 'merchant_credentials', 'conversations', 'message_logs',
    'products', 'orders', 'analytics_events', 'webhook_events',
    'instagram_stories', 'instagram_comments', 'instagram_media', 'utility_messages'
  ];
BEGIN
  FOREACH table_name IN ARRAY table_names
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS admin_bypass_%s ON %s', table_name, table_name);
    EXECUTE format('CREATE POLICY admin_bypass_%s ON %s FOR ALL USING (current_setting(''app.admin_mode'', true) = ''true'')', table_name, table_name);
  END LOOP;
  
  RAISE NOTICE 'Created admin bypass policies for all tables';
END $$;

-- Add comments for documentation
COMMENT ON POLICY tenant_isolation_merchants ON merchants IS 'RLS policy for tenant isolation using app.current_merchant_id';
COMMENT ON POLICY tenant_isolation_conversations ON conversations IS 'RLS policy for tenant isolation on conversations';
COMMENT ON POLICY admin_bypass_merchants ON merchants IS 'Admin bypass policy when app.admin_mode is true';
\r\n-- ==== End of: 025_implement_rls_policies.sql ====\r\n
-- ==== File: 028_add_missing_columns.sql ====\r\n
/**
 * Migration 028: Add Missing Columns for Tests
 * Adds is_active columns to merchants and conversations tables
 */

-- Add is_active column to merchants table
ALTER TABLE merchants 
ADD COLUMN is_active BOOLEAN DEFAULT true;

-- Update existing merchants to be active
UPDATE merchants 
SET is_active = true
WHERE is_active IS NULL;

-- Add is_active column to conversations table  
ALTER TABLE conversations
ADD COLUMN is_active BOOLEAN DEFAULT true;

-- Update existing conversations to be active
UPDATE conversations
SET is_active = true  
WHERE is_active IS NULL;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_merchants_is_active ON merchants(is_active);
CREATE INDEX IF NOT EXISTS idx_conversations_is_active ON conversations(is_active);

-- Add comments for documentation
COMMENT ON COLUMN merchants.is_active IS 'Whether this merchant account is active';
COMMENT ON COLUMN conversations.is_active IS 'Whether this conversation is currently active';
\r\n-- ==== End of: 028_add_missing_columns.sql ====\r\n
-- ==== File: 030_add_missing_tables.sql ====\r\n
/**
 * Migration 030: Add Missing Tables for Tests
 * Creates webhook_events and service_errors tables needed for tests
 */

-- Create webhook_events table
CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL,
  platform VARCHAR(50) NOT NULL,
  webhook_id VARCHAR(255) UNIQUE NOT NULL,
  payload JSONB NOT NULL,
  processed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create service_errors table 
CREATE TABLE IF NOT EXISTS service_errors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
  service_name VARCHAR(100) NOT NULL,
  error_type VARCHAR(100) NOT NULL,
  error_message TEXT NOT NULL,
  error_context JSONB,
  resolved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_webhook_events_merchant_id ON webhook_events(merchant_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_webhook_id ON webhook_events(webhook_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_created_at ON webhook_events(created_at);
CREATE INDEX IF NOT EXISTS idx_service_errors_merchant_id ON service_errors(merchant_id);
CREATE INDEX IF NOT EXISTS idx_service_errors_service_name ON service_errors(service_name);
CREATE INDEX IF NOT EXISTS idx_service_errors_created_at ON service_errors(created_at);

-- Add RLS policies
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_errors ENABLE ROW LEVEL SECURITY;

-- RLS policy for webhook_events 
DROP POLICY IF EXISTS webhook_events_tenant_isolation ON webhook_events;
CREATE POLICY webhook_events_tenant_isolation ON webhook_events
  USING (
    current_setting('app.admin_mode', true) = 'true' OR 
    merchant_id::text = current_setting('app.current_merchant_id', true)
  );

-- RLS policy for service_errors
DROP POLICY IF EXISTS service_errors_tenant_isolation ON service_errors;
CREATE POLICY service_errors_tenant_isolation ON service_errors
  USING (
    current_setting('app.admin_mode', true) = 'true' OR 
    merchant_id IS NULL OR
    merchant_id::text = current_setting('app.current_merchant_id', true)
  );

-- Add comments for documentation
COMMENT ON TABLE webhook_events IS 'Webhook events received from platforms';
COMMENT ON TABLE service_errors IS 'Service errors and exceptions for monitoring';
\r\n-- ==== End of: 030_add_missing_tables.sql ====\r\n
-- ==== File: 036_complete_rls_policies.sql ====\r\n
-- ===============================================
-- Complete RLS Policies Migration
-- Adds missing RLS policies for security compliance
-- Migration: 036_complete_rls_policies.sql
-- ===============================================

-- Enable RLS for job_spool table
DO $$
BEGIN
    -- Check if table exists and RLS is not already enabled
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'job_spool' AND table_schema = 'public') THEN
        -- Enable RLS
        ALTER TABLE job_spool ENABLE ROW LEVEL SECURITY;
        
        -- Drop existing policy if it exists
        DROP POLICY IF EXISTS job_spool_tenant_isolation ON job_spool;
        
        -- Create tenant isolation policy
        CREATE POLICY job_spool_tenant_isolation ON job_spool 
            FOR ALL 
            USING (
                merchant_id::text = current_setting('app.current_merchant_id', true)
                OR current_setting('app.is_admin', true)::boolean = true
            );
            
        -- Create policy for admin users
        DROP POLICY IF EXISTS job_spool_admin_access ON job_spool;
        CREATE POLICY job_spool_admin_access ON job_spool
            FOR ALL
            TO postgres
            USING (true);
        
        RAISE NOTICE 'RLS policies created for job_spool table';
    ELSE
        RAISE NOTICE 'job_spool table does not exist, skipping RLS setup';
    END IF;
END $$;

-- Enable RLS for queue_jobs table if it exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'queue_jobs' AND table_schema = 'public') THEN
        -- Enable RLS
        ALTER TABLE queue_jobs ENABLE ROW LEVEL SECURITY;
        
        -- Drop existing policy if it exists
        DROP POLICY IF EXISTS queue_jobs_tenant_isolation ON queue_jobs;
        
        -- Create tenant isolation policy (assuming payload contains merchantId)
        CREATE POLICY queue_jobs_tenant_isolation ON queue_jobs 
            FOR ALL 
            USING (
                (payload->>'merchantId')::text = current_setting('app.current_merchant_id', true)
                OR current_setting('app.is_admin', true)::boolean = true
            );
            
        -- Create policy for admin users
        DROP POLICY IF EXISTS queue_jobs_admin_access ON queue_jobs;
        CREATE POLICY queue_jobs_admin_access ON queue_jobs
            FOR ALL
            TO postgres
            USING (true);
        
        RAISE NOTICE 'RLS policies created for queue_jobs table';
    ELSE
        RAISE NOTICE 'queue_jobs table does not exist, skipping RLS setup';
    END IF;
END $$;

-- Enable RLS for products table if not already enabled
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'products' AND table_schema = 'public') THEN
        -- Enable RLS
        ALTER TABLE products ENABLE ROW LEVEL SECURITY;
        
        -- Drop existing policy if it exists
        DROP POLICY IF EXISTS products_tenant_isolation ON products;
        
        -- Create tenant isolation policy
        CREATE POLICY products_tenant_isolation ON products 
            FOR ALL 
            USING (
                merchant_id::text = current_setting('app.current_merchant_id', true)
                OR current_setting('app.is_admin', true)::boolean = true
            );
            
        -- Create policy for admin users
        DROP POLICY IF EXISTS products_admin_access ON products;
        CREATE POLICY products_admin_access ON products
            FOR ALL
            TO postgres
            USING (true);
        
        RAISE NOTICE 'RLS policies created for products table';
    ELSE
        RAISE NOTICE 'products table does not exist, skipping RLS setup';
    END IF;
END $$;

-- Enable RLS for orders table if not already enabled
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'orders' AND table_schema = 'public') THEN
        -- Enable RLS
        ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
        
        -- Drop existing policy if it exists
        DROP POLICY IF EXISTS orders_tenant_isolation ON orders;
        
        -- Create tenant isolation policy
        CREATE POLICY orders_tenant_isolation ON orders 
            FOR ALL 
            USING (
                merchant_id::text = current_setting('app.current_merchant_id', true)
                OR current_setting('app.is_admin', true)::boolean = true
            );
            
        -- Create policy for admin users
        DROP POLICY IF EXISTS orders_admin_access ON orders;
        CREATE POLICY orders_admin_access ON orders
            FOR ALL
            TO postgres
            USING (true);
        
        RAISE NOTICE 'RLS policies created for orders table';
    ELSE
        RAISE NOTICE 'orders table does not exist, skipping RLS setup';
    END IF;
END $$;

-- Validate RLS configuration
DO $$
DECLARE
    rls_table RECORD;
    policy_count INTEGER;
BEGIN
    -- Check all tables with RLS enabled
    FOR rls_table IN 
        SELECT tablename 
        FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename IN ('merchants', 'conversations', 'message_logs', 'products', 'orders', 'job_spool', 'queue_jobs')
    LOOP
        -- Count policies for each table
        SELECT COUNT(*) INTO policy_count
        FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = rls_table.tablename;
        
        IF policy_count = 0 THEN
            RAISE WARNING 'Table % has RLS enabled but no policies defined', rls_table.tablename;
        ELSE
            RAISE NOTICE 'Table % has % RLS policies configured', rls_table.tablename, policy_count;
        END IF;
    END LOOP;
    
    RAISE NOTICE 'RLS validation completed successfully';
END $$;

-- Create helper function to check RLS status
CREATE OR REPLACE FUNCTION check_rls_status()
RETURNS TABLE(
    table_name TEXT,
    rls_enabled BOOLEAN,
    policy_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        t.tablename::TEXT,
        (SELECT relrowsecurity FROM pg_class WHERE relname = t.tablename AND relnamespace = 'public'::regnamespace) AS rls_enabled,
        (SELECT COUNT(*) FROM pg_policies p WHERE p.tablename = t.tablename AND p.schemaname = 'public') AS policy_count
    FROM pg_tables t
    WHERE t.schemaname = 'public'
    AND t.tablename IN ('merchants', 'conversations', 'message_logs', 'products', 'orders', 'job_spool', 'queue_jobs')
    ORDER BY t.tablename;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION check_rls_status() TO PUBLIC;

-- Log migration completion
INSERT INTO migration_log (migration_name, executed_at, status) 
VALUES ('036_complete_rls_policies.sql', NOW(), 'SUCCESS')
ON CONFLICT (migration_name) DO UPDATE SET 
    executed_at = NOW(), 
    status = 'SUCCESS';
\r\n-- ==== End of: 036_complete_rls_policies.sql ====\r\n
-- ==== File: 041_cross_platform_infrastructure.sql ====\r\n
-- Cross-Platform Conversation Management Infrastructure
-- Tables and functions for unified customer experience across WhatsApp and Instagram

-- Create platform_switches table to track customer platform changes
CREATE TABLE IF NOT EXISTS platform_switches (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
    from_platform VARCHAR(20) NOT NULL CHECK (from_platform IN ('WHATSAPP', 'INSTAGRAM')),
    to_platform VARCHAR(20) NOT NULL CHECK (to_platform IN ('WHATSAPP', 'INSTAGRAM')),
    from_identifier VARCHAR(255) NOT NULL, -- phone number or instagram username
    to_identifier VARCHAR(255) NOT NULL,
    from_conversation_id UUID REFERENCES conversations(id),
    to_conversation_id UUID REFERENCES conversations(id),
    reason VARCHAR(50) NOT NULL CHECK (reason IN ('customer_initiated', 'merchant_redirect', 'auto_follow')),
    context_preserved BOOLEAN DEFAULT false,
    continuity_score DECIMAL(3,2) CHECK (continuity_score >= 0 AND continuity_score <= 1),
    switch_timestamp TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for platform_switches
CREATE INDEX IF NOT EXISTS idx_platform_switches_merchant ON platform_switches (merchant_id);
CREATE INDEX IF NOT EXISTS idx_platform_switches_timestamp ON platform_switches (switch_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_platform_switches_identifiers ON platform_switches (from_identifier, to_identifier);
CREATE INDEX IF NOT EXISTS idx_platform_switches_conversations ON platform_switches (from_conversation_id, to_conversation_id);

-- Create unified_customer_profiles table for cross-platform customer data
CREATE TABLE IF NOT EXISTS unified_customer_profiles (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
    master_customer_id VARCHAR(255) NOT NULL, -- Primary identifier across platforms
    whatsapp_number VARCHAR(20),
    instagram_username VARCHAR(100),
    customer_name VARCHAR(255),
    preferred_platform VARCHAR(20) CHECK (preferred_platform IN ('WHATSAPP', 'INSTAGRAM')),
    total_interactions INTEGER DEFAULT 0,
    unified_context JSONB DEFAULT '{}',
    tags TEXT[] DEFAULT '{}',
    last_activity TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Unique constraint to prevent duplicate profiles
    UNIQUE(merchant_id, master_customer_id),
    
    -- Ensure at least one platform identifier exists
    CHECK (whatsapp_number IS NOT NULL OR instagram_username IS NOT NULL)
);

-- Create indexes for unified_customer_profiles
CREATE INDEX IF NOT EXISTS idx_unified_profiles_merchant ON unified_customer_profiles (merchant_id);
CREATE INDEX IF NOT EXISTS idx_unified_profiles_whatsapp ON unified_customer_profiles (whatsapp_number);
CREATE INDEX IF NOT EXISTS idx_unified_profiles_instagram ON unified_customer_profiles (instagram_username);
CREATE INDEX IF NOT EXISTS idx_unified_profiles_last_activity ON unified_customer_profiles (last_activity DESC);
CREATE INDEX IF NOT EXISTS idx_unified_profiles_tags ON unified_customer_profiles USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_unified_profiles_context ON unified_customer_profiles USING GIN (unified_context);

-- Create customer_journey_events table for tracking cross-platform journey
CREATE TABLE IF NOT EXISTS customer_journey_events (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
    customer_profile_id UUID REFERENCES unified_customer_profiles(id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    platform VARCHAR(20) NOT NULL CHECK (platform IN ('WHATSAPP', 'INSTAGRAM')),
    event_type VARCHAR(50) NOT NULL, -- 'message_sent', 'platform_switch', 'conversion', etc.
    event_stage VARCHAR(50), -- conversation stage at time of event
    event_data JSONB DEFAULT '{}',
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for customer_journey_events
CREATE INDEX IF NOT EXISTS idx_journey_events_merchant ON customer_journey_events (merchant_id);
CREATE INDEX IF NOT EXISTS idx_journey_events_customer ON customer_journey_events (customer_profile_id);
CREATE INDEX IF NOT EXISTS idx_journey_events_platform ON customer_journey_events (platform);
CREATE INDEX IF NOT EXISTS idx_journey_events_timestamp ON customer_journey_events (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_journey_events_type ON customer_journey_events (event_type);

-- Create conversation_merges table to track conversation consolidation
CREATE TABLE IF NOT EXISTS conversation_merges (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
    primary_conversation_id UUID REFERENCES conversations(id),
    merged_conversation_ids UUID[] NOT NULL,
    merge_strategy VARCHAR(50) DEFAULT 'most_complete',
    context_fields_merged TEXT[] DEFAULT '{}',
    conflicts_resolved INTEGER DEFAULT 0,
    data_loss TEXT[] DEFAULT '{}',
    merge_timestamp TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for conversation_merges
CREATE INDEX IF NOT EXISTS idx_conversation_merges_merchant ON conversation_merges (merchant_id);
CREATE INDEX IF NOT EXISTS idx_conversation_merges_primary ON conversation_merges (primary_conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_merges_timestamp ON conversation_merges (merge_timestamp DESC);

-- Create function to get unified customer profile
CREATE OR REPLACE FUNCTION get_unified_customer_profile(
    p_merchant_id UUID,
    p_whatsapp_number VARCHAR(20) DEFAULT NULL,
    p_instagram_username VARCHAR(100) DEFAULT NULL
)
RETURNS TABLE(
    profile_id UUID,
    master_customer_id VARCHAR(255),
    whatsapp_number VARCHAR(20),
    instagram_username VARCHAR(100),
    customer_name VARCHAR(255),
    preferred_platform VARCHAR(20),
    total_interactions INTEGER,
    unified_context JSONB,
    tags TEXT[],
    last_activity TIMESTAMPTZ,
    platform_stats JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ucp.id as profile_id,
        ucp.master_customer_id,
        ucp.whatsapp_number,
        ucp.instagram_username,
        ucp.customer_name,
        ucp.preferred_platform,
        ucp.total_interactions,
        ucp.unified_context,
        ucp.tags,
        ucp.last_activity,
        (
            SELECT jsonb_object_agg(
                c.platform,
                jsonb_build_object(
                    'conversation_count', COUNT(DISTINCT c.id),
                    'message_count', COUNT(ml.id),
                    'last_message', MAX(ml.created_at),
                    'avg_response_time', 0
                )
            )
            FROM conversations c
            LEFT JOIN message_logs ml ON c.id = ml.conversation_id
            WHERE c.merchant_id = p_merchant_id
            AND (
                (p_whatsapp_number IS NOT NULL AND c.customer_phone = p_whatsapp_number) OR
                (p_instagram_username IS NOT NULL AND c.customer_instagram = p_instagram_username)
            )
            GROUP BY c.platform
        ) as platform_stats
    FROM unified_customer_profiles ucp
    WHERE ucp.merchant_id = p_merchant_id
    AND (
        (p_whatsapp_number IS NOT NULL AND ucp.whatsapp_number = p_whatsapp_number) OR
        (p_instagram_username IS NOT NULL AND ucp.instagram_username = p_instagram_username)
    )
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Create function to create or update unified customer profile
CREATE OR REPLACE FUNCTION upsert_unified_customer_profile(
    p_merchant_id UUID,
    p_whatsapp_number VARCHAR(20) DEFAULT NULL,
    p_instagram_username VARCHAR(100) DEFAULT NULL,
    p_customer_name VARCHAR(255) DEFAULT NULL,
    p_preferred_platform VARCHAR(20) DEFAULT NULL,
    p_unified_context JSONB DEFAULT '{}',
    p_tags TEXT[] DEFAULT '{}'
)
RETURNS UUID AS $$
DECLARE
    profile_id UUID;
    master_id VARCHAR(255);
BEGIN
    -- Generate master customer ID
    master_id := COALESCE(p_whatsapp_number, p_instagram_username, uuid_generate_v4()::text);
    
    -- Try to insert new profile
    INSERT INTO unified_customer_profiles (
        merchant_id,
        master_customer_id,
        whatsapp_number,
        instagram_username,
        customer_name,
        preferred_platform,
        unified_context,
        tags,
        total_interactions
    ) VALUES (
        p_merchant_id,
        master_id,
        p_whatsapp_number,
        p_instagram_username,
        p_customer_name,
        p_preferred_platform,
        p_unified_context,
        p_tags,
        1
    )
    ON CONFLICT (merchant_id, master_customer_id) 
    DO UPDATE SET
        whatsapp_number = COALESCE(EXCLUDED.whatsapp_number, unified_customer_profiles.whatsapp_number),
        instagram_username = COALESCE(EXCLUDED.instagram_username, unified_customer_profiles.instagram_username),
        customer_name = COALESCE(EXCLUDED.customer_name, unified_customer_profiles.customer_name),
        preferred_platform = COALESCE(EXCLUDED.preferred_platform, unified_customer_profiles.preferred_platform),
        unified_context = unified_customer_profiles.unified_context || EXCLUDED.unified_context,
        tags = array(SELECT DISTINCT unnest(unified_customer_profiles.tags || EXCLUDED.tags)),
        total_interactions = unified_customer_profiles.total_interactions + 1,
        last_activity = NOW(),
        updated_at = NOW()
    RETURNING id INTO profile_id;
    
    RETURN profile_id;
END;
$$ LANGUAGE plpgsql;

-- Create function to track customer journey event
CREATE OR REPLACE FUNCTION track_customer_journey_event(
    p_merchant_id UUID,
    p_customer_profile_id UUID,
    p_conversation_id UUID,
    p_platform VARCHAR(20),
    p_event_type VARCHAR(50),
    p_event_stage VARCHAR(50) DEFAULT NULL,
    p_event_data JSONB DEFAULT '{}'
)
RETURNS UUID AS $$
DECLARE
    event_id UUID;
BEGIN
    INSERT INTO customer_journey_events (
        merchant_id,
        customer_profile_id,
        conversation_id,
        platform,
        event_type,
        event_stage,
        event_data,
        timestamp
    ) VALUES (
        p_merchant_id,
        p_customer_profile_id,
        p_conversation_id,
        p_platform,
        p_event_type,
        p_event_stage,
        p_event_data,
        NOW()
    ) RETURNING id INTO event_id;
    
    RETURN event_id;
END;
$$ LANGUAGE plpgsql;

-- Create function to analyze platform switch patterns
CREATE OR REPLACE FUNCTION analyze_platform_switch_patterns(
    p_merchant_id UUID,
    p_days_back INTEGER DEFAULT 30
)
RETURNS TABLE(
    switch_pattern VARCHAR(50),
    count BIGINT,
    avg_continuity_score DECIMAL(5,2),
    most_common_reason VARCHAR(50)
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        CONCAT(ps.from_platform, '_TO_', ps.to_platform) as switch_pattern,
        COUNT(*) as count,
        ROUND(AVG(ps.continuity_score), 2) as avg_continuity_score,
        MODE() WITHIN GROUP (ORDER BY ps.reason) as most_common_reason
    FROM platform_switches ps
    WHERE ps.merchant_id = p_merchant_id
    AND ps.switch_timestamp >= NOW() - INTERVAL '1 day' * p_days_back
    GROUP BY ps.from_platform, ps.to_platform
    ORDER BY count DESC;
END;
$$ LANGUAGE plpgsql;

-- Create view for cross-platform customer analytics
CREATE OR REPLACE VIEW cross_platform_customer_analytics AS
SELECT 
    m.id as merchant_id,
    m.business_name,
    ucp.preferred_platform,
    COUNT(*) as total_customers,
    COUNT(CASE WHEN ucp.whatsapp_number IS NOT NULL AND ucp.instagram_username IS NOT NULL THEN 1 END) as multi_platform_customers,
    COUNT(CASE WHEN 'multi-platform' = ANY(ucp.tags) THEN 1 END) as tagged_multi_platform,
    COUNT(CASE WHEN 'high-engagement' = ANY(ucp.tags) THEN 1 END) as high_engagement_customers,
    AVG(ucp.total_interactions) as avg_interactions_per_customer,
    COUNT(CASE WHEN ucp.last_activity >= NOW() - INTERVAL '7 days' THEN 1 END) as active_last_7_days,
    COUNT(CASE WHEN ucp.last_activity >= NOW() - INTERVAL '30 days' THEN 1 END) as active_last_30_days
FROM merchants m
JOIN unified_customer_profiles ucp ON m.id = ucp.merchant_id
GROUP BY m.id, m.business_name, ucp.preferred_platform;

-- Create view for platform switch analytics
CREATE OR REPLACE VIEW platform_switch_analytics AS
SELECT 
    ps.merchant_id,
    DATE_TRUNC('day', ps.switch_timestamp) as switch_date,
    ps.from_platform,
    ps.to_platform,
    ps.reason,
    COUNT(*) as switch_count,
    AVG(ps.continuity_score) as avg_continuity_score,
    COUNT(CASE WHEN ps.context_preserved = true THEN 1 END) as successful_transfers,
    ROUND(
        COUNT(CASE WHEN ps.context_preserved = true THEN 1 END)::numeric / 
        COUNT(*)::numeric * 100, 2
    ) as transfer_success_rate
FROM platform_switches ps
GROUP BY ps.merchant_id, DATE_TRUNC('day', ps.switch_timestamp), ps.from_platform, ps.to_platform, ps.reason
ORDER BY switch_date DESC;

-- Add Row Level Security
ALTER TABLE platform_switches ENABLE ROW LEVEL SECURITY;
ALTER TABLE unified_customer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_journey_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_merges ENABLE ROW LEVEL SECURITY;

-- RLS Policies for platform_switches
DROP POLICY IF EXISTS platform_switches_tenant_policy ON platform_switches;
CREATE POLICY platform_switches_tenant_policy ON platform_switches
    FOR ALL USING (
        merchant_id = current_setting('app.current_merchant_id', true)::UUID
    );

-- RLS Policies for unified_customer_profiles
DROP POLICY IF EXISTS unified_customer_profiles_tenant_policy ON unified_customer_profiles;
CREATE POLICY unified_customer_profiles_tenant_policy ON unified_customer_profiles
    FOR ALL USING (
        merchant_id = current_setting('app.current_merchant_id', true)::UUID
    );

-- RLS Policies for customer_journey_events
DROP POLICY IF EXISTS customer_journey_events_tenant_policy ON customer_journey_events;
CREATE POLICY customer_journey_events_tenant_policy ON customer_journey_events
    FOR ALL USING (
        merchant_id = current_setting('app.current_merchant_id', true)::UUID
    );

-- RLS Policies for conversation_merges
DROP POLICY IF EXISTS conversation_merges_tenant_policy ON conversation_merges;
CREATE POLICY conversation_merges_tenant_policy ON conversation_merges
    FOR ALL USING (
        merchant_id = current_setting('app.current_merchant_id', true)::UUID
    );

-- Create trigger to update unified_customer_profiles updated_at
CREATE OR REPLACE FUNCTION update_unified_profile_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_unified_profiles_updated_at ON unified_customer_profiles;
CREATE TRIGGER trigger_unified_profiles_updated_at
    BEFORE UPDATE ON unified_customer_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_unified_profile_timestamp();

-- Note: Migration tracking is handled automatically by the migration runner

\r\n-- ==== End of: 041_cross_platform_infrastructure.sql ====\r\n
-- ==== File: 042_create_audit_logs.sql ====\r\n
-- Migration 042: Create Audit Logs Table
-- Date: 2025-08-26
-- Description: Create audit_logs table for security and compliance tracking

BEGIN;

-- Create audit_logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id uuid REFERENCES merchants(id) ON DELETE CASCADE,
    user_id VARCHAR(100),
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id VARCHAR(255),
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    user_agent TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'SUCCESS',
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT audit_logs_status_check CHECK (status IN ('SUCCESS', 'FAILED', 'PENDING')),
    CONSTRAINT audit_logs_action_check CHECK (action IN (
        'CREATE', 'READ', 'UPDATE', 'DELETE',
        'LOGIN', 'LOGOUT', 'WEBHOOK_RECEIVED',
        'MESSAGE_SENT', 'MESSAGE_RECEIVED',
        'INSTAGRAM_AUTH', 'WHATSAPP_AUTH',
        'API_CALL', 'SYSTEM_EVENT'
    )),
    CONSTRAINT audit_logs_resource_type_check CHECK (resource_type IN (
        'MERCHANT', 'CONVERSATION', 'MESSAGE', 'PRODUCT', 'ORDER',
        'CREDENTIAL', 'WEBHOOK', 'AUTH_TOKEN', 'SYSTEM'
    ))
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_audit_logs_merchant ON audit_logs (merchant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs (action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs (resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_status ON audit_logs (status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs (user_id);

-- Create trigger to ensure created_at is not modified
CREATE OR REPLACE FUNCTION protect_audit_logs_created_at()
RETURNS TRIGGER AS $$
BEGIN
    -- Prevent modification of created_at on updates
    IF TG_OP = 'UPDATE' THEN
        NEW.created_at = OLD.created_at;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_protect_audit_logs_created_at ON audit_logs;
CREATE TRIGGER trigger_protect_audit_logs_created_at
    BEFORE UPDATE ON audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION protect_audit_logs_created_at();

-- Enable RLS (already handled in migration 015)
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Add comments
COMMENT ON TABLE audit_logs IS 'Security audit trail for all system activities';
COMMENT ON COLUMN audit_logs.merchant_id IS 'Merchant context (nullable for system events)';
COMMENT ON COLUMN audit_logs.action IS 'Type of action performed';
COMMENT ON COLUMN audit_logs.resource_type IS 'Type of resource affected';
COMMENT ON COLUMN audit_logs.resource_id IS 'ID of the affected resource';
COMMENT ON COLUMN audit_logs.old_values IS 'Previous values before change';
COMMENT ON COLUMN audit_logs.new_values IS 'New values after change';

COMMIT;

-- Log success
\echo 'Migration 042: Audit logs table created âœ…'
\r\n-- ==== End of: 042_create_audit_logs.sql ====\r\n
-- ==== File: 053_manychat_integration.sql ====\r\n
-- ===============================================
-- Migration 053: ManyChat Integration
-- AI Sales Platform - ManyChat integration support
-- ===============================================

-- Prerequisites validation
DO $$
BEGIN
    -- Ensure merchants table exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'merchants') THEN
        RAISE EXCEPTION 'Migration 053 failed: merchants table missing. Run migration 001 first.';
    END IF;
    
    -- Ensure uuid-ossp extension is available
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'uuid-ossp') THEN
        RAISE EXCEPTION 'Migration 053 failed: uuid-ossp extension missing. Create extension first.';
    END IF;
    
    RAISE NOTICE 'Migration 053: Prerequisites validated successfully';
END $$;

-- ===============================================
-- 1. ADD MANYCHAT CONFIG TO MERCHANTS TABLE
-- ===============================================

-- Add ManyChat configuration column to merchants table
ALTER TABLE merchants 
ADD COLUMN IF NOT EXISTS manychat_config JSONB DEFAULT '{}';

-- Add comment for documentation
COMMENT ON COLUMN merchants.manychat_config IS 'ManyChat configuration for the merchant including API keys, flow IDs, and settings';

-- ===============================================
-- 2. MANYCHAT_LOGS TABLE - Interaction tracking
-- ===============================================

CREATE TABLE IF NOT EXISTS manychat_logs (
    -- Primary identification
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    
    -- Subscriber identification
    subscriber_id VARCHAR(255) NOT NULL,
    message_id VARCHAR(255),
    
    -- Action and status tracking
    action VARCHAR(50) NOT NULL CHECK (action IN (
        'send_message', 'create_subscriber', 'update_subscriber', 
        'add_tag', 'remove_tag', 'get_info', 'local_ai_response', 
        'fallback_response', 'webhook_received'
    )),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'success', 'failed', 'retrying'
    )),
    
    -- Response data and metadata
    response_data JSONB DEFAULT '{}',
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    
    -- Processing metrics
    processing_time_ms INTEGER,
    platform VARCHAR(20) DEFAULT 'manychat' CHECK (platform IN (
        'manychat', 'local_ai', 'fallback', 'instagram'
    )),
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add comments for documentation
COMMENT ON TABLE manychat_logs IS 'Tracks all ManyChat API interactions and responses';
COMMENT ON COLUMN manychat_logs.subscriber_id IS 'ManyChat subscriber ID or Instagram customer ID';
COMMENT ON COLUMN manychat_logs.action IS 'Type of action performed with ManyChat';
COMMENT ON COLUMN manychat_logs.response_data IS 'Full response data from ManyChat API';
COMMENT ON COLUMN manychat_logs.platform IS 'Platform used for processing (manychat, local_ai, fallback)';

-- ===============================================
-- 3. MANYCHAT_SUBSCRIBERS TABLE - Subscriber management
-- ===============================================

CREATE TABLE IF NOT EXISTS manychat_subscribers (
    -- Primary identification
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    
    -- ManyChat subscriber identification
    manychat_subscriber_id VARCHAR(255) NOT NULL,
    instagram_customer_id VARCHAR(255),
    whatsapp_customer_id VARCHAR(255),
    
    -- Subscriber information
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    phone VARCHAR(20),
    email VARCHAR(255),
    language VARCHAR(10) DEFAULT 'ar',
    timezone VARCHAR(50) DEFAULT 'Asia/Baghdad',
    
    -- Tags and custom fields
    tags TEXT[] DEFAULT '{}',
    custom_fields JSONB DEFAULT '{}',
    
    -- Status and engagement
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN (
        'active', 'inactive', 'blocked', 'unsubscribed'
    )),
    engagement_score INTEGER DEFAULT 0,
    last_interaction_at TIMESTAMPTZ,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add comments for documentation
COMMENT ON TABLE manychat_subscribers IS 'ManyChat subscribers linked to merchants';
COMMENT ON COLUMN manychat_subscribers.manychat_subscriber_id IS 'ManyChat internal subscriber ID';
COMMENT ON COLUMN manychat_subscribers.instagram_customer_id IS 'Instagram customer ID for cross-platform linking';
COMMENT ON COLUMN manychat_subscribers.whatsapp_customer_id IS 'WhatsApp customer ID for cross-platform linking';
COMMENT ON COLUMN manychat_subscribers.engagement_score IS 'Calculated engagement score (0-100)';

-- ===============================================
-- 4. MANYCHAT_FLOWS TABLE - Flow management
-- ===============================================

CREATE TABLE IF NOT EXISTS manychat_flows (
    -- Primary identification
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    
    -- Flow identification
    flow_name VARCHAR(255) NOT NULL,
    flow_id VARCHAR(255) NOT NULL,
    flow_type VARCHAR(50) NOT NULL CHECK (flow_type IN (
        'welcome', 'ai_response', 'comment_response', 'story_response',
        'purchase_intent', 'price_inquiry', 'customer_support', 'custom'
    )),
    
    -- Flow configuration
    is_active BOOLEAN DEFAULT true,
    priority INTEGER DEFAULT 0,
    trigger_conditions JSONB DEFAULT '{}',
    
    -- Flow content and settings
    default_message TEXT,
    ai_prompt TEXT,
    tags_to_add TEXT[] DEFAULT '{}',
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add comments for documentation
COMMENT ON TABLE manychat_flows IS 'ManyChat flows configuration for merchants';
COMMENT ON COLUMN manychat_flows.flow_id IS 'ManyChat internal flow ID';
COMMENT ON COLUMN manychat_flows.trigger_conditions IS 'JSON conditions for when to trigger this flow';

-- ===============================================
-- 5. MANYCHAT_WEBHOOKS TABLE - Webhook management
-- ===============================================

CREATE TABLE IF NOT EXISTS manychat_webhooks (
    -- Primary identification
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    
    -- Webhook configuration
    webhook_url TEXT NOT NULL,
    webhook_secret VARCHAR(255),
    webhook_type VARCHAR(50) NOT NULL CHECK (webhook_type IN (
        'subscriber_created', 'message_received', 'flow_completed',
        'tag_added', 'tag_removed', 'custom'
    )),
    
    -- Status and health
    is_active BOOLEAN DEFAULT true,
    last_triggered_at TIMESTAMPTZ,
    success_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    last_error TEXT,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add comments for documentation
COMMENT ON TABLE manychat_webhooks IS 'ManyChat webhook configurations for merchants';
COMMENT ON COLUMN manychat_webhooks.webhook_secret IS 'Secret for webhook signature verification';

-- ===============================================
-- 6. INDEXES FOR PERFORMANCE
-- ===============================================

-- ManyChat logs indexes
CREATE INDEX IF NOT EXISTS idx_manychat_logs_merchant_id ON manychat_logs(merchant_id);
CREATE INDEX IF NOT EXISTS idx_manychat_logs_subscriber_id ON manychat_logs(subscriber_id);
CREATE INDEX IF NOT EXISTS idx_manychat_logs_created_at ON manychat_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_manychat_logs_action_status ON manychat_logs(action, status);
CREATE INDEX IF NOT EXISTS idx_manychat_logs_platform ON manychat_logs(platform);

-- ManyChat subscribers indexes
CREATE INDEX IF NOT EXISTS idx_manychat_subscribers_merchant_id ON manychat_subscribers(merchant_id);
CREATE INDEX IF NOT EXISTS idx_manychat_subscribers_manychat_id ON manychat_subscribers(manychat_subscriber_id);
CREATE INDEX IF NOT EXISTS idx_manychat_subscribers_instagram_id ON manychat_subscribers(instagram_customer_id);
CREATE INDEX IF NOT EXISTS idx_manychat_subscribers_whatsapp_id ON manychat_subscribers(whatsapp_customer_id);
CREATE INDEX IF NOT EXISTS idx_manychat_subscribers_status ON manychat_subscribers(status);
CREATE INDEX IF NOT EXISTS idx_manychat_subscribers_last_interaction ON manychat_subscribers(last_interaction_at);

-- ManyChat flows indexes
CREATE INDEX IF NOT EXISTS idx_manychat_flows_merchant_id ON manychat_flows(merchant_id);
CREATE INDEX IF NOT EXISTS idx_manychat_flows_flow_id ON manychat_flows(flow_id);
CREATE INDEX IF NOT EXISTS idx_manychat_flows_type_active ON manychat_flows(flow_type, is_active);
CREATE INDEX IF NOT EXISTS idx_manychat_flows_priority ON manychat_flows(priority);

-- ManyChat webhooks indexes
CREATE INDEX IF NOT EXISTS idx_manychat_webhooks_merchant_id ON manychat_webhooks(merchant_id);
CREATE INDEX IF NOT EXISTS idx_manychat_webhooks_type_active ON manychat_webhooks(webhook_type, is_active);

-- ===============================================
-- 7. UNIQUE CONSTRAINTS
-- ===============================================

-- Ensure unique ManyChat subscriber IDs per merchant
ALTER TABLE manychat_subscribers 
ADD CONSTRAINT uk_manychat_subscribers_merchant_manychat_id 
UNIQUE (merchant_id, manychat_subscriber_id);

-- Ensure unique flow IDs per merchant
ALTER TABLE manychat_flows 
ADD CONSTRAINT uk_manychat_flows_merchant_flow_id 
UNIQUE (merchant_id, flow_id);

-- Ensure unique webhook URLs per merchant
ALTER TABLE manychat_webhooks 
ADD CONSTRAINT uk_manychat_webhooks_merchant_url 
UNIQUE (merchant_id, webhook_url);

-- ===============================================
-- 8. ROW LEVEL SECURITY (RLS) POLICIES
-- ===============================================

-- Enable RLS on all tables
ALTER TABLE manychat_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE manychat_subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE manychat_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE manychat_webhooks ENABLE ROW LEVEL SECURITY;

-- ManyChat logs RLS policies
CREATE POLICY manychat_logs_merchant_isolation ON manychat_logs
    FOR ALL USING (merchant_id = current_setting('app.current_merchant_id')::UUID);

-- ManyChat subscribers RLS policies
CREATE POLICY manychat_subscribers_merchant_isolation ON manychat_subscribers
    FOR ALL USING (merchant_id = current_setting('app.current_merchant_id')::UUID);

-- ManyChat flows RLS policies
CREATE POLICY manychat_flows_merchant_isolation ON manychat_flows
    FOR ALL USING (merchant_id = current_setting('app.current_merchant_id')::UUID);

-- ManyChat webhooks RLS policies
CREATE POLICY manychat_webhooks_merchant_isolation ON manychat_webhooks
    FOR ALL USING (merchant_id = current_setting('app.current_merchant_id')::UUID);

-- ===============================================
-- 9. TRIGGERS FOR UPDATED_AT
-- ===============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_manychat_logs_updated_at 
    BEFORE UPDATE ON manychat_logs 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_manychat_subscribers_updated_at 
    BEFORE UPDATE ON manychat_subscribers 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_manychat_flows_updated_at 
    BEFORE UPDATE ON manychat_flows 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_manychat_webhooks_updated_at 
    BEFORE UPDATE ON manychat_webhooks 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ===============================================
-- 10. HELPER FUNCTIONS
-- ===============================================

-- Function to get ManyChat subscriber by Instagram ID
CREATE OR REPLACE FUNCTION get_manychat_subscriber_by_instagram(
    p_merchant_id UUID,
    p_instagram_customer_id VARCHAR(255)
)
RETURNS TABLE (
    id UUID,
    manychat_subscriber_id VARCHAR(255),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    phone VARCHAR(20),
    email VARCHAR(255),
    language VARCHAR(10),
    timezone VARCHAR(50),
    tags TEXT[],
    custom_fields JSONB,
    status VARCHAR(20),
    engagement_score INTEGER,
    last_interaction_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ms.id,
        ms.manychat_subscriber_id,
        ms.first_name,
        ms.last_name,
        ms.phone,
        ms.email,
        ms.language,
        ms.timezone,
        ms.tags,
        ms.custom_fields,
        ms.status,
        ms.engagement_score,
        ms.last_interaction_at
    FROM manychat_subscribers ms
    WHERE ms.merchant_id = p_merchant_id
      AND ms.instagram_customer_id = p_instagram_customer_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get active ManyChat flows for merchant
CREATE OR REPLACE FUNCTION get_active_manychat_flows(
    p_merchant_id UUID,
    p_flow_type VARCHAR(50) DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    flow_name VARCHAR(255),
    flow_id VARCHAR(255),
    flow_type VARCHAR(50),
    priority INTEGER,
    default_message TEXT,
    ai_prompt TEXT,
    tags_to_add TEXT[]
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        mf.id,
        mf.flow_name,
        mf.flow_id,
        mf.flow_type,
        mf.priority,
        mf.default_message,
        mf.ai_prompt,
        mf.tags_to_add
    FROM manychat_flows mf
    WHERE mf.merchant_id = p_merchant_id
      AND mf.is_active = true
      AND (p_flow_type IS NULL OR mf.flow_type = p_flow_type)
    ORDER BY mf.priority DESC, mf.created_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to log ManyChat interaction
CREATE OR REPLACE FUNCTION log_manychat_interaction(
    p_merchant_id UUID,
    p_subscriber_id VARCHAR(255),
    p_action VARCHAR(50),
    p_status VARCHAR(20),
    p_response_data JSONB DEFAULT '{}',
    p_error_message TEXT DEFAULT NULL,
    p_platform VARCHAR(20) DEFAULT 'manychat'
)
RETURNS UUID AS $$
DECLARE
    v_log_id UUID;
BEGIN
    INSERT INTO manychat_logs (
        merchant_id,
        subscriber_id,
        action,
        status,
        response_data,
        error_message,
        platform,
        created_at
    ) VALUES (
        p_merchant_id,
        p_subscriber_id,
        p_action,
        p_status,
        p_response_data,
        p_error_message,
        p_platform,
        NOW()
    ) RETURNING id INTO v_log_id;
    
    RETURN v_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===============================================
-- 11. MIGRATION COMPLETION
-- ===============================================

-- Log migration completion
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
    'ManyChat integration tables and functions created successfully'
);

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Migration 053 completed successfully: ManyChat integration support added';
    RAISE NOTICE 'Created tables: manychat_logs, manychat_subscribers, manychat_flows, manychat_webhooks';
    RAISE NOTICE 'Added indexes and RLS policies for security and performance';
    RAISE NOTICE 'Created helper functions for ManyChat operations';
END $$;

\r\n-- ==== End of: 053_manychat_integration.sql ====\r\n
-- ==== File: 054_production_fixes.sql ====\r\n
-- ===============================================
-- Production Fixes Migration
-- Creates missing tables for Instagram ManyChat Bridge
-- ===============================================

-- Create messages table for message window tracking
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

-- Create message_followups table for scheduling expired messages
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

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_messages_merchant_sender_platform ON messages(merchant_id, sender_id, platform);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_platform_status ON messages(platform, status);

CREATE INDEX IF NOT EXISTS idx_message_followups_merchant_customer ON message_followups(merchant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_message_followups_scheduled_for ON message_followups(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_message_followups_status ON message_followups(status);
CREATE INDEX IF NOT EXISTS idx_message_followups_platform ON message_followups(platform);

-- Add table comments
COMMENT ON TABLE messages IS 'Stores all messages for tracking message windows and interaction history';
COMMENT ON COLUMN messages.sender_id IS 'ID of the message sender (customer/user)';
COMMENT ON COLUMN messages.recipient_id IS 'ID of the message recipient (merchant/business)';
COMMENT ON COLUMN messages.platform IS 'Platform where message was sent (instagram, whatsapp, facebook)';

COMMENT ON TABLE message_followups IS 'Stores messages scheduled for follow-up delivery when message window expires';
COMMENT ON COLUMN message_followups.customer_id IS 'Instagram/social media customer ID';
COMMENT ON COLUMN message_followups.interaction_type IS 'Type of interaction: dm, comment, story_reply, story_mention';
COMMENT ON COLUMN message_followups.scheduled_for IS 'When to attempt delivery (usually 24+ hours after original)';
COMMENT ON COLUMN message_followups.retry_count IS 'Number of retry attempts made';

-- Insert sample data to test the schema (will be removed in production)
-- This helps verify the tables work correctly
INSERT INTO messages (merchant_id, sender_id, platform, content, status) 
VALUES ('test-merchant', 'test-sender', 'instagram', 'Test message for schema validation', 'sent')
ON CONFLICT DO NOTHING;

-- Clean up test data immediately
DELETE FROM messages WHERE merchant_id = 'test-merchant' AND sender_id = 'test-sender';
\r\n-- ==== End of: 054_production_fixes.sql ====\r\n
-- ==== File: 055_enforce_username_only.sql ====\r\n
-- ===============================================
-- Migration 055: Enforce Username-Only Architecture
-- Remove all instagram_user_id columns and enforce username-only
-- ===============================================

-- 1. Update conversations table
ALTER TABLE conversations 
  DROP COLUMN IF EXISTS customer_phone CASCADE,
  ADD COLUMN IF NOT EXISTS instagram_username VARCHAR(100);

-- Migrate existing data: use customer_instagram as username (if it contains @)
UPDATE conversations 
SET instagram_username = customer_instagram
WHERE customer_instagram IS NOT NULL 
  AND platform = 'instagram'
  AND instagram_username IS NULL;

-- Create unique index on merchant + username
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS 
  idx_conversations_merchant_username 
  ON conversations (merchant_id, instagram_username)
  WHERE platform = 'instagram' AND instagram_username IS NOT NULL;

-- 2. Update merchants table - remove instagram_user_id
ALTER TABLE merchants 
  DROP COLUMN IF EXISTS instagram_user_id CASCADE;

-- 3. Update merchant_credentials table - remove instagram_user_id  
ALTER TABLE merchant_credentials 
  DROP COLUMN IF EXISTS instagram_user_id CASCADE;

-- Ensure instagram_username is properly indexed
CREATE INDEX CONCURRENTLY IF NOT EXISTS 
  idx_merchants_instagram_username 
  ON merchants (instagram_username)
  WHERE instagram_username IS NOT NULL;

-- 4. Update manychat_subscribers table to use username
ALTER TABLE manychat_subscribers 
  DROP COLUMN IF EXISTS instagram_user_id CASCADE,
  ADD COLUMN IF NOT EXISTS instagram_username VARCHAR(100);

-- Create unique index for ManyChat mapping
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS 
  idx_manychat_merchant_username 
  ON manychat_subscribers (merchant_id, instagram_username)
  WHERE instagram_username IS NOT NULL;

-- 5. Update messages table
ALTER TABLE messages 
  ADD COLUMN IF NOT EXISTS sender_username VARCHAR(100);

-- Migrate existing messages: use sender_id as username placeholder
UPDATE messages 
SET sender_username = CASE 
  WHEN platform = 'instagram' AND sender_username IS NULL 
  THEN CONCAT('user_', sender_id)
  ELSE sender_username 
END
WHERE platform = 'instagram';

-- Create index for message lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS 
  idx_messages_platform_username 
  ON messages (platform, sender_username)
  WHERE platform = 'instagram';

-- 6. Clean up any remaining instagram_user_id references
-- This will help catch any missed columns during development
DO $$
DECLARE
  r RECORD;
BEGIN
  -- Find any remaining columns with instagram_user_id
  FOR r IN 
    SELECT schemaname, tablename, columnname 
    FROM information_schema.columns 
    WHERE column_name LIKE '%instagram_user_id%'
      AND table_schema = 'public'
  LOOP
    RAISE NOTICE 'Found instagram_user_id column: %.%.%', r.schemaname, r.tablename, r.columnname;
    -- Uncomment to actually drop (be careful!):
    -- EXECUTE 'ALTER TABLE ' || r.schemaname || '.' || r.tablename || ' DROP COLUMN IF EXISTS ' || r.columnname || ' CASCADE';
  END LOOP;
END $$;

-- 7. Add constraints to enforce data integrity
-- Ensure conversations have username when platform is instagram
ALTER TABLE conversations 
  ADD CONSTRAINT chk_instagram_has_username 
  CHECK (platform != 'instagram' OR instagram_username IS NOT NULL);

-- Ensure manychat mappings have username
ALTER TABLE manychat_subscribers 
  ADD CONSTRAINT chk_manychat_has_username 
  CHECK (instagram_username IS NOT NULL AND instagram_username != '');

-- 8. Create monitoring view for username consistency
CREATE OR REPLACE VIEW v_instagram_username_audit AS
SELECT 
  'conversations' as table_name,
  merchant_id,
  instagram_username,
  COUNT(*) as record_count
FROM conversations 
WHERE platform = 'instagram'
GROUP BY merchant_id, instagram_username

UNION ALL

SELECT 
  'manychat_subscribers' as table_name,
  merchant_id,
  instagram_username,
  COUNT(*) as record_count
FROM manychat_subscribers
GROUP BY merchant_id, instagram_username

UNION ALL

SELECT 
  'messages' as table_name,
  'N/A' as merchant_id,
  sender_username as instagram_username,
  COUNT(*) as record_count
FROM messages 
WHERE platform = 'instagram'
GROUP BY sender_username;

-- Add comment for documentation
COMMENT ON VIEW v_instagram_username_audit IS 
'Audit view to monitor username consistency across instagram-related tables';

-- Final verification
SELECT 'Migration 055 completed - Username-only architecture enforced' as status;
\r\n-- ==== End of: 055_enforce_username_only.sql ====\r\n
-- ==== File: 056_manychat_username_and_message_windows.sql ====\r\n
-- ===============================================
-- 056: ManyChat username mapping + message windows
-- Align DB schema with Instagramâ†’ManyChatâ†’Serverâ†’AI flow
-- ===============================================

DO $$
BEGIN
  -- Ensure merchants table exists
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'merchants' AND table_schema='public') THEN
    RAISE EXCEPTION 'Migration 056 failed: merchants table missing.';
  END IF;

  -- Ensure manychat_subscribers table exists (from 053)
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'manychat_subscribers' AND table_schema='public') THEN
    RAISE EXCEPTION 'Migration 056 failed: manychat_subscribers table missing. Apply migration 053 first.';
  END IF;
END $$;

-- ===============================================
-- 0) Merchant â†” Instagram page mapping (minimal)
-- ===============================================

CREATE TABLE IF NOT EXISTS public.merchant_instagram_mapping (
  merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL,
  business_account_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pk_merchant_instagram_mapping PRIMARY KEY (page_id)
);

CREATE INDEX IF NOT EXISTS idx_mim_merchant_id ON public.merchant_instagram_mapping(merchant_id) WHERE is_active = true;

COMMENT ON TABLE public.merchant_instagram_mapping IS 'Maps Instagram page_id to merchant with optional business account id';

-- ===============================================
-- 1) Add instagram_username mapping (case-insensitive)
-- ===============================================

ALTER TABLE public.manychat_subscribers
  ADD COLUMN IF NOT EXISTS instagram_username TEXT;

-- Normalize username to lowercase via expression index & uniqueness per merchant
CREATE UNIQUE INDEX IF NOT EXISTS uk_manychat_subscribers_merchant_username
  ON public.manychat_subscribers (merchant_id, lower(instagram_username));

COMMENT ON COLUMN public.manychat_subscribers.instagram_username IS 'Instagram username (lowercased for uniqueness)';

-- Helper function to fetch ManyChat subscriber by username
CREATE OR REPLACE FUNCTION public.get_manychat_subscriber_by_instagram_username(
  p_merchant_id UUID,
  p_username TEXT
) RETURNS TABLE(manychat_subscriber_id TEXT)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT m.manychat_subscriber_id
  FROM public.manychat_subscribers m
  WHERE m.merchant_id = p_merchant_id
    AND CASE WHEN p_username IS NULL THEN FALSE ELSE lower(m.instagram_username) = lower(p_username) END;
END;
$$;

COMMENT ON FUNCTION public.get_manychat_subscriber_by_instagram_username(UUID, TEXT)
  IS 'Return ManyChat subscriber_id for a given merchant and Instagram username';

-- ===============================================
-- 2) Message windows (24h window enforcement)
-- ===============================================

CREATE TABLE IF NOT EXISTS public.message_windows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('instagram','whatsapp','facebook')),
  customer_phone TEXT,
  customer_instagram TEXT,
  window_expires_at TIMESTAMPTZ NOT NULL,
  is_expired BOOLEAN GENERATED ALWAYS AS (window_expires_at <= NOW()) STORED,
  message_count_in_window INTEGER NOT NULL DEFAULT 0,
  merchant_response_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Targeted indexes
CREATE INDEX IF NOT EXISTS idx_message_windows_merchant ON public.message_windows(merchant_id);
CREATE INDEX IF NOT EXISTS idx_message_windows_active ON public.message_windows(merchant_id, platform) WHERE is_expired = FALSE;
CREATE INDEX IF NOT EXISTS idx_message_windows_instagram ON public.message_windows(lower(customer_instagram)) WHERE customer_instagram IS NOT NULL;

COMMENT ON TABLE public.message_windows IS 'Tracks 24h customer service window per merchant & customer';

-- Upsert helper for updating/creating a window when a customer message arrives
CREATE OR REPLACE FUNCTION public.update_message_window(
  p_merchant_id UUID,
  p_customer_phone TEXT,
  p_customer_instagram TEXT,
  p_platform TEXT,
  p_message_id UUID
) RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_expires TIMESTAMPTZ := NOW() + INTERVAL '24 hours';
BEGIN
  INSERT INTO public.message_windows (merchant_id, platform, customer_phone, customer_instagram, window_expires_at, message_count_in_window)
  VALUES (p_merchant_id, p_platform, p_customer_phone, p_customer_instagram, v_expires, 1)
  ON CONFLICT (merchant_id, platform, customer_phone, customer_instagram)
  DO UPDATE SET
    window_expires_at = EXCLUDED.window_expires_at,
    message_count_in_window = public.message_windows.message_count_in_window + 1,
    updated_at = v_now;
END;
$$;

-- Check helper that returns window status for API layer
CREATE OR REPLACE FUNCTION public.check_message_window(
  p_merchant_id UUID,
  p_customer_phone TEXT,
  p_customer_instagram TEXT,
  p_platform TEXT
) RETURNS TABLE (
  can_send_message BOOLEAN,
  window_expires_at TIMESTAMPTZ,
  time_remaining_minutes INTEGER,
  message_count_in_window INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_expires TIMESTAMPTZ;
  v_msgs INT := 0;
BEGIN
  SELECT mw.window_expires_at, mw.message_count_in_window
    INTO v_expires, v_msgs
  FROM public.message_windows mw
  WHERE mw.merchant_id = p_merchant_id
    AND mw.platform = p_platform
    AND (
      (p_customer_phone IS NOT NULL AND mw.customer_phone = p_customer_phone)
      OR (p_customer_instagram IS NOT NULL AND lower(mw.customer_instagram) = lower(p_customer_instagram))
    )
  ORDER BY mw.window_expires_at DESC
  LIMIT 1;

  IF v_expires IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::timestamptz, NULL::int, 0;
  ELSE
    RETURN QUERY SELECT (v_expires > v_now), v_expires, GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_expires - v_now)) / 60)::int), v_msgs;
  END IF;
END;
$$;

-- Add a composite unique constraint to support ON CONFLICT in update_message_window
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uk_message_windows_identity'
  ) THEN
    ALTER TABLE public.message_windows
      ADD CONSTRAINT uk_message_windows_identity UNIQUE (merchant_id, platform, customer_phone, customer_instagram);
  END IF;
END $$;

-- RLS enablement if 015/037/039 rely on it
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='message_windows'
  ) THEN
    ALTER TABLE public.message_windows ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

\r\n-- ==== End of: 056_manychat_username_and_message_windows.sql ====\r\n
-- ==== File: 057_currency_and_fx.sql ====\r\n
-- ===============================================
-- 057: Merchant currency & optional FX rates
-- ===============================================

-- Merchant currency (ISO 4217), default IQD
ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS currency CHAR(3) NOT NULL DEFAULT 'IQD';

COMMENT ON COLUMN public.merchants.currency IS 'Default ISO 4217 currency code for pricing/formatting';

-- Optional FX rates table (for future dynamic pricing)
CREATE TABLE IF NOT EXISTS public.fx_rates (
  base CHAR(3) NOT NULL,
  quote CHAR(3) NOT NULL,
  rate NUMERIC(18,8) NOT NULL,
  as_of TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(base, quote)
);

COMMENT ON TABLE public.fx_rates IS 'Optional FX rates for currency conversion';

\r\n-- ==== End of: 057_currency_and_fx.sql ====\r\n
-- ==== File: 058_generic_pricing.sql ====\r\n
-- ===============================================
-- 058: Generic pricing (currency-agnostic)
-- Adds price_amount / sale_price_amount / price_currency to products
-- and backfills from USD fields. Keeps legacy USD fields for compatibility.
-- ===============================================

-- 1) Add generic pricing columns
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS price_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sale_price_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS price_currency CHAR(3) NOT NULL DEFAULT 'USD';

COMMENT ON COLUMN public.products.price_amount IS 'Generic price amount in price_currency';
COMMENT ON COLUMN public.products.sale_price_amount IS 'Generic sale price amount in price_currency';
COMMENT ON COLUMN public.products.price_currency IS 'ISO 4217 currency for price_amount';

-- 2) Backfill price_currency from merchants.currency when available
UPDATE public.products p
SET price_currency = m.currency
FROM public.merchants m
WHERE p.merchant_id = m.id
  AND m.currency IS NOT NULL
  AND m.currency <> ''
  AND p.price_currency = 'USD';

-- 3) Backfill amounts from USD using fx_rates when present; otherwise copy
-- price_amount
UPDATE public.products p
SET price_amount = CASE
  WHEN p.price_currency = 'USD' THEN p.price_usd
  ELSE COALESCE(p.price_usd * fx.rate, p.price_usd)
END
FROM (
  SELECT base, quote, rate FROM public.fx_rates
) fx
WHERE (fx.base = 'USD' AND fx.quote = p.price_currency)
  OR p.price_currency = 'USD';

-- If no fx_rate row matched, ensure price_amount still set
UPDATE public.products
SET price_amount = price_usd
WHERE price_amount = 0;

-- sale_price_amount
UPDATE public.products p
SET sale_price_amount = CASE
  WHEN p.sale_price_usd IS NULL THEN NULL
  WHEN p.price_currency = 'USD' THEN p.sale_price_usd
  ELSE COALESCE(p.sale_price_usd * fx.rate, p.sale_price_usd)
END
FROM (
  SELECT base, quote, rate FROM public.fx_rates
) fx
WHERE p.sale_price_usd IS NOT NULL
  AND ((fx.base = 'USD' AND fx.quote = p.price_currency) OR p.price_currency = 'USD');

-- 4) View exposing effective pricing (for reads)
CREATE OR REPLACE VIEW public.products_priced AS
SELECT
  p.id,
  p.merchant_id,
  p.sku,
  p.name_ar,
  p.category,
  p.price_amount,
  p.sale_price_amount,
  p.price_currency,
  (CASE WHEN p.sale_price_amount IS NOT NULL THEN p.sale_price_amount ELSE p.price_amount END) as effective_price,
  p.stock_quantity,
  p.updated_at,
  p.created_at
FROM public.products p;

COMMENT ON VIEW public.products_priced IS 'Readable view for generic pricing per product';


\r\n-- ==== End of: 058_generic_pricing.sql ====\r\n
-- ==== File: 059_add_ai_config_to_merchants.sql ====\r\n
-- Migration 059: Add ai_config to merchants
-- Ensures AI per-merchant configuration can be stored

ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS ai_config JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.merchants.ai_config IS 'Per-merchant AI configuration (model, temperature, maxTokens, language, etc.)';


\r\n-- ==== End of: 059_add_ai_config_to_merchants.sql ====\r\n
-- ==== File: 060_adjust_audit_logs_for_middleware.sql ====\r\n
-- ===============================================
-- 060: Adjust audit_logs schema to match middleware usage
-- Ensures columns referenced by src/middleware/security.ts exist
-- ===============================================

BEGIN;

-- Ensure audit_logs table exists (created in 042)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema='public' AND table_name='audit_logs'
  ) THEN
    RAISE EXCEPTION 'audit_logs table is missing. Apply migration 042 first.';
  END IF;
END $$;

-- Add columns expected by middleware (idempotent)
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS entity_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS details JSONB,
  ADD COLUMN IF NOT EXISTS trace_id UUID,
  ADD COLUMN IF NOT EXISTS request_path TEXT,
  ADD COLUMN IF NOT EXISTS request_method TEXT,
  ADD COLUMN IF NOT EXISTS execution_time_ms INTEGER,
  ADD COLUMN IF NOT EXISTS memory_usage_mb NUMERIC,
  ADD COLUMN IF NOT EXISTS success BOOLEAN;

-- Helpful indexes for query patterns
CREATE INDEX IF NOT EXISTS idx_audit_logs_trace ON public.audit_logs(trace_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_req ON public.audit_logs(request_method, request_path);

-- Comments for documentation
COMMENT ON COLUMN public.audit_logs.entity_type IS 'Logical entity type (matches middleware)';
COMMENT ON COLUMN public.audit_logs.details IS 'Request/response details payload (JSON)';
COMMENT ON COLUMN public.audit_logs.trace_id IS 'Request trace identifier (UUID)';
COMMENT ON COLUMN public.audit_logs.request_path IS 'HTTP request path';
COMMENT ON COLUMN public.audit_logs.request_method IS 'HTTP method';
COMMENT ON COLUMN public.audit_logs.execution_time_ms IS 'Request execution time in milliseconds';
COMMENT ON COLUMN public.audit_logs.memory_usage_mb IS 'Approximate heap memory MB at time of logging';
COMMENT ON COLUMN public.audit_logs.success IS 'Indicates success/failure of the request';

COMMIT;


\r\n-- ==== End of: 060_adjust_audit_logs_for_middleware.sql ====\r\n
-- ==== File: 061_create_quality_metrics.sql ====\r\n
-- ===============================================
-- 061: Create quality_metrics table (production-safe)
-- ===============================================

CREATE TABLE IF NOT EXISTS public.quality_metrics (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('instagram','whatsapp','facebook')),

  quality_rating numeric,
  messaging_quality_score numeric,

  messages_sent_24h integer DEFAULT 0,
  messages_delivered_24h integer DEFAULT 0,
  messages_read_24h integer DEFAULT 0,
  user_initiated_conversations_24h integer DEFAULT 0,
  business_initiated_conversations_24h integer DEFAULT 0,
  block_rate_24h numeric DEFAULT 0,
  report_rate_24h numeric DEFAULT 0,
  avg_response_time_minutes numeric DEFAULT 0,
  response_rate_24h numeric DEFAULT 0,
  template_violations_24h integer DEFAULT 0,
  policy_violations_24h integer DEFAULT 0,

  status text DEFAULT 'OK' CHECK (status IN ('OK','WARNING','CRITICAL')),
  last_quality_check timestamptz,

  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  metric_date date NOT NULL DEFAULT CURRENT_DATE,

  UNIQUE (merchant_id, platform, metric_date)
);

CREATE INDEX IF NOT EXISTS idx_quality_metrics_merchant_platform_date
  ON public.quality_metrics(merchant_id, platform, metric_date);

-- Maintain updated_at
CREATE OR REPLACE FUNCTION public.update_quality_metrics_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_quality_metrics_updated_at ON public.quality_metrics;
CREATE TRIGGER trigger_quality_metrics_updated_at
  BEFORE UPDATE ON public.quality_metrics
  FOR EACH ROW EXECUTE FUNCTION public.update_quality_metrics_updated_at();

-- Keep metric_date in sync with created_at on insert/update
CREATE OR REPLACE FUNCTION public.sync_quality_metrics_metric_date()
RETURNS TRIGGER AS $$
BEGIN
  NEW.metric_date := (NEW.created_at)::date;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_quality_metrics_metric_date_ins ON public.quality_metrics;
CREATE TRIGGER trg_quality_metrics_metric_date_ins
  BEFORE INSERT ON public.quality_metrics
  FOR EACH ROW EXECUTE FUNCTION public.sync_quality_metrics_metric_date();

DROP TRIGGER IF EXISTS trg_quality_metrics_metric_date_upd ON public.quality_metrics;
CREATE TRIGGER trg_quality_metrics_metric_date_upd
  BEFORE UPDATE OF created_at ON public.quality_metrics
  FOR EACH ROW EXECUTE FUNCTION public.sync_quality_metrics_metric_date();

\r\n-- ==== End of: 061_create_quality_metrics.sql ====\r\n
-- ==== File: 062_enable_rls_minimal.sql ====\r\n
-- ===============================================
-- 062: Minimal RLS enablement using app context
-- Safe policies with TO PUBLIC, driven by app.current_merchant_id
-- ===============================================

-- Helper functions
CREATE OR REPLACE FUNCTION public.current_merchant_id()
RETURNS uuid AS $$
BEGIN
  RETURN COALESCE(current_setting('app.current_merchant_id', true)::uuid,
                  '00000000-0000-0000-0000-000000000000'::uuid);
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS boolean AS $$
BEGIN
  RETURN COALESCE(current_setting('app.is_admin', true)::boolean, false);
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.set_merchant_context(p_merchant_id uuid)
RETURNS void AS $$
BEGIN
  IF p_merchant_id IS NULL THEN
    RAISE EXCEPTION 'merchant_id cannot be null';
  END IF;
  PERFORM set_config('app.current_merchant_id', p_merchant_id::text, true);
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.set_admin_context(p_is_admin boolean DEFAULT true)
RETURNS void AS $$
BEGIN
  PERFORM set_config('app.is_admin', COALESCE(p_is_admin,false)::text, true);
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.clear_security_context()
RETURNS void AS $$
BEGIN
  PERFORM set_config('app.current_merchant_id', '', true);
  PERFORM set_config('app.is_admin', 'false', true);
END; $$ LANGUAGE plpgsql;

-- Enable RLS and create policies if tables exist
DO $$
BEGIN
  -- merchants
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='merchants') THEN
    EXECUTE 'ALTER TABLE public.merchants ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS merchants_tenant_isolation ON public.merchants';
    EXECUTE 'CREATE POLICY merchants_tenant_isolation ON public.merchants '
            'FOR ALL TO PUBLIC '
            'USING (id = public.current_merchant_id() OR public.is_admin_user()) '
            'WITH CHECK (id = public.current_merchant_id() OR public.is_admin_user())';
  END IF;

  -- merchant_credentials
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='merchant_credentials') THEN
    EXECUTE 'ALTER TABLE public.merchant_credentials ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS merchant_credentials_tenant_isolation ON public.merchant_credentials';
    EXECUTE 'CREATE POLICY merchant_credentials_tenant_isolation ON public.merchant_credentials '
            'FOR ALL TO PUBLIC '
            'USING (merchant_id = public.current_merchant_id() OR public.is_admin_user()) '
            'WITH CHECK (merchant_id = public.current_merchant_id() OR public.is_admin_user())';
  END IF;

  -- products
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='products') THEN
    EXECUTE 'ALTER TABLE public.products ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS products_tenant_isolation ON public.products';
    EXECUTE 'CREATE POLICY products_tenant_isolation ON public.products '
            'FOR ALL TO PUBLIC '
            'USING (merchant_id = public.current_merchant_id() OR public.is_admin_user()) '
            'WITH CHECK (merchant_id = public.current_merchant_id() OR public.is_admin_user())';
  END IF;

  -- orders
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='orders') THEN
    EXECUTE 'ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS orders_tenant_isolation ON public.orders';
    EXECUTE 'CREATE POLICY orders_tenant_isolation ON public.orders '
            'FOR ALL TO PUBLIC '
            'USING (merchant_id = public.current_merchant_id() OR public.is_admin_user()) '
            'WITH CHECK (merchant_id = public.current_merchant_id() OR public.is_admin_user())';
  END IF;

  -- conversations
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='conversations') THEN
    EXECUTE 'ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS conversations_tenant_isolation ON public.conversations';
    EXECUTE 'CREATE POLICY conversations_tenant_isolation ON public.conversations '
            'FOR ALL TO PUBLIC '
            'USING (merchant_id = public.current_merchant_id() OR public.is_admin_user()) '
            'WITH CHECK (merchant_id = public.current_merchant_id() OR public.is_admin_user())';
  END IF;

  -- message_logs (via conversation)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='message_logs') THEN
    EXECUTE 'ALTER TABLE public.message_logs ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS message_logs_tenant_isolation ON public.message_logs';
    EXECUTE 'CREATE POLICY message_logs_tenant_isolation ON public.message_logs '
            'FOR ALL TO PUBLIC '
            'USING (conversation_id IN (SELECT id FROM public.conversations WHERE merchant_id = public.current_merchant_id()) OR public.is_admin_user()) '
            'WITH CHECK (conversation_id IN (SELECT id FROM public.conversations WHERE merchant_id = public.current_merchant_id()) OR public.is_admin_user())';
  END IF;

  -- message_windows
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='message_windows') THEN
    EXECUTE 'ALTER TABLE public.message_windows ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS message_windows_tenant_isolation ON public.message_windows';
    EXECUTE 'CREATE POLICY message_windows_tenant_isolation ON public.message_windows '
            'FOR ALL TO PUBLIC '
            'USING (merchant_id = public.current_merchant_id() OR public.is_admin_user()) '
            'WITH CHECK (merchant_id = public.current_merchant_id() OR public.is_admin_user())';
  END IF;

  -- manychat_subscribers
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='manychat_subscribers') THEN
    EXECUTE 'ALTER TABLE public.manychat_subscribers ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS manychat_subscribers_tenant_isolation ON public.manychat_subscribers';
    EXECUTE 'CREATE POLICY manychat_subscribers_tenant_isolation ON public.manychat_subscribers '
            'FOR ALL TO PUBLIC '
            'USING (merchant_id = public.current_merchant_id() OR public.is_admin_user()) '
            'WITH CHECK (merchant_id = public.current_merchant_id() OR public.is_admin_user())';
  END IF;

  -- manychat_logs
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='manychat_logs') THEN
    EXECUTE 'ALTER TABLE public.manychat_logs ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS manychat_logs_tenant_isolation ON public.manychat_logs';
    EXECUTE 'CREATE POLICY manychat_logs_tenant_isolation ON public.manychat_logs '
            'FOR ALL TO PUBLIC '
            'USING (merchant_id = public.current_merchant_id() OR public.is_admin_user()) '
            'WITH CHECK (merchant_id = public.current_merchant_id() OR public.is_admin_user())';
  END IF;

  -- audit_logs
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='audit_logs') THEN
    EXECUTE 'ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS audit_logs_tenant_isolation ON public.audit_logs';
    EXECUTE 'CREATE POLICY audit_logs_tenant_isolation ON public.audit_logs '
            'FOR ALL TO PUBLIC '
            'USING (merchant_id = public.current_merchant_id() OR merchant_id IS NULL OR public.is_admin_user()) '
            'WITH CHECK (merchant_id = public.current_merchant_id() OR merchant_id IS NULL OR public.is_admin_user())';
  END IF;

  -- quality_metrics
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='quality_metrics') THEN
    EXECUTE 'ALTER TABLE public.quality_metrics ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS quality_metrics_tenant_isolation ON public.quality_metrics';
    EXECUTE 'CREATE POLICY quality_metrics_tenant_isolation ON public.quality_metrics '
            'FOR ALL TO PUBLIC '
            'USING (merchant_id = public.current_merchant_id() OR public.is_admin_user()) '
            'WITH CHECK (merchant_id = public.current_merchant_id() OR public.is_admin_user())';
  END IF;
END $$;

\r\n-- ==== End of: 062_enable_rls_minimal.sql ====\r\n
-- ==== File: 063_message_windows_active_index.sql ====\r\n
-- ===============================================
-- 063: Performance index for message_windows active queries
-- ===============================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='message_windows') THEN
    CREATE INDEX IF NOT EXISTS idx_message_windows_active_time
      ON public.message_windows(merchant_id, platform, window_expires_at DESC);
  END IF;
END $$;


\r\n-- ==== End of: 063_message_windows_active_index.sql ====\r\n
-- ==== File: 064_create_job_spool.sql ====\r\n
-- ===============================================
-- 064: Create job_spool table + minimal RLS
-- ===============================================

CREATE TABLE IF NOT EXISTS public.job_spool (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id text NOT NULL UNIQUE,
  job_type text NOT NULL,
  job_data jsonb,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  scheduled_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  processed_at timestamptz
);

-- Helpful indexes for scheduler and stats
CREATE INDEX IF NOT EXISTS idx_job_spool_pending ON public.job_spool (scheduled_at, created_at)
  WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_job_spool_priority ON public.job_spool (priority, created_at)
  WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_job_spool_type ON public.job_spool (job_type)
  WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_job_spool_merchant ON public.job_spool (merchant_id);

-- Minimal RLS: allow tenant rows or admin mode
ALTER TABLE public.job_spool ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='job_spool' AND policyname='job_spool_tenant_isolation'
  ) THEN
    EXECUTE 'CREATE POLICY job_spool_tenant_isolation ON public.job_spool '
            'FOR ALL TO PUBLIC '
            'USING (merchant_id = public.current_merchant_id() '
            '       OR COALESCE(current_setting(''app.admin_mode'', true), ''false'')::boolean '
            '       OR public.is_admin_user()) '
            'WITH CHECK (merchant_id = public.current_merchant_id() '
            '       OR COALESCE(current_setting(''app.admin_mode'', true), ''false'')::boolean '
            '       OR public.is_admin_user())';
  END IF;
END $$;
\r\n-- ==== End of: 064_create_job_spool.sql ====\r\n
-- ==== File: 065_normalize_platform_case.sql ====\r\n
-- ===============================================
-- 065: Normalize platform case to lowercase for conversations and message_logs
-- Aligns schema with application using lowercase ('instagram','whatsapp')
-- ===============================================

BEGIN;

-- Conversations: update data then adjust CHECK constraint
UPDATE public.conversations
SET platform = LOWER(platform)
WHERE platform IS NOT NULL;

ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_platform_check;

ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_platform_check
  CHECK (platform IN ('instagram','whatsapp'));

-- Message logs: update data then adjust CHECK constraint
UPDATE public.message_logs
SET platform = LOWER(platform)
WHERE platform IS NOT NULL;

ALTER TABLE public.message_logs
  DROP CONSTRAINT IF EXISTS message_logs_platform_check;

ALTER TABLE public.message_logs
  ADD CONSTRAINT message_logs_platform_check
  CHECK (platform IN ('instagram','whatsapp'));

COMMIT;
\r\n-- ==== End of: 065_normalize_platform_case.sql ====\r\n
-- ==== File: 066_fix_manychat_unique_conflict.sql ====\r\n
-- ===============================================
-- 066: Ensure ON CONFLICT works for manychat_subscribers
-- Adds a real UNIQUE CONSTRAINT on (merchant_id, instagram_username)
-- and normalizes usernames to lowercase
-- ===============================================

BEGIN;

-- Normalize existing usernames to lowercase
UPDATE public.manychat_subscribers
SET instagram_username = LOWER(instagram_username)
WHERE instagram_username IS NOT NULL;

-- Add unique constraint to support ON CONFLICT (merchant_id, instagram_username)
ALTER TABLE public.manychat_subscribers
  ADD CONSTRAINT uq_manychat_merchant_username
  UNIQUE (merchant_id, instagram_username);

COMMIT;
\r\n-- ==== End of: 066_fix_manychat_unique_conflict.sql ====\r\n
-- ==== File: 067_add_instagram_business_account_id_to_credentials.sql ====\r\n
-- ===============================================
-- 067: Add instagram_business_account_id to merchant_credentials (compat)
-- ===============================================

ALTER TABLE public.merchant_credentials
  ADD COLUMN IF NOT EXISTS instagram_business_account_id TEXT;

-- Optional helper index
CREATE INDEX IF NOT EXISTS idx_mc_instagram_business_account_id
  ON public.merchant_credentials(instagram_business_account_id);
\r\n-- ==== End of: 067_add_instagram_business_account_id_to_credentials.sql ====\r\n
-- ==== File: 068_create_merchant_service_status.sql ====\r\n
-- ===============================================
-- 068: Create merchant_service_status table
-- ===============================================

CREATE TABLE IF NOT EXISTS public.merchant_service_status (
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  service_name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (merchant_id, service_name)
);

CREATE INDEX IF NOT EXISTS idx_mss_merchant ON public.merchant_service_status(merchant_id);

-- Maintain updated_at
CREATE OR REPLACE FUNCTION public.update_mss_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mss_updated ON public.merchant_service_status;
CREATE TRIGGER trg_mss_updated
  BEFORE UPDATE ON public.merchant_service_status
  FOR EACH ROW EXECUTE FUNCTION public.update_mss_updated_at();

-- Minimal RLS
ALTER TABLE public.merchant_service_status ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='merchant_service_status' AND policyname='mss_tenant'
  ) THEN
    EXECUTE 'CREATE POLICY mss_tenant ON public.merchant_service_status '
            'FOR ALL TO PUBLIC '
            'USING (merchant_id = public.current_merchant_id() OR public.is_admin_user()) '
            'WITH CHECK (merchant_id = public.current_merchant_id() OR public.is_admin_user())';
  END IF;
END $$;
\r\n-- ==== End of: 068_create_merchant_service_status.sql ====\r\n
-- ==== File: 069_create_merchant_kb_docs.sql ====\r\n
-- 069: Create per-merchant knowledge base docs with pgvector

DO $$ BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS vector;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'vector extension not available on this cluster';
  END;
END $$;

CREATE TABLE IF NOT EXISTS public.merchant_kb_docs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  chunk TEXT NOT NULL,
  embedding vector(1536),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_kb_docs_merchant ON public.merchant_kb_docs (merchant_id);
DO $$ BEGIN
  -- HNSW index only if extension available
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'vector'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_kb_docs_embedding ON public.merchant_kb_docs USING hnsw (embedding vector_cosine_ops);
  ELSE
    RAISE NOTICE 'pgvector not enabled; similarity search fallback will be used.';
  END IF;
END $$;

-- RLS
ALTER TABLE public.merchant_kb_docs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kb_docs_tenant_isolation ON public.merchant_kb_docs;
CREATE POLICY kb_docs_tenant_isolation ON public.merchant_kb_docs
  FOR ALL USING (
    merchant_id::text = current_setting('app.current_merchant_id', true)
    OR COALESCE(current_setting('app.is_admin', true), 'false')::boolean = true
  );


\r\n-- ==== End of: 069_create_merchant_kb_docs.sql ====\r\n
-- ==== File: 070_add_source_channel.sql ====\r\n
-- 070: Add source_channel (e.g., 'manychat') to conversations and message_logs

-- conversations.source_channel
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS source_channel TEXT;

-- message_logs.source_channel
ALTER TABLE public.message_logs
  ADD COLUMN IF NOT EXISTS source_channel TEXT;

-- optional indexes
CREATE INDEX IF NOT EXISTS idx_conversations_source_channel ON public.conversations (source_channel);
CREATE INDEX IF NOT EXISTS idx_message_logs_source_channel ON public.message_logs (source_channel);


\r\n-- ==== End of: 070_add_source_channel.sql ====\r\n
-- ==== File: 071_add_merchant_type_and_kb_tags.sql ====\r\n
-- 071: Add merchant_type enum, merchants.merchant_type, and KB tags

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'merchant_type') THEN
    CREATE TYPE public.merchant_type AS ENUM (
      'home','electric','fashion','grocery','pharmacy','toys','beauty','sports','books','auto','other'
    );
  END IF;
END $$;

ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS merchant_type public.merchant_type NOT NULL DEFAULT 'other';

COMMENT ON COLUMN public.merchants.merchant_type IS 'Merchant vertical for per-tenant tuning (multi-vertical support)';

-- KB tags for filtering (e.g., {"type":"electric","policy":"returns"})
ALTER TABLE public.merchant_kb_docs
  ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '{}'::jsonb;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_products_mrch_cat ON public.products(merchant_id, category);
CREATE INDEX IF NOT EXISTS idx_products_mrch_sku ON public.products(merchant_id, sku);
CREATE INDEX IF NOT EXISTS idx_kb_docs_tags_gin ON public.merchant_kb_docs USING GIN (tags);

-- Re-affirm RLS on key tables (no-op if already enabled)
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_logs ENABLE ROW LEVEL SECURITY;
-- products_priced is a VIEW backed by products; RLS enforced on base table


\r\n-- ==== End of: 071_add_merchant_type_and_kb_tags.sql ====\r\n
-- ==== File: 072_discounts_effective_prices_vaults.sql ====\r\n
-- 072: Merchant discounts, effective prices view (IQD), and customer vaults with TTL

-- 1) Discounts table per-merchant
CREATE TABLE IF NOT EXISTS public.merchant_discounts (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  -- Either percent_off (0..100) or fixed amount_off_iqd (in IQD)
  percent_off numeric CHECK (percent_off >= 0 AND percent_off <= 100),
  amount_off_iqd numeric CHECK (amount_off_iqd >= 0),
  starts_at timestamptz NOT NULL DEFAULT NOW(),
  ends_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discounts_active ON public.merchant_discounts(merchant_id, is_active, starts_at, ends_at);

-- 2) Effective prices view in IQD with discount applied
-- Requires fx_rates(base, quote, rate) to convert from price_currency -> IQD
CREATE OR REPLACE VIEW public.products_effective_prices AS
WITH base_price AS (
  SELECT
    p.id,
    p.merchant_id,
    p.sku,
    p.name_ar,
    p.category,
    p.stock_quantity,
    COALESCE(p.sale_price_amount, p.price_amount) AS base_amount,
    UPPER(p.price_currency) AS price_currency
  FROM public.products p
),
to_iqd AS (
  SELECT b.*, 
    CASE 
      WHEN b.price_currency = 'IQD' THEN b.base_amount
      ELSE b.base_amount * COALESCE((SELECT rate FROM public.fx_rates WHERE base = b.price_currency AND quote = 'IQD' LIMIT 1), 1)
    END AS base_price_iqd
  FROM base_price b
),
active_discount AS (
  SELECT d.* FROM public.merchant_discounts d
  WHERE d.is_active = true
    AND (d.starts_at IS NULL OR d.starts_at <= NOW())
    AND (d.ends_at IS NULL OR d.ends_at >= NOW())
)
SELECT 
  t.id,
  t.merchant_id,
  t.sku,
  t.name_ar,
  t.category,
  t.stock_quantity,
  t.base_price_iqd,
  -- Choose amount_off_iqd first if present; otherwise percent_off
  GREATEST(0, 
    t.base_price_iqd - COALESCE(
      (SELECT amount_off_iqd FROM active_discount ad WHERE ad.merchant_id = t.merchant_id LIMIT 1),
      (SELECT (t.base_price_iqd * (ad2.percent_off/100.0)) FROM active_discount ad2 WHERE ad2.merchant_id = t.merchant_id LIMIT 1),
      0
    )
  ) AS final_price_iqd
FROM to_iqd t;

COMMENT ON VIEW public.products_effective_prices IS 'Per-merchant effective IQD prices with discounts applied';

-- 3) Customer vaults for per-customer per-merchant context with TTL
CREATE TABLE IF NOT EXISTS public.customer_vaults (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  customer_id text NOT NULL,
  conversation_id uuid,
  status text DEFAULT 'active',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  purge_after timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (merchant_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_vaults_merchant_customer ON public.customer_vaults(merchant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_vaults_purge ON public.customer_vaults(purge_after);

-- RLS
ALTER TABLE public.customer_vaults ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customer_vaults_tenant_isolation ON public.customer_vaults;
CREATE POLICY customer_vaults_tenant_isolation ON public.customer_vaults
  FOR ALL USING (
    merchant_id::text = current_setting('app.current_merchant_id', true)
    OR COALESCE(current_setting('app.is_admin', true), 'false')::boolean = true
  );

-- Purge job function (to be scheduled externally every 10 minutes)
CREATE OR REPLACE FUNCTION public.cleanup_customer_vaults()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.customer_vaults WHERE purge_after IS NOT NULL AND purge_after <= NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;


\r\n-- ==== End of: 072_discounts_effective_prices_vaults.sql ====\r\n
-- ==== File: 073_seed_ai_config_and_trgm.sql ====\r\n
-- 073: Seed merchants.ai_config defaults and add trigram index for product names

-- Ensure pg_trgm extension exists (for trigram index)
DO $$ BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_trgm extension not available';
  END;
END $$;

-- Add trigram index on products.name_ar for faster fuzzy search
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON public.products USING gin (name_ar gin_trgm_ops);
  ELSE
    RAISE NOTICE 'pg_trgm not enabled; skipping trigram index';
  END IF;
END $$;

-- Seed ai_config for merchants that have NULL or missing synonyms
UPDATE public.merchants
SET ai_config = COALESCE(ai_config, '{}'::jsonb) || '{
  "synonyms": {"Ø¬Ø²Ù…Ù‡": ["Ø­Ø°Ø§Ø¡","Ø¨ÙˆØª"], "Ø±Ø¬Ø§ÙŠ": ["Ø±Ø¬Ø§Ù„ÙŠ"]},
  "categories": [],
  "colors": [],
  "genders": [],
  "sizeAliases": {}
}'::jsonb
WHERE ai_config IS NULL 
   OR (ai_config ? 'synonyms') = false;

COMMENT ON COLUMN public.merchants.ai_config IS 'Per-merchant AI hints (synonyms/categories/etc). Seeded with Arabic defaults when missing.';


\r\n-- ==== End of: 073_seed_ai_config_and_trgm.sql ====\r\n
-- ==== File: 074_conversation_rejections.sql ====\r\n
-- 074: Conversation rejections table for objection handling analytics

CREATE TABLE IF NOT EXISTS public.conversation_rejections (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  customer_id text NOT NULL,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  rejection_type text NOT NULL CHECK (rejection_type IN ('price','quality','timing','other')),
  rejection_reason text,
  customer_message text,
  ai_strategies_used jsonb,
  context_data jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

ALTER TABLE public.conversation_rejections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conversation_rejections_tenant_isolation ON public.conversation_rejections;
CREATE POLICY conversation_rejections_tenant_isolation ON public.conversation_rejections
  FOR ALL USING (
    merchant_id::text = current_setting('app.current_merchant_id', true)
    OR COALESCE(current_setting('app.is_admin', true), 'false')::boolean = true
  );

CREATE INDEX IF NOT EXISTS idx_conv_reject_merchant_created ON public.conversation_rejections(merchant_id, created_at DESC);


\r\n-- ==== End of: 074_conversation_rejections.sql ====\r\n
-- ==== File: 075_message_image_metadata.sql ====\r\n
-- 075: Message image metadata storage

CREATE TABLE IF NOT EXISTS public.message_image_metadata (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id uuid REFERENCES public.message_logs(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  customer_id text,
  mime_type text,
  width int,
  height int,
  size_bytes int,
  content_hash text,
  ocr_text text,
  labels jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_msg_img_meta_message ON public.message_image_metadata(message_id);
CREATE INDEX IF NOT EXISTS idx_msg_img_meta_merchant ON public.message_image_metadata(merchant_id);


\r\n-- ==== End of: 075_message_image_metadata.sql ====\r\n
-- ==== File: 076_customer_memory.sql ====\r\n
-- 076: Customer memory (preferences + behavior history)

CREATE TABLE IF NOT EXISTS public.customer_preferences (
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  customer_id text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (merchant_id, customer_id)
);

CREATE TABLE IF NOT EXISTS public.customer_behavior_history (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  customer_id text NOT NULL,
  event_type text NOT NULL,
  product_id text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cust_behavior_merchant ON public.customer_behavior_history(merchant_id);
CREATE INDEX IF NOT EXISTS idx_cust_behavior_customer ON public.customer_behavior_history(customer_id);


\r\n-- ==== End of: 076_customer_memory.sql ====\r\n
-- ==== File: 077_proactive_messaging.sql ====\r\n
-- 077: Proactive messaging system tables

-- Table for storing proactive messages
CREATE TABLE IF NOT EXISTS public.proactive_messages (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  customer_id text NOT NULL,
  type text NOT NULL CHECK (type IN ('SIZE_WARNING', 'RESTOCK_ALERT', 'FOLLOWUP_MESSAGE', 'LOYALTY_OFFER', 'SATISFACTION_CHECK')),
  message text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  sent_at timestamptz,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'CANCELLED')),
  context jsonb DEFAULT '{}'::jsonb,
  priority text NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

-- Table for merchant proactive settings
CREATE TABLE IF NOT EXISTS public.proactive_settings (
  merchant_id uuid PRIMARY KEY REFERENCES public.merchants(id) ON DELETE CASCADE,
  enable_proactive_messages boolean NOT NULL DEFAULT true,
  enable_follow_ups boolean NOT NULL DEFAULT true,
  enable_stock_alerts boolean NOT NULL DEFAULT true,
  enable_churn_prevention boolean NOT NULL DEFAULT true,
  max_messages_per_day integer NOT NULL DEFAULT 3,
  quiet_hours_start integer NOT NULL DEFAULT 22 CHECK (quiet_hours_start >= 0 AND quiet_hours_start <= 23),
  quiet_hours_end integer NOT NULL DEFAULT 6 CHECK (quiet_hours_end >= 0 AND quiet_hours_end <= 23),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

-- Table for tracking prediction accuracy (for ML improvement)
CREATE TABLE IF NOT EXISTS public.prediction_accuracy (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  customer_id text NOT NULL,
  prediction_type text NOT NULL CHECK (prediction_type IN ('SIZE_ISSUE', 'CHURN_RISK', 'PURCHASE_TIMING')),
  predicted_value jsonb NOT NULL,
  actual_outcome jsonb,
  accuracy_score float,
  prediction_date timestamptz NOT NULL,
  outcome_date timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

-- Table for customer interaction patterns (for timing optimization)
CREATE TABLE IF NOT EXISTS public.customer_interaction_patterns (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  customer_id text NOT NULL,
  interaction_hour integer NOT NULL CHECK (interaction_hour >= 0 AND interaction_hour <= 23),
  day_of_week integer NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  response_rate float NOT NULL DEFAULT 0,
  interaction_count integer NOT NULL DEFAULT 1,
  last_updated timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE(merchant_id, customer_id, interaction_hour, day_of_week)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_proactive_msg_merchant ON public.proactive_messages(merchant_id);
CREATE INDEX IF NOT EXISTS idx_proactive_msg_customer ON public.proactive_messages(customer_id);
CREATE INDEX IF NOT EXISTS idx_proactive_msg_scheduled ON public.proactive_messages(scheduled_at) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_proactive_msg_status ON public.proactive_messages(status);
CREATE INDEX IF NOT EXISTS idx_proactive_msg_priority ON public.proactive_messages(priority);

CREATE INDEX IF NOT EXISTS idx_prediction_accuracy_merchant ON public.prediction_accuracy(merchant_id);
CREATE INDEX IF NOT EXISTS idx_prediction_accuracy_type ON public.prediction_accuracy(prediction_type);
CREATE INDEX IF NOT EXISTS idx_prediction_accuracy_date ON public.prediction_accuracy(prediction_date);

CREATE INDEX IF NOT EXISTS idx_interaction_patterns_merchant ON public.customer_interaction_patterns(merchant_id);
CREATE INDEX IF NOT EXISTS idx_interaction_patterns_customer ON public.customer_interaction_patterns(customer_id);

-- Function to update interaction patterns automatically
CREATE OR REPLACE FUNCTION update_interaction_patterns()
RETURNS TRIGGER AS $$
BEGIN
  -- Only process incoming messages (customer responses)
  IF NEW.direction = 'INCOMING' THEN
    INSERT INTO public.customer_interaction_patterns (
      merchant_id, customer_id, interaction_hour, day_of_week, response_rate, interaction_count
    )
    SELECT 
      c.merchant_id,
      c.customer_instagram,
      EXTRACT(HOUR FROM NEW.created_at)::integer,
      EXTRACT(DOW FROM NEW.created_at)::integer,
      1.0,
      1
    FROM conversations c
    WHERE c.id = NEW.conversation_id
    ON CONFLICT (merchant_id, customer_id, interaction_hour, day_of_week)
    DO UPDATE SET
      interaction_count = customer_interaction_patterns.interaction_count + 1,
      response_rate = (customer_interaction_patterns.response_rate * customer_interaction_patterns.interaction_count + 1.0) / (customer_interaction_patterns.interaction_count + 1),
      last_updated = NOW();
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update interaction patterns
DROP TRIGGER IF EXISTS trigger_update_interaction_patterns ON public.message_logs;
CREATE TRIGGER trigger_update_interaction_patterns
  AFTER INSERT ON public.message_logs
  FOR EACH ROW
  EXECUTE FUNCTION update_interaction_patterns();

-- Insert default settings for existing merchants
INSERT INTO public.proactive_settings (merchant_id)
SELECT id FROM public.merchants
WHERE id NOT IN (SELECT merchant_id FROM public.proactive_settings)
ON CONFLICT (merchant_id) DO NOTHING;
\r\n-- ==== End of: 077_proactive_messaging.sql ====\r\n
-- ==== File: 078_prediction_tables.sql ====\r\n
-- 078: Additional prediction and analytics tables

-- Table for storing customer insights cache (performance optimization)
CREATE TABLE IF NOT EXISTS public.customer_insights_cache (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  customer_id text NOT NULL,
  insights jsonb NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT NOW(),
  expires_at timestamptz NOT NULL DEFAULT (NOW() + INTERVAL '6 hours'),
  UNIQUE(merchant_id, customer_id)
);

-- Table for tracking size issues and returns
CREATE TABLE IF NOT EXISTS public.size_issue_tracking (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  customer_id text NOT NULL,
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id text NOT NULL,
  predicted_size text,
  actual_size text,
  issue_type text CHECK (issue_type IN ('TOO_SMALL', 'TOO_LARGE', 'WRONG_FIT', 'RETURNED', 'EXCHANGED')),
  prediction_confidence float,
  issue_resolved boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

-- Table for churn prediction tracking
CREATE TABLE IF NOT EXISTS public.churn_prediction_tracking (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  customer_id text NOT NULL,
  predicted_churn_date timestamptz,
  churn_probability float NOT NULL,
  risk_factors jsonb,
  prevention_actions jsonb,
  actual_churn_date timestamptz,
  prevention_successful boolean,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

-- Table for proactive action results tracking
CREATE TABLE IF NOT EXISTS public.proactive_action_results (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  customer_id text NOT NULL,
  action_type text NOT NULL,
  message_sent text,
  sent_at timestamptz,
  customer_responded boolean DEFAULT false,
  response_time_minutes integer,
  conversion_achieved boolean DEFAULT false,
  conversion_value float,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

-- Table for storing ML model metadata and performance
CREATE TABLE IF NOT EXISTS public.ml_model_performance (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  model_type text NOT NULL CHECK (model_type IN ('SIZE_PREDICTION', 'CHURN_PREDICTION', 'TIMING_OPTIMIZATION')),
  merchant_id uuid REFERENCES public.merchants(id) ON DELETE CASCADE,
  model_version text NOT NULL,
  accuracy_score float,
  precision_score float,
  recall_score float,
  f1_score float,
  training_data_size integer,
  evaluation_date timestamptz NOT NULL,
  model_params jsonb,
  feature_importance jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_insights_cache_merchant ON public.customer_insights_cache(merchant_id);
CREATE INDEX IF NOT EXISTS idx_insights_cache_expires ON public.customer_insights_cache(expires_at);

CREATE INDEX IF NOT EXISTS idx_size_tracking_merchant ON public.size_issue_tracking(merchant_id);
CREATE INDEX IF NOT EXISTS idx_size_tracking_customer ON public.size_issue_tracking(customer_id);
CREATE INDEX IF NOT EXISTS idx_size_tracking_product ON public.size_issue_tracking(product_id);

CREATE INDEX IF NOT EXISTS idx_churn_tracking_merchant ON public.churn_prediction_tracking(merchant_id);
CREATE INDEX IF NOT EXISTS idx_churn_tracking_customer ON public.churn_prediction_tracking(customer_id);
CREATE INDEX IF NOT EXISTS idx_churn_tracking_date ON public.churn_prediction_tracking(predicted_churn_date);

CREATE INDEX IF NOT EXISTS idx_action_results_merchant ON public.proactive_action_results(merchant_id);
CREATE INDEX IF NOT EXISTS idx_action_results_customer ON public.proactive_action_results(customer_id);
CREATE INDEX IF NOT EXISTS idx_action_results_sent ON public.proactive_action_results(sent_at);

CREATE INDEX IF NOT EXISTS idx_ml_performance_type ON public.ml_model_performance(model_type);
CREATE INDEX IF NOT EXISTS idx_ml_performance_merchant ON public.ml_model_performance(merchant_id);

-- Function to clean up expired cache entries
CREATE OR REPLACE FUNCTION cleanup_expired_cache()
RETURNS void AS $$
BEGIN
  DELETE FROM public.customer_insights_cache 
  WHERE expires_at < NOW();
  
  -- Also cleanup old proactive messages (keep last 30 days)
  DELETE FROM public.proactive_messages 
  WHERE created_at < NOW() - INTERVAL '30 days' 
    AND status IN ('SENT', 'FAILED', 'CANCELLED');
    
  -- Cleanup old prediction tracking (keep last 90 days)
  DELETE FROM public.prediction_accuracy 
  WHERE created_at < NOW() - INTERVAL '90 days';
END;
$$ LANGUAGE plpgsql;

-- Function to automatically update proactive action results
CREATE OR REPLACE FUNCTION track_proactive_response()
RETURNS TRIGGER AS $$
DECLARE
  recent_message_id uuid;
  time_diff_minutes integer;
BEGIN
  -- Only track incoming messages (customer responses)
  IF NEW.direction = 'INCOMING' THEN
    -- Find recent proactive message to this customer
    SELECT pm.id INTO recent_message_id
    FROM proactive_messages pm
    WHERE pm.merchant_id = (SELECT c.merchant_id FROM conversations c WHERE c.id = NEW.conversation_id)
      AND pm.customer_id = (SELECT c.customer_instagram FROM conversations c WHERE c.id = NEW.conversation_id)
      AND pm.sent_at IS NOT NULL
      AND pm.sent_at >= NOW() - INTERVAL '24 hours'
    ORDER BY pm.sent_at DESC
    LIMIT 1;
    
    -- If we found a recent proactive message, update the results
    IF recent_message_id IS NOT NULL THEN
      SELECT EXTRACT(EPOCH FROM (NEW.created_at - pm.sent_at))/60 INTO time_diff_minutes
      FROM proactive_messages pm
      WHERE pm.id = recent_message_id;
      
      INSERT INTO proactive_action_results (
        merchant_id, customer_id, action_type, customer_responded, 
        response_time_minutes, sent_at
      )
      SELECT 
        pm.merchant_id,
        pm.customer_id,
        pm.type,
        true,
        time_diff_minutes,
        pm.sent_at
      FROM proactive_messages pm
      WHERE pm.id = recent_message_id
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for tracking proactive responses
DROP TRIGGER IF EXISTS trigger_track_proactive_response ON public.message_logs;
CREATE TRIGGER trigger_track_proactive_response
  AFTER INSERT ON public.message_logs
  FOR EACH ROW
  EXECUTE FUNCTION track_proactive_response();
\r\n-- ==== End of: 078_prediction_tables.sql ====\r\n
-- ==== File: 080_instagram_interactions.sql ====\r\n
-- 080: Instagram interactions tables

-- Core table: story interactions
CREATE TABLE IF NOT EXISTS public.instagram_story_interactions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  customer_id text NOT NULL,
  story_id text,
  interaction_type text NOT NULL CHECK (interaction_type IN ('reply','emoji','question')),
  content text,
  window_expires_at timestamptz,
  converted_to_sale boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

-- Default window expiry to 24h if not provided
CREATE OR REPLACE FUNCTION set_isi_window_expiry()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.window_expires_at IS NULL THEN
    NEW.window_expires_at := NOW() + INTERVAL '24 hours';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_set_isi_window_expiry ON public.instagram_story_interactions;
CREATE TRIGGER trigger_set_isi_window_expiry
  BEFORE INSERT ON public.instagram_story_interactions
  FOR EACH ROW
  EXECUTE FUNCTION set_isi_window_expiry();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_isi_merchant_created ON public.instagram_story_interactions(merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_isi_customer_created ON public.instagram_story_interactions(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_isi_type ON public.instagram_story_interactions(interaction_type);

-- Enable RLS and add tenant policy
ALTER TABLE public.instagram_story_interactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS isi_tenant_policy ON public.instagram_story_interactions;
CREATE POLICY isi_tenant_policy ON public.instagram_story_interactions
  FOR ALL USING (
    merchant_id = current_setting('app.current_merchant_id', true)::uuid
  );

\r\n-- ==== End of: 080_instagram_interactions.sql ====\r\n
-- ==== File: 081_fix_instagram_order_items_returns.sql ====\r\n
-- 081: Fix schema for Instagram analytics and order items
-- Adds missing columns and tables used by analytics and profiling code

-- Safety: ensure required extension exists
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1) Ensure conversations has customer_instagram (older DBs may miss it)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'conversations' AND column_name = 'customer_instagram'
  ) THEN
    ALTER TABLE public.conversations
      ADD COLUMN customer_instagram TEXT;
    -- Helpful index for lookups
    CREATE INDEX IF NOT EXISTS idx_conversations_customer_instagram
      ON public.conversations (customer_instagram, platform);
  END IF;
END $$;

-- 2) Ensure orders has customer_instagram (code uses it for joins)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'customer_instagram'
  ) THEN
    ALTER TABLE public.orders
      ADD COLUMN customer_instagram TEXT;
    -- Optional index to speed up per-customer analytics
    CREATE INDEX IF NOT EXISTS idx_orders_merchant_customer_instagram
      ON public.orders (merchant_id, customer_instagram);
  END IF;
END $$;

-- 3) Create order_items table if missing (some environments stored items JSON only)
CREATE TABLE IF NOT EXISTS public.order_items (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  price numeric(12,2),
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON public.order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON public.order_items(product_id);

-- 4) Minimal returns table to support LEFT JOINs used by analytics
CREATE TABLE IF NOT EXISTS public.returns (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  rating integer,
  reason text,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_returns_order ON public.returns(order_id);

-- Notes:
-- - Code expects joins like: orders o -> order_items oi -> products p, and optional returns r.
-- - This migration aligns DB schema with application queries without altering existing data.


\r\n-- ==== End of: 081_fix_instagram_order_items_returns.sql ====\r\n
-- ==== File: 081_fix_predictive_analytics_schema.sql ====\r\n
-- ===============================================
-- Migration 080: Fix Predictive Analytics Schema Issues
-- Fixes SQL query errors found in production logs
-- ===============================================

-- 1. Add missing columns to products table
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS size VARCHAR(50),
ADD COLUMN IF NOT EXISTS color VARCHAR(50),
ADD COLUMN IF NOT EXISTS material VARCHAR(100),
ADD COLUMN IF NOT EXISTS brand VARCHAR(100);

-- Create indexes for new product columns
CREATE INDEX IF NOT EXISTS idx_products_size ON products(size) WHERE size IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_color ON products(color) WHERE color IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand) WHERE brand IS NOT NULL;

-- 2. Create order_items table (referenced by predictive analytics)
CREATE TABLE IF NOT EXISTS order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    
    -- Product details at time of order
    product_name TEXT NOT NULL,
    product_sku VARCHAR(100) NOT NULL,
    size VARCHAR(50),
    color VARCHAR(50),
    
    -- Quantities and pricing
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price DECIMAL(10,2) NOT NULL CHECK (unit_price >= 0),
    discount_amount DECIMAL(10,2) DEFAULT 0 CHECK (discount_amount >= 0),
    total_price DECIMAL(10,2) NOT NULL CHECK (total_price >= 0),
    
    -- Product attributes snapshot
    product_attributes JSONB DEFAULT '{}',
    
    -- Audit fields
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for order_items
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_order_items_size ON order_items(size) WHERE size IS NOT NULL;

-- 3. Create returns table (referenced in predictive analytics)
CREATE TABLE IF NOT EXISTS returns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    order_item_id UUID REFERENCES order_items(id) ON DELETE SET NULL,
    
    -- Return details
    reason TEXT,
    return_type VARCHAR(50) DEFAULT 'REFUND' CHECK (return_type IN ('REFUND', 'EXCHANGE', 'REPAIR')),
    condition_received VARCHAR(50) DEFAULT 'GOOD' CHECK (condition_received IN ('EXCELLENT', 'GOOD', 'DAMAGED', 'DEFECTIVE')),
    
    -- Customer feedback
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    feedback TEXT,
    
    -- Processing
    status VARCHAR(50) DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'APPROVED', 'REJECTED', 'PROCESSING', 'COMPLETED')),
    refund_amount DECIMAL(10,2),
    
    -- Timestamps
    requested_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for returns
CREATE INDEX IF NOT EXISTS idx_returns_order ON returns(order_id);
CREATE INDEX IF NOT EXISTS idx_returns_item ON returns(order_item_id) WHERE order_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_returns_status ON returns(status);

-- 4. Populate order_items from existing orders
-- This function will migrate existing order data
CREATE OR REPLACE FUNCTION migrate_existing_order_items()
RETURNS INTEGER AS $$
DECLARE
    order_record RECORD;
    item JSONB;
    item_count INTEGER := 0;
BEGIN
    -- Loop through orders that have items but no order_items
    FOR order_record IN
        SELECT id, items, merchant_id
        FROM orders 
        WHERE items IS NOT NULL 
        AND id NOT IN (SELECT DISTINCT order_id FROM order_items WHERE order_id IS NOT NULL)
        ORDER BY created_at DESC
        LIMIT 500 -- Process in batches
    LOOP
        -- Loop through each item in the JSONB array
        FOR item IN SELECT * FROM jsonb_array_elements(order_record.items)
        LOOP
            INSERT INTO order_items (
                order_id,
                product_id,
                product_name,
                product_sku,
                size,
                quantity,
                unit_price,
                total_price,
                product_attributes
            ) VALUES (
                order_record.id,
                COALESCE((item->>'product_id')::uuid, uuid_generate_v4()),
                COALESCE(item->>'name', item->>'product_name', 'Unknown Product'),
                COALESCE(item->>'sku', 'UNKNOWN'),
                item->>'size',
                COALESCE((item->>'quantity')::integer, 1),
                COALESCE((item->>'price')::decimal, (item->>'unit_price')::decimal, 0),
                COALESCE((item->>'total')::decimal, (item->>'total_price')::decimal, 0),
                item
            ) ON CONFLICT DO NOTHING;
            
            item_count := item_count + 1;
        END LOOP;
    END LOOP;
    
    RETURN item_count;
END;
$$ LANGUAGE plpgsql;

-- Run the migration function
SELECT migrate_existing_order_items();

-- 5. Add updated_at triggers for new tables
CREATE TRIGGER trigger_order_items_updated_at
    BEFORE UPDATE ON order_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_returns_updated_at
    BEFORE UPDATE ON returns
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 6. Grant permissions and enable RLS
GRANT SELECT, INSERT, UPDATE, DELETE ON order_items TO ai_sales;
GRANT SELECT, INSERT, UPDATE, DELETE ON returns TO ai_sales;

ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE returns ENABLE ROW LEVEL SECURITY;

-- Order items RLS
DROP POLICY IF EXISTS order_items_tenant_isolation ON order_items;
CREATE POLICY order_items_tenant_isolation ON order_items
  FOR ALL TO ai_sales
  USING (
    order_id IN (
      SELECT id FROM orders WHERE merchant_id = current_merchant_id()
    ) OR is_admin_user()
  );

-- Returns RLS  
DROP POLICY IF EXISTS returns_tenant_isolation ON returns;
CREATE POLICY returns_tenant_isolation ON returns
  FOR ALL TO ai_sales
  USING (
    order_id IN (
      SELECT id FROM orders WHERE merchant_id = current_merchant_id()
    ) OR is_admin_user()
  );

-- 7. Add comments for documentation
COMMENT ON TABLE order_items IS 'Individual items within orders - enables size prediction and return analysis';
COMMENT ON TABLE returns IS 'Product returns and exchanges - used for predictive analytics';
COMMENT ON COLUMN products.size IS 'Product size for predictive analytics';
COMMENT ON COLUMN products.color IS 'Product color for customer preferences';
COMMENT ON COLUMN products.brand IS 'Product brand for analytics';

-- Migration completion notice
DO $$
BEGIN
    RAISE NOTICE 'âœ… Migration 080: Fixed Predictive Analytics Schema Issues';
    RAISE NOTICE 'ðŸ”§ Added missing columns: size, color, material, brand to products';
    RAISE NOTICE 'ðŸ“Š Created tables: order_items, returns';
    RAISE NOTICE 'âš¡ Migrated existing order data to order_items table';
    RAISE NOTICE 'ðŸ”’ Applied RLS policies to new tables';
END $$;
\r\n-- ==== End of: 081_fix_predictive_analytics_schema.sql ====\r\n
\r\nCOMMIT;\r\n
