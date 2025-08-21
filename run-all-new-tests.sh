#!/bin/bash

# ===============================================
# Complete Test Suite Runner Script  
# سكريبت تشغيل مجموعة الاختبارات الكاملة
# ===============================================

echo "🚀 تشغيل جميع الاختبارات الجديدة"
echo "🚀 Running All New Tests"
echo "============================================================"

# التحقق من وجود Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js غير مثبت - Node.js is not installed"
    exit 1
fi

# التحقق من وجود bun (اختياري)
if command -v bun &> /dev/null; then
    echo "✅ تم العثور على bun - Found bun"
    HAS_BUN=true
else
    echo "⚠️  bun غير مثبت، سيتم استخدام Node.js - bun not installed, will use Node.js"
    HAS_BUN=false
fi

echo ""

# تشغيل الاختبارات
if [ "$HAS_BUN" = true ]; then
    echo "🧪 تشغيل الاختبارات مع bun..."
    echo "🧪 Running tests with bun..."
    
    # محاولة تشغيل الاختبارات الشاملة مع bun
    if bun run run-all-new-tests.ts; then
        echo ""
        echo "🎉 جميع الاختبارات نجحت مع bun!"
        echo "🎉 All tests passed with bun!"
        exit 0
    else
        echo ""
        echo "⚠️  فشل في تشغيل مع bun، محاولة مع Node.js..."
        echo "⚠️  Failed with bun, trying with Node.js..."
    fi
fi

echo "🧪 تشغيل الاختبارات مع Node.js..."
echo "🧪 Running tests with Node.js..."

# تشغيل الاختبارات مع Node.js
if node run-new-tests.cjs; then
    echo ""
    echo "🎉 جميع الاختبارات نجحت مع Node.js!"
    echo "🎉 All tests passed with Node.js!"
    exit 0
else
    echo ""
    echo "❌ فشلت بعض الاختبارات"
    echo "❌ Some tests failed"
    exit 1
fi