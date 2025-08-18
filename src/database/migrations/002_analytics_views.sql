-- ===============================================
-- Migration 002: Analytics Views and Functions
-- Creates analytical views and performance functions
-- ===============================================

-- ===============================================
-- MERCHANT ANALYTICS VIEW
-- ===============================================

CREATE OR REPLACE VIEW merchant_analytics AS
WITH merchant_stats AS (
    SELECT 
        m.id,
        m.business_name,
        m.subscription_status,
        m.created_at as merchant_since,
        
        -- Order Statistics
        COUNT(DISTINCT o.id) as total_orders,
        COUNT(DISTINCT CASE WHEN o.status = 'CONFIRMED' THEN o.id END) as confirmed_orders,
        COUNT(DISTINCT CASE WHEN o.status = 'DELIVERED' THEN o.id END) as delivered_orders,
        COUNT(DISTINCT CASE WHEN o.status = 'CANCELLED' THEN o.id END) as cancelled_orders,
        
        -- Revenue Statistics
        COALESCE(SUM(CASE WHEN o.status IN ('CONFIRMED', 'DELIVERED') THEN o.total_amount END), 0) as total_revenue,
        COALESCE(AVG(CASE WHEN o.status IN ('CONFIRMED', 'DELIVERED') THEN o.total_amount END), 0) as avg_order_value,
        
        -- Customer Statistics
        COUNT(DISTINCT o.customer_phone) as unique_customers,
        COUNT(DISTINCT CASE WHEN o.created_at >= CURRENT_DATE - INTERVAL '30 days' THEN o.customer_phone END) as active_customers_30d,
        
        -- Product Statistics
        COUNT(DISTINCT p.id) as total_products,
        COUNT(DISTINCT CASE WHEN p.status = 'ACTIVE' THEN p.id END) as active_products,
        COUNT(DISTINCT CASE WHEN p.stock_quantity <= p.min_stock_alert AND p.status = 'ACTIVE' THEN p.id END) as low_stock_products,
        
        -- Conversation Statistics
        COUNT(DISTINCT c.id) as total_conversations,
        COUNT(DISTINCT CASE WHEN c.converted_to_order = true THEN c.id END) as converted_conversations,
        
        -- Recent Activity
        MAX(o.created_at) as last_order_at,
        MAX(c.last_message_at) as last_conversation_at
        
    FROM merchants m
    LEFT JOIN orders o ON m.id = o.merchant_id
    LEFT JOIN products p ON m.id = p.merchant_id
    LEFT JOIN conversations c ON m.id = c.merchant_id
    GROUP BY m.id, m.business_name, m.subscription_status, m.created_at
)
SELECT 
    *,
    CASE 
        WHEN total_orders > 0 THEN ROUND((confirmed_orders::DECIMAL / total_orders) * 100, 2)
        ELSE 0 
    END as order_confirmation_rate,
    
    CASE 
        WHEN total_conversations > 0 THEN ROUND((converted_conversations::DECIMAL / total_conversations) * 100, 2)
        ELSE 0 
    END as conversation_conversion_rate,
    
    CASE 
        WHEN confirmed_orders > 0 THEN ROUND((delivered_orders::DECIMAL / confirmed_orders) * 100, 2)
        ELSE 0 
    END as delivery_success_rate
FROM merchant_stats;

-- ===============================================
-- DAILY PLATFORM STATISTICS VIEW
-- ===============================================

