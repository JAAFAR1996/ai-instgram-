/**
 * ===============================================
 * Complete Test Suite Runner
 * مشغل مجموعة الاختبارات الكاملة الجديدة
 * ===============================================
 */

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';

interface TestResult {
  file: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  coverage?: number;
  errors?: string[];
}

interface TestSuiteReport {
  totalFiles: number;
  passed: number;
  failed: number;
  skipped: number;
  totalDuration: number;
  overallCoverage: number;
  results: TestResult[];
}

class ComprehensiveTestRunner {
  private testFiles: string[] = [];
  private results: TestResult[] = [];

  constructor() {
    console.log('🚀 تشغيل مجموعة الاختبارات الشاملة الجديدة');
    console.log('🚀 Running Comprehensive New Test Suite');
    console.log('='.repeat(60));
  }

  /**
   * جمع جميع ملفات الاختبارات الجديدة
   */
  private async collectAllTestFiles(): Promise<void> {
    console.log('📋 جمع ملفات الاختبارات...');
    
    const newTestFiles = [
      // Security & Middleware Tests
      'src/middleware/enhanced-security.test.ts',
      'src/middleware/security.test.ts',
      
      // AI Services Tests  
      'src/services/ai.test.ts',
      'src/services/instagram-ai.test.ts',
      
      // Instagram Integration Tests
      'src/services/instagram-api.test.ts',
      'src/services/instagram-comments-manager.test.ts',
      
      // Database & Repository Tests
      'src/repositories/merchant-repository.test.ts',
      'src/database/migrate.test.ts',
      
      // Queue Management Tests
      'src/queue/enhanced-queue.test.ts',
      'src/queue/dead-letter.test.ts',
      'src/queue/processors/message-delivery-processor.test.ts',
      'src/queue/processors/notification-processor.test.ts',
      
      // Configuration Tests
      'src/config/environment.test.ts',
      'src/startup/validation.test.ts',
      
      // API Tests
      'src/api/service-control.test.ts',
      
      // Utility & Infrastructure Tests
      'src/services/monitoring.test.ts',
      'src/services/telemetry.test.ts',
      'src/services/logger.test.ts',
      'src/services/utility-messages.test.ts',
      'src/services/encryption.test.ts',
      'src/services/CircuitBreaker.test.ts',
      
      // Error Handling Tests
      'src/errors/RedisErrors.test.ts',
      
      // Existing Tests in tests/ directory
      'src/tests/analytics-processing.test.ts',
      'src/tests/hashtag-growth.test.ts',
      'src/tests/idempotency.middleware.test.ts',
      'src/tests/input-sanitization.test.ts',
      'src/tests/instagram-integration.test.ts',
      'src/tests/instagram-media-manager.test.ts',
      'src/tests/instagram-message-sender.test.ts',
      'src/tests/instagram-messaging.test.ts',
      'src/tests/instagram-oauth.test.ts',
      'src/tests/instagram-token-retrieval.test.ts',
      'src/tests/instagram-webhook.test.ts',
      'src/tests/media-id-uniqueness.test.ts',
      'src/tests/meta-rate-limiter.test.ts',
      'src/tests/oauth-session-pkce.test.ts',
      'src/tests/raw-body-middleware.test.ts',
      'src/tests/rls-wrapper.test.ts',
      'src/tests/sql-injection.test.ts',
      'src/tests/utility-messages.test.ts',
      'src/tests/whatsapp-signature.test.ts'
    ];

    // التحقق من وجود الملفات
    for (const testFile of newTestFiles) {
      try {
        await fs.access(testFile);
        this.testFiles.push(testFile);
        console.log(`  ✅ تم العثور على: ${testFile}`);
      } catch (error) {
        console.log(`  ⚠️  غير موجود: ${testFile}`);
      }
    }

    console.log(`\n📊 إجمالي ملفات الاختبار: ${this.testFiles.length}`);
  }

