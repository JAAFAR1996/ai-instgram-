#!/usr/bin/env node

// اختبار معالجة webhook حقيقية مع Instagram payload فعلي
const { ProductionQueueManager } = require('./dist/services/ProductionQueueManager');
const { Environment } = require('./dist/config/RedisConfigurationFactory');

async function testRealWebhookProcessing() {
  console.log('🔥 بدء اختبار معالجة Webhook حقيقية...\n');

  const logger = {
    info: (msg, data) => console.log(`[INFO] ${msg}`, data ? JSON.stringify(data, null, 2) : ''),
    warn: (msg, data) => console.log(`[WARN] ${msg}`, data ? JSON.stringify(data, null, 2) : ''),
    error: (msg, data) => console.log(`[ERROR] ${msg}`, data ? JSON.stringify(data, null, 2) : ''),
    debug: (msg, data) => console.log(`[DEBUG] ${msg}`, data ? JSON.stringify(data, null, 2) : '')
  };

  // استخدام Redis URL من البيئة
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.error('❌ REDIS_URL مطلوب لتشغيل الاختبار');
    process.exit(1);
  }
  
  const queueManager = new ProductionQueueManager(
    redisUrl,
    logger,
    Environment.DEVELOPMENT,
    'test-real-webhook'
  );

  try {
    console.log('1️⃣ تهيئة مدير الطوابير...');
    const initResult = await queueManager.initialize();
    
    if (!initResult.success) {
      console.error('❌ فشل في تهيئة مدير الطوابير:', initResult.error);
      return;
    }

    console.log('✅ تم تهيئة مدير الطوابير بنجاح\n');

    console.log('2️⃣ إنشاء Instagram webhook payloads حقيقية...');
    
    // Payload #1: Instagram Message Event
    const instagramMessagePayload = {
      object: 'instagram',
      entry: [
        {
          id: '17841400008460056', // Instagram Business Account ID
          time: Date.now(),
          messaging: [
            {
              sender: {
                id: '123456789012345' // Customer Instagram ID
              },
              recipient: {
                id: '17841400008460056' // Business Instagram ID
              },
              timestamp: Date.now(),
              message: {
                mid: 'aGlzdGVkX19XaGF0c0FwcENoZW5nZV9kYXRlAAAA',
                text: 'مرحبا، أريد معرفة المزيد عن منتجاتكم'
              }
            }
          ]
        }
      ]
    };

    // Payload #2: Instagram Comment Event  
    const instagramCommentPayload = {
      object: 'instagram',
      entry: [
        {
          id: '17841400008460056',
          time: Date.now(),
          comments: [
            {
              id: 'comment_id_123',
              text: 'هل لديكم شحن مجاني؟',
              created_time: new Date().toISOString(),
              from: {
                id: '987654321098765',
                username: 'customer_username'
              },
              media: {
                id: 'media_id_456',
                media_product_type: 'FEED'
              }
            }
          ]
        }
      ]
    };

    const realWebhookJobs = [
      {
        eventId: 'instagram-message-001',
        payload: instagramMessagePayload,
        merchantId: 'test-merchant-real',
        platform: 'INSTAGRAM'
      },
      {
        eventId: 'instagram-comment-002', 
        payload: instagramCommentPayload,
        merchantId: 'test-merchant-real',
        platform: 'INSTAGRAM'
      }
    ];

    console.log('3️⃣ إضافة real webhook jobs...');
    
    for (let i = 0; i < realWebhookJobs.length; i++) {
      const job = realWebhookJobs[i];
      
      const jobResult = await queueManager.addWebhookJob(
        job.eventId,
        job.payload,
        job.merchantId,
        job.platform,
        'CRITICAL' // فوري
      );
      
      if (jobResult.success) {
        console.log(`✅ تم إضافة real webhook job ${i + 1}: ${jobResult.jobId}`);
      } else {
        console.error(`❌ فشل في إضافة webhook job ${i + 1}:`, jobResult.error);
      }
    }

    console.log('\n4️⃣ إضافة real AI jobs...');
    
    // Real AI Response Jobs
    const realAIJobs = [
      {
        conversationId: 'conv_instagram_001',
        merchantId: 'test-merchant-real',
        customerId: '123456789012345',
        message: 'أريد معرفة المزيد عن منتجاتكم والأسعار',
        platform: 'INSTAGRAM'
      },
      {
        conversationId: 'conv_instagram_002', 
        merchantId: 'test-merchant-real',
        customerId: '987654321098765',
        message: 'متى يكون لديكم تخفيضات؟',
        platform: 'INSTAGRAM'
      }
    ];

    for (let i = 0; i < realAIJobs.length; i++) {
      const job = realAIJobs[i];
      
      const aiJobResult = await queueManager.addAIResponseJob(
        job.conversationId,
        job.merchantId,
        job.customerId,
        job.message,
        job.platform,
        'HIGH'
      );

      if (aiJobResult.success) {
        console.log(`✅ تم إضافة real AI job ${i + 1}: ${aiJobResult.jobId}`);
      } else {
        console.error(`❌ فشل في إضافة AI job ${i + 1}:`, aiJobResult.error);
      }
    }

    console.log('\n5️⃣ مراقبة معالجة Real Processing...');
    
    // انتظار معالجة مع مراقبة مفصلة
    for (let i = 0; i < 15; i++) {
      await new Promise(resolve => setTimeout(resolve, 3000)); // انتظار 3 ثواني
      
      const stats = await queueManager.getQueueStats();
      console.log(`📊 إحصائيات Real Processing (${i * 3}s):`, {
        waiting: stats.waiting,
        active: stats.active,
        completed: stats.completed,
        failed: stats.failed,
        processing: stats.processing,
        errorRate: stats.errorRate
      });

      if (stats.waiting === 0 && stats.active === 0 && stats.completed > 0) {
        console.log('✅ تمت معالجة جميع Real Jobs بنجاح!');
        break;
      }
    }

    console.log('\n6️⃣ فحص صحة Real Processing...');
    const healthResult = await queueManager.getQueueHealth();
    
    console.log('🏥 نتائج فحص Real Processing Health:');
    console.log(`- الحالة الصحية: ${healthResult.healthy ? '✅ صحي' : '❌ غير صحي'}`);
    console.log(`- Workers النشطة: ${healthResult.workerStatus.activeWorkers}`);
    console.log(`- قيد المعالجة: ${healthResult.workerStatus.isProcessing ? 'نعم' : 'لا'}`);
    console.log('- التوصيات:', healthResult.recommendations);

    console.log('\n📈 الإحصائيات النهائية لـ Real Processing:');
    const finalStats = await queueManager.getQueueStats();
    console.log({
      totalProcessed: finalStats.completed + finalStats.failed,
      successfullyProcessed: finalStats.completed,
      failedProcessing: finalStats.failed,
      successRate: finalStats.completed > 0 ? 
        ((finalStats.completed / (finalStats.completed + finalStats.failed)) * 100).toFixed(2) + '%' : '0%',
      errorRate: finalStats.errorRate
    });

  } catch (error) {
    console.error('💥 خطأ في اختبار Real Processing:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    console.log('\n🔄 إغلاق الاتصالات...');
    await queueManager.gracefulShutdown();
    console.log('✅ تم إغلاق اختبار Real Processing بأمان');
  }
}

// تشغيل الاختبار
if (require.main === module) {
  testRealWebhookProcessing().catch(error => {
    console.error('فشل اختبار Real Processing:', error);
    process.exit(1);
  });
}

module.exports = { testRealWebhookProcessing };