CREATE OR REPLACE VIEW daily_platform_stats AS
WITH daily_stats AS (
    SELECT 
        DATE(created_at) as date,
        
        -- Merchant Statistics
        COUNT(DISTINCT CASE WHEN subscription_status = 'ACTIVE' THEN id END) as active_merchants,
        COUNT(DISTINCT id) as total_merchants
        
    FROM merchants
    WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY DATE(created_at)
),
order_stats AS (
    SELECT 
        DATE(created_at) as date,
        COUNT(*) as daily_orders,
        COUNT(CASE WHEN status = 'CONFIRMED' THEN 1 END) as daily_confirmed_orders,
        COALESCE(SUM(CASE WHEN status IN ('CONFIRMED', 'DELIVERED') THEN total_amount END), 0) as daily_revenue
    FROM orders
    WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY DATE(created_at)
),
conversation_stats AS (
    SELECT 
        DATE(created_at) as date,
        COUNT(*) as daily_conversations,
        COUNT(CASE WHEN converted_to_order = true THEN 1 END) as daily_converted_conversations
    FROM conversations
    WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY DATE(created_at)
),
message_stats AS (
    SELECT 
        DATE(created_at) as date,
        COUNT(*) as daily_messages,
        COUNT(CASE WHEN direction = 'INCOMING' THEN 1 END) as daily_incoming_messages,
        COUNT(CASE WHEN direction = 'OUTGOING' THEN 1 END) as daily_outgoing_messages
    FROM message_logs
    WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY DATE(created_at)
)
SELECT 
    COALESCE(d.date, o.date, c.date, m.date) as date,
    COALESCE(d.active_merchants, 0) as active_merchants,
    COALESCE(d.total_merchants, 0) as total_merchants,
    COALESCE(o.daily_orders, 0) as daily_orders,
    COALESCE(o.daily_confirmed_orders, 0) as daily_confirmed_orders,
    COALESCE(o.daily_revenue, 0) as daily_revenue,
    COALESCE(c.daily_conversations, 0) as daily_conversations,
    COALESCE(c.daily_converted_conversations, 0) as daily_converted_conversations,
    COALESCE(m.daily_messages, 0) as daily_messages,
    COALESCE(m.daily_incoming_messages, 0) as daily_incoming_messages,
    COALESCE(m.daily_outgoing_messages, 0) as daily_outgoing_messages,
    
    CASE 
        WHEN COALESCE(o.daily_orders, 0) > 0 
        THEN ROUND((COALESCE(o.daily_confirmed_orders, 0)::DECIMAL / o.daily_orders) * 100, 2)
        ELSE 0 
    END as daily_order_confirmation_rate,
    
    CASE 
        WHEN COALESCE(c.daily_conversations, 0) > 0 
        THEN ROUND((COALESCE(c.daily_converted_conversations, 0)::DECIMAL / c.daily_conversations) * 100, 2)
        ELSE 0 
    END as daily_conversation_conversion_rate
    
FROM daily_stats d
FULL OUTER JOIN order_stats o ON d.date = o.date
FULL OUTER JOIN conversation_stats c ON COALESCE(d.date, o.date) = c.date
FULL OUTER JOIN message_stats m ON COALESCE(d.date, o.date, c.date) = m.date
ORDER BY date DESC;

-- ===============================================
-- PRODUCT PERFORMANCE VIEW
-- ===============================================

CREATE OR REPLACE VIEW product_performance AS
WITH product_stats AS (
    SELECT 
        p.id,
        p.merchant_id,
        p.sku,
        p.name_ar,
        p.category,
        p.price_usd,
        p.stock_quantity,
        p.created_at,
        
        -- Sales Statistics from order items
        COALESCE(SUM((item->>'quantity')::INTEGER), 0) as total_sold,
        COALESCE(SUM((item->>'total')::DECIMAL), 0) as total_revenue,
        COUNT(DISTINCT o.id) as order_count,
        COUNT(DISTINCT o.customer_phone) as unique_buyers,
        
        -- Recent sales
        COUNT(DISTINCT CASE WHEN o.created_at >= CURRENT_DATE - INTERVAL '7 days' THEN o.id END) as sales_last_7_days,
        COUNT(DISTINCT CASE WHEN o.created_at >= CURRENT_DATE - INTERVAL '30 days' THEN o.id END) as sales_last_30_days
        
    FROM products p
    LEFT JOIN orders o ON p.merchant_id = o.merchant_id
    LEFT JOIN LATERAL jsonb_array_elements(o.items) AS item ON (item->>'sku' = p.sku)
    WHERE p.status = 'ACTIVE'
    GROUP BY p.id, p.merchant_id, p.sku, p.name_ar, p.category, p.price_usd, p.stock_quantity, p.created_at
)
SELECT 
    *,
    CASE 
        WHEN total_sold > 0 THEN ROUND(total_revenue / total_sold, 2)
        ELSE price_usd 
    END as avg_selling_price,
    
    CASE 
        WHEN stock_quantity + total_sold > 0 
        THEN ROUND((total_sold::DECIMAL / (stock_quantity + total_sold)) * 100, 2)
        ELSE 0 
    END as sell_through_rate
FROM product_stats;

-- ===============================================
-- CUSTOMER ANALYTICS VIEW
-- ===============================================

