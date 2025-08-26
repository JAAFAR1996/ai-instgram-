// dependency-checker.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const tables = ['comment_interactions', 'comment_responses', 'user_comment_history', 
                'story_interactions', 'sales_opportunities'];
const functions = ['update_user_comment_history', 'calculate_comment_engagement_score'];

function searchInFile(filePath, searchTerms) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const found = [];
        
        searchTerms.forEach(term => {
            if (content.includes(term)) {
                const lines = content.split('\n');
                let matchCount = 0;
                
                lines.forEach((line, index) => {
                    if (line.includes(term)) {
                        matchCount++;
                    }
                });
                
                if (matchCount > 0) {
                    found.push({ term, matches: matchCount });
                }
            }
        });
        
        return found;
    } catch (error) {
        console.error(`Error reading file ${filePath}:`, error.message);
        return [];
    }
}

function walkDirectory(dir, extension = '.ts') {
    const results = [];
    
    function walk(currentDir) {
        try {
            const files = fs.readdirSync(currentDir);
            
            files.forEach(file => {
                const filePath = path.join(currentDir, file);
                
                try {
                    const stat = fs.statSync(filePath);
                    
                    if (stat.isDirectory()) {
                        walk(filePath);
                    } else if (file.endsWith(extension)) {
                        const found = searchInFile(filePath, [...tables, ...functions]);
                        if (found.length > 0) {
                            results.push({ file: filePath, dependencies: found });
                        }
                    }
                } catch (error) {
                    console.error(`Error processing ${filePath}:`, error.message);
                }
            });
        } catch (error) {
            console.error(`Error reading directory ${currentDir}:`, error.message);
        }
    }
    
    walk(dir);
    return results;
}

console.log('🔍 فحص Dependencies...');
const results = walkDirectory('./src');

console.log('\n📊 النتائج:');
if (results.length === 0) {
    console.log('❌ لم يتم العثور على أي استخدامات للجداول والدوال المحددة');
} else {
    results.forEach(result => {
        console.log(`\n📁 ${result.file}`);
        result.dependencies.forEach(dep => {
            console.log(`   ✓ ${dep.term} (${dep.matches} استخدام)`);
        });
    });
}

console.log(`\n📈 الإحصائيات:`);
console.log(`- ملفات تحتوي على dependencies: ${results.length}`);
console.log(`- إجمالي الجداول المفحوصة: ${tables.length}`);
console.log(`- إجمالي Functions المفحوصة: ${functions.length}`);

// فحص إضافي للجداول الموجودة في المشروع
console.log('\n🔍 فحص الجداول الموجودة في المشروع...');
const existingTables = [
    'merchants', 'products', 'orders', 'conversations', 'message_logs',
    'webhook_logs', 'webhook_subscriptions', 'webhook_delivery_attempts',
    'instagram_accounts', 'instagram_messages', 'instagram_stories'
];

const existingResults = walkDirectory('./src');
console.log(`\n📊 الجداول الموجودة في المشروع:`);
existingTables.forEach(table => {
    const usageCount = existingResults.reduce((count, result) => {
        const found = result.dependencies.find(dep => dep.term === table);
        return count + (found ? found.matches : 0);
    }, 0);
    
    if (usageCount > 0) {
        console.log(`   ✓ ${table} (${usageCount} استخدام)`);
    } else {
        console.log(`   ⚠️ ${table} (لا يوجد استخدام)`);
    }
});
