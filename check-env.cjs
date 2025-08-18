#!/usr/bin/env node

/**
 * Environment Variables Validation Script
 * Checks if all required environment variables are set for production
 */

require('dotenv').config({ path: '.env.production' });

const requiredVars = [
  'NODE_ENV',
  'PORT',
  'META_APP_SECRET',
  'IG_VERIFY_TOKEN',
  'OPENAI_API_KEY',
  'DATABASE_URL',
  'ENCRYPTION_KEY',
  'JWT_SECRET'
];

const optionalVars = [
  'INSTAGRAM_ACCESS_TOKEN',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID'
];

console.log('🔍 Checking environment variables...\n');

let allValid = true;

// Check required variables
console.log('✅ Required Variables:');
requiredVars.forEach(varName => {
  const value = process.env[varName];
  const isSet = value && value !== 'YOUR_*' && !value.includes('your_*');
  
  if (isSet) {
    console.log(`  ✅ ${varName}: Set (${value.length} chars)`);
  } else {
    console.log(`  ❌ ${varName}: Missing or placeholder`);
    allValid = false;
  }
});

console.log('\n📋 Optional Variables:');
optionalVars.forEach(varName => {
  const value = process.env[varName];
  const isSet = value && value !== 'YOUR_*' && !value.includes('your_*');
  
  if (isSet) {
    console.log(`  ✅ ${varName}: Set`);
  } else {
    console.log(`  ⚠️  ${varName}: Not set (will need manual configuration)`);
  }
});

console.log('\n📊 Configuration Summary:');
console.log(`  • Environment: ${process.env.NODE_ENV}`);
console.log(`  • Port: ${process.env.PORT}`);
console.log(`  • Database: ${process.env.DATABASE_URL ? 'Configured' : 'Not configured'}`);
console.log(`  • Meta App ID: ${process.env.META_APP_ID}`);
console.log(`  • Webhook URL: ${process.env.WEBHOOK_BASE_URL}`);

if (allValid) {
  console.log('\n🎉 All required environment variables are set!');
  process.exit(0);
} else {
  console.log('\n❌ Some required environment variables are missing.');
  console.log('Please update .env.production with the correct values.');
  process.exit(1);
}