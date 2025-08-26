#!/usr/bin/env node

/**
 * ===============================================
 * Platform Code Impact Analysis Tool
 * تحليل نقاط التأثير في الكود لمشروع تحديث Platform Values
 * ===============================================
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// إعدادات التحليل
const CONFIG = {
    srcDir: path.join(__dirname, '../src'),
    outputFile: path.join(__dirname, '../docs/platform-impact-analysis.md'),
    patterns: {
        // أنماط البحث عن platform usage
        platformComparison: /(?:platform\s*[=!]=|===)\s*['"`]([^'"`]+)['"`]/gi,
        platformSwitch: /(?:case|when)\s+['"`]([^'"`]+)['"`]\s*:/gi,
        platformAssignment: /(?:platform|\.platform)\s*=\s*['"`]([^'"`]+)['"`]/gi,
        platformProperty: /\.platform(?:\s*\??\.\w+|\s*\[)/gi,
        enumOrConst: /(?:PLATFORM|Platform)(?:s|Types?)?\s*[=:]/gi,
        validation: /validate.*platform|platform.*valid/gi
    },
    fileExtensions: ['.ts', '.js', '.tsx', '.jsx'],
    excludeDirs: ['node_modules', 'dist', 'build', '.git']
};

class PlatformImpactAnalyzer {
    constructor() {
        this.results = {
            totalFilesScanned: 0,
            filesWithPlatformCode: 0,
            impactPoints: [],
            platformValues: new Set(),
            criticalFiles: [],
            recommendations: []
        };
    }

    /**
     * تشغيل التحليل الشامل
     */
    async analyze() {
        console.log('🔍 بدء تحليل تأثير الكود للمنصات...');
        
        try {
            const files = await this.scanDirectory(CONFIG.srcDir);
            console.log(`📁 تم العثور على ${files.length} ملف للفحص`);
            
            for (const file of files) {
                await this.analyzeFile(file);
            }
            
            this.generateRecommendations();
            await this.generateReport();
            
            console.log('✅ تم التحليل بنجاح');
            console.log(`📊 الملفات المتأثرة: ${this.results.filesWithPlatformCode}/${this.results.totalFilesScanned}`);
            console.log(`📋 التقرير محفوظ في: ${CONFIG.outputFile}`);
            
        } catch (error) {
            console.error('❌ خطأ في التحليل:', error);
            process.exit(1);
        }
    }

    /**
     * فحص المجلدات والملفات
     */
    async scanDirectory(dir) {
        const files = [];
        
        const scan = async (currentDir) => {
            const entries = await fs.readdir(currentDir, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(currentDir, entry.name);
                
                if (entry.isDirectory()) {
                    if (!CONFIG.excludeDirs.includes(entry.name)) {
                        await scan(fullPath);
                    }
                } else if (entry.isFile()) {
                    const ext = path.extname(entry.name);
                    if (CONFIG.fileExtensions.includes(ext)) {
                        files.push(fullPath);
                    }
                }
            }
        };
        
        await scan(dir);
        return files;
    }

    /**
     * تحليل ملف واحد
     */
    async analyzeFile(filePath) {
        try {
            this.results.totalFilesScanned++;
            
            const content = await fs.readFile(filePath, 'utf8');
            const relativePath = path.relative(CONFIG.srcDir, filePath);
            
            const fileAnalysis = {
                path: relativePath,
                platformUsages: [],
                riskLevel: 'low',
                recommendations: []
            };

            let hasImpact = false;

            // فحص جميع الأنماط
            for (const [patternName, pattern] of Object.entries(CONFIG.patterns)) {
                const matches = this.findMatches(content, pattern, patternName);
                if (matches.length > 0) {
                    hasImpact = true;
                    fileAnalysis.platformUsages.push(...matches);
                }
            }

            if (hasImpact) {
                this.results.filesWithPlatformCode++;
                
                // تحديد مستوى المخاطر
                fileAnalysis.riskLevel = this.assessRiskLevel(fileAnalysis, content);
                
                // إضافة توصيات خاصة بالملف
                this.addFileRecommendations(fileAnalysis, content);
                
                this.results.impactPoints.push(fileAnalysis);
                
                // تحديد الملفات الحرجة
                if (['high', 'critical'].includes(fileAnalysis.riskLevel)) {
                    this.results.criticalFiles.push(relativePath);
                }
            }
            
        } catch (error) {
            console.warn(`⚠️ خطأ في فحص الملف ${filePath}:`, error.message);
        }
    }

    /**
     * البحث عن المطابقات في النص
     */
    findMatches(content, pattern, patternName) {
        const matches = [];
        let match;
        
        const regex = new RegExp(pattern.source, pattern.flags);
        
        while ((match = regex.exec(content)) !== null) {
            const lineNumber = content.substring(0, match.index).split('\n').length;
            
            matches.push({
                type: patternName,
                match: match[0],
                value: match[1] || null,
                line: lineNumber,
                context: this.getContext(content, match.index)
            });
            
            // حفظ قيم المنصات المكتشفة
            if (match[1]) {
                this.results.platformValues.add(match[1].toLowerCase());
            }
        }
        
        return matches;
    }

    /**
     * الحصول على سياق الكود حول المطابقة
     */
    getContext(content, index) {
        const lines = content.split('\n');
        const lineIndex = content.substring(0, index).split('\n').length - 1;
        const start = Math.max(0, lineIndex - 1);
        const end = Math.min(lines.length, lineIndex + 2);
        
        return lines.slice(start, end).join('\n');
    }

    /**
     * تقييم مستوى المخاطر
     */
    assessRiskLevel(fileAnalysis, content) {
        let riskScore = 0;
        
        // عوامل الخطر
        const riskFactors = {
            hasSwitch: /switch.*platform/gi.test(content),
            hasValidation: /validate.*platform/gi.test(content),
            isRepository: fileAnalysis.path.includes('repositories/'),
            isService: fileAnalysis.path.includes('services/'),
            isAPI: fileAnalysis.path.includes('api/'),
            hasDatabase: /sql|query|repository/gi.test(content),
            multipleComparisons: fileAnalysis.platformUsages.filter(u => u.type === 'platformComparison').length > 3
        };
        
        // حساب النقاط
        if (riskFactors.hasSwitch) riskScore += 3;
        if (riskFactors.hasValidation) riskScore += 2;
        if (riskFactors.isRepository) riskScore += 2;
        if (riskFactors.isService) riskScore += 2;
        if (riskFactors.isAPI) riskScore += 3;
        if (riskFactors.hasDatabase) riskScore += 2;
        if (riskFactors.multipleComparisons) riskScore += 2;
        
        // تصنيف المخاطر
        if (riskScore >= 8) return 'critical';
        if (riskScore >= 5) return 'high';
        if (riskScore >= 2) return 'medium';
        return 'low';
    }

    /**
     * إضافة توصيات خاصة بالملف
     */
    addFileRecommendations(fileAnalysis, content) {
        const recommendations = [];
        
        // توصيات بناء على نوع الاستخدام
        const hasSwitch = fileAnalysis.platformUsages.some(u => u.type === 'platformSwitch');
        if (hasSwitch) {
            recommendations.push('تحديث جميع case statements لتشمل القيم الجديدة');
        }
        
        const hasComparisons = fileAnalysis.platformUsages.some(u => u.type === 'platformComparison');
        if (hasComparisons) {
            recommendations.push('فحص جميع مقارنات المنصات للتأكد من case sensitivity');
        }
        
        const hasValidation = /validate.*platform/gi.test(content);
        if (hasValidation) {
            recommendations.push('تحديث validation rules لتشمل المنصات الجديدة');
        }
        
        if (fileAnalysis.path.includes('repositories/')) {
            recommendations.push('فحص queries للتأكد من صحة platform filters');
        }
        
        fileAnalysis.recommendations = recommendations;
    }

    /**
     * توليد التوصيات العامة
     */
    generateRecommendations() {
        const recommendations = [];
        
        // تحليل قيم المنصات المكتشفة
        const platformValues = Array.from(this.results.platformValues);
        
        recommendations.push({
            category: 'Platform Values Discovery',
            items: [
                `تم اكتشاف ${platformValues.length} قيم منصات مختلفة: ${platformValues.join(', ')}`,
                'فحص case sensitivity - قد تكون هناك اختلافات في الحالة',
                'توحيد تسمية المنصات في جميع أنحاء الكود'
            ]
        });
        
        recommendations.push({
            category: 'Critical Files',
            items: [
                `${this.results.criticalFiles.length} ملفات تحتاج انتباه عاجل`,
                'بدء التحديث بالملفات عالية المخاطر أولاً',
                'إنشاء اختبارات شاملة قبل التعديل'
            ]
        });
        
        recommendations.push({
            category: 'Testing Strategy', 
            items: [
                'إنشاء test cases لجميع قيم المنصات الجديدة',
                'اختبار backwards compatibility',
                'اختبار integration مع external APIs'
            ]
        });
        
        this.results.recommendations = recommendations;
    }

    /**
     * توليد التقرير
     */
    async generateReport() {
        const report = this.buildMarkdownReport();
        await fs.writeFile(CONFIG.outputFile, report, 'utf8');
    }

    /**
     * بناء تقرير Markdown
     */
    buildMarkdownReport() {
        const report = [];
        
        // Header
        report.push('# Platform Code Impact Analysis Report');
        report.push(`**Generated on:** ${new Date().toISOString()}`);
        report.push('');
        
        // Executive Summary
        report.push('## Executive Summary');
        report.push(`- **Total Files Scanned:** ${this.results.totalFilesScanned}`);
        report.push(`- **Files with Platform Code:** ${this.results.filesWithPlatformCode}`);
        report.push(`- **Critical Files:** ${this.results.criticalFiles.length}`);
        report.push(`- **Platform Values Found:** ${Array.from(this.results.platformValues).join(', ')}`);
        report.push('');
        
        // Critical Files
        if (this.results.criticalFiles.length > 0) {
            report.push('## 🚨 Critical Files (High Priority)');
            this.results.criticalFiles.forEach(file => {
                report.push(`- \`${file}\``);
            });
            report.push('');
        }
        
        // Detailed Analysis
        report.push('## Detailed File Analysis');
        
        const sortedFiles = this.results.impactPoints.sort((a, b) => {
            const riskOrder = { critical: 4, high: 3, medium: 2, low: 1 };
            return riskOrder[b.riskLevel] - riskOrder[a.riskLevel];
        });
        
        sortedFiles.forEach(file => {
            const riskEmoji = {
                critical: '🔴',
                high: '🟠', 
                medium: '🟡',
                low: '🟢'
            };
            
            report.push(`### ${riskEmoji[file.riskLevel]} \`${file.path}\` (${file.riskLevel} risk)`);
            report.push('');
            
            // Platform usages
            report.push('**Platform Usages:**');
            file.platformUsages.forEach(usage => {
                report.push(`- Line ${usage.line}: ${usage.type} - \`${usage.match}\``);
                if (usage.value) {
                    report.push(`  - Platform Value: \`${usage.value}\``);
                }
            });
            report.push('');
            
            // Recommendations
            if (file.recommendations.length > 0) {
                report.push('**Recommendations:**');
                file.recommendations.forEach(rec => {
                    report.push(`- ${rec}`);
                });
                report.push('');
            }
        });
        
        // General Recommendations
        report.push('## General Recommendations');
        this.results.recommendations.forEach(category => {
            report.push(`### ${category.category}`);
            category.items.forEach(item => {
                report.push(`- ${item}`);
            });
            report.push('');
        });
        
        return report.join('\n');
    }
}

// تشغيل التحليل
if (import.meta.url === `file://${process.argv[1]}`) {
    const analyzer = new PlatformImpactAnalyzer();
    analyzer.analyze().catch(console.error);
}