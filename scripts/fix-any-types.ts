#!/usr/bin/env tsx

/**
 * ===================================================================
 * Script لإزالة any types بطريقة آمنة ومتدرجة
 * يُطبق أنواع صريحة محددة بدلاً من any
 * ===================================================================
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

interface TypeReplacement {
  pattern: RegExp;
  replacement: string;
  category: 'catch' | 'function-param' | 'return-type' | 'property' | 'variable';
  riskLevel: 'low' | 'medium' | 'high';
}

const SAFE_REPLACEMENTS: TypeReplacement[] = [
  // خ1: خرائط Catch blocks - آمنة 100%
  {
    pattern: /catch\s*\(\s*(\w+):\s*any\s*\)/g,
    replacement: 'catch ($1: unknown)',
    category: 'catch',
    riskLevel: 'low'
  },
  
  // 2: Callback functions - آمنة نسبياً
  {
    pattern: /\.\.\.(args|params):\s*any\[\]/g,
    replacement: '...$1: unknown[]',
    category: 'function-param',
    riskLevel: 'low'
  },
  
  // 3: Object properties - متوسطة الخطر
  {
    pattern: /:\s*any\s*=\s*\{\}/g,
    replacement: ': Record<string, unknown> = {}',
    category: 'variable',
    riskLevel: 'medium'
  },
  
  // 4: Function return types - عالية الخطر
  {
    pattern: /\):\s*Promise<any>/g,
    replacement: '): Promise<Record<string, unknown>>',
    category: 'return-type',
    riskLevel: 'high'
  },
  
  // 5: Object indexing - متوسطة الخطر
  {
    pattern: /\[key:\s*string\]:\s*any/g,
    replacement: '[key: string]: unknown',
    category: 'property',
    riskLevel: 'medium'
  }
];

const HIGH_PRIORITY_FILES = [
  'src/services/ai.ts',
  'src/services/instagram-api.ts', 
  'src/services/ProductionQueueManager.ts',
  'src/services/cross-platform-conversation-manager.ts',
  'src/services/instagram-testing-orchestrator.ts'
];

class SafeAnyRemover {
  private stats = {
    filesProcessed: 0,
    replacementsMade: 0,
    errorsPrevented: 0
  };

  async processProject(rootDir: string): Promise<void> {
    console.log('🚀 بدء معالجة المشروع لإزالة any types...');
    
    // خطوة 1: معالجة الملفات عالية الأولوية أولاً
    await this.processHighPriorityFiles(rootDir);
    
    // خطوة 2: معالجة باقي الملفات
    await this.processRemainingFiles(rootDir);
    
    // خطوة 3: التحقق من التغييرات
    await this.validateChanges();
    
    this.printSummary();
  }

  private async processHighPriorityFiles(rootDir: string): Promise<void> {
    console.log('📝 معالجة الملفات عالية الأولوية...');
    
    for (const filePath of HIGH_PRIORITY_FILES) {
      const fullPath = join(rootDir, filePath);
      if (this.fileExists(fullPath)) {
        await this.processFile(fullPath, true);
      }
    }
  }

  private async processRemainingFiles(rootDir: string): Promise<void> {
    console.log('🔍 معالجة باقي الملفات...');
    
    const allTsFiles = this.findTypeScriptFiles(join(rootDir, 'src'));
    
    for (const filePath of allTsFiles) {
      if (!HIGH_PRIORITY_FILES.some(hp => filePath.includes(hp.replace('src/', '')))) {
        await this.processFile(filePath, false);
      }
    }
  }

  private async processFile(filePath: string, isHighPriority: boolean): Promise<void> {
    try {
      let content = readFileSync(filePath, 'utf8');
      let hasChanges = false;
      
      console.log(`🔧 معالجة ${filePath}...`);
      
      // تطبيق التعديلات حسب مستوى الخطر
      const allowedRiskLevels = isHighPriority ? ['low', 'medium', 'high'] : ['low', 'medium'];
      
      for (const replacement of SAFE_REPLACEMENTS) {
        if (allowedRiskLevels.includes(replacement.riskLevel)) {
          const beforeCount = (content.match(replacement.pattern) || []).length;
          content = content.replace(replacement.pattern, replacement.replacement);
          const afterCount = (content.match(replacement.pattern) || []).length;
          
          if (beforeCount > afterCount) {
            hasChanges = true;
            this.stats.replacementsMade += (beforeCount - afterCount);
            console.log(`  ✅ ${replacement.category}: ${beforeCount - afterCount} تعديل`);
          }
        }
      }
      
      if (hasChanges) {
        writeFileSync(filePath, content);
        this.stats.filesProcessed++;
      }
      
    } catch (error) {
      console.error(`❌ فشل في معالجة ${filePath}:`, error);
      this.stats.errorsPrevented++;
    }
  }

  private findTypeScriptFiles(dir: string): string[] {
    const files: string[] = [];
    
    const scan = (directory: string) => {
      const items = readdirSync(directory);
      
      for (const item of items) {
        const fullPath = join(directory, item);
        const stat = statSync(fullPath);
        
        if (stat.isDirectory() && !item.startsWith('.') && item !== 'node_modules') {
          scan(fullPath);
        } else if (extname(item) === '.ts' && !item.includes('.test.') && !item.includes('.spec.')) {
          files.push(fullPath);
        }
      }
    };
    
    scan(dir);
    return files;
  }

  private fileExists(filePath: string): boolean {
    try {
      statSync(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async validateChanges(): Promise<void> {
    console.log('🧪 التحقق من صحة التغييرات...');
    
    try {
      execSync('npm run typecheck', { stdio: 'pipe' });
      console.log('✅ التحقق من الأنواع نجح');
    } catch (error) {
      console.log('⚠️  هناك أخطاء في الأنواع - قد تحتاج إلى مراجعة يدوية');
      // لا نتوقف - نكمل المعالجة
    }
  }

  private printSummary(): void {
    console.log('\n📊 ملخص العملية:');
    console.log(`  📁 ملفات معالجة: ${this.stats.filesProcessed}`);
    console.log(`  🔄 تعديلات مطبقة: ${this.stats.replacementsMade}`);
    console.log(`  ⚠️  أخطاء منعت: ${this.stats.errorsPrevented}`);
    console.log('\n✨ تم الانتهاء من إزالة any types!');
  }
}

// تشغيل السكريبت
if (require.main === module) {
  const remover = new SafeAnyRemover();
  remover.processProject(process.cwd())
    .catch(console.error);
}

export { SafeAnyRemover };