  /**
   * تشغيل اختبار واحد
   */
  private async runSingleTest(testFile: string): Promise<TestResult> {
    const startTime = Date.now();
    
    console.log(`\n🧪 تشغيل: ${testFile}`);
    
    try {
      // محاولة تشغيل مع bun أولاً
      const result = await this.executeTest('bun', ['test', testFile]);
      
      if (result.success) {
        const duration = Date.now() - startTime;
        console.log(`  ✅ نجح في ${duration}ms`);
        
        return {
          file: testFile,
          status: 'passed',
          duration,
          coverage: this.extractCoverage(result.output)
        };
      } else {
        throw new Error(result.error);
      }
    } catch (bunError) {
      console.log(`  ⚠️  فشل bun، محاولة مع node...`);
      
      try {
        // محاولة مع node كبديل
        const result = await this.executeTest('node', ['--test', testFile]);
        
        const duration = Date.now() - startTime;
        
        if (result.success) {
          console.log(`  ✅ نجح مع node في ${duration}ms`);
          return {
            file: testFile,
            status: 'passed',
            duration
          };
        } else {
          throw new Error(result.error);
        }
      } catch (nodeError) {
        const duration = Date.now() - startTime;
        console.log(`  ❌ فشل: ${nodeError}`);
        
        return {
          file: testFile,
          status: 'failed',
          duration,
          errors: [String(bunError), String(nodeError)]
        };
      }
    }
  }

