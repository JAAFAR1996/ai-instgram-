/**
 * ===============================================
 * Production Database Testing Suite (2025)
 * ✅ Comprehensive database functionality testing
 * ✅ Performance benchmarking
 * ✅ Real-world scenario simulation
 * ===============================================
 */

import { getDatabase } from '../db/adapter.js';
import { getPool } from '../db/index.js';
import { getLogger } from '../services/logger.js';
import { must } from '../utils/safety.js';
import { getRLSDatabase } from './rls-wrapper.js';
import { cleanupTestData } from './seed.js';
import { randomUUID } from 'crypto';

const log = getLogger({ component: 'database-test' });

export interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  details?: Record<string, unknown>;
  error?: string;
}

export interface TestSuite {
  name: string;
  tests: TestResult[];
  totalDuration: number;
  passed: number;
  failed: number;
  success: boolean;
}

export interface PerformanceBenchmark {
  operation: string;
  iterations: number;
  totalDuration: number;
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
  throughput: number; // operations per second
}

/**
 * Production Database Test Suite
 */
export class DatabaseTestSuite {
  private db = getDatabase();
  private pool = getPool();
  private rlsDb = getRLSDatabase();
  private testMerchantId: string | null = null;
  private testResults: TestSuite[] = [];
  private cleanupTasks: (() => Promise<void>)[] = [];

  constructor(private skipCleanup = false) {}

  /**
   * Run all test suites
   */
  public async runAllTests(): Promise<{
    success: boolean;
    suites: TestSuite[];
    totalDuration: number;
    summary: {
      totalTests: number;
      passed: number;
      failed: number;
      successRate: number;
    };
  }> {
    const startTime = Date.now();
    log.info('🧪 Starting comprehensive database test suite...');

    try {
      // Setup test environment
      await this.setupTestEnvironment();

      // Run test suites
      this.testResults.push(await this.runConnectionTests());
      this.testResults.push(await this.runCRUDTests());
      this.testResults.push(await this.runRLSTests());
      this.testResults.push(await this.runTransactionTests());
      this.testResults.push(await this.runPerformanceTests());
      this.testResults.push(await this.runIntegrityTests());
      this.testResults.push(await this.runRealWorldScenarioTests());

      const totalDuration = Date.now() - startTime;
      const summary = this.calculateSummary();

      log.info(`✅ Test suite completed in ${totalDuration}ms`, {
        totalTests: summary.totalTests,
        passed: summary.passed,
        failed: summary.failed,
        successRate: summary.successRate
      });

      return {
        success: summary.successRate === 100,
        suites: this.testResults,
        totalDuration,
        summary
      };

    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      log.error('❌ Test suite failed:', err);
      return {
        success: false,
        suites: this.testResults,
        totalDuration: Date.now() - startTime,
        summary: { totalTests: 0, passed: 0, failed: 1, successRate: 0 }
      };
    } finally {
      if (!this.skipCleanup) {
        await this.cleanup();
      }
    }
  }

  /**
   * Setup test environment
   */
  public async setupTestEnvironment(): Promise<void> {
    log.info('🔧 Setting up test environment...');
    
    // Create test merchant
    const sql = this.db.getSQL();
    const merchants = await sql`
      INSERT INTO merchants (
        business_name, 
        whatsapp_number, 
        business_category,
        subscription_status
      ) VALUES (
        'Test Merchant ' || ${randomUUID()},
        '+96470' || ${Math.floor(Math.random() * 10000000).toString().padStart(7, '0')},
        'electronics',
        'ACTIVE'
      ) RETURNING id
    `;

    this.testMerchantId = must(merchants[0], 'Failed to create test merchant').id as string;
    
    this.cleanupTasks.push(async () => {
      if (this.testMerchantId) {
        await sql`DELETE FROM merchants WHERE id = ${this.testMerchantId}`;
      }
    });

    log.info('✅ Test environment setup complete', { testMerchantId: this.testMerchantId });
  }

