/**
 * Simple migration script to fix critical schema issues
 */

const { Pool } = require('pg');

async function runSimpleMigration() {
  const connectionString = 'postgresql://ai_instgram_user:rTAH6gFMveMhoSrFu3l9FmrqGYd1ZFdw@dpg-d2f0pije5dus73bi4ac0-a.frankfurt-postgres.render.com/ai_instgram';
  
  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 3,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000
  });

  const client = await pool.connect();
  
  try {
    console.log('🔄 Starting simple migration...');
    
    // Step 1: Add missing columns to products table
    console.log('📝 Step 1: Adding missing columns to products...');
    try {
      await client.query(`
        ALTER TABLE products 
        ADD COLUMN IF NOT EXISTS size VARCHAR(50),
        ADD COLUMN IF NOT EXISTS color VARCHAR(50),
        ADD COLUMN IF NOT EXISTS material VARCHAR(100),
        ADD COLUMN IF NOT EXISTS brand VARCHAR(100);
      `);
      console.log('✅ Products columns added successfully');
    } catch (error) {
      console.error('❌ Failed to add products columns:', error.message);
    }

    // Step 2: Create order_items table
    console.log('📝 Step 2: Creating order_items table...');
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS order_items (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
          product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
          product_name TEXT NOT NULL DEFAULT 'Unknown Product',
          product_sku VARCHAR(100) NOT NULL DEFAULT 'UNKNOWN',
          size VARCHAR(50),
          color VARCHAR(50),
          quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
          unit_price DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
          discount_amount DECIMAL(10,2) DEFAULT 0 CHECK (discount_amount >= 0),
          total_price DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (total_price >= 0),
          product_attributes JSONB DEFAULT '{}',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      console.log('✅ order_items table created successfully');
    } catch (error) {
      console.error('❌ Failed to create order_items table:', error.message);
    }

    // Step 3: Create returns table
    console.log('📝 Step 3: Creating returns table...');
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS returns (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
          order_item_id UUID REFERENCES order_items(id) ON DELETE SET NULL,
          reason TEXT,
          return_type VARCHAR(50) DEFAULT 'REFUND',
          condition_received VARCHAR(50) DEFAULT 'GOOD',
          rating INTEGER CHECK (rating >= 1 AND rating <= 5),
          feedback TEXT,
          status VARCHAR(50) DEFAULT 'REQUESTED',
          refund_amount DECIMAL(10,2),
          requested_at TIMESTAMPTZ DEFAULT NOW(),
          processed_at TIMESTAMPTZ,
          completed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      console.log('✅ returns table created successfully');
    } catch (error) {
      console.error('❌ Failed to create returns table:', error.message);
    }

    // Step 4: Create basic indexes
    console.log('📝 Step 4: Creating essential indexes...');
    try {
      await client.query('CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);');
      await client.query('CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);');
      await client.query('CREATE INDEX IF NOT EXISTS idx_returns_order ON returns(order_id);');
      console.log('✅ Essential indexes created successfully');
    } catch (error) {
      console.error('❌ Failed to create indexes:', error.message);
    }

    // Step 5: Migrate some sample order data
    console.log('📝 Step 5: Migrating sample order data...');
    try {
      const migrationResult = await client.query(`
        WITH sample_migration AS (
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
          LIMIT 10
          ON CONFLICT DO NOTHING
          RETURNING id
        )
        SELECT COUNT(*) as migrated_count FROM sample_migration;
      `);
      
      const migratedCount = migrationResult.rows[0]?.migrated_count || 0;
      console.log(`✅ Migrated ${migratedCount} sample order items`);
    } catch (error) {
      console.error('❌ Failed to migrate order data:', error.message);
    }

    console.log('🎉 Simple migration completed!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the migration
runSimpleMigration().catch(console.error);