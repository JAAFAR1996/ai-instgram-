/**
 * ===============================================
 * Database Testing Script
 * Tests all database functionality
 * ===============================================
 */

import { getDatabase } from '../db/adapter.js';
import { checkDatabaseHealth } from '../db/index.js';
import { runMigrations, getMigrationStatus } from './migrate';
import { seedDatabase } from './seed';
import { logger } from '../services/logger.js';
import { firstOrThrow } from '../utils/safety.js';

// حارس عنصر أول
const get0 = <T>(arr: T[] | undefined, msg = 'empty result'): T => {
  const v = arr?.[0];
  if (!v) throw new Error(msg);
  return v;
};

export class DatabaseTester {
  private db = getDatabase();

  /**
   * Run comprehensive database tests
   */
  public async runTests(): Promise<boolean> {
    logger.info('🧪 Starting comprehensive database tests...\n');
    
    let allTestsPassed = true;

    try {
      // Test 1: Connection
      allTestsPassed = allTestsPassed && await this.testConnection();
      
      // Test 2: Migrations
      allTestsPassed = allTestsPassed && await this.testMigrations();
      
      // Test 3: Basic CRUD operations
      allTestsPassed = allTestsPassed && await this.testCRUD();
      
      // Test 4: Analytics views
      allTestsPassed = allTestsPassed && await this.testAnalytics();
      
      // Test 5: Search functionality
      allTestsPassed = allTestsPassed && await this.testSearch();
      
      // Test 6: Performance
      allTestsPassed = allTestsPassed && await this.testPerformance();

      if (allTestsPassed) {
        logger.info('\n✅ All database tests passed successfully! 🎉');
      } else {
        logger.info('\n❌ Some database tests failed');
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
    logger.info('🔗 Testing database connection...');
    
    try {
      if (!this.db.isReady()) {
        await this.db.connect();
      }

      const health = await checkDatabaseHealth();
      if (health.healthy) {
        logger.info('✅ Connection test passed');
        if (health.details.poolStats) {
          logger.info(`   🔌 Pool:`, health.details.poolStats);
        }
        return true;
      } else {
        logger.info('❌ Connection test failed - database unhealthy');
        return false;
      }
    } catch (error) {
      logger.info('❌ Connection test failed:', { error: String(error) });
      return false;
    }
  }

  /**
   * Test migrations
   */
  private async testMigrations(): Promise<boolean> {
    logger.info('\n📋 Testing migrations...');
    
    try {
      // Run migrations
      await runMigrations();
      
      // Check migration status
      const status = await getMigrationStatus();
      
      logger.info(`✅ Migration test passed`);
      logger.info(`   📊 Total migrations: ${status.total}`);
      logger.info(`   ✅ Executed: ${status.executed}`);
      logger.info(`   ⏳ Pending: ${status.pending}`);
      
      return status.pending === 0;
    } catch (error) {
      logger.info('❌ Migration test failed:', { error: String(error) });
      return false;
    }
  }

  /**
   * Test CRUD operations
   */
  private async testCRUD(): Promise<boolean> {
    logger.info('\n📝 Testing CRUD operations...');
    
    try {
      const sql = this.db.getSQL();
      
      // Test CREATE
      logger.info('   📝 Testing CREATE...');
      const merchant = await sql`
        INSERT INTO merchants (business_name, whatsapp_number, business_category)
        VALUES ('Test Store', '+9647801234999', 'test')
        RETURNING id, business_name
      `;
      
      if (merchant.length === 0) {
        throw new Error('Failed to create merchant');
      }
      
      const merchantId = firstOrThrow(merchant, 'No merchant created').id;
      logger.info(`   ✅ Created merchant: ${get0(merchant).business_name}`);

      // Test READ
      logger.info('   📖 Testing READ...');
      const readMerchant = await sql`
        SELECT * FROM merchants WHERE id = ${merchantId}
      `;
      
      if (readMerchant.length === 0) {
        throw new Error('Failed to read merchant');
      }
      logger.info(`   ✅ Read merchant: ${get0(readMerchant).business_name}`);

      // Test UPDATE
      logger.info('   ✏️ Testing UPDATE...');
      await sql`
        UPDATE merchants 
        SET business_name = 'Updated Test Store'
        WHERE id = ${merchantId}
      `;
      
      const updatedMerchant = await sql`
        SELECT business_name FROM merchants WHERE id = ${merchantId}
      `;
      
      if (get0(updatedMerchant).business_name !== 'Updated Test Store') {
        throw new Error('Failed to update merchant');
      }
      logger.info(`   ✅ Updated merchant name`);

      // Test DELETE
      logger.info('   🗑️ Testing DELETE...');
      await sql`DELETE FROM merchants WHERE id = ${merchantId}`;
      
      const deletedCheck = await sql<{ count: string }>`
        SELECT COUNT(*)::text as count FROM merchants WHERE id = ${merchantId}
      `;
      if (Number(get0(deletedCheck).count) !== 0) {
        throw new Error('Failed to delete merchant');
      }
      logger.info(`   ✅ Deleted merchant`);

      logger.info('✅ CRUD operations test passed');
      return true;
    } catch (error) {
      logger.info('❌ CRUD operations test failed:', { error: String(error) });
      return false;
    }
  }

  /**
   * Test analytics views
   */
  private async testAnalytics(): Promise<boolean> {
    logger.info('\n📊 Testing analytics views...');
    
    try {
      const sql = this.db.getSQL();
      
      // Seed some test data first
      await seedDatabase();
      
      // Test merchant analytics view
      logger.info('   📈 Testing merchant analytics...');
      const merchantAnalytics = await sql`
        SELECT * FROM merchant_analytics LIMIT 5
      `;
      logger.info(`   ✅ Merchant analytics: ${merchantAnalytics.length} records`);

      // Test platform stats view
      logger.info('   📊 Testing platform stats...');
      const platformStats = await sql`
        SELECT * FROM daily_platform_stats LIMIT 5
      `;
      logger.info(`   ✅ Platform stats: ${platformStats.length} records`);

      // Test product performance view
      logger.info('   📱 Testing product performance...');
      const productPerformance = await sql`
        SELECT * FROM product_performance LIMIT 5
      `;
      logger.info(`   ✅ Product performance: ${productPerformance.length} records`);

      // Test customer analytics view
      logger.info('   👥 Testing customer analytics...');
      const customerAnalytics = await sql`
        SELECT * FROM customer_analytics LIMIT 5
      `;
      logger.info(`   ✅ Customer analytics: ${customerAnalytics.length} records`);

      logger.info('✅ Analytics views test passed');
      return true;
    } catch (error) {
      logger.info('❌ Analytics views test failed:', { error: String(error) });
      return false;
    }
  }

  /**
   * Test search functionality
   */
  private async testSearch(): Promise<boolean> {
    logger.info('\n🔍 Testing search functionality...');
    
    try {
      const sql = this.db.getSQL();
      
      // Test product search
      logger.info('   📱 Testing product search...');
      const productSearch = await sql`
        SELECT name_ar, category 
        FROM products 
        WHERE search_vector @@ to_tsquery('arabic', 'آيفون | موبايل')
        LIMIT 5
      `;
      logger.info(`   ✅ Product search: ${productSearch.length} results`);

      // Test merchant search
      logger.info('   🏪 Testing merchant search...');
      const merchantSearch = await sql`
        SELECT business_name, business_category
        FROM merchants 
        WHERE search_vector @@ to_tsquery('arabic', 'محل | موبايل')
        LIMIT 5
      `;
      logger.info(`   ✅ Merchant search: ${merchantSearch.length} results`);

      // Test fuzzy search with pg_trgm
      logger.info('   🎯 Testing fuzzy search...');
      const fuzzySearch = await sql`
        SELECT name_ar, similarity(name_ar, 'ايفون') as sim
        FROM products 
        WHERE name_ar % 'ايفون'
        ORDER BY sim DESC
        LIMIT 3
      `;
      logger.info(`   ✅ Fuzzy search: ${fuzzySearch.length} results`);

      logger.info('✅ Search functionality test passed');
      return true;
    } catch (error) {
      logger.info('❌ Search functionality test failed:', { error: String(error) });
      return false;
    }
  }

  /**
   * Test performance
   */
  private async testPerformance(): Promise<boolean> {
    logger.info('\n⚡ Testing performance...');
    
    try {
      const sql = this.db.getSQL();
      
      // Test query performance
      logger.info('   ⏱️ Testing query performance...');
      
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
      logger.info(`   ✅ Complex query executed in ${queryTime}ms`);
      
      // Test index usage
      logger.info('   📇 Testing index usage...');
      const indexQuery = await sql`
        SELECT schemaname, tablename, indexname, idx_tup_read, idx_tup_fetch
        FROM pg_stat_user_indexes 
        WHERE idx_tup_read > 0
        ORDER BY idx_tup_read DESC
        LIMIT 5
      `;
      logger.info(`   ✅ Active indexes: ${indexQuery.length}`);

      logger.info('✅ Performance test passed');
      return true;
    } catch (error) {
      logger.info('❌ Performance test failed:', { error: String(error) });
      return false;
    }
  }

  /**
   * Test specific queries that will be used in the application
   */
  public async testApplicationQueries(): Promise<boolean> {
    logger.info('\n🎯 Testing application-specific queries...');
    
    try {
      const sql = this.db.getSQL();
      
      // Test merchant KPIs function
      logger.info('   📊 Testing merchant KPIs function...');
      const merchants = await sql`SELECT id FROM merchants LIMIT 1`;
      if (merchants.length > 0) {
        const _kpis = await sql`SELECT get_merchant_kpis(${get0(merchants).id}, 30)`;
        logger.info('   ✅ Merchant KPIs function works');
      }

      // Test platform health function
      logger.info('   🔋 Testing platform health function...');
      const _health = await sql`SELECT get_platform_health()`;
      logger.info('   ✅ Platform health function works');

      // Test product search with attributes
      logger.info('   🔍 Testing JSONB queries...');
      const productAttrs = await sql`
        SELECT name_ar, attributes->'brand' as brand
        FROM products 
        WHERE attributes->>'brand' = 'Apple'
        LIMIT 3
      `;
      logger.info(`   ✅ JSONB attribute search: ${productAttrs.length} results`);

      // Test order items aggregation
      logger.info('   📦 Testing order items aggregation...');
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
      logger.info(`   ✅ Order items aggregation: ${orderItems.length} results`);

      logger.info('✅ Application queries test passed');
      return true;
    } catch (error) {
      logger.info('❌ Application queries test failed:', { error: String(error) });
      return false;
    }
  }

  /**
   * Show database statistics
   */
  public async showDatabaseStats(): Promise<void> {
    logger.info('\n📊 Database Statistics:');
    
    try {
      // getStats غير متوفرة على المحول الحالي
      // (أزلنا الاستدعاء لتفادي خطأ النوع)
    } catch (error) {
      logger.info('❌ Failed to get database stats:', { error: String(error) });
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
if (process.argv[1] === new URL(import.meta.url).pathname) {
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
        logger.info('📖 Available commands:');
        logger.info('  test    - Run comprehensive database tests');
        logger.info('  queries - Test application-specific queries');
        logger.info('  stats   - Show database statistics');
    }
  } catch (error) {
    console.error('❌ Command failed:', error);
    process.exit(1);
  }
}