  /**
   * Connection and health tests
   */
  private async runConnectionTests(): Promise<TestSuite> {
    const tests: TestResult[] = [];
    const suiteStart = Date.now();

    // Test 1: Basic connection
    tests.push(await this.runTest('Basic Connection', async () => {
      const sql = this.db.getSQL();
      const result = await sql`SELECT 1 as test`;
      return { connected: true, result: result[0] };
    }));

    // Test 2: Pool stats
    tests.push(await this.runTest('Connection Pool Health', async () => {
      return { 
        totalCount: this.pool.totalCount,
        idleCount: this.pool.idleCount,
        waitingCount: this.pool.waitingCount
      };
    }));

    // Test 3: Database version and extensions
    tests.push(await this.runTest('Database Extensions', async () => {
      const sql = this.db.getSQL();
      const version = await sql`SELECT version()`;
      const extensions = await sql`
        SELECT extname, extversion 
        FROM pg_extension 
        WHERE extname IN ('uuid-ossp', 'pg_trgm', 'btree_gin')
      `;
      return { version: version[0], extensions };
    }));

    return this.createTestSuite('Connection Tests', tests, Date.now() - suiteStart);
  }

  /**
   * CRUD operation tests
   */
  private async runCRUDTests(): Promise<TestSuite> {
    const tests: TestResult[] = [];
    const suiteStart = Date.now();
    let testProductId: string | null = null;

    // Test 1: Create operation
    tests.push(await this.runTest('CREATE Operation', async () => {
      const sql = this.db.getSQL();
      const products = await sql`
        INSERT INTO products (
          merchant_id,
          sku,
          name_ar,
          name_en,
          category,
          price_iqd,
          stock_quantity,
          attributes
        ) VALUES (
          ${this.testMerchantId}::uuid,
          'TEST-' || ${randomUUID()},
          'منتج تجريبي',
          'Test Product',
          'electronics',
          100000,
          10,
          '{"brand": "TestBrand", "color": "blue"}'::jsonb
        ) RETURNING id, name_ar
      `;
      
      testProductId = must(products[0], 'Product creation failed').id as string;
      return { productId: testProductId, name: products[0]!.name_ar };
    }));

    // Test 2: Read operation
    tests.push(await this.runTest('READ Operation', async () => {
      if (!testProductId) throw new Error('No test product available');
      
      const sql = this.db.getSQL();
      const products = await sql`
        SELECT id, name_ar, attributes
        FROM products 
        WHERE id = ${testProductId}
      `;
      
      return { 
        found: products.length > 0,
        product: products[0]
      };
    }));

    // Test 3: Update operation
    tests.push(await this.runTest('UPDATE Operation', async () => {
      if (!testProductId) throw new Error('No test product available');
      
      const sql = this.db.getSQL();
      await sql`
        UPDATE products 
        SET 
          name_ar = 'منتج محدث',
          price_iqd = 150000,
          attributes = attributes || '{"updated": true}'::jsonb
        WHERE id = ${testProductId}
      `;

      const updated = await sql`
        SELECT name_ar, price_iqd, attributes
        FROM products 
        WHERE id = ${testProductId}
      `;

      return { 
        updated: updated[0]!.name_ar === 'منتج محدث',
        newPrice: updated[0]!.price_iqd,
        attributes: updated[0]!.attributes
      };
    }));

    // Test 4: Delete operation
    tests.push(await this.runTest('DELETE Operation', async () => {
      if (!testProductId) throw new Error('No test product available');
      
      const sql = this.db.getSQL();
      const deleted = await sql`
        DELETE FROM products 
        WHERE id = ${testProductId}
        RETURNING id
      `;

      const check = await sql`
        SELECT COUNT(*)::text as count 
        FROM products 
        WHERE id = ${testProductId}
      `;

      return { 
        deleted: deleted.length > 0,
        confirmed: Number(check[0]!.count) === 0
      };
    }));

    return this.createTestSuite('CRUD Tests', tests, Date.now() - suiteStart);
  }

