#!/bin/bash

# ========================================
# AI Sales Platform - Production Validation
# Comprehensive Pre-Deployment Checks
# ========================================

set -euo pipefail

echo "🔍 Starting Production Validation..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Validation functions
validate_dependencies() {
    echo -e "${BLUE}📦 Validating Dependencies...${NC}"
    
    # Check for exact versions
    if npm ls --depth=0 | grep -q "invalid\|missing\|extraneous"; then
        echo -e "${RED}❌ Dependencies validation failed${NC}"
        npm ls --depth=0
        return 1
    fi
    
    echo -e "${GREEN}✅ Dependencies valid${NC}"
}

validate_security() {
    echo -e "${BLUE}🔒 Security Audit...${NC}"
    
    # Production security audit
    if ! npm audit --omit=dev --audit-level=moderate; then
        echo -e "${YELLOW}⚠️  Security vulnerabilities found${NC}"
        return 1
    fi
    
    echo -e "${GREEN}✅ No security vulnerabilities${NC}"
}

validate_typescript() {
    echo -e "${BLUE}📝 TypeScript Validation...${NC}"
    
    # Type checking
    if ! npm run typecheck; then
        echo -e "${RED}❌ TypeScript validation failed${NC}"
        return 1
    fi
    
    echo -e "${GREEN}✅ TypeScript valid${NC}"
}

validate_build() {
    echo -e "${BLUE}🏗️  Build Validation...${NC}"
    
    # Clean build test
    rm -rf dist/
    
    if ! npm run build; then
        echo -e "${RED}❌ Build failed${NC}"
        return 1
    fi
    
    # Check if essential files exist
    REQUIRED_FILES=(
        "dist/index.js"
        "dist/production-index.js"
    )
    
    for file in "${REQUIRED_FILES[@]}"; do
        if [[ ! -f "$file" ]]; then
            echo -e "${RED}❌ Missing required file: $file${NC}"
            return 1
        fi
    done
    
    echo -e "${GREEN}✅ Build successful${NC}"
}

validate_environment() {
    echo -e "${BLUE}🌍 Environment Validation...${NC}"
    
    # Check Node.js version
    NODE_VERSION=$(node -v | cut -d'.' -f1 | sed 's/v//')
    if [[ $NODE_VERSION -lt 20 ]]; then
        echo -e "${RED}❌ Node.js version $NODE_VERSION < 20${NC}"
        return 1
    fi
    
    # Check npm version
    NPM_VERSION=$(npm -v | cut -d'.' -f1)
    if [[ $NPM_VERSION -lt 10 ]]; then
        echo -e "${RED}❌ npm version $NPM_VERSION < 10${NC}"
        return 1
    fi
    
    echo -e "${GREEN}✅ Environment valid${NC}"
}

validate_production_readiness() {
    echo -e "${BLUE}🚀 Production Readiness...${NC}"
    
    # Check essential production files
    PROD_FILES=(
        "package.json"
        "package-lock.json"
        ".env.example"
        "Dockerfile"
        "docker-compose.yml"
        ".dockerignore"
    )
    
    for file in "${PROD_FILES[@]}"; do
        if [[ ! -f "$file" ]]; then
            echo -e "${RED}❌ Missing production file: $file${NC}"
            return 1
        fi
    done
    
    echo -e "${GREEN}✅ Production ready${NC}"
}

# Main validation
main() {
    echo -e "${BLUE}🎯 AI Sales Platform - Production Validation${NC}"
    echo -e "${BLUE}============================================${NC}"
    
    validate_environment
    validate_dependencies
    validate_security
    validate_typescript
    validate_build
    validate_production_readiness
    
    echo -e "${GREEN}🎉 All validations passed!${NC}"
    echo -e "${GREEN}✅ Ready for production deployment${NC}"
}

# Run validation
main "$@"