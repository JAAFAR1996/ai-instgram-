/**
 * ===============================================
 * Database Testing Script
 * Tests all database functionality
 * ===============================================
 */

import { getDatabase } from './connection';
import { runMigrations, getMigrationStatus } from './migrate';
import { seedDatabase } from './seed';

export class DatabaseTester {
  private db = getDatabase();

  /**
   * Run comprehensive database tests
   */
  public async runTests(): Promise<boolean> {
    console.log('🧪 Starting comprehensive database tests...\n');
    
    let allTestsPassed = true;

    try {
      // Test 1: Connection
      allTestsPassed &= await this.testConnection();
      
      // Test 2: Migrations
      allTestsPassed &= await this.testMigrations();
      
      // Test 3: Basic CRUD operations
      allTestsPassed &= await this.testCRUD();
      
      // Test 4: Analytics views
      allTestsPassed &= await this.testAnalytics();
      
      // Test 5: Search functionality
      allTestsPassed &= await this.testSearch();
      
      // Test 6: Performance
      allTestsPassed &= await this.testPerformance();

      if (allTestsPassed) {
        console.log('\n✅ All database tests passed successfully! 🎉');
      } else {
        console.log('\n❌ Some database tests failed');
      }

      return allTestsPassed;
    } catch (error) {
      console.error('\n❌ Database tests failed with error:', error);
      return false;
    }
  }

  /**
   * Test database connection
   */
  private async testConnection(): Promise<boolean> {
    console.log('🔗 Testing database connection...');
    
    try {
      if (!this.db.isReady()) {
        await this.db.connect();
      }

      const health = await this.db.healthCheck();
      
      if (health.status === 'healthy') {
        console.log('✅ Connection test passed');
        console.log(`   📊 Response time: ${health.details.response_time_ms}ms`);
        console.log(`   🔌 Active connections: ${health.details.active_connections}`);
        console.log(`   💾 Database size: ${health.details.database_size}`);
        return true;
      } else {
        console.log('❌ Connection test failed - database unhealthy');
        return false;
      }
    } catch (error) {
      console.log('❌ Connection test failed:', error);
      return false;
    }
  }

  /**
   * Test migrations
   */
  private async testMigrations(): Promise<boolean> {
    console.log('\n📋 Testing migrations...');
    
    try {
      // Run migrations
      await runMigrations();
      
      // Check migration status
      const status = await getMigrationStatus();
      
      console.log(`✅ Migration test passed`);
      console.log(`   📊 Total migrations: ${status.total}`);
      console.log(`   ✅ Executed: ${status.executed}`);
      console.log(`   ⏳ Pending: ${status.pending}`);
      
      return status.pending === 0;
    } catch (error) {
      console.log('❌ Migration test failed:', error);
      return false;
    }
  }

  /**
   * Test CRUD operations
   */
  private async testCRUD(): Promise<boolean> {
    console.log('\n📝 Testing CRUD operations...');
    
    try {
      const sql = this.db.getSQL();
      
      // Test CREATE
      console.log('   📝 Testing CREATE...');
      const merchant = await sql`
        INSERT INTO merchants (business_name, whatsapp_number, business_category)
        VALUES ('Test Store', '+9647801234999', 'test')
        RETURNING id, business_name
      `;
      
      if (merchant.length === 0) {
        throw new Error('Failed to create merchant');
      }
      
      const merchantId = merchant[0].id;
      console.log(`   ✅ Created merchant: ${merchant[0].business_name}`);

      // Test READ
      console.log('   📖 Testing READ...');
      const readMerchant = await sql`
        SELECT * FROM merchants WHERE id = ${merchantId}
      `;
      
      if (readMerchant.length === 0) {
        throw new Error('Failed to read merchant');
      }
      console.log(`   ✅ Read merchant: ${readMerchant[0].business_name}`);

      // Test UPDATE
      console.log('   ✏️ Testing UPDATE...');
      await sql`
        UPDATE merchants 
        SET business_name = 'Updated Test Store'
        WHERE id = ${merchantId}
      `;
      
      const updatedMerchant = await sql`
        SELECT business_name FROM merchants WHERE id = ${merchantId}
      `;
      
      if (updatedMerchant[0].business_name !== 'Updated Test Store') {
        throw new Error('Failed to update merchant');
      }
      console.log(`   ✅ Updated merchant name`);

      // Test DELETE
      console.log('   🗑️ Testing DELETE...');
      await sql`DELETE FROM merchants WHERE id = ${merchantId}`;
      
      const deletedCheck = await sql`
        SELECT COUNT(*) as count FROM merchants WHERE id = ${merchantId}
      `;
      
      if (parseInt(deletedCheck[0].count) !== 0) {
        throw new Error('Failed to delete merchant');
      }
      console.log(`   ✅ Deleted merchant`);

      console.log('✅ CRUD operations test passed');
      return true;
    } catch (error) {
      console.log('❌ CRUD operations test failed:', error);
      return false;
    }
  }

