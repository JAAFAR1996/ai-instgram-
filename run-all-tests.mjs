#!/usr/bin/env node

/**
 * ===============================================
 * Test Runner (Node.js) - مشغل الاختبارات الشامل
 * Comprehensive test suite runner for Node.js
 * ===============================================
 */

import { spawn } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { teardownTimerManagement } from './src/utils/timer-manager.js';

const testSuites = [
  {
    name: 'Security & Encryption',
    pattern: 'src/services/encryption.test.ts',
    description: 'اختبارات الأمان والتشفير',
    priority: 'HIGH'
  },
  {
    name: 'Service Control API',
    pattern: 'src/api/service-control.test.ts', 
    description: 'اختبارات API التحكم في الخدمات',
    priority: 'HIGH'
  },
  {
    name: 'Merchant Repository',
    pattern: 'src/repositories/merchant-repository.test.ts',
    description: 'اختبارات مستودع التجار',
    priority: 'HIGH'
  },
  {
    name: 'Circuit Breaker',
    pattern: 'src/services/CircuitBreaker.test.ts',
    description: 'اختبارات Circuit Breaker',
    priority: 'HIGH'
  },
  {
    name: 'Database Migration',
    pattern: 'src/database/migrate.test.ts',
    description: 'اختبارات هجرة قاعدة البيانات',
    priority: 'HIGH'
  },
  {
    name: 'Monitoring & Analytics',
    pattern: 'src/services/monitoring.test.ts',
    description: 'اختبارات المراقبة والتحليلات',
    priority: 'HIGH'
  },
  {
    name: 'Instagram Integration',
    pattern: 'src/tests/instagram-integration.test.ts',
    description: 'اختبارات تكامل Instagram',
    priority: 'HIGH'
  }
];

function displayHeader() {
  console.log('\n' + '═'.repeat(80));
  console.log('🚀 AI SALES PLATFORM - مشغل الاختبارات الشامل (Node.js)');
  console.log('   Comprehensive Test Suite Runner');
  console.log('═'.repeat(80));
  console.log('📋 المجموعات المتاحة: ' + testSuites.length);
  console.log('⏰ وقت البدء: ' + new Date().toLocaleString('ar-IQ'));
  console.log('═'.repeat(80) + '\n');
}

function listTests() {
  displayHeader();
  
  console.log('📋 المجموعات المتاحة:\n');
  
  const existing = testSuites.filter(suite => existsSync(suite.pattern));
  const missing = testSuites.filter(suite => !existsSync(suite.pattern));
  
  console.log('✅ المجموعات الموجودة:');
  console.log('─'.repeat(80));
  existing.forEach((suite, index) => {
    const priorityIcon = suite.priority === 'HIGH' ? '🔴' : 
                        suite.priority === 'MEDIUM' ? '🟡' : '🟢';
    console.log(`${index + 1}. ${priorityIcon} ${suite.name}`);
    console.log(`   📄 ${suite.description}`);
    console.log(`   📁 ${suite.pattern}\n`);
  });

  if (missing.length > 0) {
    console.log('❌ المجموعات المفقودة:');
    console.log('─'.repeat(80));
    missing.forEach((suite, index) => {
      console.log(`${index + 1}. ⚠️  ${suite.name}`);
      console.log(`   📁 ${suite.pattern}\n`);
    });
  }

  console.log(`📊 الإجمالي: ${existing.length} موجود، ${missing.length} مفقود`);
}

async function runTest(suite) {
  return new Promise((resolve) => {
    console.log(`\n🔄 تشغيل: ${suite.name}`);
    console.log(`   📄 ${suite.description}`);
    console.log(`   📁 ${suite.pattern}`);
    console.log('   ' + '─'.repeat(60));

    // Try different test runners
    const runners = ['bun test', 'npm test', 'npx jest'];
    
    let child;
    
    // Try bun first
    child = spawn('bun', ['test', suite.pattern], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test' }
    });

    let stdout = '';
    let stderr = '';
    let success = false;

    child.stdout?.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      process.stdout.write(output);
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      success = code === 0;
      
      const statusIcon = success ? '✅' : '❌';
      const status = success ? 'PASS' : 'FAIL';
      
      console.log(`\n   ${statusIcon} ${status} - ${suite.name}`);
      console.log('   ' + '─'.repeat(60));
      
      resolve({ name: suite.name, success, stdout, stderr });
    });

    child.on('error', (error) => {
      if (error.code === 'ENOENT') {
        // Fallback to npm test if bun not found
        console.log('   ⚠️  Bun not found, trying npm...');
        
        const npmChild = spawn('npm', ['test', suite.pattern], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, NODE_ENV: 'test' }
        });
        
        npmChild.on('close', (code) => {
          success = code === 0;
          const statusIcon = success ? '✅' : '❌';
          const status = success ? 'PASS' : 'FAIL';
          
          console.log(`\n   ${statusIcon} ${status} - ${suite.name} (npm)`);
          console.log('   ' + '─'.repeat(60));
          
          resolve({ name: suite.name, success, stdout: '', stderr: '' });
        });
      } else {
        console.log(`\n   ❌ ERROR - ${suite.name}: ${error.message}`);
        resolve({ name: suite.name, success: false, stdout: '', stderr: error.message });
      }
    });
  });
}

async function runAllTests() {
  displayHeader();

  const existing = testSuites.filter(suite => existsSync(suite.pattern));
  
  if (existing.length === 0) {
    console.log('❌ لا توجد ملفات اختبارات للتشغيل!');
    process.exit(1);
  }

  console.log(`🚀 بدء تشغيل ${existing.length} مجموعة اختبارات...\n`);

  const results = [];
  
  for (const suite of existing) {
    try {
      const result = await runTest(suite);
      results.push(result);
    } catch (error) {
      console.error(`❌ خطأ في تشغيل ${suite.name}:`, error);
      results.push({ name: suite.name, success: false, stdout: '', stderr: error.message });
    }
  }

  // Final report
  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const passRate = existing.length > 0 ? (passed / existing.length * 100).toFixed(2) : '0';

  console.log('\n' + '═'.repeat(80));
  console.log('📈 التقرير النهائي - FINAL REPORT');
  console.log('═'.repeat(80));
  console.log(`📊 إجمالي المجموعات: ${existing.length}`);
  console.log(`✅ نجح: ${passed} (${passRate}%)`);
  console.log(`❌ فشل: ${failed}`);

  if (parseFloat(passRate) >= 95) {
    console.log('🏆 النتيجة: ممتاز - جاهز للإنتاج');
  } else if (parseFloat(passRate) >= 85) {
    console.log('🥇 النتيجة: جيد جداً - يحتاج تحسين طفيف');
  } else {
    console.log('🥉 النتيجة: يحتاج تحسين');
  }

  console.log('═'.repeat(80) + '\n');

  process.exit(failed > 0 ? 1 : 0);
}

// Main execution
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
🚀 AI Sales Platform - مشغل الاختبارات الشامل (Node.js)

الاستخدام:
  node run-all-tests.mjs [خيارات]

الخيارات:
  --list, -l     عرض قائمة الاختبارات المتاحة
  --help, -h     عرض هذه المساعدة

أمثلة:
  node run-all-tests.mjs         # تشغيل جميع الاختبارات
  node run-all-tests.mjs --list  # عرض المجموعات المتاحة
`);
  process.exit(0);
}

if (args.includes('--list') || args.includes('-l')) {
  listTests();
} else {
  runAllTests().catch(console.error);
}

process.on('exit', () => {
  teardownTimerManagement();
});