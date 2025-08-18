const crypto = require('crypto');

// Test signature generation
const META_APP_SECRET = process.env.META_APP_SECRET || 'test_secret_for_development_only';
if (META_APP_SECRET === 'test_secret_for_development_only') {
  console.warn('⚠️ Using development secret - set META_APP_SECRET environment variable');
}
const testPayload = '{"object":"instagram","entry":[{"id":"17841400008460056","time":1234567890,"changes":[{"value":{"media_id":"17842721965059448","comment_id":"17842721965059123"},"field":"comments"}]}]}';

console.log('🔍 Debug Signature Generation');
console.log('============================');
console.log('App Secret:', META_APP_SECRET);
console.log('Payload:', testPayload);
console.log('');

// Generate signature
const expectedSignature = crypto
  .createHmac('sha256', META_APP_SECRET)
  .update(testPayload, 'utf8')
  .digest('hex');

console.log('Generated Signature:', expectedSignature);
console.log('Full Header:', `sha256=${expectedSignature}`);

// Test verification function
function verifySignature(body, signature) {
  console.log('');
  console.log('🧪 Verification Test:');
  console.log('====================');
  console.log('Input Body:', body);
  console.log('Input Signature:', signature);
  
  if (!signature || !signature.startsWith('sha256=')) {
    console.log('❌ Invalid signature format');
    return false;
  }
  
  const providedSignature = signature.replace('sha256=', '');
  console.log('Provided Signature (hex):', providedSignature);
  
  // Generate expected signature
  const expected = crypto
    .createHmac('sha256', META_APP_SECRET)
    .update(body, 'utf8')
    .digest('hex');
  
  console.log('Expected Signature (hex):', expected);
  console.log('Signatures Match:', providedSignature === expected);
  
  // Timing-safe comparison
  try {
    const result = crypto.timingSafeEqual(
      Buffer.from(providedSignature, 'hex'),
      Buffer.from(expected, 'hex')
    );
    console.log('Timing-safe Result:', result);
    return result;
  } catch (error) {
    console.log('❌ Comparison Error:', error.message);
    return false;
  }
}

// Test with the exact payload from our test
const testResult = verifySignature(testPayload, `sha256=${expectedSignature}`);
console.log('');
console.log('🎯 Final Result:', testResult ? '✅ VALID' : '❌ INVALID');