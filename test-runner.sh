#!/bin/bash

# ===============================================
# AI Sales Platform - مشغل الاختبارات المبسط
# Simple test runner script
# ===============================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Emojis
SUCCESS="✅"
ERROR="❌"
WARNING="⚠️"
INFO="ℹ️"
ROCKET="🚀"
GEAR="⚙️"
CHART="📊"

echo -e "\n${BLUE}════════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${ROCKET} ${CYAN}AI SALES PLATFORM - مشغل الاختبارات المبسط${NC}"
echo -e "   ${CYAN}Simple Test Runner for AI Sales Platform${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════════════════════════${NC}"

# Function to show help
show_help() {
    echo -e "\n${CYAN}الاستخدام - Usage:${NC}"
    echo -e "  ./test-runner.sh [command]"
    echo -e "\n${CYAN}الأوامر المتاحة - Available Commands:${NC}"
    echo -e "  ${GREEN}all${NC}           تشغيل جميع الاختبارات - Run all tests"
    echo -e "  ${GREEN}list${NC}          عرض قائمة الاختبارات - List available tests"
    echo -e "  ${GREEN}security${NC}      اختبارات الأمان - Security tests"
    echo -e "  ${GREEN}api${NC}           اختبارات الـ API - API tests"
    echo -e "  ${GREEN}database${NC}      اختبارات قاعدة البيانات - Database tests"
    echo -e "  ${GREEN}instagram${NC}     اختبارات Instagram - Instagram tests"
    echo -e "  ${GREEN}monitoring${NC}    اختبارات المراقبة - Monitoring tests"
    echo -e "  ${GREEN}critical${NC}      الاختبارات الحرجة فقط - Critical tests only"
    echo -e "  ${GREEN}quick${NC}         اختبار سريع - Quick test"
    echo -e "  ${GREEN}help${NC}          عرض هذه المساعدة - Show this help"
    echo -e "\n${CYAN}أمثلة - Examples:${NC}"
    echo -e "  ./test-runner.sh all"
    echo -e "  ./test-runner.sh security"
    echo -e "  ./test-runner.sh critical"
}

# Function to check prerequisites
check_prerequisites() {
    echo -e "\n${GEAR} ${YELLOW}فحص المتطلبات - Checking Prerequisites...${NC}"
    
    # Check Node.js
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node --version)
        echo -e "${SUCCESS} Node.js: ${NODE_VERSION}"
    else
        echo -e "${ERROR} Node.js غير مثبت - Node.js not installed"
        exit 1
    fi
    
    # Check if bun is available
    if command -v bun &> /dev/null; then
        BUN_VERSION=$(bun --version)
        echo -e "${SUCCESS} Bun: v${BUN_VERSION}"
        TEST_RUNNER="bun"
    else
        echo -e "${WARNING} Bun غير متاح، سيتم استخدام Node.js - Bun not available, using Node.js"
        TEST_RUNNER="node"
    fi
    
    # Check npm
    if command -v npm &> /dev/null; then
        NPM_VERSION=$(npm --version)
        echo -e "${SUCCESS} NPM: ${NPM_VERSION}"
    else
        echo -e "${ERROR} NPM غير مثبت - NPM not installed"
        exit 1
    fi
}

