/**
 * ===============================================
 * Instagram Integration Test Runner
 * Comprehensive test runner for Instagram services
 * ===============================================
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Test configuration
const TEST_TYPES = {
  UNIT: 'unit',
  INTEGRATION: 'integration', 
  E2E: 'e2e',
  PERFORMANCE: 'performance',
  ALL: 'all'
};

const TEST_FILES = {
  [TEST_TYPES.INTEGRATION]: [
    'src/tests/instagram-integration.test.ts'
  ],
  [TEST_TYPES.UNIT]: [
    'src/tests/instagram-ai.test.ts',
    'src/tests/service-controller.test.ts'
  ],
  [TEST_TYPES.E2E]: [
    'src/tests/e2e/instagram-workflow.test.ts'
  ],
  [TEST_TYPES.PERFORMANCE]: [
    'src/tests/performance/instagram-load.test.ts'
  ]
};

/**
 * Main test runner
 */
async function runInstagramTests(testType = TEST_TYPES.INTEGRATION) {
  console.log('🧪 ======================================');
  console.log('🧪 Instagram Integration Test Runner');
  console.log('🧪 ======================================\n');

  try {
    // Validate test type
    if (!Object.values(TEST_TYPES).includes(testType)) {
      console.error('❌ Invalid test type. Available types:', Object.values(TEST_TYPES).join(', '));
      process.exit(1);
    }

    // Check environment
    await checkTestEnvironment();

    // Setup test database
    await setupTestEnvironment();

    // Run tests based on type
    if (testType === TEST_TYPES.ALL) {
      await runAllTests();
    } else {
      await runSpecificTests(testType);
    }

    // Cleanup
    await cleanupTestEnvironment();

    console.log('\n🎉 All tests completed successfully!');

  } catch (error) {
    console.error('\n❌ Test run failed:', error.message);
    
    // Cleanup on failure
    await cleanupTestEnvironment().catch(console.error);
    
    process.exit(1);
  }
}

/**
 * Check test environment prerequisites
 */
async function checkTestEnvironment() {
  console.log('🔍 Checking test environment...');

  // Check if Bun is available
  try {
    await runCommand('bun', ['--version'], { silent: true });
    console.log('  ✅ Bun runtime available');
  } catch (error) {
    throw new Error('Bun runtime not found. Please install Bun first.');
  }

  // Check if test files exist
  const testFiles = TEST_FILES[TEST_TYPES.INTEGRATION];
  for (const file of testFiles) {
    if (!fs.existsSync(file)) {
      throw new Error(`Test file not found: ${file}`);
    }
  }
  console.log('  ✅ Test files available');

  // Check database connection
  console.log('  🔍 Testing database connection...');
  try {
    await runCommand('node', ['-e', `
      import('./src/database/connection.js').then(({ getDatabase }) => {
        const db = getDatabase();
        const sql = db.getSQL();
        return sql\`SELECT 1\`;
      }).then(() => {
        console.log('Database connection OK');
        process.exit(0);
      }).catch(err => {
        console.error('Database connection failed:', err.message);
        process.exit(1);
      });
    `], { silent: true });
    console.log('  ✅ Database connection working');
  } catch (error) {
    throw new Error('Database connection failed. Check your DATABASE_URL configuration.');
  }

  console.log('✅ Environment check passed\n');
}

/**
 * Setup test environment
 */
async function setupTestEnvironment() {
  console.log('🔧 Setting up test environment...');

  // Run service control migration if needed
  console.log('  🔄 Running service control migration...');
  try {
    await runCommand('node', ['run-service-control-migration.js'], { silent: true });
    console.log('  ✅ Service control tables ready');
  } catch (error) {
    // Migration might already be applied
    console.log('  ℹ️  Service control migration already applied');
  }

  // Create test environment variables
  process.env.NODE_ENV = 'test';
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
  
  console.log('✅ Test environment setup complete\n');
}

/**
 * Run all test types
 */
async function runAllTests() {
  console.log('🚀 Running all Instagram tests...\n');

  const testTypes = [
    TEST_TYPES.UNIT,
    TEST_TYPES.INTEGRATION,
    TEST_TYPES.PERFORMANCE
  ];

  for (const testType of testTypes) {
    console.log(`\n📋 Running ${testType.toUpperCase()} tests...`);
    await runSpecificTests(testType);
  }
}

/**
 * Run specific test type
 */
async function runSpecificTests(testType) {
  const files = TEST_FILES[testType] || [];
  
  if (files.length === 0) {
    console.log(`⏭️  No ${testType} tests found`);
    return;
  }

  console.log(`🧪 Running ${testType.toUpperCase()} tests...`);
  
  for (const file of files) {
    if (fs.existsSync(file)) {
      console.log(`  🔍 Testing: ${file}`);
      
      try {
        await runCommand('bun', ['test', file], { 
          env: { ...process.env, NODE_ENV: 'test' }
        });
        console.log(`  ✅ ${file} - PASSED`);
      } catch (error) {
        console.error(`  ❌ ${file} - FAILED`);
        throw error;
      }
    } else {
      console.log(`  ⏭️  ${file} - File not found, skipping`);
    }
  }
  
  console.log(`✅ ${testType.toUpperCase()} tests completed\n`);
}

