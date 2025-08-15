#!/usr/bin/env node

/**
 * Instagram Webhook Signature Testing Script
 * Tests X-Hub-Signature-256 verification against production server
 * Based on Meta's official webhook verification docs
 */

const crypto = require('crypto');
const https = require('https');

// Configuration
const WEBHOOK_URL = 'https://ai-instgram.onrender.com/webhooks/instagram';
const LOCAL_TEST_URL = 'http://localhost:3001/webhooks/instagram';
const APP_SECRET = 'e7f6750636baccdd3bd1f8cc948b4bd9';

console.log('🔐 Instagram Webhook Signature Testing');
console.log('=====================================');
console.log(`App Secret: ${APP_SECRET.substring(0, 8)}...`);
console.log('');

/**
 * Generate HMAC-SHA256 signature per Meta's specification
 * @param {string} payload - Raw JSON payload
 * @param {string} secret - App secret
 * @returns {string} - hex signature
 */
function generateSignature(payload, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(payload, 'utf8')
    .digest('hex');
}

/**
 * Test webhook with signed payload
 * @param {string} url - Webhook URL
 * @param {Object} payload - Test payload
 * @param {string} signature - Expected signature
 * @returns {Promise<Object>} - Test result
 */
function testWebhook(url, payload, signature) {
  return new Promise((resolve) => {
    const payloadString = JSON.stringify(payload);
    const fullSignature = `sha256=${signature}`;
    
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payloadString),
        'X-Hub-Signature-256': fullSignature,
        'User-Agent': 'Instagram-Webhook-Test/1.0'
      }
    };

    // Handle both http and https URLs
    const client = url.startsWith('https:') ? https : require('http');
    
    const req = client.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data,
          signature: fullSignature,
          payload: payloadString
        });
      });
    });

    req.on('error', (error) => {
      resolve({
        statusCode: 'ERROR',
        error: error.message,
        signature: fullSignature
      });
    });

    req.write(payloadString);
    req.end();
  });
}

// Test Cases
async function runTests() {
  // Test payload (Instagram webhook format)
  const validPayload = {
    object: 'instagram',
    entry: [
      {
        id: '17841400008460056',
        time: 1234567890,
        changes: [
          {
            value: {
              media_id: '17842721965059448',
              comment_id: '17842721965059123'
            },
            field: 'comments'
          }
        ]
      }
    ]
  };

  console.log('📋 Test Payload:');
  console.log(JSON.stringify(validPayload, null, 2));
  console.log('');

  // Test 1: Valid signature
  console.log('🧪 Test 1: Valid Signature');
  console.log('==========================');
  
  const validPayloadString = JSON.stringify(validPayload);
  const validSignature = generateSignature(validPayloadString, APP_SECRET);
  
  console.log(`Generated signature: ${validSignature}`);
  console.log(`Full header: sha256=${validSignature}`);
  console.log('');

  // Test against local server first (if available)
  console.log('🔍 Testing Local Server (if running)...');
  const localResult = await testWebhook(LOCAL_TEST_URL, validPayload, validSignature);
  
  if (localResult.statusCode !== 'ERROR') {
    console.log(`✅ Local Test Result: ${localResult.statusCode}`);
    console.log(`   Response: ${localResult.body}`);
    
    if (localResult.statusCode === 200) {
      console.log('   ✅ Valid signature accepted');
    } else {
      console.log('   ❌ Valid signature rejected');
    }
  } else {
    console.log(`⚠️  Local server not available: ${localResult.error}`);
  }
  console.log('');

  // Test against production server  
  console.log('🌐 Testing Production Server...');
  const prodResult = await testWebhook(WEBHOOK_URL, validPayload, validSignature);
  
  if (prodResult.statusCode !== 'ERROR') {
    console.log(`✅ Production Test Result: ${prodResult.statusCode}`);
    console.log(`   Response: ${prodResult.body}`);
    
    if (prodResult.statusCode === 200) {
      console.log('   ✅ Valid signature accepted');
    } else {
      console.log('   ❌ Valid signature rejected');
    }
  } else {
    console.log(`❌ Production server error: ${prodResult.error}`);
  }
  console.log('');

  // Test 2: Invalid signature (tampered payload)
  console.log('🧪 Test 2: Invalid Signature (Tampered Payload)');
  console.log('===============================================');
  
  const tamperedPayload = {
    ...validPayload,
    entry: [
      {
        ...validPayload.entry[0],
        id: 'HACKED_ID_12345' // Tampered data
      }
    ]
  };

  // Use the VALID signature with TAMPERED payload (should fail)
  console.log('Testing tampered payload with original signature...');
  
  const tamperedResult = await testWebhook(WEBHOOK_URL, tamperedPayload, validSignature);
  
  if (tamperedResult.statusCode !== 'ERROR') {
    console.log(`🔍 Tampered Test Result: ${tamperedResult.statusCode}`);
    console.log(`   Response: ${tamperedResult.body}`);
    
    if (tamperedResult.statusCode === 401 || tamperedResult.statusCode === 403) {
      console.log('   ✅ Tampered payload correctly rejected');
    } else if (tamperedResult.statusCode === 200) {
      console.log('   ❌ SECURITY ISSUE: Tampered payload accepted!');
    } else {
      console.log(`   ⚠️  Unexpected response: ${tamperedResult.statusCode}`);
    }
  } else {
    console.log(`❌ Error testing tampered payload: ${tamperedResult.error}`);
  }
  console.log('');

  // Test 3: No signature
  console.log('🧪 Test 3: Missing Signature');
  console.log('============================');
  
  const noSigResult = await testWebhookNoSig(WEBHOOK_URL, validPayload);
  
  if (noSigResult.statusCode !== 'ERROR') {
    console.log(`🔍 No Signature Result: ${noSigResult.statusCode}`);
    console.log(`   Response: ${noSigResult.body}`);
    
    if (noSigResult.statusCode === 400 || noSigResult.statusCode === 401) {
      console.log('   ✅ Missing signature correctly rejected');
    } else if (noSigResult.statusCode === 200) {
      console.log('   ❌ SECURITY ISSUE: Missing signature accepted!');
    }
  } else {
    console.log(`❌ Error testing missing signature: ${noSigResult.error}`);
  }

  console.log('');
  console.log('🎯 Summary:');
  console.log('===========');
  console.log('✅ Valid signature should return: 200');
  console.log('❌ Tampered payload should return: 401/403');
  console.log('❌ Missing signature should return: 400/401');
  console.log('');
  console.log('🔗 Webhook URL: ' + WEBHOOK_URL);
}

/**
 * Test webhook without signature
 */
function testWebhookNoSig(url, payload) {
  return new Promise((resolve) => {
    const payloadString = JSON.stringify(payload);
    
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payloadString),
        'User-Agent': 'Instagram-Webhook-Test/1.0'
        // No X-Hub-Signature-256 header
      }
    };

    const client = url.startsWith('https:') ? https : require('http');
    
    const req = client.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });

    req.on('error', (error) => {
      resolve({
        statusCode: 'ERROR',
        error: error.message
      });
    });

    req.write(payloadString);
    req.end();
  });
}

// Run the tests
runTests().catch(console.error);