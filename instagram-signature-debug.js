#!/usr/bin/env node
/**
 * Instagram Webhook Signature Debug Tool (2025 Edition)
 * Comprehensive debugging for Instagram webhook signature verification issues
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(color, message) {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(60));
  log('cyan', `📋 ${title}`);
  console.log('='.repeat(60));
}

// Enhanced signature verification function (production-ready)
function verifyInstagramSignature(rawBody, signature, appSecret) {
  const sigHeaderRaw = (signature || '').trim();
  if (!sigHeaderRaw) {
    log('red', '❌ Missing signature header');
    return { valid: false, error: 'Missing signature' };
  }

  const secret = (appSecret || '').trim();
  if (!secret) {
    log('red', '❌ Missing app secret');
    return { valid: false, error: 'Missing app secret' };
  }

  // Pick algorithm from header; default to sha256
  const algo = sigHeaderRaw.toLowerCase().startsWith('sha1=') ? 'sha1' : 'sha256';
  const received = sigHeaderRaw.replace(/^sha(?:1|256)=/i, '').trim().toLowerCase();

  // Sanity: hex length must match algo (40 for sha1, 64 for sha256)
  const hexOk = (algo === 'sha1' && /^[a-f0-9]{40}$/.test(received)) ||
                (algo === 'sha256' && /^[a-f0-9]{64}$/.test(received));

  if (!hexOk) {
    log('red', '❌ Invalid signature format');
    return { valid: false, error: 'Invalid signature format' };
  }

  // CRITICAL: raw bytes before any parsing
  const expected = crypto.createHmac(algo, secret).update(rawBody).digest('hex');

  // Debug info
  const debugInfo = {
    algorithm: algo,
    secretFingerprint: secret.slice(0, 4) + '…' + secret.slice(-4),
    rawBodyLength: rawBody.length,
    receivedLength: received.length,
    expectedLength: expected.length,
    receivedPreview: received.slice(0, 8) + '…' + received.slice(-8),
    expectedPreview: expected.slice(0, 8) + '…' + expected.slice(-8)
  };

  // Constant-time compare
  try {
    const valid = crypto.timingSafeEqual(Buffer.from(received, 'hex'), Buffer.from(expected, 'hex'));
    return { valid, debugInfo, received, expected };
  } catch (e) {
    return { valid: false, error: e.message, debugInfo };
  }
}

// Test with sample Instagram webhook payload
function testWithSamplePayload() {
  logSection('Testing with Sample Instagram Payload');
  
  const samplePayload = {
    object: 'instagram',
    entry: [{
      id: '17841405822304914',
      time: Date.now(),
      changes: [{
        field: 'messages',
        value: {
          messaging: [{
            sender: { id: '1234567890' },
            recipient: { id: '17841405822304914' },
            timestamp: Date.now(),
            message: {
              mid: 'mid.1234567890',
              text: 'Hello from Instagram!'
            }
          }]
        }
      }]
    }]
  };

  const rawBody = Buffer.from(JSON.stringify(samplePayload), 'utf8');
  const testSecret = process.env.META_APP_SECRET || 'test_secret_123';
  
  // Generate expected signature
  const expectedSig = crypto.createHmac('sha256', testSecret).update(rawBody).digest('hex');
  const signatureHeader = `sha256=${expectedSig}`;
  
  log('blue', '📝 Sample payload generated:');
  console.log('  Raw body length:', rawBody.length);
  console.log('  Expected signature:', signatureHeader);
  
  // Test verification
  const result = verifyInstagramSignature(rawBody, signatureHeader, testSecret);
  
  if (result.valid) {
    log('green', '✅ Sample payload verification: PASSED');
  } else {
    log('red', '❌ Sample payload verification: FAILED');
    console.log('  Error:', result.error);
  }
  
  return { rawBody, signatureHeader, testSecret };
}

// Test with file input
function testWithFile(filePath, signature, secret) {
  logSection('Testing with File Input');
  
  if (!fs.existsSync(filePath)) {
    log('red', `❌ File not found: ${filePath}`);
    return false;
  }
  
  const rawBody = fs.readFileSync(filePath);
  log('blue', `📁 Loaded file: ${filePath}`);
  console.log('  File size:', rawBody.length, 'bytes');
  
  const result = verifyInstagramSignature(rawBody, signature, secret);
  
  console.log('\n🔍 Verification Details:');
  if (result.debugInfo) {
    Object.entries(result.debugInfo).forEach(([key, value]) => {
      console.log(`  ${key}:`, value);
    });
  }
  
  if (result.valid) {
    log('green', '✅ File verification: PASSED');
  } else {
    log('red', '❌ File verification: FAILED');
    if (result.error) {
      console.log('  Error:', result.error);
    }
  }
  
  return result.valid;
}

// Environment check
function checkEnvironment() {
  logSection('Environment Check');
  
  const requiredVars = ['META_APP_SECRET'];
  const optionalVars = ['IG_VERIFY_TOKEN', 'DEBUG_DUMP'];
  
  log('blue', '🔧 Required Environment Variables:');
  requiredVars.forEach(varName => {
    const value = process.env[varName];
    if (value) {
      log('green', `  ✅ ${varName}: ${value.slice(0, 4)}...${value.slice(-4)} (${value.length} chars)`);
    } else {
      log('red', `  ❌ ${varName}: Not set`);
    }
  });
  
  log('blue', '\n🔧 Optional Environment Variables:');
  optionalVars.forEach(varName => {
    const value = process.env[varName];
    if (value) {
      log('green', `  ✅ ${varName}: ${value}`);
    } else {
      log('yellow', `  ⚠️ ${varName}: Not set`);
    }
  });
}

// Common issues and solutions
function showTroubleshooting() {
  logSection('Common Issues & Solutions');
  
  const issues = [
    {
      issue: 'Signature verification always fails',
      solutions: [
        'Ensure you\'re using the raw request body (Buffer), not parsed JSON',
        'Check that META_APP_SECRET matches the app secret in Facebook Developer Console',
        'Verify the signature header format: "sha256=<hex_string>"',
        'Make sure no middleware is parsing the body before signature verification'
      ]
    },
    {
      issue: 'Getting "Invalid signature format" error',
      solutions: [
        'Check signature header is present and properly formatted',
        'Ensure signature is 64 characters for SHA256 (40 for SHA1)',
        'Remove any quotes or extra whitespace from signature header'
      ]
    },
    {
      issue: 'Raw body is already parsed as JSON',
      solutions: [
        'Move signature verification before any JSON parsing middleware',
        'Use express.raw() middleware for webhook endpoints',
        'Capture raw body in middleware before express.json() processes it'
      ]
    }
  ];
  
  issues.forEach((item, index) => {
    log('yellow', `\n${index + 1}. ${item.issue}:`);
    item.solutions.forEach(solution => {
      console.log(`   • ${solution}`);
    });
  });
}

// Main execution
function main() {
  console.log('🚀 Instagram Webhook Signature Debug Tool (2025 Edition)');
  console.log('================================================================\n');
  
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    // Interactive mode
    checkEnvironment();
    testWithSamplePayload();
    showTroubleshooting();
    
    console.log('\n📖 Usage Examples:');
    console.log('  node instagram-signature-debug.js /path/to/webhook.json "sha256=abc123..."');
    console.log('  node instagram-signature-debug.js /tmp/ig.raw "sha256=def456..."');
    console.log('\n🔧 Environment Variables:');
    console.log('  export META_APP_SECRET="your_app_secret_here"');
    console.log('  export DEBUG_DUMP="1"  # Enable raw body dumping');
    
  } else if (args.length >= 2) {
    // File testing mode
    const filePath = args[0];
    const signature = args[1];
    const secret = args[2] || process.env.META_APP_SECRET;
    
    if (!secret) {
      log('red', '❌ App secret required. Set META_APP_SECRET environment variable or pass as third argument.');
      process.exit(1);
    }
    
    checkEnvironment();
    const success = testWithFile(filePath, signature, secret);
    
    if (!success) {
      showTroubleshooting();
      process.exit(1);
    }
    
  } else {
    log('red', '❌ Invalid arguments. Usage:');
    console.log('  node instagram-signature-debug.js [file_path] [signature] [app_secret]');
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = {
  verifyInstagramSignature,
  testWithSamplePayload,
  testWithFile,
  checkEnvironment
};