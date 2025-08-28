/**
 * ===============================================
 * ManyChat Integration Test
 * اختبار تكامل ManyChat
 * ===============================================
 */

const https = require('https');

// تكوين الاختبار
const config = {
  baseUrl: 'https://ai-instgram.onrender.com', // تغيير إلى URL التطبيق الخاص بك
  endpoints: {
    health: '/api/health/manychat',
    test: '/api/test/manychat'
  },
  testData: {
    merchantId: 'test-merchant-123',
    customerId: 'test-customer-456',
    message: 'مرحبا، أريد معلومات عن المنتجات'
  }
};

/**
 * إرسال طلب HTTP
 */
function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            data: jsonData
          });
        } catch (error) {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            data: data
          });
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    if (options.body) {
      req.write(options.body);
    }
    
    req.end();
  });
}

/**
 * اختبار صحة ManyChat
 */
async function testManyChatHealth() {
  console.log('🔍 اختبار صحة ManyChat...');
  
  try {
    const url = `${config.baseUrl}${config.endpoints.health}`;
    const response = await makeRequest(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log('✅ ManyChat Health Check Result:');
    console.log(`   Status Code: ${response.statusCode}`);
    console.log(`   Response:`, JSON.stringify(response.data, null, 2));
    
    return response.statusCode === 200 && response.data.success;
  } catch (error) {
    console.error('❌ ManyChat Health Check Failed:', error.message);
    return false;
  }
}

/**
 * اختبار معالجة الرسائل
 */
async function testManyChatProcessing() {
  console.log('🔄 اختبار معالجة الرسائل...');
  
  try {
    const url = `${config.baseUrl}${config.endpoints.test}`;
    const response = await makeRequest(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(config.testData)
    });
    
    console.log('✅ ManyChat Processing Test Result:');
    console.log(`   Status Code: ${response.statusCode}`);
    console.log(`   Response:`, JSON.stringify(response.data, null, 2));
    
    return response.statusCode === 200 && response.data.success;
  } catch (error) {
    console.error('❌ ManyChat Processing Test Failed:', error.message);
    return false;
  }
}

/**
 * اختبار Instagram Webhook
 */
async function testInstagramWebhook() {
  console.log('📱 اختبار Instagram Webhook...');
  
  try {
    const webhookData = {
      object: 'instagram',
      entry: [{
        id: 'test-instagram-page-id',
        time: Math.floor(Date.now() / 1000),
        messaging: [{
          sender: { id: config.testData.customerId },
          recipient: { id: config.testData.merchantId },
          timestamp: Math.floor(Date.now() / 1000),
          message: {
            mid: 'test-message-id',
            text: config.testData.message
          }
        }]
      }]
    };
    
    const url = `${config.baseUrl}/api/webhooks/instagram`;
    const response = await makeRequest(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': 'test-signature'
      },
      body: JSON.stringify(webhookData)
    });
    
    console.log('✅ Instagram Webhook Test Result:');
    console.log(`   Status Code: ${response.statusCode}`);
    console.log(`   Response:`, JSON.stringify(response.data, null, 2));
    
    return response.statusCode === 200;
  } catch (error) {
    console.error('❌ Instagram Webhook Test Failed:', error.message);
    return false;
  }
}

/**
 * تشغيل جميع الاختبارات
 */
async function runAllTests() {
  console.log('🚀 بدء اختبارات ManyChat Integration...\n');
  
  const results = {
    health: await testManyChatHealth(),
    processing: await testManyChatProcessing(),
    webhook: await testInstagramWebhook()
  };
  
  console.log('\n📊 نتائج الاختبارات:');
  console.log(`   Health Check: ${results.health ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   Processing: ${results.processing ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   Webhook: ${results.webhook ? '✅ PASS' : '❌ FAIL'}`);
  
  const allPassed = Object.values(results).every(result => result);
  
  if (allPassed) {
    console.log('\n🎉 جميع الاختبارات نجحت! ManyChat Integration يعمل بشكل صحيح.');
  } else {
    console.log('\n⚠️ بعض الاختبارات فشلت. تحقق من الإعدادات والـ logs.');
  }
  
  return allPassed;
}

// تشغيل الاختبارات إذا تم تشغيل الملف مباشرة
if (require.main === module) {
  runAllTests().catch(console.error);
}

module.exports = {
  testManyChatHealth,
  testManyChatProcessing,
  testInstagramWebhook,
  runAllTests
};
