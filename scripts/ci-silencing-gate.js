#!/usr/bin/env node

/**
 * CI Silencing Gate - Production Quality Gate
 * Ensures no new error silencing patterns are introduced
 */

import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

const BASELINE_PATH = process.env.SILENCING_BASELINE || 'reports/silencing-baseline.prod.json';
const CURRENT_REPORT_PATH = 'reports/silencing-current.json';

async function runAudit() {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['scripts/audit-silencing.mjs', '--pretty'], {
      stdio: ['inherit', 'pipe', 'inherit']
    });
    
    let output = '';
    proc.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(`Audit failed with code ${code}`));
      }
    });
  });
}

async function main() {
  try {
    console.log('🔍 Running silencing audit...');
    const auditOutput = await runAudit();
    await fs.writeFile(CURRENT_REPORT_PATH, auditOutput);
    
    console.log('📊 Comparing against baseline...');
    const baseline = JSON.parse(await fs.readFile(BASELINE_PATH, 'utf-8'));
    const current = JSON.parse(auditOutput);
    
    const violations = [];
    
    // Check for increases in any silencing patterns
    for (const [key, baselineValue] of Object.entries(baseline.totals)) {
      const currentValue = current.totals[key] || 0;
      if (currentValue > baselineValue) {
        violations.push(`${key}: ${baselineValue} → ${currentValue} (+${currentValue - baselineValue})`);
      }
    }
    
    if (violations.length > 0) {
      console.log('❌ CI GATE FAILED - New silencing patterns detected:');
      violations.forEach(violation => console.log(`  • ${violation}`));
      process.exit(1);
    } else {
      console.log('✅ CI GATE PASSED - No new silencing patterns detected');
      console.log(`📈 Current totals: ${JSON.stringify(current.totals, null, 2)}`);
      process.exit(0);
    }
  } catch (error) {
    console.error('❌ CI gate error:', error.message);
    process.exit(1);
  }
}

main();