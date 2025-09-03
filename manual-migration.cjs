/**
 * Manual migration script to fix schema issues
 * Run this directly with the database connection string
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function runManualMigration() {
  // Get database connection from environment or hardcoded for Render
  const connectionString = process.env.DATABASE_URL || 
    'postgresql://ai_instgram_user:rTAH6gFMveMhoSrFu3l9FmrqGYd1ZFdw@dpg-d2f0pije5dus73bi4ac0-a.frankfurt-postgres.render.com/ai_instgram';
  
  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 3,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000
  });

  const client = await pool.connect();
  
  try {
    console.log('🔄 Starting manual migration...');
    
    // Step 1: Add missing columns to products table
    console.log('📝 Adding missing columns to products table...');
    await client.query(`
      ALTER TABLE products 
      ADD COLUMN IF NOT EXISTS size VARCHAR(50),
      ADD COLUMN IF NOT EXISTS color VARCHAR(50),
      ADD COLUMN IF NOT EXISTS material VARCHAR(100),
      ADD COLUMN IF NOT EXISTS brand VARCHAR(100);
    `);
    console.log('✅ Products table columns added');

    // Step 2: Create indexes for new product columns
    console.log('📝 Creating indexes for new columns...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_products_size ON products(size) WHERE size IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_products_color ON products(color) WHERE color IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand) WHERE brand IS NOT NULL;
    `);
    console.log('✅ Product indexes created');

    // Step 3: Create order_items table
    console.log('📝 Creating order_items table...');
    await client.query(`
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
    `);
    console.log('✅ order_items table created');

    // Step 4: Create indexes for order_items
    console.log('📝 Creating indexes for order_items...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);
    `);
    try {
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_order_items_size ON order_items(size) WHERE size IS NOT NULL;
      `);
    } catch (error) {
      console.log('⚠️ Skipping size index (column may not exist yet)');
    }
    console.log('✅ order_items indexes created');

    // Step 5: Create returns table
    console.log('📝 Creating returns table...');
    await client.query(`
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
    `);
    console.log('✅ returns table created');

    // Step 6: Create indexes for returns
    console.log('📝 Creating indexes for returns...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_returns_order ON returns(order_id);
    `);
    try {
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_returns_item ON returns(order_item_id) WHERE order_item_id IS NOT NULL;
      `);
    } catch (error) {
      console.log('⚠️ Skipping order_item_id index (column may not exist yet)');
    }
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_returns_status ON returns(status);
    `);
    console.log('✅ returns indexes created');

    // Step 7: Migrate existing order data to order_items
    console.log('📝 Migrating existing order data...');
    const migrationResult = await client.query(`
      WITH migrated_items AS (
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
        )
        SELECT 
          o.id as order_id,
          COALESCE((item->>'product_id')::uuid, uuid_generate_v4()) as product_id,
          COALESCE(item->>'name', item->>'product_name', 'Unknown Product') as product_name,
          COALESCE(item->>'sku', 'UNKNOWN') as product_sku,
          item->>'size' as size,
          COALESCE((item->>'quantity')::integer, 1) as quantity,
          COALESCE((item->>'price')::decimal, (item->>'unit_price')::decimal, 0) as unit_price,
          COALESCE((item->>'total')::decimal, (item->>'total_price')::decimal, 0) as total_price,
          item as product_attributes
        FROM orders o
        CROSS JOIN LATERAL jsonb_array_elements(o.items) as item
        WHERE o.items IS NOT NULL 
        AND o.id NOT IN (SELECT DISTINCT order_id FROM order_items WHERE order_id IS NOT NULL)
        ON CONFLICT DO NOTHING
        RETURNING id
      )
      SELECT COUNT(*) as migrated_count FROM migrated_items;
    `);
    
    const migratedCount = migrationResult.rows[0]?.migrated_count || 0;
    console.log(`✅ Migrated ${migratedCount} order items`);

    // Step 8: Add triggers
    console.log('📝 Adding triggers...');
    await client.query(`
      CREATE TRIGGER trigger_order_items_updated_at
        BEFORE UPDATE ON order_items
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      
      CREATE TRIGGER trigger_returns_updated_at
        BEFORE UPDATE ON returns
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);
    console.log('✅ Triggers added');

    // Step 9: Enable RLS
    console.log('📝 Enabling RLS...');
    await client.query(`
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
    `);
    console.log('✅ RLS policies applied');

    // Step 10: Grant permissions
    console.log('📝 Granting permissions...');
    await client.query(`
      GRANT SELECT, INSERT, UPDATE, DELETE ON order_items TO ai_sales;
      GRANT SELECT, INSERT, UPDATE, DELETE ON returns TO ai_sales;
    `);
    console.log('✅ Permissions granted');

    console.log('🎉 Manual migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the migration
runManualMigration().catch(console.error);