CREATE OR REPLACE VIEW customer_analytics AS
WITH customer_stats AS (
    SELECT 
        o.customer_phone,
        o.customer_name,
        o.merchant_id,
        
        -- Order Statistics
        COUNT(DISTINCT o.id) as total_orders,
        COUNT(DISTINCT CASE WHEN o.status = 'DELIVERED' THEN o.id END) as delivered_orders,
        SUM(CASE WHEN o.status IN ('CONFIRMED', 'DELIVERED') THEN o.total_amount ELSE 0 END) as total_spent,
        AVG(CASE WHEN o.status IN ('CONFIRMED', 'DELIVERED') THEN o.total_amount END) as avg_order_value,
        
        -- Timing
        MIN(o.created_at) as first_order_at,
        MAX(o.created_at) as last_order_at,
        
        -- Conversation Statistics
        COUNT(DISTINCT c.id) as total_conversations,
        AVG(c.message_count) as avg_messages_per_conversation
        
    FROM orders o
    LEFT JOIN conversations c ON o.customer_phone = c.customer_phone AND o.merchant_id = c.merchant_id
    GROUP BY o.customer_phone, o.customer_name, o.merchant_id
)
SELECT 
    *,
    CASE 
        WHEN total_orders > 1 THEN 
            EXTRACT(EPOCH FROM (last_order_at - first_order_at)) / (86400 * (total_orders - 1))
        ELSE NULL 
    END as avg_days_between_orders,
    
    CASE 
        WHEN total_orders >= 2 THEN 'REPEAT'
        ELSE 'NEW' 
    END as customer_type,
    
    CASE 
        WHEN last_order_at >= CURRENT_DATE - INTERVAL '30 days' THEN 'ACTIVE'
        WHEN last_order_at >= CURRENT_DATE - INTERVAL '90 days' THEN 'INACTIVE'
        ELSE 'CHURNED' 
    END as customer_status
FROM customer_stats;

-- ===============================================
-- AI PERFORMANCE ANALYTICS VIEW
-- ===============================================

CREATE OR REPLACE VIEW ai_performance_stats AS
WITH ai_stats AS (
    SELECT 
        DATE(ml.created_at) as date,
        ml.platform,
        c.merchant_id,
        
        -- Message Statistics
        COUNT(CASE WHEN ml.direction = 'INCOMING' THEN 1 END) as incoming_messages,
        COUNT(CASE WHEN ml.direction = 'OUTGOING' THEN 1 END) as outgoing_messages,
        
        -- AI Response Statistics
        COUNT(CASE WHEN ml.ai_processed = true THEN 1 END) as ai_processed_messages,
        AVG(CASE WHEN ml.ai_response_time_ms IS NOT NULL THEN ml.ai_response_time_ms END) as avg_response_time_ms,
        MAX(ml.ai_response_time_ms) as max_response_time_ms,
        MIN(ml.ai_response_time_ms) as min_response_time_ms,
        
        -- Token Usage
        SUM(COALESCE(ml.ai_tokens_used, 0)) as total_tokens_used,
        AVG(CASE WHEN ml.ai_tokens_used IS NOT NULL THEN ml.ai_tokens_used END) as avg_tokens_per_response
        
    FROM message_logs ml
    JOIN conversations c ON ml.conversation_id = c.id
    WHERE ml.created_at >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY DATE(ml.created_at), ml.platform, c.merchant_id
)
SELECT 
    *,
    CASE 
        WHEN incoming_messages > 0 THEN ROUND((ai_processed_messages::DECIMAL / incoming_messages) * 100, 2)
        ELSE 0 
    END as ai_processing_rate,
    
    CASE 
        WHEN outgoing_messages > 0 THEN ROUND((incoming_messages::DECIMAL / outgoing_messages) * 100, 2)
        ELSE 0 
    END as response_ratio
FROM ai_stats
ORDER BY date DESC, merchant_id;

-- ===============================================
-- PERFORMANCE FUNCTIONS
-- ===============================================

-- Get merchant KPIs function
CREATE OR REPLACE FUNCTION get_merchant_kpis(merchant_uuid UUID, days_back INTEGER DEFAULT 30)
RETURNS JSON AS $$
DECLARE
    result JSON;
    start_date DATE := CURRENT_DATE - INTERVAL '1 day' * days_back;
