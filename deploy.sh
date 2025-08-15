#!/bin/bash

# ===============================================
# Docker Deployment Script - AI Sales Platform (2025)
# ✅ Production Docker deployment instead of Cloudflare Workers
# ===============================================

echo "🚀 تشغيل النظام في الإنتاج..."
echo "=================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if Docker is running
echo "🔍 فحص Docker..."
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker غير مُشغل${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Docker جاهز${NC}"

# Check if .env.production exists
if [ ! -f ".env.production" ]; then
    echo -e "${YELLOW}⚠️ .env.production غير موجود${NC}"
    echo "إنشاء ملف .env.production من .env.example..."
    cp .env.example .env.production
    echo -e "${YELLOW}يرجى تحديث .env.production بالقيم الإنتاجية${NC}"
    exit 1
fi

# Build production image
echo "🔨 بناء صورة الإنتاج..."
docker build --target production -t ai-sales-platform:latest .

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ فشل في بناء الصورة${NC}"
    exit 1
fi

echo -e "${GREEN}✅ تم بناء الصورة بنجاح${NC}"

# Run database migrations
echo "📊 تشغيل migrations قاعدة البيانات..."
docker-compose -f docker-compose.prod.yml run --rm api bun run db:migrate

# Start production services
echo "🚀 تشغيل الخدمات..."
docker-compose -f docker-compose.prod.yml up -d

# Check health
echo "🔍 فحص حالة الخدمات..."
sleep 10
curl -f https://ai-instgram.onrender.com/health > /dev/null 2>&1

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ النظام يعمل بنجاح!${NC}"
    echo "📊 يمكنك زيارة: https://ai-instgram.onrender.com"
    echo "📋 للمراقبة: docker-compose -f docker-compose.prod.yml logs -f"
else
    echo -e "${RED}❌ فشل في تشغيل النظام${NC}"
    docker-compose -f docker-compose.prod.yml logs api
    exit 1
fi

echo "🎉 تم النشر بنجاح!"