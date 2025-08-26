#!/usr/bin/env bun

/**
 * ===============================================
 * Test Runner - مشغل الاختبارات الشامل
 * Comprehensive test suite runner with detailed reporting
 * ===============================================
 */

import { spawn } from 'child_process';
import { existsSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { teardownTimerManagement } from './src/utils/timer-manager.js';

interface TestResult {
  file: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  duration: number;
  tests: number;
  passed: number;
  failed: number;
  errors: string[];
}

interface TestSuite {
  name: string;
  pattern: string;
  description: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
}

class TestRunner {
  private results: TestResult[] = [];
  private startTime = Date.now();
  private totalTests = 0;
  private passedTests = 0;
  private failedTests = 0;

  // تعريف مجموعات الاختبارات
  private testSuites: TestSuite[] = [
    {
      name: 'Security & Encryption',
      pattern: 'src/services/encryption.test.ts',
      description: 'اختبارات الأمان والتشفير - حماية البيانات الحساسة',
      priority: 'HIGH'
    },
    {
      name: 'Service Control API',
      pattern: 'src/api/service-control.test.ts',
      description: 'اختبارات API التحكم في الخدمات - الواجهة الرئيسية للإدارة',
      priority: 'HIGH'
    },
    {
      name: 'Merchant Repository',
      pattern: 'src/repositories/merchant-repository.test.ts',
      description: 'اختبارات مستودع التجار - طبقة الوصول للبيانات',
      priority: 'HIGH'
    },
    {
      name: 'Circuit Breaker',
      pattern: 'src/services/CircuitBreaker.test.ts',
      description: 'اختبارات Circuit Breaker - الحماية من الأعطال المتتالية',
      priority: 'HIGH'
    },
    {
      name: 'Database Migration',
      pattern: 'src/database/migrate.test.ts',
      description: 'اختبارات هجرة قاعدة البيانات - إدارة المخطط والبيانات',
      priority: 'HIGH'
    },
    {
      name: 'Monitoring & Analytics',
      pattern: 'src/services/monitoring.test.ts',
      description: 'اختبارات المراقبة والتحليلات - قياس الأداء والتنبيهات',
      priority: 'HIGH'
    },
    {
      name: 'Instagram Integration',
      pattern: 'src/tests/instagram-integration.test.ts',
      description: 'اختبارات تكامل Instagram - الوظائف الأساسية للمنصة',
      priority: 'HIGH'
    },
    {
      name: 'Instagram Webhook',
      pattern: 'src/tests/instagram-webhook.test.ts',
      description: 'اختبارات Instagram Webhook - معالجة الأحداث المباشرة',
      priority: 'HIGH'
    },
    {
      name: 'Instagram Media Manager',
      pattern: 'src/tests/instagram-media-manager.test.ts',
      description: 'اختبارات إدارة وسائط Instagram - الصور والفيديوهات',
      priority: 'MEDIUM'
    },
    {
      name: 'Instagram Message Sender',
      pattern: 'src/tests/instagram-message-sender.test.ts',
      description: 'اختبارات إرسال رسائل Instagram - التواصل مع العملاء',
      priority: 'MEDIUM'
    },
    {
      name: 'SQL Injection Protection',
      pattern: 'src/tests/sql-injection.test.ts',
      description: 'اختبارات حماية من SQL Injection - أمان قاعدة البيانات',
      priority: 'HIGH'
    },
    {
      name: 'Rate Limiting',
      pattern: 'src/tests/meta-rate-limiter.test.ts',
      description: 'اختبارات تحديد معدل الطلبات - الحماية من الإفراط',
      priority: 'HIGH'
    },
    {
      name: 'Input Sanitization',
      pattern: 'src/tests/input-sanitization.test.ts',
      description: 'اختبارات تنظيف المدخلات - منع الهجمات الضارة',
      priority: 'HIGH'
    },
    {
      name: 'Idempotency Middleware',
      pattern: 'src/tests/idempotency.middleware.test.ts',
      description: 'اختبارات Idempotency - منع التكرار غير المرغوب',
      priority: 'MEDIUM'
    },
    {
      name: 'Dead Letter Queue',
      pattern: 'src/queue/dead-letter.test.ts',
      description: 'اختبارات Dead Letter Queue - معالجة الرسائل الفاشلة',
      priority: 'MEDIUM'
    },
    {
      name: 'Message Delivery Processor',
      pattern: 'src/queue/processors/message-delivery-processor.test.ts',
      description: 'اختبارات معالج تسليم الرسائل - ضمان الوصول',
      priority: 'MEDIUM'
    },
    {
      name: 'Analytics Processing',
      pattern: 'src/tests/analytics-processing.test.ts',
      description: 'اختبارات معالجة التحليلات - إحصائيات الاستخدام',
      priority: 'MEDIUM'
    },
    {
      name: 'Utility Messages',
      pattern: 'src/tests/utility-messages.test.ts',
      description: 'اختبارات الرسائل المساعدة - وظائف إضافية',
      priority: 'LOW'
    }
  ];

  /**
   * عرض شعار البرنامج
   */
  private displayHeader(): void {
    console.log('\n' + '═'.repeat(80));
    console.log('🚀 AI SALES PLATFORM - مشغل الاختبارات الشامل');
    console.log('   Comprehensive Test Suite Runner');
    console.log('═'.repeat(80));
    console.log('📋 المجموعات المتاحة: ' + this.testSuites.length);
    console.log('⏰ وقت البدء: ' + new Date().toLocaleString('ar-IQ'));
    console.log('═'.repeat(80) + '\n');
  }

  /**
   * فحص وجود ملفات الاختبارات
   */
  private checkTestFiles(): { existing: TestSuite[], missing: TestSuite[] } {
    const existing: TestSuite[] = [];
    const missing: TestSuite[] = [];

    for (const suite of this.testSuites) {
      if (existsSync(suite.pattern)) {
        existing.push(suite);
      } else {
        missing.push(suite);
      }
    }

    return { existing, missing };
  }

  /**
   * تشغيل مجموعة اختبارات محددة
   */
  private async runTestSuite(suite: TestSuite): Promise<TestResult> {
    const startTime = Date.now();
    
    return new Promise((resolve) => {
      console.log(`\n🔄 تشغيل: ${suite.name}`);
      console.log(`   📄 ${suite.description}`);
      console.log(`   📁 ${suite.pattern}`);
      console.log('   ' + '─'.repeat(60));

      const child = spawn('bun', ['test', suite.pattern, '--reporter=verbose'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'test' }
      });

      let stdout = '';
      let stderr = '';
      let tests = 0;
      let passed = 0;
      let failed = 0;
      const errors: string[] = [];

      child.stdout?.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        process.stdout.write(output);
        
        // تحليل النتائج
        const testMatches = output.match(/✓|✗/g);
        if (testMatches) {
          testMatches.forEach(match => {
            tests++;
            if (match === '✓') passed++;
            else failed++;
          });
        }
      });

      child.stderr?.on('data', (data) => {
        const error = data.toString();
        stderr += error;
        if (error.trim()) {
          errors.push(error.trim());
          console.error('❌ خطأ: ', error);
        }
      });

      child.on('close', (code) => {
        const duration = Date.now() - startTime;
        const status = code === 0 ? 'PASS' : 'FAIL';

        // إحصائيات من الإخراج إذا لم يتم العثور عليها
        if (tests === 0) {
          const passMatches = stdout.match(/(\d+) passing/);
          const failMatches = stdout.match(/(\d+) failing/);
          
          if (passMatches) passed = parseInt(passMatches[1]);
          if (failMatches) failed = parseInt(failMatches[1]);
          tests = passed + failed;
        }

        const result: TestResult = {
          file: suite.pattern,
          status,
          duration,
          tests: tests || 1,
          passed: passed || (code === 0 ? 1 : 0),
          failed: failed || (code === 0 ? 0 : 1),
          errors
        };

        // تحديث الإحصائيات العامة
        this.totalTests += result.tests;
        this.passedTests += result.passed;
        this.failedTests += result.failed;

        this.displayTestResult(suite, result);
        resolve(result);
      });
    });
  }

  /**
   * عرض نتيجة مجموعة اختبارات
   */
  private displayTestResult(suite: TestSuite, result: TestResult): void {
    const statusIcon = result.status === 'PASS' ? '✅' : '❌';
    const priorityIcon = suite.priority === 'HIGH' ? '🔴' : 
                        suite.priority === 'MEDIUM' ? '🟡' : '🟢';
    
    console.log(`\n   ${statusIcon} ${result.status} - ${suite.name} ${priorityIcon}`);
    console.log(`   📊 النتائج: ${result.passed}/${result.tests} نجح`);
    console.log(`   ⏱️  المدة: ${result.duration}ms`);
    
    if (result.failed > 0) {
      console.log(`   ❌ فشل: ${result.failed} اختبار`);
    }
    
    if (result.errors.length > 0) {
      console.log(`   🐛 أخطاء: ${result.errors.length}`);
    }
    
    console.log('   ' + '─'.repeat(60));
  }

  /**
   * عرض تقرير مفصل للنتائج النهائية
   */
  private displayFinalReport(): void {
    const totalDuration = Date.now() - this.startTime;
    const passRate = this.totalTests > 0 ? (this.passedTests / this.totalTests * 100).toFixed(2) : '0';
    const failRate = this.totalTests > 0 ? (this.failedTests / this.totalTests * 100).toFixed(2) : '0';

    console.log('\n' + '═'.repeat(80));
    console.log('📈 التقرير النهائي - FINAL REPORT');
    console.log('═'.repeat(80));
    
    // الإحصائيات العامة
    console.log(`📊 إجمالي المجموعات المختبرة: ${this.results.length}`);
    console.log(`🧪 إجمالي الاختبارات: ${this.totalTests}`);
    console.log(`✅ نجح: ${this.passedTests} (${passRate}%)`);
    console.log(`❌ فشل: ${this.failedTests} (${failRate}%)`);
    console.log(`⏱️  إجمالي الوقت: ${(totalDuration / 1000).toFixed(2)} ثانية`);

    // تصنيف النتائج
    const passedSuites = this.results.filter(r => r.status === 'PASS');
    const failedSuites = this.results.filter(r => r.status === 'FAIL');

    console.log('\n' + '─'.repeat(80));
    console.log('🏆 المجموعات الناجحة:');
    console.log('─'.repeat(80));
    
    passedSuites.forEach((result, index) => {
      const suite = this.testSuites.find(s => s.pattern === result.file);
      const priorityIcon = suite?.priority === 'HIGH' ? '🔴' : 
                          suite?.priority === 'MEDIUM' ? '🟡' : '🟢';
      console.log(`${index + 1}. ✅ ${suite?.name || result.file} ${priorityIcon}`);
      console.log(`   📊 ${result.passed}/${result.tests} اختبار - ${result.duration}ms`);
    });

    if (failedSuites.length > 0) {
      console.log('\n' + '─'.repeat(80));
      console.log('⚠️  المجموعات الفاشلة:');
      console.log('─'.repeat(80));
      
      failedSuites.forEach((result, index) => {
        const suite = this.testSuites.find(s => s.pattern === result.file);
        console.log(`${index + 1}. ❌ ${suite?.name || result.file}`);
        console.log(`   📊 ${result.passed}/${result.tests} اختبار - ${result.failed} فشل`);
        if (result.errors.length > 0) {
          console.log(`   🐛 الأخطاء:`);
          result.errors.slice(0, 3).forEach(error => {
            console.log(`      • ${error.substring(0, 100)}...`);
          });
        }
      });
    }

    // تقييم الجودة الإجمالية
    console.log('\n' + '─'.repeat(80));
    console.log('🎯 تقييم الجودة:');
    console.log('─'.repeat(80));
    
    const overallScore = parseFloat(passRate);
    let qualityRating = '';
    let recommendation = '';
    
    if (overallScore >= 95) {
      qualityRating = '🏆 ممتاز - Excellent';
      recommendation = '✅ جاهز للإنتاج - Ready for Production';
    } else if (overallScore >= 85) {
      qualityRating = '🥇 جيد جداً - Very Good';
      recommendation = '⚠️  يحتاج تحسين طفيف - Minor improvements needed';
    } else if (overallScore >= 75) {
      qualityRating = '🥈 جيد - Good';
      recommendation = '🔧 يحتاج تحسينات متوسطة - Moderate improvements needed';
    } else {
      qualityRating = '🥉 يحتاج تحسين - Needs Improvement';
      recommendation = '🚨 غير جاهز للإنتاج - Not ready for production';
    }
    
    console.log(`📈 النتيجة الإجمالية: ${passRate}% - ${qualityRating}`);
    console.log(`🎯 التوصية: ${recommendation}`);

    // إحصائيات الأولوية
    const highPriorityPassed = this.results.filter(r => {
      const suite = this.testSuites.find(s => s.pattern === r.file);
      return suite?.priority === 'HIGH' && r.status === 'PASS';
    }).length;
    
    const highPriorityTotal = this.testSuites.filter(s => s.priority === 'HIGH').length;
    const criticalPassRate = highPriorityTotal > 0 ? (highPriorityPassed / highPriorityTotal * 100).toFixed(2) : '0';
    
    console.log('\n📊 تقرير الأولوية:');
    console.log(`🔴 عالية الأولوية: ${highPriorityPassed}/${highPriorityTotal} (${criticalPassRate}%)`);
    
    if (parseFloat(criticalPassRate) < 100) {
      console.log('🚨 تحذير: توجد اختبارات عالية الأولوية فاشلة!');
    }

    console.log('\n' + '═'.repeat(80));
    console.log('🏁 انتهى تشغيل جميع الاختبارات');
    console.log('   مجموعة الاختبارات الشاملة للـ AI Sales Platform');
    console.log('═'.repeat(80) + '\n');

    // رمز الخروج
    process.exit(failedSuites.length > 0 ? 1 : 0);
  }

  /**
   * تشغيل جميع الاختبارات
   */
  public async runAllTests(): Promise<void> {
    this.displayHeader();

    // فحص ملفات الاختبارات
    const { existing, missing } = this.checkTestFiles();

    if (missing.length > 0) {
      console.log('⚠️  ملفات اختبارات مفقودة:');
      missing.forEach(suite => {
        console.log(`   • ${suite.name} - ${suite.pattern}`);
      });
      console.log();
    }

    if (existing.length === 0) {
      console.log('❌ لا توجد ملفات اختبارات للتشغيل!');
      process.exit(1);
    }

    console.log(`🚀 بدء تشغيل ${existing.length} مجموعة اختبارات...\n`);

    // ترتيب حسب الأولوية
    const sortedSuites = existing.sort((a, b) => {
      const priorityOrder = { 'HIGH': 0, 'MEDIUM': 1, 'LOW': 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

    // تشغيل الاختبارات تسلسلياً
    for (const suite of sortedSuites) {
      try {
        const result = await this.runTestSuite(suite);
        this.results.push(result);
      } catch (error) {
        console.error(`❌ خطأ في تشغيل ${suite.name}:`, error);
        this.results.push({
          file: suite.pattern,
          status: 'FAIL',
          duration: 0,
          tests: 0,
          passed: 0,
          failed: 1,
          errors: [error instanceof Error ? error.message : String(error)]
        });
      }
    }

    // عرض التقرير النهائي
    this.displayFinalReport();
  }

  /**
   * تشغيل اختبارات محددة فقط
   */
  public async runSpecificTests(patterns: string[]): Promise<void> {
    this.displayHeader();

    const matchingSuites = this.testSuites.filter(suite =>
      patterns.some(pattern => 
        suite.name.toLowerCase().includes(pattern.toLowerCase()) ||
        suite.pattern.includes(pattern)
      )
    );

    if (matchingSuites.length === 0) {
      console.log('❌ لم يتم العثور على اختبارات تطابق الأنماط المحددة!');
      process.exit(1);
    }

    console.log(`🎯 تشغيل ${matchingSuites.length} مجموعة مطابقة...\n`);

    for (const suite of matchingSuites) {
      try {
        const result = await this.runTestSuite(suite);
        this.results.push(result);
      } catch (error) {
        console.error(`❌ خطأ في تشغيل ${suite.name}:`, error);
        this.results.push({
          file: suite.pattern,
          status: 'FAIL',
          duration: 0,
          tests: 0,
          passed: 0,
          failed: 1,
          errors: [error instanceof Error ? error.message : String(error)]
        });
      }
    }

    this.displayFinalReport();
  }

  /**
   * عرض قائمة المجموعات المتاحة
   */
  public listAvailableTests(): void {
    this.displayHeader();
    
    console.log('📋 المجموعات المتاحة:\n');
    
    const { existing, missing } = this.checkTestFiles();
    
    // عرض المجموعات الموجودة
    console.log('✅ المجموعات الموجودة:');
    console.log('─'.repeat(80));
    existing.forEach((suite, index) => {
      const priorityIcon = suite.priority === 'HIGH' ? '🔴' : 
                          suite.priority === 'MEDIUM' ? '🟡' : '🟢';
      console.log(`${index + 1}. ${priorityIcon} ${suite.name}`);
      console.log(`   📄 ${suite.description}`);
      console.log(`   📁 ${suite.pattern}\n`);
    });

    // عرض المجموعات المفقودة
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
}

// تشغيل البرنامج الرئيسي
async function main() {
  const runner = new TestRunner();
  const args = process.argv.slice(2);

  if (args.includes('--list') || args.includes('-l')) {
    runner.listAvailableTests();
    return;
  }

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
🚀 AI Sales Platform - مشغل الاختبارات الشامل

الاستخدام:
  bun run-all-tests.ts [خيارات] [أنماط...]

الخيارات:
  --list, -l     عرض قائمة بجميع مجموعات الاختبارات المتاحة
  --help, -h     عرض هذه المساعدة

أمثلة:
  bun run-all-tests.ts                    # تشغيل جميع الاختبارات
  bun run-all-tests.ts instagram          # تشغيل اختبارات Instagram فقط
  bun run-all-tests.ts security api       # تشغيل اختبارات الأمان والـ API
  bun run-all-tests.ts --list             # عرض المجموعات المتاحة

المجموعات المتاحة:
  • Security & Encryption
  • Service Control API  
  • Merchant Repository
  • Circuit Breaker
  • Database Migration
  • Monitoring & Analytics
  • Instagram Integration
  • ... والمزيد
`);
    return;
  }

  const patterns = args.filter(arg => !arg.startsWith('--'));
  
  if (patterns.length > 0) {
    await runner.runSpecificTests(patterns);
  } else {
    await runner.runAllTests();
  }
}

// معالج الأخطاء غير المتوقعة
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

process.on('exit', () => {
  teardownTimerManagement();
});

// تشغيل البرنامج
main().catch(console.error);