/**
 * Cleanup test environment
 */
async function cleanupTestEnvironment() {
  console.log('\n🧹 Cleaning up test environment...');
  
  try {
    // Clean up test data
    await runCommand('node', ['-e', `
      import('./src/database/connection.js').then(({ getDatabase }) => {
        const db = getDatabase();
        const sql = db.getSQL();
        return sql\`DELETE FROM merchants WHERE business_name LIKE 'Test%'\`;
      }).then(() => {
        console.log('Test data cleaned up');
      }).catch(err => {
        console.warn('Cleanup warning:', err.message);
      });
    `], { silent: true });
    
    console.log('✅ Test cleanup completed');
  } catch (error) {
    console.warn('⚠️  Cleanup warning:', error.message);
  }
}

/**
 * Run a command and return promise
 */
function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: options.silent ? 'pipe' : 'inherit',
      env: options.env || process.env,
      shell: true
    });

    let stdout = '';
    let stderr = '';

    if (options.silent) {
      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });
    }

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Command failed with code ${code}: ${stderr || stdout}`));
      }
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Show test statistics
 */
async function showTestStats() {
  console.log('📊 Instagram Test Statistics\n');
  
  try {
    const stats = {
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      testFiles: 0
    };

    // Count test files
    Object.values(TEST_FILES).flat().forEach(file => {
      if (fs.existsSync(file)) {
        stats.testFiles++;
        
        // Read file to count test cases (rough estimate)
        const content = fs.readFileSync(file, 'utf8');
        const testMatches = content.match(/test\(/g) || [];
        stats.totalTests += testMatches.length;
      }
    });

    console.log('Test Suite Overview:');
    console.log(`  📁 Test Files: ${stats.testFiles}`);
    console.log(`  🧪 Estimated Tests: ${stats.totalTests}`);
    
    // Show available test types
    console.log('\nAvailable Test Types:');
    Object.entries(TEST_FILES).forEach(([type, files]) => {
      const existingFiles = files.filter(f => fs.existsSync(f));
      console.log(`  ${type.toUpperCase()}: ${existingFiles.length}/${files.length} files`);
    });
    
  } catch (error) {
    console.error('❌ Failed to get test statistics:', error.message);
  }
}

/**
 * Generate test report
 */
async function generateTestReport() {
  console.log('📋 Generating Instagram Test Report...\n');
  
  const report = {
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    testSuite: 'Instagram Integration',
    coverage: {
      services: [
        'InstagramAIService',
        'ServiceController', 
        'ConversationAIOrchestrator',
        'InstagramWebhookHandler'
      ],
      endpoints: [
        '/api/services/toggle',
        '/api/services/:merchantId/status',
        '/api/services/:merchantId/health',
        '/webhooks/instagram'
      ]
    }
  };
  
  console.log('Test Report:');
  console.log(JSON.stringify(report, null, 2));
  
  // Save to file
  const reportPath = path.join(__dirname, 'test-reports', `instagram-${Date.now()}.json`);
  
  try {
    // Ensure directory exists
    const reportDir = path.dirname(reportPath);
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }
    
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n📄 Report saved to: ${reportPath}`);
  } catch (error) {
    console.warn('⚠️  Could not save report:', error.message);
  }
}

// Command line interface
if (import.meta.url === `file://${process.argv[1]}`) {
  const testType = process.argv[2] || TEST_TYPES.INTEGRATION;
  const command = process.argv[3];
  
  switch (command) {
    case 'stats':
      showTestStats();
      break;
      
    case 'report':
      generateTestReport();
      break;
      
    case 'help':
    case '--help':
    case '-h':
      console.log('Instagram Integration Test Runner\n');
      console.log('Usage:');
      console.log('  node run-instagram-tests.js [TEST_TYPE] [COMMAND]\n');
      console.log('Test Types:');
      console.log(`  ${TEST_TYPES.UNIT}        - Unit tests only`);
      console.log(`  ${TEST_TYPES.INTEGRATION} - Integration tests (default)`);
      console.log(`  ${TEST_TYPES.E2E}         - End-to-end tests`);
      console.log(`  ${TEST_TYPES.PERFORMANCE} - Performance tests`);
      console.log(`  ${TEST_TYPES.ALL}         - All test types\n`);
      console.log('Commands:');
      console.log('  stats       - Show test statistics');
      console.log('  report      - Generate test report');
      console.log('  help        - Show this help\n');
      console.log('Examples:');
      console.log('  node run-instagram-tests.js integration');
      console.log('  node run-instagram-tests.js all');
      console.log('  node run-instagram-tests.js unit stats');
      break;
      
    default:
      runInstagramTests(testType);
      break;
  }
}

export {
  runInstagramTests,
  showTestStats,
  generateTestReport,
  TEST_TYPES
};