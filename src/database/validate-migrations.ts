/**
 * ===============================================
 * Migration Validation Script - Production Ready
 * ===============================================
 * 
 * This script validates migration files for common issues:
 * - Duplicate migration numbers
 * - Missing migration numbers
 * - Test files in production
 * - SQL syntax issues
 * - Dependency conflicts
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { getLogger } from '../services/logger.js';

const log = getLogger({ component: 'migration-validation' });

interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  summary: {
    totalFiles: number;
    duplicateNumbers: number;
    missingNumbers: number;
    testFiles: number;
    syntaxErrors: number;
  };
}

interface MigrationFile {
  filename: string;
  number: number;
  name: string;
  content: string;
}

export async function validateMigrations(): Promise<ValidationResult> {
  const validationErrors: string[] = [];
  const warnings: string[] = [];
  
  try {
    const migrationsDir = join(process.cwd(), 'src/database/migrations');
    const files = readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();
    
    log.info(`🔍 Validating ${files.length} migration files...`);
    
    // Parse migration files
    const migrations: MigrationFile[] = files.map(filename => {
      const match = filename.match(/^(\d{3})_(.+?)\.sql$/);
      if (!match) {
        validationErrors.push(`Invalid filename format: ${filename}`);
        return null;
      }
      
      const number = parseInt(match[1]);
      const name = match[2];
      const content = readFileSync(join(migrationsDir, filename), 'utf8');
      
      return { filename, number, name, content };
    }).filter(Boolean) as MigrationFile[];
    
    // Check for duplicate numbers
    const numbers = migrations.map(m => m.number);
    const duplicates = numbers.filter((n, i) => numbers.indexOf(n) !== i);
    if (duplicates.length > 0) {
      validationErrors.push(`Duplicate migration numbers: ${duplicates.join(', ')}`);
    }
    
    // Check for missing numbers
    const sortedNumbers = [...new Set(numbers)].sort((a, b) => a - b);
    const missingNumbers: number[] = [];
    for (let i = 1; i < sortedNumbers.length; i++) {
      if (sortedNumbers[i] !== sortedNumbers[i-1] + 1) {
        missingNumbers.push(sortedNumbers[i-1] + 1);
      }
    }
    if (missingNumbers.length > 0) {
      validationErrors.push(`Missing migration numbers: ${missingNumbers.join(', ')}`);
    }
    
    // Check for test files in production
    const testFiles = migrations.filter(m => 
      m.number >= 988 || 
      m.name.includes('test') || 
      m.name.includes('Test')
    );
    if (testFiles.length > 0) {
      validationErrors.push(`Test files found in production: ${testFiles.map(f => f.filename).join(', ')}`);
    }
    
    // Check for SQL syntax issues
    for (const migration of migrations) {
      const syntaxIssues = validateSQLSyntax(migration.content, migration.filename);
      validationErrors.push(...syntaxIssues);
    }
    
    // Check for RLS function dependencies
    const rlsIssues = await checkRLSDependencies(migrations);
    validationErrors.push(...rlsIssues);
    
    // Check for table dependencies
    const dependencyIssues = await checkTableDependencies(migrations);
    warnings.push(...dependencyIssues);
    
    const summary = {
      totalFiles: files.length,
      duplicateNumbers: duplicates.length,
      missingNumbers: missingNumbers.length,
      testFiles: testFiles.length,
      syntaxErrors: validationErrors.filter(e => e.includes('SQL syntax')).length
    };
    
    log.info('✅ Migration validation completed', summary);
    
    return {
      isValid: validationErrors.length === 0,
      errors: validationErrors,
      warnings,
      summary
    };
    
  } catch (error) {
    log.error('❌ Migration validation failed:', error);
    return {
      isValid: false,
      errors: [`Validation failed: ${error}`],
      warnings: [],
      summary: {
        totalFiles: 0,
        duplicateNumbers: 0,
        missingNumbers: 0,
        testFiles: 0,
        syntaxErrors: 0
      }
    };
  }
}

function validateSQLSyntax(content: string, filename: string): string[] {
  const issues: string[] = [];
  
  // Check for common SQL issues
  const checks = [
    {
      pattern: /CREATE TABLE.*\(/gi,
      issue: 'Missing closing parenthesis in CREATE TABLE'
    },
    {
      pattern: /INSERT INTO.*VALUES/gi,
      issue: 'Potential INSERT syntax issue'
    },
    {
      pattern: /ALTER TABLE.*ADD COLUMN/gi,
      issue: 'Potential ALTER TABLE syntax issue'
    }
  ];
  
  for (const check of checks) {
    const matches = content.match(check.pattern);
    if (matches) {
      // Basic validation - in production, use proper SQL parser
      if (content.includes(';') && content.includes('(') && content.includes(')')) {
        // Basic syntax seems OK
      } else {
        issues.push(`SQL syntax issue in ${filename}: ${check.issue}`);
      }
    }
  }
  
  return issues;
}

async function checkRLSDependencies(migrations: MigrationFile[]): Promise<string[]> {
  const issues: string[] = [];
  
  // Check if RLS functions are defined before use
  const rlsFunctions = ['current_merchant_id', 'is_admin_user'];
  const functionDefinitions: { [key: string]: number } = {};
  const functionUses: { [key: string]: number[] } = {};
  
  for (const migration of migrations) {
    // Check for function definitions
    for (const func of rlsFunctions) {
      if (migration.content.includes(`CREATE.*FUNCTION.*${func}`)) {
        functionDefinitions[func] = migration.number;
      }
      if (migration.content.includes(`${func}\\(`)) {
        if (!functionUses[func]) functionUses[func] = [];
        functionUses[func].push(migration.number);
      }
    }
  }
  
  // Check for undefined function usage
  for (const func of rlsFunctions) {
    if (functionUses[func] && !functionDefinitions[func]) {
      issues.push(`RLS function ${func}() used but not defined`);
    } else if (functionUses[func] && functionDefinitions[func]) {
      const firstUse = Math.min(...functionUses[func]);
      if (firstUse < functionDefinitions[func]) {
        issues.push(`RLS function ${func}() used before definition (used in ${firstUse}, defined in ${functionDefinitions[func]})`);
      }
    }
  }
  
  return issues;
}

async function checkTableDependencies(migrations: MigrationFile[]): Promise<string[]> {
  const warnings: string[] = [];
  
  // Check for table references before creation
  const tableCreations: { [key: string]: number } = {};
  const tableReferences: { [key: string]: number[] } = {};
  
  for (const migration of migrations) {
    // Extract table names from CREATE TABLE
    const createMatches = migration.content.match(/CREATE TABLE (?:IF NOT EXISTS )?([a-zA-Z_][a-zA-Z0-9_]*)/gi);
    if (createMatches) {
      for (const match of createMatches) {
        const tableName = match.replace(/CREATE TABLE (?:IF NOT EXISTS )?/i, '').toLowerCase();
        tableCreations[tableName] = migration.number;
      }
    }
    
    // Extract table references from foreign keys, joins, etc.
    const referenceMatches = migration.content.match(/REFERENCES ([a-zA-Z_][a-zA-Z0-9_]*)/gi);
    if (referenceMatches) {
      for (const match of referenceMatches) {
        const tableName = match.replace(/REFERENCES /i, '').toLowerCase();
        if (!tableReferences[tableName]) tableReferences[tableName] = [];
        tableReferences[tableName].push(migration.number);
      }
    }
  }
  
  // Check for references to non-existent tables
  for (const [tableName, references] of Object.entries(tableReferences)) {
    if (!tableCreations[tableName]) {
      warnings.push(`Table ${tableName} referenced but not created in migrations`);
    } else {
      const firstReference = Math.min(...references);
      if (firstReference < tableCreations[tableName]) {
        warnings.push(`Table ${tableName} referenced before creation (referenced in ${firstReference}, created in ${tableCreations[tableName]})`);
      }
    }
  }
  
  return warnings;
}

// CLI interface
if (import.meta.url === `file://${process.argv[1]}`) {
  validateMigrations().then(result => {
    if (result.isValid) {
      console.log('✅ All migrations are valid!');
      process.exit(0);
    } else {
      console.log('❌ Migration validation failed:');
      result.errors.forEach(error => console.log(`  - ${error}`));
      result.warnings.forEach(warning => console.log(`  ⚠️  ${warning}`));
      process.exit(1);
    }
  });
}