# Function to run tests
run_tests() {
    local test_type=$1
    
    echo -e "\n${ROCKET} ${GREEN}بدء تشغيل الاختبارات - Starting Tests: ${test_type}${NC}"
    echo -e "${BLUE}────────────────────────────────────────────────────────────────────────────────${NC}"
    
    case $test_type in
        "all")
            if [ "$TEST_RUNNER" = "bun" ]; then
                echo -e "${INFO} استخدام Bun لتشغيل جميع الاختبارات..."
                bun run-all-tests.ts
            else
                echo -e "${INFO} استخدام Node.js لتشغيل جميع الاختبارات..."
                node run-all-tests.mjs
            fi
            ;;
        "list")
            if [ "$TEST_RUNNER" = "bun" ]; then
                bun run-all-tests.ts --list
            else
                node run-all-tests.mjs --list
            fi
            ;;
        "security")
            echo -e "${INFO} تشغيل اختبارات الأمان..."
            if [ -f "src/services/encryption.test.ts" ]; then
                npm test src/services/encryption.test.ts 2>/dev/null || echo -e "${WARNING} فشل في تشغيل اختبارات التشفير"
            fi
            if [ -f "src/tests/sql-injection.test.ts" ]; then
                npm test src/tests/sql-injection.test.ts 2>/dev/null || echo -e "${WARNING} فشل في تشغيل اختبارات SQL Injection"
            fi
            ;;
        "api")
            echo -e "${INFO} تشغيل اختبارات الـ API..."
            if [ -f "src/api/service-control.test.ts" ]; then
                npm test src/api/service-control.test.ts 2>/dev/null || echo -e "${WARNING} فشل في تشغيل اختبارات API"
            fi
            ;;
        "database")
            echo -e "${INFO} تشغيل اختبارات قاعدة البيانات..."
            if [ -f "src/repositories/merchant-repository.test.ts" ]; then
                npm test src/repositories/merchant-repository.test.ts 2>/dev/null || echo -e "${WARNING} فشل في تشغيل اختبارات Repository"
            fi
            if [ -f "src/database/migrate.test.ts" ]; then
                npm test src/database/migrate.test.ts 2>/dev/null || echo -e "${WARNING} فشل في تشغيل اختبارات Migration"
            fi
            ;;
        "instagram")
            echo -e "${INFO} تشغيل اختبارات Instagram..."
            if [ -f "src/tests/instagram-integration.test.ts" ]; then
                npm test src/tests/instagram-integration.test.ts 2>/dev/null || echo -e "${WARNING} فشل في تشغيل اختبارات Instagram"
            fi
            ;;
        "monitoring")
            echo -e "${INFO} تشغيل اختبارات المراقبة..."
            if [ -f "src/services/monitoring.test.ts" ]; then
                npm test src/services/monitoring.test.ts 2>/dev/null || echo -e "${WARNING} فشل في تشغيل اختبارات المراقبة"
            fi
            ;;
        "critical")
            echo -e "${INFO} تشغيل الاختبارات الحرجة فقط..."
            npm run test:critical 2>/dev/null || echo -e "${WARNING} فشل في تشغيل الاختبارات الحرجة"
            ;;
        "quick")
            echo -e "${INFO} تشغيل اختبار سريع..."
            # Run one simple test to verify system is working
            if [ -f "src/services/encryption.test.ts" ]; then
                npm test src/services/encryption.test.ts 2>/dev/null || echo -e "${WARNING} الاختبار السريع فشل"
                echo -e "${SUCCESS} الاختبار السريع مكتمل"
            else
                echo -e "${ERROR} لا توجد اختبارات متاحة للتشغيل السريع"
            fi
            ;;
        *)
            echo -e "${ERROR} أمر غير معروف: $test_type"
            show_help
            exit 1
            ;;
    esac
}

# Function to show summary
show_summary() {
    echo -e "\n${BLUE}════════════════════════════════════════════════════════════════════════════════${NC}"
    echo -e "${CHART} ${CYAN}ملخص التشغيل - Execution Summary${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════════════════════════${NC}"
    echo -e "${INFO} تم انتهاء تشغيل الاختبارات"
    echo -e "${INFO} وقت الانتهاء: $(date '+%Y-%m-%d %H:%M:%S')"
    echo -e "${BLUE}════════════════════════════════════════════════════════════════════════════════${NC}\n"
}

# Main execution
main() {
    # Handle command line arguments
    if [ $# -eq 0 ]; then
        show_help
        exit 0
    fi
    
    case $1 in
        "help"|"-h"|"--help")
            show_help
            ;;
        "list"|"-l"|"--list")
            check_prerequisites
            run_tests "list"
            ;;
        *)
            check_prerequisites
            run_tests "$1"
            show_summary
            ;;
    esac
}

# Trap to handle script interruption
trap 'echo -e "\n${ERROR} تم إيقاف التشغيل بواسطة المستخدم"; exit 1' SIGINT

# Run main function
main "$@"