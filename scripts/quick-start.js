#!/usr/bin/env node

/**
 * ===============================================
 * Quick Start Script - AI Sales Platform
 * Rapid testing and validation of production solutions
 * ===============================================
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class QuickStart {
  constructor() {
    this.results = [];
  }

  async run() {
    console.log('🚀 AI Sales Platform - Quick Start Validation');
    console.log('='.repeat(60));
    
    try {
      // 1. Environment Check
      await this.checkEnvironment();
      
      // 2. Database Connection Test
      await this.testDatabaseConnection();
      
      // 3. Migration System Validation
      await this.validateMigrationSystem();
      
      // 4. Database Health Check
      await this.runDatabaseDiagnosis();
      
      // 5. Data Integrity Check
      await this.checkDataIntegrity();
      
      // 6. Error Handler Test
      await this.testErrorHandler();
      
      // 7. Generate Summary Report
      await this.generateSummary();
      
    } catch (error) {
      console.error('❌ Quick start failed:', error.message);
      process.exit(1);
    }
  }

  async checkEnvironment() {
    console.log('\n🔍 1. Environment Check...');
    
    const requiredEnvVars = [
      'DATABASE_URL',
      'NODE_ENV',
      'META_APP_SECRET',
      'IG_VERIFY_TOKEN'
    ];

    const missing = [];
    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        missing.push(envVar);
      }
    }

    if (missing.length > 0) {
      this.results.push({
        step: 'Environment Check',
        status: 'FAILED',
        message: `Missing environment variables: ${missing.join(', ')}`
      });
      throw new Error(`Missing environment variables: ${missing.join(', ')}`);
    }

    this.results.push({
      step: 'Environment Check',
      status: 'PASSED',
      message: 'All required environment variables are set'
    });
    
    console.log('✅ Environment variables validated');
  }

  async testDatabaseConnection() {
    console.log('\n🗄️ 2. Database Connection Test...');
    
    try {
      const { Pool } = await import('pg');
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes('sslmode=require') ? {
          rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false'
        } : false
      });

      const client = await pool.connect();
      await client.query('SELECT 1');
      client.release();
      await pool.end();

      this.results.push({
        step: 'Database Connection',
        status: 'PASSED',
        message: 'Database connection successful'
      });
      
      console.log('✅ Database connection successful');
    } catch (error) {
      this.results.push({
        step: 'Database Connection',
        status: 'FAILED',
        message: error.message
      });
      throw error;
    }
  }

  async validateMigrationSystem() {
    console.log('\n📋 3. Migration System Validation...');
    
    try {
      // Check if migration files exist
      const migrationDir = path.join(__dirname, '../src/database/migrations');
      if (!fs.existsSync(migrationDir)) {
        throw new Error('Migration directory not found');
      }

      const migrationFiles = fs.readdirSync(migrationDir)
        .filter(f => f.endsWith('.sql'))
        .sort();

      if (migrationFiles.length === 0) {
        throw new Error('No migration files found');
      }

      // Check for production migration runner
      const runnerPath = path.join(__dirname, 'production-migration-runner.js');
      if (!fs.existsSync(runnerPath)) {
        throw new Error('Production migration runner not found');
      }

      this.results.push({
        step: 'Migration System',
        status: 'PASSED',
        message: `Found ${migrationFiles.length} migration files and production runner`
      });
      
      console.log(`✅ Migration system validated (${migrationFiles.length} files)`);
    } catch (error) {
      this.results.push({
        step: 'Migration System',
        status: 'FAILED',
        message: error.message
      });
      throw error;
    }
  }

  async runDatabaseDiagnosis() {
    console.log('\n🔍 4. Database Health Check...');
    
    try {
      const diagnosisPath = path.join(__dirname, 'database-diagnosis.js');
      if (!fs.existsSync(diagnosisPath)) {
        throw new Error('Database diagnosis tool not found');
      }

      // Run diagnosis in dry-run mode
      const result = await this.runScript('database-diagnosis.js');
      
      if (result.success) {
        this.results.push({
          step: 'Database Health Check',
          status: 'PASSED',
          message: 'Database diagnosis completed successfully'
        });
        console.log('✅ Database health check completed');
      } else {
        this.results.push({
          step: 'Database Health Check',
          status: 'WARNING',
          message: 'Database diagnosis found issues - check report'
        });
        console.log('⚠️ Database health check found issues - check report');
      }
    } catch (error) {
      this.results.push({
        step: 'Database Health Check',
        status: 'FAILED',
        message: error.message
      });
      console.log('❌ Database health check failed');
    }
  }

  async checkDataIntegrity() {
    console.log('\n🧹 5. Data Integrity Check...');
    
    try {
      const cleanupPath = path.join(__dirname, 'data-cleanup.js');
      if (!fs.existsSync(cleanupPath)) {
        throw new Error('Data cleanup tool not found');
      }

      // Run cleanup in dry-run mode
      const result = await this.runScript('data-cleanup.js', ['--dry-run']);
      
      if (result.success) {
        this.results.push({
          step: 'Data Integrity Check',
          status: 'PASSED',
          message: 'Data integrity check completed'
        });
        console.log('✅ Data integrity check completed');
      } else {
        this.results.push({
          step: 'Data Integrity Check',
          status: 'WARNING',
          message: 'Data integrity issues found - check report'
        });
        console.log('⚠️ Data integrity issues found - check report');
      }
    } catch (error) {
      this.results.push({
        step: 'Data Integrity Check',
        status: 'FAILED',
        message: error.message
      });
      console.log('❌ Data integrity check failed');
    }
  }

  async testErrorHandler() {
    console.log('\n🛡️ 6. Error Handler Test...');
    
    try {
      const errorHandlerPath = path.join(__dirname, '../src/services/enhanced-error-handler.ts');
      if (!fs.existsSync(errorHandlerPath)) {
        throw new Error('Enhanced error handler not found');
      }

      // Test error handler functionality
      const testScript = `
        import { errorHandler } from './src/services/enhanced-error-handler.js';
        
        try {
          const testError = errorHandler.createError(
            'Test error for validation',
            { component: 'quick-start', operation: 'test' },
            { severity: 'LOW', category: 'SYSTEM' }
          );
          
          errorHandler.logError(testError);
          console.log('✅ Error handler test passed');
        } catch (error) {
          console.error('❌ Error handler test failed:', error.message);
          process.exit(1);
        }
      `;

      const testFile = path.join(__dirname, 'error-handler-test.js');
      fs.writeFileSync(testFile, testScript);

      const result = await this.runScript('error-handler-test.js');
      fs.unlinkSync(testFile);

      if (result.success) {
        this.results.push({
          step: 'Error Handler Test',
          status: 'PASSED',
          message: 'Error handler functionality validated'
        });
        console.log('✅ Error handler test passed');
      } else {
        throw new Error('Error handler test failed');
      }
    } catch (error) {
      this.results.push({
        step: 'Error Handler Test',
        status: 'FAILED',
        message: error.message
      });
      console.log('❌ Error handler test failed');
    }
  }

  async runScript(scriptName, args = []) {
    return new Promise((resolve) => {
      const scriptPath = path.join(__dirname, scriptName);
      const child = spawn('node', [scriptPath, ...args], {
        stdio: 'pipe',
        env: process.env
      });

      let output = '';
      let errorOutput = '';

      child.stdout.on('data', (data) => {
        output += data.toString();
      });

      child.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      child.on('close', (code) => {
        resolve({
          success: code === 0,
          output,
          errorOutput,
          code
        });
      });
    });
  }

  async generateSummary() {
    console.log('\n📊 7. Summary Report');
    console.log('='.repeat(60));
    
    const passed = this.results.filter(r => r.status === 'PASSED').length;
    const failed = this.results.filter(r => r.status === 'FAILED').length;
    const warnings = this.results.filter(r => r.status === 'WARNING').length;
    
    console.log(`\n📈 Results Summary:`);
    console.log(`  ✅ Passed: ${passed}`);
    console.log(`  ⚠️  Warnings: ${warnings}`);
    console.log(`  ❌ Failed: ${failed}`);
    
    console.log(`\n📋 Detailed Results:`);
    this.results.forEach((result, index) => {
      const icon = result.status === 'PASSED' ? '✅' : 
                   result.status === 'WARNING' ? '⚠️' : '❌';
      console.log(`  ${index + 1}. ${icon} ${result.step}: ${result.status}`);
      if (result.message) {
        console.log(`     ${result.message}`);
      }
    });

    // Generate report file
    const report = {
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      summary: {
        total: this.results.length,
        passed,
        warnings,
        failed
      },
      results: this.results
    };

    const reportPath = path.join(__dirname, '../quick-start-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    console.log(`\n📄 Full report saved to: ${reportPath}`);
    
    if (failed > 0) {
      console.log('\n❌ Some checks failed. Please review the issues above.');
      process.exit(1);
    } else if (warnings > 0) {
      console.log('\n⚠️  Some warnings detected. Review the reports for details.');
    } else {
      console.log('\n🎉 All checks passed! The system is ready for production.');
    }
  }
}

// Main execution
async function main() {
  const quickStart = new QuickStart();
  await quickStart.run();
}

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n⚠️  Quick start interrupted');
  process.exit(1);
});

// Run if this file is executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
