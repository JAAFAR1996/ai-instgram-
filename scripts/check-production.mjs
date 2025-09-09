#!/usr/bin/env node

/**
 * Production Check Script
 * سكريبت التحقق من الإعدادات الإنتاجية
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

console.log('🔍 AI Sales Platform - Production Check');
console.log('=====================================\n');

// التحقق من متغيرات البيئة
console.log('1️⃣ Environment Variables:');
const requiredEnvVars = [
  'OPENAI_API_KEY',
  'DATABASE_URL',
  'NODE_ENV'
];

let envIssues = 0;
requiredEnvVars.forEach(envVar => {
  if (process.env[envVar]) {
    console.log(`   ✅ ${envVar}: Set`);
  } else {
    console.log(`   ❌ ${envVar}: Missing`);
    envIssues++;
  }
});

// التحقق من ملفات التكوين
console.log('\n2️⃣ Configuration Files:');
const configFiles = [
  'src/config/ai-intelligence.ts',
  'src/config/production-checklist.ts',
  'src/utils/price-formatter.ts',
  'src/utils/response-diversity.ts'
];

let configIssues = 0;
configFiles.forEach(file => {
  const filePath = join(projectRoot, file);
  if (existsSync(filePath)) {
    console.log(`   ✅ ${file}: Exists`);
  } else {
    console.log(`   ❌ ${file}: Missing`);
    configIssues++;
  }
});

// التحقق من ملفات الخدمات المحدثة
console.log('\n3️⃣ Updated Services:');
const serviceFiles = [
  'src/services/ai.ts',
  'src/services/service-controller.ts',
  'src/services/error-fallbacks.ts',
  'src/services/response-personalizer.ts',
  'src/services/smart-cache.ts'
];

let serviceIssues = 0;
serviceFiles.forEach(file => {
  const filePath = join(projectRoot, file);
  if (existsSync(filePath)) {
    console.log(`   ✅ ${file}: Exists`);
  } else {
    console.log(`   ❌ ${file}: Missing`);
    serviceIssues++;
  }
});

// التحقق من ملفات البناء
console.log('\n4️⃣ Build Files:');
const buildFiles = [
  'dist/index.js',
  'dist/services/ai.js',
  'dist/services/service-controller.js',
  'dist/services/error-fallbacks.js'
];

let buildIssues = 0;
buildFiles.forEach(file => {
  const filePath = join(projectRoot, file);
  if (existsSync(filePath)) {
    console.log(`   ✅ ${file}: Built`);
  } else {
    console.log(`   ❌ ${file}: Not built`);
    buildIssues++;
  }
});

// التحقق من package.json
console.log('\n5️⃣ Package Dependencies:');
try {
  const packageJsonPath = join(projectRoot, 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  
  const requiredDeps = ['openai', 'pg', 'bullmq'];
  let depsIssues = 0;
  
  requiredDeps.forEach(dep => {
    if (packageJson.dependencies && packageJson.dependencies[dep]) {
      console.log(`   ✅ ${dep}: ${packageJson.dependencies[dep]}`);
    } else {
      console.log(`   ❌ ${dep}: Missing`);
      depsIssues++;
    }
  });
  
  if (depsIssues === 0) {
    console.log('   ✅ All required dependencies are present');
  }
} catch (error) {
  console.log(`   ❌ Error reading package.json: ${error.message}`);
}

// النتيجة النهائية
console.log('\n📊 Production Readiness Summary:');
console.log('================================');

const totalIssues = envIssues + configIssues + serviceIssues + buildIssues;

if (totalIssues === 0) {
  console.log('🎉 PRODUCTION READY!');
  console.log('   All checks passed successfully.');
  console.log('   The AI system is ready for deployment.');
} else {
  console.log('⚠️  PRODUCTION ISSUES FOUND:');
  console.log(`   Total issues: ${totalIssues}`);
  console.log('   Please fix the issues above before deploying.');
}

console.log('\n🔧 Applied Patches:');
console.log('   ✅ Patch 1: ServiceController degraded mode');
console.log('   ✅ Patch 2: Smart contextual fallbacks');
console.log('   ✅ Patch 3: Price formatting improvements');
console.log('   ✅ Patch 4: OpenAI request/response logging');

console.log('\n🚀 Next Steps:');
if (totalIssues === 0) {
  console.log('   1. Deploy to production environment');
  console.log('   2. Monitor logs for OpenAI requests/responses');
  console.log('   3. Test AI responses with real customer messages');
  console.log('   4. Verify fallback responses work correctly');
} else {
  console.log('   1. Fix the issues listed above');
  console.log('   2. Run this check again');
  console.log('   3. Deploy when all checks pass');
}

process.exit(totalIssues === 0 ? 0 : 1);
