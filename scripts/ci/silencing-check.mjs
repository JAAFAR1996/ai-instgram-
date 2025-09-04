#!/usr/bin/env node
/**
 * CI Silencing Check - منع الارتداد
 * يتحقق من عدم زيادة أنماط الإسكات مقارنة بالـ baseline الإنتاجي
 */

import { readFile } from 'fs/promises';
import { spawn } from 'child_process';

const BASELINE_PATH = process.env.SILENCING_BASELINE || 'reports/silencing-baseline.prod.json';
const CURRENT_TEMP_PATH = 'reports/silencing-ci-current.json';

/**
 * تشغيل audit script
 */
async function runAudit() {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [
      'scripts/audit-silencing.mjs', 
      '--out', 
      CURRENT_TEMP_PATH
    ]);

    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Audit script failed with code ${code}`));
    });
  });
}

/**
 * قراءة ملف JSON
 */
async function readJsonFile(path) {
  try {
    const content = await readFile(path, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to read ${path}: ${error.message}`);
  }
}

/**
 * مقارنة النتائج
 */
function compareResults(baseline, current) {
  const criticalPatterns = [
    'tsIgnore',
    'tsExpectError', 
    'tsNoCheck',
    'emptyCatchBlock',
    'nonNullAssert',
    'eslintDisable'
  ];

  const warnings = [];
  const failures = [];

  // تحقق من الأنماط الحرجة - يجب أن تبقى 0
  for (const pattern of criticalPatterns) {
    const baselineCount = baseline.totals[pattern] || 0;
    const currentCount = current.totals[pattern] || 0;
    
    if (currentCount > baselineCount) {
      failures.push({
        pattern,
        baseline: baselineCount,
        current: currentCount,
        increase: currentCount - baselineCount
      });
    }
  }

  // تحقق من الأنماط الأخرى - لا يجب أن تزيد
  const warningPatterns = [
    'falsyOrOther',
    'asAny', 
    'typeAny',
    'allSettled',
    'thenSecondArg'
  ];

  for (const pattern of warningPatterns) {
    const baselineCount = baseline.totals[pattern] || 0;
    const currentCount = current.totals[pattern] || 0;
    
    if (currentCount > baselineCount) {
      warnings.push({
        pattern,
        baseline: baselineCount,
        current: currentCount,
        increase: currentCount - baselineCount
      });
    }
  }

  return { warnings, failures };
}

/**
 * تقرير النتائج
 */
function reportResults(comparison, baseline, current) {
  console.log('\\n🔍 CI Silencing Check Results\\n');
  
  if (comparison.failures.length === 0 && comparison.warnings.length === 0) {
    console.log('✅ All checks passed! No silencing pattern regressions detected.\\n');
    return 0;
  }

  // عرض الفشل والتحذيرات
  if (comparison.failures.length > 0) {
    console.log('❌ FAILURES - Critical silencing patterns increased:\\n');
    comparison.failures.forEach(({ pattern, baseline, current, increase }) => {
      console.log(`   ${pattern}: ${baseline} → ${current} (+${increase})`);
    });
    console.log('\\n💡 These patterns must not increase. Please fix immediately.\\n');
  }

  if (comparison.warnings.length > 0) {
    console.log('⚠️  WARNINGS - Silencing patterns increased:\\n');
    comparison.warnings.forEach(({ pattern, baseline, current, increase }) => {
      console.log(`   ${pattern}: ${baseline} → ${current} (+${increase})`);
    });
    console.log('\\n💡 Consider reducing these patterns in your implementation.\\n');
  }

  return comparison.failures.length > 0 ? 1 : 0;
}

/**
 * التشغيل الرئيسي
 */
async function main() {
  try {
    console.log('🔎 Running silencing pattern audit...');
    await runAudit();
    
    console.log('📋 Loading baseline and current results...');
    const baseline = await readJsonFile(BASELINE_PATH);
    const current = await readJsonFile(CURRENT_TEMP_PATH);
    
    console.log('🔍 Comparing results...');
    const comparison = compareResults(baseline, current);
    
    const exitCode = reportResults(comparison, baseline, current);
    process.exit(exitCode);
    
  } catch (error) {
    console.error('❌ CI Check failed:', error.message);
    process.exit(1);
  }
}

main();