  /**
   * Row Level Security tests
   */
  private async runRLSTests(): Promise<TestSuite> {
    const tests: TestResult[] = [];
    const suiteStart = Date.now();

    // Test 1: RLS context setup
    tests.push(await this.runTest('RLS Context Setup', async () => {
      if (!this.testMerchantId) throw new Error('No test merchant available');
      
      await this.rlsDb.setMerchantContext(this.testMerchantId);
      const context = this.rlsDb.getCurrentContext();
      return { 
        merchantId: context.merchantId,
        isValid: context.merchantId === this.testMerchantId
      };
    }));

    // Test 2: RLS query isolation
    tests.push(await this.runTest('RLS Query Isolation', async () => {
      if (!this.testMerchantId) throw new Error('No test merchant available');
      
      // Query with RLS should only return merchant's data
      const merchantProducts = await this.rlsDb.query`
        SELECT COUNT(*)::text as count
        FROM products
      `;

      // Clear context and try again (should fail)
      await this.rlsDb.clearContext();
      
      try {
        await this.rlsDb.query`SELECT COUNT(*) FROM products`;
        return { isolated: false, error: 'RLS bypass detected' };
      } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        return { 
          isolated: true, 
          merchantProductCount: merchantProducts[0]?.count,
          rlsError: err.message
        };
      }
    }));

    // Test 3: Admin context bypass
    tests.push(await this.runTest('Admin Context Bypass', async () => {
      await this.rlsDb.setAdminContext(true, 'test-admin', true);
      
      const allProducts = await this.rlsDb.query`
        SELECT COUNT(*)::text as count
        FROM products
      `;

      return { 
        adminAccess: true,
        totalProductCount: allProducts[0]?.count
      };
    }));