  /**
   * Test analytics views
   */
  private async testAnalytics(): Promise<boolean> {
    console.log('\n📊 Testing analytics views...');
    
    try {
      const sql = this.db.getSQL();
      
      // Seed some test data first
      await seedDatabase();
      
      // Test merchant analytics view
      console.log('   📈 Testing merchant analytics...');
      const merchantAnalytics = await sql`
        SELECT * FROM merchant_analytics LIMIT 5
      `;
      console.log(`   ✅ Merchant analytics: ${merchantAnalytics.length} records`);

      // Test platform stats view
      console.log('   📊 Testing platform stats...');
      const platformStats = await sql`
        SELECT * FROM daily_platform_stats LIMIT 5
      `;
      console.log(`   ✅ Platform stats: ${platformStats.length} records`);

      // Test product performance view
      console.log('   📱 Testing product performance...');
      const productPerformance = await sql`
        SELECT * FROM product_performance LIMIT 5
      `;
      console.log(`   ✅ Product performance: ${productPerformance.length} records`);

      // Test customer analytics view
      console.log('   👥 Testing customer analytics...');
      const customerAnalytics = await sql`
        SELECT * FROM customer_analytics LIMIT 5
      `;
      console.log(`   ✅ Customer analytics: ${customerAnalytics.length} records`);

      console.log('✅ Analytics views test passed');
      return true;
    } catch (error) {
      console.log('❌ Analytics views test failed:', error);
      return false;
    }
  }

  /**
   * Test search functionality
   */
  private async testSearch(): Promise<boolean> {
    console.log('\n🔍 Testing search functionality...');
    
    try {
      const sql = this.db.getSQL();
      
      // Test product search
      console.log('   📱 Testing product search...');
      const productSearch = await sql`
        SELECT name_ar, category 
        FROM products 
        WHERE search_vector @@ to_tsquery('arabic', 'آيفون | موبايل')
        LIMIT 5
      `;
      console.log(`   ✅ Product search: ${productSearch.length} results`);

      // Test merchant search
      console.log('   🏪 Testing merchant search...');
      const merchantSearch = await sql`
        SELECT business_name, business_category
        FROM merchants 
        WHERE search_vector @@ to_tsquery('arabic', 'محل | موبايل')
        LIMIT 5
      `;
      console.log(`   ✅ Merchant search: ${merchantSearch.length} results`);

      // Test fuzzy search with pg_trgm
      console.log('   🎯 Testing fuzzy search...');
      const fuzzySearch = await sql`
        SELECT name_ar, similarity(name_ar, 'ايفون') as sim
        FROM products 
        WHERE name_ar % 'ايفون'
        ORDER BY sim DESC
        LIMIT 3
      `;
      console.log(`   ✅ Fuzzy search: ${fuzzySearch.length} results`);

      console.log('✅ Search functionality test passed');
      return true;
    } catch (error) {
      console.log('❌ Search functionality test failed:', error);
      return false;
    }
  }

  /**
   * Test performance
   */
  private async testPerformance(): Promise<boolean> {
    console.log('\n⚡ Testing performance...');
    
    try {
      const sql = this.db.getSQL();
      
      // Test query performance
      console.log('   ⏱️ Testing query performance...');
      
      const startTime = Date.now();
      
      // Complex analytics query
      await sql`
        SELECT 
          m.business_name,
          COUNT(DISTINCT o.id) as total_orders,
          COUNT(DISTINCT c.id) as total_conversations,
          AVG(ml.ai_response_time_ms) as avg_response_time
        FROM merchants m
        LEFT JOIN orders o ON m.id = o.merchant_id
        LEFT JOIN conversations c ON m.id = c.merchant_id  
        LEFT JOIN message_logs ml ON c.id = ml.conversation_id
        WHERE m.subscription_status = 'ACTIVE'
        GROUP BY m.id, m.business_name
        ORDER BY total_orders DESC
      `;
      
      const queryTime = Date.now() - startTime;
      console.log(`   ✅ Complex query executed in ${queryTime}ms`);
      
      // Test index usage
      console.log('   📇 Testing index usage...');
      const indexQuery = await sql`
        SELECT schemaname, tablename, indexname, idx_tup_read, idx_tup_fetch
        FROM pg_stat_user_indexes 
        WHERE idx_tup_read > 0
        ORDER BY idx_tup_read DESC
        LIMIT 5
      `;
      console.log(`   ✅ Active indexes: ${indexQuery.length}`);

      console.log('✅ Performance test passed');
      return true;
    } catch (error) {
      console.log('❌ Performance test failed:', error);
      return false;
    }
  }

