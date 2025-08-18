#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');

// قراءة البيانات الخام من الملف المحفوظ
const rawBody = fs.readFileSync('/tmp/ig.raw');
const secret = '3b41e5421706802fbc1156f9aa84247e';

// حساب التوقيع الصحيح
const expectedSignature = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

console.log('🔍 Local Webhook Test');
console.log('====================');
console.log('Raw body size:', rawBody.length, 'bytes');
console.log('Expected signature:', expectedSignature);
console.log('First 20 chars:', expectedSignature.substring(0, 27));
console.log('');

// إرسال الطلب للسيرفر المحلي
async function sendWebhook() {
    try {
        console.log('📤 Sending webhook to localhost:10000...');
        
        const response = await fetch('http://localhost:10000/webhooks/instagram', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Hub-Signature-256': expectedSignature,
                'User-Agent': 'facebookexternalua'
            },
            body: rawBody
        });
        
        console.log('📥 Response status:', response.status);
        console.log('📥 Response headers:', Object.fromEntries(response.headers.entries()));
        
        if (response.status === 200) {
            console.log('✅ Webhook accepted successfully!');
        } else {
            console.log('❌ Webhook rejected:', response.status);
            const responseText = await response.text();
            console.log('Response body:', responseText);
        }
        
    } catch (error) {
        console.error('❌ Error sending webhook:', error.message);
    }
}

// إرسال أيضاً طلب مع توقيع خاطئ للمقارنة
async function sendBadWebhook() {
    try {
        console.log('\n📤 Sending webhook with WRONG signature...');
        const badSignature = 'sha256=badbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadb';
        
        const response = await fetch('http://localhost:10000/webhooks/instagram', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Hub-Signature-256': badSignature,
                'User-Agent': 'facebookexternalua'
            },
            body: rawBody
        });
        
        console.log('📥 Bad signature response status:', response.status);
        
        if (response.status === 401) {
            console.log('✅ Bad signature correctly rejected!');
        } else {
            console.log('⚠️ Unexpected response for bad signature');
        }
        
    } catch (error) {
        console.error('❌ Error sending bad webhook:', error.message);
    }
}

// تشغيل الاختبارات
async function runTests() {
    await sendWebhook();
    await new Promise(resolve => setTimeout(resolve, 1000)); // انتظار ثانية واحدة
    await sendBadWebhook();
}

// تحقق من وجود fetch في Node.js
if (typeof fetch === 'undefined') {
    console.log('❌ fetch is not available. Please use Node.js 18+ or install node-fetch');
    process.exit(1);
}

runTests().then(() => {
    console.log('\n✅ All tests completed');
}).catch(error => {
    console.error('❌ Test failed:', error);
});