BEGIN
    SELECT json_build_object(
        'merchant_id', merchant_uuid,
        'period_days', days_back,
        'orders', json_build_object(
            'total', COUNT(DISTINCT o.id),
            'confirmed', COUNT(DISTINCT CASE WHEN o.status = 'CONFIRMED' THEN o.id END),
            'revenue', COALESCE(SUM(CASE WHEN o.status IN ('CONFIRMED', 'DELIVERED') THEN o.total_amount END), 0)
        ),
        'conversations', json_build_object(
            'total', COUNT(DISTINCT c.id),
            'converted', COUNT(DISTINCT CASE WHEN c.converted_to_order = true THEN c.id END),
            'avg_messages', ROUND(AVG(c.message_count), 2)
        ),
        'products', json_build_object(
            'active', COUNT(DISTINCT CASE WHEN p.status = 'ACTIVE' THEN p.id END),
            'low_stock', COUNT(DISTINCT CASE WHEN p.stock_quantity <= p.min_stock_alert AND p.status = 'ACTIVE' THEN p.id END)
        ),
        'ai_performance', json_build_object(
            'avg_response_time', ROUND(AVG(ml.ai_response_time_ms), 2),
            'total_tokens', SUM(COALESCE(ml.ai_tokens_used, 0))
        )
    ) INTO result
    FROM merchants m
    LEFT JOIN orders o ON m.id = o.merchant_id AND o.created_at >= start_date
    LEFT JOIN conversations c ON m.id = c.merchant_id AND c.created_at >= start_date
    LEFT JOIN products p ON m.id = p.merchant_id
    LEFT JOIN message_logs ml ON c.id = ml.conversation_id AND ml.created_at >= start_date AND ml.direction = 'OUTGOING'
    WHERE m.id = merchant_uuid
    GROUP BY m.id;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Platform health check function
CREATE OR REPLACE FUNCTION get_platform_health()
RETURNS JSON AS $$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'timestamp', NOW(),
        'active_merchants', COUNT(DISTINCT CASE WHEN subscription_status = 'ACTIVE' THEN m.id END),
        'orders_today', (SELECT COUNT(*) FROM orders WHERE DATE(created_at) = CURRENT_DATE),
        'conversations_today', (SELECT COUNT(*) FROM conversations WHERE DATE(created_at) = CURRENT_DATE),
        'messages_today', (SELECT COUNT(*) FROM message_logs WHERE DATE(created_at) = CURRENT_DATE),
        'avg_response_time_today', (
            SELECT ROUND(AVG(ai_response_time_ms), 2) 
            FROM message_logs 
            WHERE DATE(created_at) = CURRENT_DATE 
            AND ai_response_time_ms IS NOT NULL
        ),
        'system_load', json_build_object(
            'database_size', pg_size_pretty(pg_database_size(current_database())),
            'active_connections', (SELECT count(*) FROM pg_stat_activity WHERE state = 'active')
        )
    ) INTO result
    FROM merchants m;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Performance monitoring function
CREATE OR REPLACE FUNCTION get_performance_metrics(hours_back INTEGER DEFAULT 24)
RETURNS JSON AS $$
DECLARE
    result JSON;
    start_time TIMESTAMPTZ := NOW() - INTERVAL '1 hour' * hours_back;
BEGIN
    SELECT json_build_object(
        'period_hours', hours_back,
        'message_processing', json_build_object(
            'total_messages', COUNT(ml.id),
            'avg_response_time_ms', ROUND(AVG(ml.ai_response_time_ms), 2),
            'max_response_time_ms', MAX(ml.ai_response_time_ms),
            'processed_rate', ROUND((COUNT(CASE WHEN ml.ai_processed THEN 1 END)::DECIMAL / COUNT(ml.id)) * 100, 2)
        ),
        'conversation_metrics', json_build_object(
            'new_conversations', COUNT(DISTINCT CASE WHEN c.created_at >= start_time THEN c.id END),
            'active_conversations', COUNT(DISTINCT CASE WHEN c.last_message_at >= start_time THEN c.id END),
            'conversion_rate', ROUND((COUNT(DISTINCT CASE WHEN c.converted_to_order AND c.created_at >= start_time THEN c.id END)::DECIMAL / NULLIF(COUNT(DISTINCT CASE WHEN c.created_at >= start_time THEN c.id END), 0)) * 100, 2)
        ),
        'order_metrics', json_build_object(
            'new_orders', COUNT(DISTINCT CASE WHEN o.created_at >= start_time THEN o.id END),
            'avg_order_value', ROUND(AVG(CASE WHEN o.created_at >= start_time THEN o.total_amount END), 2),
            'confirmation_rate', ROUND((COUNT(DISTINCT CASE WHEN o.status = 'CONFIRMED' AND o.created_at >= start_time THEN o.id END)::DECIMAL / NULLIF(COUNT(DISTINCT CASE WHEN o.created_at >= start_time THEN o.id END), 0)) * 100, 2)
        )
    ) INTO result
    FROM message_logs ml
    FULL OUTER JOIN conversations c ON ml.conversation_id = c.id
    FULL OUTER JOIN orders o ON c.order_id = o.id
    WHERE ml.created_at >= start_time OR c.created_at >= start_time OR o.created_at >= start_time;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Record this migration
INSERT INTO migrations (name, filename) VALUES ('Analytics Views', '002_analytics_views.sql');