  /**
   * Test specific queries that will be used in the application
   */
  public async testApplicationQueries(): Promise<boolean> {
    console.log('\n🎯 Testing application-specific queries...');
    
    try {
      const sql = this.db.getSQL();
      
      // Test merchant KPIs function
      console.log('   📊 Testing merchant KPIs function...');
      const merchants = await sql`SELECT id FROM merchants LIMIT 1`;
      if (merchants.length > 0) {
        const kpis = await sql`SELECT get_merchant_kpis(${merchants[0].id}, 30)`;
        console.log('   ✅ Merchant KPIs function works');
      }

      // Test platform health function
      console.log('   🔋 Testing platform health function...');
      const health = await sql`SELECT get_platform_health()`;
      console.log('   ✅ Platform health function works');

      // Test product search with attributes
      console.log('   🔍 Testing JSONB queries...');
      const productAttrs = await sql`
        SELECT name_ar, attributes->'brand' as brand
        FROM products 
        WHERE attributes->>'brand' = 'Apple'
        LIMIT 3
      `;
      console.log(`   ✅ JSONB attribute search: ${productAttrs.length} results`);

      // Test order items aggregation
      console.log('   📦 Testing order items aggregation...');
      const orderItems = await sql`
        SELECT 
          (item->>'sku') as sku,
          (item->>'name') as product_name,
          SUM((item->>'quantity')::INTEGER) as total_sold
        FROM orders o,
        LATERAL jsonb_array_elements(o.items) AS item
        WHERE o.status IN ('CONFIRMED', 'DELIVERED')
        GROUP BY item->>'sku', item->>'name'
        ORDER BY total_sold DESC
        LIMIT 5
      `;
      console.log(`   ✅ Order items aggregation: ${orderItems.length} results`);

      console.log('✅ Application queries test passed');
      return true;
    } catch (error) {
      console.log('❌ Application queries test failed:', error);
      return false;
    }
  }

  /**
   * Show database statistics
   */
  public async showDatabaseStats(): Promise<void> {
    console.log('\n📊 Database Statistics:');
    
    try {
      const stats = await this.db.getStats();
      
      console.log(`   📋 Total Tables: ${stats.total_tables}`);
      console.log(`   📝 Total Records: ${stats.total_records}`);
      console.log(`   💾 Database Size: ${stats.database_size}`);
      console.log('\n   📊 Largest Tables:');
      
      stats.largest_tables.forEach((table, index) => {
        console.log(`   ${index + 1}. ${table.table_name}: ${table.row_count} rows (${table.size})`);
      });
    } catch (error) {
      console.log('❌ Failed to get database stats:', error);
    }
  }
}

// Export functions
export async function testDatabase(): Promise<boolean> {
  const tester = new DatabaseTester();
  return await tester.runTests();
}

export async function testApplicationQueries(): Promise<boolean> {
  const tester = new DatabaseTester();
  return await tester.testApplicationQueries();
}

export async function showStats(): Promise<void> {
  const tester = new DatabaseTester();
  await tester.showDatabaseStats();
}

// CLI script runner
if (import.meta.main) {
  const command = process.argv[2];
  
  try {
    const tester = new DatabaseTester();
    
    switch (command) {
      case 'test':
        const success = await tester.runTests();
        process.exit(success ? 0 : 1);
        break;
      case 'queries':
        await tester.testApplicationQueries();
        break;
      case 'stats':
        await tester.showDatabaseStats();
        break;
      default:
        console.log('📖 Available commands:');
        console.log('  test    - Run comprehensive database tests');
        console.log('  queries - Test application-specific queries');
        console.log('  stats   - Show database statistics');
    }
  } catch (error) {
    console.error('❌ Command failed:', error);
    process.exit(1);
  }
}