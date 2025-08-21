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