  /**
   * تنفيذ أمر الاختبار
   */
  private executeTest(command: string, args: string[]): Promise<{success: boolean, output: string, error: string}> {
    return new Promise((resolve) => {
      const process = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true
      });

      let output = '';
      let error = '';

      process.stdout?.on('data', (data) => {
        output += data.toString();
      });

      process.stderr?.on('data', (data) => {
        error += data.toString();
      });

      process.on('close', (code) => {
        resolve({
          success: code === 0,
          output,
          error: error || (code !== 0 ? `Process exited with code ${code}` : '')
        });
      });

      process.on('error', (err) => {
        resolve({
          success: false,
          output,
          error: err.message
        });
      });

      // انتهاء وقت التشغيل بعد 30 ثانية
      setTimeout(() => {
        process.kill();
        resolve({
          success: false,
          output,
          error: 'Test timeout after 30 seconds'
        });
      }, 30000);
    });
  }

  /**
   * استخراج نسبة التغطية من الإخراج
   */
  private extractCoverage(output: string): number {
    const coverageMatch = output.match(/(\d+(?:\.\d+)?)%/);
    return coverageMatch ? parseFloat(coverageMatch[1]) : 0;
  }

  /**
   * تشغيل جميع الاختبارات
   */
  public async runAllTests(): Promise<TestSuiteReport> {
    const startTime = Date.now();
    
    await this.collectAllTestFiles();
    
    console.log('\n🚀 بدء تشغيل جميع الاختبارات...');
    console.log('='.repeat(60));

    // تشغيل الاختبارات بشكل متتالي لتجنب مشاكل الذاكرة
    for (const testFile of this.testFiles) {
      const result = await this.runSingleTest(testFile);
      this.results.push(result);
    }

    const totalDuration = Date.now() - startTime;
    
    // حساب الإحصائيات
    const passed = this.results.filter(r => r.status === 'passed').length;
    const failed = this.results.filter(r => r.status === 'failed').length;
    const skipped = this.results.filter(r => r.status === 'skipped').length;
    
    const coverageValues = this.results
      .map(r => r.coverage)
      .filter(c => c !== undefined) as number[];
    
    const overallCoverage = coverageValues.length > 0 
      ? coverageValues.reduce((a, b) => a + b, 0) / coverageValues.length 
      : 0;

    const report: TestSuiteReport = {
      totalFiles: this.testFiles.length,
      passed,
      failed,
      skipped,
      totalDuration,
      overallCoverage,
      results: this.results
    };

    this.printDetailedReport(report);
    
    return report;
  }

  /**
   * طباعة التقرير المفصل
   */
  private printDetailedReport(report: TestSuiteReport): void {
    console.log('\n' + '='.repeat(80));
    console.log('📊 تقرير الاختبارات الشامل - COMPREHENSIVE TEST REPORT');
    console.log('='.repeat(80));

    // الملخص العام
    console.log(`\n📈 SUMMARY - الملخص:`);
    console.log(`  📁 إجمالي الملفات: ${report.totalFiles}`);
    console.log(`  ✅ نجح: ${report.passed}`);
    console.log(`  ❌ فشل: ${report.failed}`);
    console.log(`  ⏭️  تم تخطيه: ${report.skipped}`);
    console.log(`  ⏱️  إجمالي الوقت: ${report.totalDuration}ms`);
    
    if (report.overallCoverage > 0) {
      console.log(`  📊 متوسط التغطية: ${report.overallCoverage.toFixed(1)}%`);
    }

    // النتائج المفصلة
    console.log(`\n📋 DETAILED RESULTS - النتائج المفصلة:`);
    
    report.results.forEach((result, index) => {
      const icon = result.status === 'passed' ? '✅' : 
                   result.status === 'failed' ? '❌' : '⏭️';
      
      console.log(`\n${index + 1}. ${icon} ${result.file}`);
      console.log(`   Status: ${result.status.toUpperCase()}`);
      console.log(`   Duration: ${result.duration}ms`);
      
      if (result.coverage) {
        console.log(`   Coverage: ${result.coverage}%`);
      }
      
      if (result.errors && result.errors.length > 0) {
        console.log(`   Errors:`);
        result.errors.forEach(error => {
          console.log(`     • ${error.substring(0, 100)}...`);
        });
      }
    });

    // الاختبارات الفاشلة
    const failedTests = report.results.filter(r => r.status === 'failed');
    if (failedTests.length > 0) {
      console.log(`\n❌ FAILED TESTS - الاختبارات الفاشلة:`);
      failedTests.forEach(test => {
        console.log(`  • ${test.file}`);
      });
    }

    console.log('\n' + '='.repeat(80));
    
    if (report.failed === 0) {
      console.log('🎉 جميع الاختبارات نجحت! ALL TESTS PASSED!');
      console.log('✅ المشروع جاهز للإنتاج - Project Ready for Production');
    } else {
      console.log(`⚠️  ${report.failed} اختبار فشل - ${report.failed} tests failed`);
      console.log('🔧 يرجى مراجعة الأخطاء أعلاه - Please review errors above');
    }
    
    console.log('='.repeat(80));
  }

  /**
   * حفظ التقرير في ملف
   */
  public async saveReport(report: TestSuiteReport): Promise<void> {
    const reportData = {
      timestamp: new Date().toISOString(),
      summary: {
        totalFiles: report.totalFiles,
        passed: report.passed,
        failed: report.failed,
        skipped: report.skipped,
        totalDuration: report.totalDuration,
        overallCoverage: report.overallCoverage
      },
      results: report.results
    };

    const reportJson = JSON.stringify(reportData, null, 2);
    const reportPath = `test-report-${Date.now()}.json`;
    
    await fs.writeFile(reportPath, reportJson);
    console.log(`\n💾 تم حفظ التقرير في: ${reportPath}`);
  }
}

/**
 * تشغيل مجموعة الاختبارات
 */
async function main() {
  try {
    console.log('🏁 بدء تشغيل مجموعة الاختبارات الشاملة...');
    
    const runner = new ComprehensiveTestRunner();
    const report = await runner.runAllTests();
    
    // حفظ التقرير
    await runner.saveReport(report);
    
    // إنهاء العملية بالرمز المناسب
    process.exit(report.failed === 0 ? 0 : 1);
    
  } catch (error) {
    console.error('❌ خطأ في تشغيل الاختبارات:', error);
    process.exit(1);
  }
}

// تشغيل إذا تم استدعاء الملف مباشرة
if (require.main === module) {
  main();
}

export { ComprehensiveTestRunner, TestResult, TestSuiteReport };