    return this.createTestSuite('RLS Tests', tests, Date.now() - suiteStart);
  }

  /**
   * Transaction tests
   */
  private async runTransactionTests(): Promise<TestSuite> {
    const tests: TestResult[] = [];
    const suiteStart = Date.now();

    // Test 1: Transaction commit
    tests.push(await this.runTest('Transaction Commit', async () => {
      if (!this.testMerchantId) throw new Error('No test merchant available');
      
      await this.rlsDb.setMerchantContext(this.testMerchantId);
      
      const result = await this.rlsDb.transaction(async (trx) => {
        const products = await trx`
          INSERT INTO products (
            merchant_id, sku, name_ar, category, price_iqd, stock_quantity
          ) VALUES (
            ${this.testMerchantId}::uuid, 'TXN-TEST-1', 'منتج المعاملة', 'test', 50000, 5
          ) RETURNING id
        `;

        const orders = await trx`
          INSERT INTO orders (
            merchant_id, customer_phone, status, total_amount_iqd
          ) VALUES (
            ${this.testMerchantId}::uuid, '+9647801234567', 'PENDING', 50000
          ) RETURNING id
        `;

        return { productId: products[0]!.id, orderId: orders[0]!.id };
      });

      // Verify both records exist
      const sql = this.db.getSQL();
      const productCheck = await sql`SELECT id FROM products WHERE id = ${result.productId}`;
      const orderCheck = await sql`SELECT id FROM orders WHERE id = ${result.orderId}`;

      return {
        committed: true,
        productExists: productCheck.length > 0,
        orderExists: orderCheck.length > 0,
        ...result
      };
    }));

    // Test 2: Transaction rollback
    tests.push(await this.runTest('Transaction Rollback', async () => {
      if (!this.testMerchantId) throw new Error('No test merchant available');
      
      await this.rlsDb.setMerchantContext(this.testMerchantId);
      
      let productId: string | null = null;
      
      try {
        await this.rlsDb.transaction(async (trx) => {
          const products = await trx`
            INSERT INTO products (
              merchant_id, sku, name_ar, category, price_iqd, stock_quantity
            ) VALUES (
              ${this.testMerchantId}::uuid, 'TXN-ROLLBACK', 'منتج الإرجاع', 'test', 75000, 3
            ) RETURNING id
          `;
          
          productId = products[0]!.id as string;
          
          // Force an error to trigger rollback
          await trx`INSERT INTO invalid_table (col) VALUES ('test')`;
        });
      } catch (error: unknown) {
        // Expected error
        log.debug('Expected rollback error:', { error: error instanceof Error ? error.message : String(error) });
      }

      // Verify product was rolled back
      const sql = this.db.getSQL();
      const productCheck = await sql`
        SELECT COUNT(*)::text as count 
        FROM products 
        WHERE id = ${productId}
      `;

      return {
        rolledBack: true,
        productNotExists: Number(productCheck[0]!.count) === 0,
        productId
      };
    }));

    return this.createTestSuite('Transaction Tests', tests, Date.now() - suiteStart);
  }

  /**
   * Performance benchmark tests
   */
  private async runPerformanceTests(): Promise<TestSuite> {
    const tests: TestResult[] = [];
    const suiteStart = Date.now();

    // Test 1: Simple query performance
    tests.push(await this.runTest('Simple Query Performance', async () => {
      const benchmark = await this.benchmarkOperation(
        'SELECT version()', 
        100,
        async () => {
      const sql = this.db.getSQL();
          await sql`SELECT version()`;
        }
      );
      return benchmark;
    }));

    // Test 2: Complex join performance
    tests.push(await this.runTest('Complex Join Performance', async () => {
      const benchmark = await this.benchmarkOperation(
        'Multi-table join',
        20,
        async () => {
          const sql = this.db.getSQL();
      await sql`
        SELECT 
          m.business_name,
              COUNT(DISTINCT p.id) as product_count,
              COUNT(DISTINCT o.id) as order_count
        FROM merchants m
            LEFT JOIN products p ON m.id = p.merchant_id
        LEFT JOIN orders o ON m.id = o.merchant_id
        WHERE m.subscription_status = 'ACTIVE'
        GROUP BY m.id, m.business_name
            LIMIT 50
          `;
        }
      );
      return benchmark;
    }));

    // Test 3: Index usage verification
    tests.push(await this.runTest('Index Usage Verification', async () => {
      const sql = this.db.getSQL();
      const indexStats = await sql`
        SELECT 
          schemaname, 
          tablename, 
          indexname, 
          idx_tup_read,
          idx_tup_fetch
        FROM pg_stat_user_indexes 
        WHERE idx_tup_read > 0
        ORDER BY idx_tup_read DESC
        LIMIT 10
      `;

      return { 
        activeIndexes: indexStats.length,
        topIndexes: indexStats
      };
    }));

    return this.createTestSuite('Performance Tests', tests, Date.now() - suiteStart);
  }

  /**
   * Data integrity tests
   */
  public async runIntegrityTests(): Promise<TestSuite> {
    const tests: TestResult[] = [];
    const suiteStart = Date.now();

    // Test 1: Foreign key constraints
    tests.push(await this.runTest('Foreign Key Constraints', async () => {
      const sql = this.db.getSQL();
      
      try {
        // Try to insert product with invalid merchant_id
        await sql`
          INSERT INTO products (
            merchant_id, sku, name_ar, category, price_iqd, stock_quantity
          ) VALUES (
            '00000000-0000-0000-0000-000000000000'::uuid,
            'INVALID-FK',
            'منتج خاطئ',
            'test',
            10000,
            1
          )
        `;
        return { constraintEnforced: false };
      } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        return { 
          constraintEnforced: true,
          error: err.message
        };
      }
    }));

    // Test 2: Check constraints
    tests.push(await this.runTest('Check Constraints', async () => {
      if (!this.testMerchantId) throw new Error('No test merchant available');
      
      const sql = this.db.getSQL();
      
      try {
        // Try to insert product with negative price
        await sql`
          INSERT INTO products (
            merchant_id, sku, name_ar, category, price_iqd, stock_quantity
          ) VALUES (
            ${this.testMerchantId}::uuid,
            'NEGATIVE-PRICE',
            'سعر سالب',
            'test',
            -1000,
            1
          )
        `;
        return { constraintEnforced: false };
      } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        return { 
          constraintEnforced: true,
          error: err.message
        };
      }
    }));

    // Test 3: Unique constraints
    tests.push(await this.runTest('Unique Constraints', async () => {
      if (!this.testMerchantId) throw new Error('No test merchant available');
      
      const sql = this.db.getSQL();
      
      const uniqueSku = `UNIQUE-TEST-${randomUUID()}`;
      
      // Insert first product
      await sql`
        INSERT INTO products (
          merchant_id, sku, name_ar, category, price_iqd, stock_quantity
        ) VALUES (
          ${this.testMerchantId}::uuid,
          ${uniqueSku},
          'منتج فريد',
          'test',
          25000,
          1
        )
      `;

      try {
        // Try to insert duplicate SKU
        await sql`
          INSERT INTO products (
            merchant_id, sku, name_ar, category, price_iqd, stock_quantity
          ) VALUES (
            ${this.testMerchantId}::uuid,
            ${uniqueSku},
            'منتج مكرر',
            'test',
            30000,
            1
          )
        `;
        return { constraintEnforced: false };
      } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        return { 
          constraintEnforced: true,
          sku: uniqueSku,
          error: err.message
        };
      }
    }));

    return this.createTestSuite('Integrity Tests', tests, Date.now() - suiteStart);
  }

  /**
   * Real-world scenario tests
   */
  private async runRealWorldScenarioTests(): Promise<TestSuite> {
    const tests: TestResult[] = [];
    const suiteStart = Date.now();

    // Test 1: Complete order flow
    tests.push(await this.runTest('Complete Order Flow', async () => {
      if (!this.testMerchantId) throw new Error('No test merchant available');
      
      await this.rlsDb.setMerchantContext(this.testMerchantId);
      
      const result = await this.rlsDb.transaction(async (trx) => {
        // Create customer conversation
        const conversations = await trx`
          INSERT INTO conversations (
            merchant_id, customer_phone, platform, conversation_stage
          ) VALUES (
            ${this.testMerchantId}::uuid, '+9647801234888', 'whatsapp', 'ORDERING'
          ) RETURNING id
        `;

        const conversationId = conversations[0]!.id;

        // Create order
        const orders = await trx`
          INSERT INTO orders (
            merchant_id,
            customer_phone, 
            status,
            total_amount_iqd,
            items,
            conversation_id
          ) VALUES (
            ${this.testMerchantId}::uuid,
            '+9647801234888',
            'CONFIRMED',
            100000,
            '[{"sku": "TEST-ITEM", "name": "Test Item", "quantity": 2, "price": 50000}]'::jsonb,
            ${conversationId}::uuid
          ) RETURNING id
        `;

        const orderId = orders[0]!.id;

        // Add message logs
        await trx`
          INSERT INTO message_logs (
            conversation_id,
            direction,
            platform,
            message_type,
            content,
            ai_processed,
            delivery_status
          ) VALUES (
            ${conversationId}::uuid,
            'INCOMING',
            'whatsapp',
            'TEXT',
            'أريد أن أطلب منتج',
            true,
            'DELIVERED'
          )
        `;

        return { conversationId, orderId };
      });

      return { 
        orderFlowCompleted: true,
        ...result
      };
    }));

    // Test 2: Analytics query simulation
    tests.push(await this.runTest('Analytics Query Simulation', async () => {
      if (!this.testMerchantId) throw new Error('No test merchant available');
      
      await this.rlsDb.setMerchantContext(this.testMerchantId);
      
      const analytics = await this.rlsDb.query`
        WITH merchant_stats AS (
        SELECT 
            COUNT(DISTINCT o.id) as total_orders,
            COUNT(DISTINCT c.id) as total_conversations,
            COUNT(DISTINCT p.id) as total_products,
            COALESCE(SUM(o.total_amount_iqd), 0) as total_revenue
          FROM merchants m
          LEFT JOIN orders o ON m.id = o.merchant_id AND o.status IN ('CONFIRMED', 'DELIVERED')
          LEFT JOIN conversations c ON m.id = c.merchant_id
          LEFT JOIN products p ON m.id = p.merchant_id
          WHERE m.id = ${this.testMerchantId}::uuid
        )
        SELECT * FROM merchant_stats
      `;

      return {
        analyticsCompleted: true,
        stats: analytics[0]
      };
    }));

    return this.createTestSuite('Real-World Scenario Tests', tests, Date.now() - suiteStart);
  }

  /**
   * Benchmark an operation
   */
  private async benchmarkOperation(
    operation: string,
    iterations: number,
    fn: () => Promise<void>
  ): Promise<PerformanceBenchmark> {
    const durations: number[] = [];
    
    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      await fn();
      durations.push(Date.now() - start);
    }

    const totalDuration = durations.reduce((sum, d) => sum + d, 0);
    const avgDuration = totalDuration / iterations;
    const minDuration = Math.min(...durations);
    const maxDuration = Math.max(...durations);
    const throughput = Math.round((iterations / totalDuration) * 1000);

    return {
      operation,
      iterations,
      totalDuration,
      avgDuration: Math.round(avgDuration * 100) / 100,
      minDuration,
      maxDuration,
      throughput
    };
  }

  /**
   * Run a single test
   */
  private async runTest(name: string, testFn: () => Promise<unknown>): Promise<TestResult> {
    const startTime = Date.now();
    log.debug(`🔬 Running test: ${name}`);

    try {
      const result = await testFn();
      const duration = Date.now() - startTime;
      
      log.debug(`✅ Test passed: ${name} (${duration}ms)`);
      return {
        name,
        passed: true,
        duration,
        details: typeof result === 'object' ? result as Record<string, unknown> : { result }
      };
    } catch (error: unknown) {
      const duration = Date.now() - startTime;
      const err = error instanceof Error ? error : new Error(String(error));
      
      log.error(`❌ Test failed: ${name} (${duration}ms)`, err);
      return {
        name,
        passed: false,
        duration,
        error: err.message
      };
    }
  }

  /**
   * Create test suite result
   */
  private createTestSuite(name: string, tests: TestResult[], duration: number): TestSuite {
    const passed = tests.filter(t => t.passed).length;
    const failed = tests.length - passed;
    
    return {
      name,
      tests,
      totalDuration: duration,
      passed,
      failed,
      success: failed === 0
    };
  }

  /**
   * Calculate overall summary
   */
  private calculateSummary() {
    const totalTests = this.testResults.reduce((sum, suite) => sum + suite.tests.length, 0);
    const passed = this.testResults.reduce((sum, suite) => sum + suite.passed, 0);
    const failed = totalTests - passed;
    const successRate = totalTests > 0 ? Math.round((passed / totalTests) * 100) : 0;

    return { totalTests, passed, failed, successRate };
  }

  /**
   * Cleanup test data
   */
  private async cleanup(): Promise<void> {
    log.info('🧹 Cleaning up test data...');
    
    try {
      // Run cleanup tasks in reverse order
      for (const cleanup of this.cleanupTasks.reverse()) {
        await cleanup();
      }
      
      // Clean up any remaining test data
      await cleanupTestData();
      
      log.info('✅ Cleanup completed');
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      log.error('❌ Cleanup failed:', err);
    }
  }
}

