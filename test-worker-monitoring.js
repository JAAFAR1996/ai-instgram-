#!/usr/bin/env node

// اختبار بسيط لمراقبة Workers المحسّنة
const { ProductionQueueManager } = require('./dist/services/ProductionQueueManager');
const { Environment } = require('./dist/config/RedisConfigurationFactory');

async function testWorkerMonitoring() {
  console.log('🧪 بدء اختبار مراقبة Workers...\n');

  const logger = {
    info: (msg, data) => console.log(`[INFO] ${msg}`, data ? JSON.stringify(data, null, 2) : ''),
    warn: (msg, data) => console.log(`[WARN] ${msg}`, data ? JSON.stringify(data, null, 2) : ''),
    error: (msg, data) => console.log(`[ERROR] ${msg}`, data ? JSON.stringify(data, null, 2) : ''),
    debug: (msg, data) => console.log(`[DEBUG] ${msg}`, data ? JSON.stringify(data, null, 2) : '')
  };

  // استخدام Redis URL من البيئة أو localhost افتراضياً
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  
  const queueManager = new ProductionQueueManager(
    redisUrl,
    logger,
    Environment.DEVELOPMENT,
    'test-worker-monitoring'
  );

  try {
    console.log('1️⃣ تهيئة مدير الطوابير...');
    const initResult = await queueManager.initialize();
    
    if (!initResult.success) {
      console.error('❌ فشل في تهيئة مدير الطوابير:', initResult.error);
      return;
    }

    console.log('✅ تم تهيئة مدير الطوابير بنجاح\n');

    console.log('2️⃣ إضافة مهام اختبار للتحقق من إصلاح Workers...');
    
    // إضافة مهام webhook لاختبار المعالج المخصص
    const jobs = [];
    for (let i = 1; i <= 3; i++) {
      const jobResult = await queueManager.addWebhookJob(
        `test-event-${i}`,
        { test: true, jobNumber: i, fixTest: 'webhook-processor-fix' },
        'test-merchant',
        'INSTAGRAM',
        'HIGH' // كلها high priority للاختبار السريع
      );
      
      if (jobResult.success) {
        console.log(`✅ تم إضافة webhook job ${i}: ${jobResult.jobId}`);
        jobs.push(jobResult.jobId);
      } else {
        console.error(`❌ فشل في إضافة webhook job ${i}:`, jobResult.error);
      }
    }

    console.log('\n🤖 إضافة مهام AI للاختبار...');
    // إضافة مهام AI أيضاً
    for (let i = 1; i <= 2; i++) {
      const aiJobResult = await queueManager.addAIResponseJob(
        `test-conversation-${i}`,
        'test-merchant',
        'test-customer',
        `رسالة اختبار رقم ${i}`,
        'INSTAGRAM',
        'HIGH'
      );

      if (aiJobResult.success) {
        console.log(`✅ تم إضافة AI job ${i}: ${aiJobResult.jobId}`);
      } else {
        console.error(`❌ فشل في إضافة AI job ${i}:`, aiJobResult.error);
      }
    }

    console.log('\n3️⃣ انتظار معالجة المهام...');
    
    // انتظار معالجة المهام ومراقبة الحالة
    for (let i = 0; i < 10; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const stats = await queueManager.getQueueStats();
      console.log(`📊 إحصائيات الطابور (${i * 2}s):`, {
        waiting: stats.waiting,
        active: stats.active,
        completed: stats.completed,
        failed: stats.failed,
        processing: stats.processing
      });

      if (stats.waiting === 0 && stats.active === 0) {
        console.log('✅ تم إنجاز جميع المهام');
        break;
      }
    }

    console.log('\n4️⃣ فحص صحة Workers...');
    const healthResult = await queueManager.getQueueHealth();
    
    console.log('🏥 نتائج فحص صحة Workers:');
    console.log(`- الحالة الصحية: ${healthResult.healthy ? '✅ صحي' : '❌ غير صحي'}`);
    console.log(`- Workers النشطة: ${healthResult.workerStatus.activeWorkers}`);
    console.log(`- قيد المعالجة: ${healthResult.workerStatus.isProcessing ? 'نعم' : 'لا'}`);
    console.log(`- التوصيات:`, healthResult.recommendations);

    console.log('\n5️⃣ التحقق النهائي من نجاح الإصلاح...');
    
    // انتظار إضافي للتأكد من إنجاز كل شيء
    await new Promise(resolve => setTimeout(resolve, 2000));

    const finalStats = await queueManager.getQueueStats();
    console.log('\n📈 الإحصائيات النهائية:', {
      total: finalStats.total,
      completed: finalStats.completed,
      failed: finalStats.failed,
      errorRate: finalStats.errorRate
    });

  } catch (error) {
    console.error('💥 خطأ في الاختبار:', error.message);
  } finally {
    console.log('\n🔄 إغلاق الاتصالات...');
    await queueManager.gracefulShutdown();
    console.log('✅ تم إغلاق الاختبار بأمان');
  }
}

// تشغيل الاختبار
if (require.main === module) {
  testWorkerMonitoring().catch(error => {
    console.error('فشل الاختبار:', error);
    process.exit(1);
  });
}

module.exports = { testWorkerMonitoring };