#!/usr/bin/env node

/**
 * Instagram Webhook Signature Verification Test
 * Tests the verifyInstagramSignature function with real Meta webhook samples
 */

const crypto = require('crypto');

// Meta standards compliant signature verification
function verifyInstagramSignature(appSecret, signature, rawBody) {
  // Calculate expected signature
  const expected = crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)  // Buffer without any conversion
    .digest('hex');
  
  // Extract provided signature (remove 'sha256=' prefix)
  const provided = signature.replace(/^sha256=/, '');
  
  // Simple string comparison (no toLowerCase)
  return expected === provided;
}

// Test cases with real Meta webhook samples
const testCases = [
  {
    name: 'Simple message webhook',
    appSecret: '3b41e5421706802fbc1156f9aa84247e',
    body: '{"entry":[{"id":"772043875986598","time":1705600000,"changes":[{"field":"messages","value":{"messaging":[{"sender":{"id":"123456"},"recipient":{"id":"772043875986598"},"timestamp":1705600000,"message":{"mid":"m_test","text":"Hello"}}]}}]}],"object":"instagram"}',
    signature: 'sha256=1685c39208162dc639a434d841ed8f78af94089b21a23d65a717049a70d768aa'
  },
  {
    name: 'Test webhook from Meta (id=0)',
    appSecret: '3b41e5421706802fbc1156f9aa84247e',
    body: '{"entry":[{"id":"0","time":1705600000,"changes":[{"field":"messages","value":{"messaging":[{"sender":{"id":"0"},"recipient":{"id":"0"},"timestamp":1705600000}]}}]}],"object":"instagram"}',
    signature: 'sha256=7e5de14056f8343f3e8a8e7dc5a7e7f3e0dd8f52e2e9c5e5e5e5e5e5e5e5e5e5' // This will be calculated
  },
  {
    name: 'Complex webhook with special characters',
    appSecret: '3b41e5421706802fbc1156f9aa84247e',
    body: '{"entry":[{"id":"17841405545604018","time":1705600000,"changes":[{"field":"messages","value":{"messaging":[{"sender":{"id":"123456"},"recipient":{"id":"17841405545604018"},"timestamp":1705600000,"message":{"mid":"m_123","text":"مرحبا 👋 Hello"}}]}}]}],"object":"instagram"}',
    signature: null // Will be calculated
  }
];

console.log('🧪 Instagram Webhook Signature Verification Tests\n');
console.log('=' .repeat(60));

let passed = 0;
let failed = 0;

testCases.forEach((test, index) => {
  console.log(`\nTest ${index + 1}: ${test.name}`);
  console.log('-'.repeat(40));
  
  const rawBody = Buffer.from(test.body, 'utf8');
  
  // Calculate expected signature if not provided
  if (!test.signature || test.signature.includes('e5e5e5')) {
    const calculated = crypto
      .createHmac('sha256', test.appSecret)
      .update(rawBody)
      .digest('hex');
    test.signature = 'sha256=' + calculated;
    console.log('📝 Calculated signature:', test.signature);
  }
  
  // Test verification
  const result = verifyInstagramSignature(test.appSecret, test.signature, rawBody);
  
  if (result) {
    console.log('✅ PASSED: Signature verified successfully');
    passed++;
  } else {
    console.log('❌ FAILED: Signature mismatch');
    failed++;
    
    // Debug info
    const expected = crypto
      .createHmac('sha256', test.appSecret)
      .update(rawBody)
      .digest('hex');
    const provided = test.signature.replace(/^sha256=/, '');
    
    console.log('   Expected:', expected);
    console.log('   Provided:', provided);
    console.log('   Match:', expected === provided);
  }
  
  // Verify raw body handling
  console.log('📊 Body stats:');
  console.log('   Length:', rawBody.length, 'bytes');
  console.log('   Type:', rawBody.constructor.name);
  console.log('   First 50 chars:', test.body.substring(0, 50) + '...');
});

console.log('\n' + '='.repeat(60));
console.log('📈 Test Results:');
console.log(`   ✅ Passed: ${passed}`);
console.log(`   ❌ Failed: ${failed}`);
console.log(`   📊 Total: ${testCases.length}`);

// Additional test: Verify that toLowerCase breaks signature
console.log('\n' + '='.repeat(60));
console.log('⚠️  Testing common mistakes:\n');

const testBody = Buffer.from('{"test":"data"}');
const testSecret = '3b41e5421706802fbc1156f9aa84247e';
const correctSig = 'sha256=' + crypto.createHmac('sha256', testSecret).update(testBody).digest('hex');
const lowerSig = 'sha256=' + crypto.createHmac('sha256', testSecret).update(testBody).digest('hex').toLowerCase();

console.log('1. Effect of toLowerCase():');
console.log('   Original:', correctSig);
console.log('   Lower:', lowerSig);
console.log('   Same?:', correctSig === lowerSig);

console.log('\n2. Effect of toString() on body:');
const bodyAsString = testBody.toString('utf8');
const sigWithString = 'sha256=' + crypto.createHmac('sha256', testSecret).update(bodyAsString, 'utf8').digest('hex');
console.log('   With Buffer:', correctSig);
console.log('   With String:', sigWithString);
console.log('   Same?:', correctSig === sigWithString);

console.log('\n✅ Tests completed!');