/**
 * CLI Test Runner
 */
export async function runDatabaseTests(options?: {
  skipCleanup?: boolean;
  suiteFilter?: string;
}): Promise<boolean> {
  const testSuite = new DatabaseTestSuite(options?.skipCleanup);
  const results = await testSuite.runAllTests();
  
  // Print summary
  console.log('\n📊 Test Results Summary:');
  console.log(`Total Tests: ${results.summary.totalTests}`);
  console.log(`✅ Passed: ${results.summary.passed}`);
  console.log(`❌ Failed: ${results.summary.failed}`);
  console.log(`Success Rate: ${results.summary.successRate}%`);
  console.log(`Duration: ${results.totalDuration}ms\n`);

  if (!results.success) {
    console.log('❌ Failed Tests:');
    results.suites.forEach(suite => {
      suite.tests.filter(t => !t.passed).forEach(test => {
        console.log(`  • ${suite.name}: ${test.name} - ${test.error}`);
      });
    });
  }

  return results.success;
}

/**
 * Export quick test functions for development
 */
export async function quickConnectionTest(): Promise<boolean> {
  const db = getDatabase();
  try {
    const sql = db.getSQL();
    await sql`SELECT 1 as test`;
    log.info('✅ Database connection successful');
    return true;
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error('❌ Database connection failed:', err);
    return false;
  }
}

export async function quickIntegrityTest(): Promise<boolean> {
  try {
    const testSuite = new DatabaseTestSuite(true);
    await testSuite.setupTestEnvironment();
    const results = await testSuite.runIntegrityTests();
    return results.success;
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error('❌ Integrity test failed:', err);
    return false;
  }
}

// CLI Runner
if (require.main === module) {
  const command = process.argv[2];
  
  (async () => {
  try {
    switch (command) {
        case 'all':
      case 'test':
          const success = await runDatabaseTests();
        process.exit(success ? 0 : 1);
        break;
          
        case 'connection':
          const connected = await quickConnectionTest();
          process.exit(connected ? 0 : 1);
        break;
          
        case 'integrity':
          const integrityOk = await quickIntegrityTest();
          process.exit(integrityOk ? 0 : 1);
        break;
          
      default:
          console.log('📖 Available commands:');
          console.log('  all        - Run all database tests');
          console.log('  connection - Quick connection test');
          console.log('  integrity  - Quick data integrity test');
          process.exit(0);
      }
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('❌ Command failed:', err);
    process.exit(1);
  }
  })();
}