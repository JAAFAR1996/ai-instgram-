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
    RAISE NOTICE '✅ Migration 080: Fixed Predictive Analytics Schema Issues';
    RAISE NOTICE '🔧 Added missing columns: size, color, material, brand to products';
    RAISE NOTICE '📊 Created tables: order_items, returns';
    RAISE NOTICE '⚡ Migrated existing order data to order_items table';
    RAISE NOTICE '🔒 Applied RLS policies to new tables';
END $$;