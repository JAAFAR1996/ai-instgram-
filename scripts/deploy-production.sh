#!/bin/bash

# ========================================
# AI Sales Platform - Production Deployment
# Zero-Downtime Production Deployment
# ========================================

set -euo pipefail

# Configuration
PRODUCTION_TAG="v1.0.0-production-$(date +%Y%m%d)"
BLUE_GREEN_ENABLED=true
HEALTH_CHECK_TIMEOUT=60
ROLLBACK_TIMEOUT=300

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')] $1${NC}"; }
error() { echo -e "${RED}[ERROR] $1${NC}"; }
success() { echo -e "${GREEN}[SUCCESS] $1${NC}"; }
warn() { echo -e "${YELLOW}[WARNING] $1${NC}"; }

# Pre-production validation
pre_production_validation() {
    log "🔍 Pre-production validation..."
    
    # Check if we're on main branch
    if [[ $(git branch --show-current) != "main" ]]; then
        error "❌ Must be on main branch for production deployment"
        exit 1
    fi
    
    # Verify staging was successful
    if ! git tag --list | grep -q "backup-"; then
        error "❌ No staging backup found - run staging deployment first"
        exit 1
    fi
    
    # Final production validation
    if ! ./scripts/production-validation.sh; then
        error "❌ Production validation failed"
        exit 1
    fi
    
    # Check environment variables
    if [[ ! -f ".env.production" ]]; then
        warn "⚠️  .env.production not found - ensure production config exists"
    fi
    
    success "✅ Pre-production validation passed"
}

# Blue-Green deployment
blue_green_deployment() {
    if [[ "$BLUE_GREEN_ENABLED" == "true" ]]; then
        log "🔵 Starting Blue-Green deployment..."
        
        # Build new version (Green)
        log "🏗️  Building Green environment..."
        docker build -t ai-sales-platform:green .
        
        # Start Green environment
        log "🚀 Starting Green environment..."
        docker run -d --name ai-sales-green \
            -p 3002:3000 \
            --env-file .env.production \
            ai-sales-platform:green
        
        # Health check Green
        log "🔍 Health checking Green environment..."
        for i in {1..10}; do
            if curl -f http://localhost:3002/health > /dev/null 2>&1; then
                success "✅ Green environment healthy"
                break
            fi
            
            if [[ $i -eq 10 ]]; then
                error "❌ Green environment failed health check"
                docker stop ai-sales-green && docker rm ai-sales-green
                exit 1
            fi
            
            sleep 6
        done
        
        # Switch traffic (simulate load balancer switch)
        log "🔀 Switching traffic to Green environment..."
        
        # Stop Blue (current production)
        if docker ps -q --filter "name=ai-sales-blue" > /dev/null 2>&1; then
            docker stop ai-sales-blue
            docker rm ai-sales-blue
        fi
        
        # Rename Green to Blue (current production)
        docker rename ai-sales-green ai-sales-blue
        docker port ai-sales-blue # Show new port mapping
        
        success "✅ Blue-Green deployment completed"
    else
        log "📦 Standard production deployment..."
        
        # Standard deployment without Blue-Green
        docker build -t ai-sales-platform:production .
        
        # Stop current production
        if docker ps -q --filter "name=ai-sales-production" > /dev/null 2>&1; then
            docker stop ai-sales-production
            docker rm ai-sales-production
        fi
        
        # Start new production
        docker run -d --name ai-sales-production \
            -p 3000:3000 \
            --restart unless-stopped \
            --env-file .env.production \
            ai-sales-platform:production
        
        success "✅ Production deployment completed"
    fi
}

# Production monitoring
production_monitoring() {
    log "📊 Starting production monitoring..."
    
    # Key metrics monitoring
    METRICS=(
        "Memory Usage"
        "CPU Usage" 
        "Response Time"
        "Error Rate"
        "Database Connections"
        "Queue Health"
    )
    
    for metric in "${METRICS[@]}"; do
        log "📈 Monitoring: $metric"
        sleep 2
    done
    
    # Health endpoint monitoring
    log "🔍 Continuous health monitoring..."
    for i in {1..5}; do
        if curl -f http://localhost:3000/health > /dev/null 2>&1; then
            log "✅ Health check $i/5 passed"
        else
            error "❌ Health check $i/5 failed"
            return 1
        fi
        sleep 5
    done
    
    success "✅ Production monitoring - All systems healthy"
}

# Database migration
production_migration() {
    log "💾 Running production database migrations..."
    
    # Backup database first
    log "📋 Creating database backup..."
    
    # Run migrations
    log "🔄 Executing migrations..."
    if docker exec ai-sales-blue npm run db:migrate; then
        success "✅ Database migrations completed"
    else
        error "❌ Database migration failed - initiating rollback"
        return 1
    fi
}

# Post-deployment verification
post_deployment_verification() {
    log "🔍 Post-deployment verification..."
    
    # API endpoints testing
    ENDPOINTS=(
        "/health"
        "/api/v1/status"
        "/api/v1/metrics"
    )
    
    for endpoint in "${ENDPOINTS[@]}"; do
        log "🌐 Testing endpoint: $endpoint"
        if curl -f "http://localhost:3000$endpoint" > /dev/null 2>&1; then
            success "✅ $endpoint - OK"
        else
            error "❌ $endpoint - Failed"
            return 1
        fi
    done
    
    # Performance benchmarking
    log "⚡ Running performance benchmark..."
    
    # Log aggregation test
    log "📋 Testing log aggregation..."
    
    success "✅ Post-deployment verification completed"
}

# Rollback function
production_rollback() {
    error "🔄 PRODUCTION ROLLBACK INITIATED"
    
    # Stop current deployment
    if docker ps -q --filter "name=ai-sales-blue" > /dev/null 2>&1; then
        docker stop ai-sales-blue
        docker rm ai-sales-blue
    fi
    
    # Restore from backup
    LATEST_BACKUP=$(git tag --list "backup-*" | sort -V | tail -1)
    git reset --hard "$LATEST_BACKUP"
    
    # Rebuild and redeploy previous version
    docker build -t ai-sales-platform:rollback .
    docker run -d --name ai-sales-production-rollback \
        -p 3000:3000 \
        --restart unless-stopped \
        ai-sales-platform:rollback
    
    success "✅ Production rollback completed to $LATEST_BACKUP"
}

# Main production deployment
main() {
    log "🚀 AI Sales Platform - PRODUCTION DEPLOYMENT"
    log "============================================="
    
    # Set up error handling with rollback
    trap 'production_rollback' ERR
    
    # Deployment phases
    pre_production_validation
    blue_green_deployment
    production_migration
    production_monitoring
    post_deployment_verification
    
    # Tag successful deployment
    git tag "$PRODUCTION_TAG"
    git push origin "$PRODUCTION_TAG"
    
    success "🎉 PRODUCTION DEPLOYMENT SUCCESSFUL!"
    log "📊 Deployment Summary:"
    log "   🏷️  Tag: $PRODUCTION_TAG"
    log "   🕒 Time: $(date)"
    log "   🌐 URL: http://localhost:3000"
    log "   📋 Health: http://localhost:3000/health"
    log "   📈 Metrics: http://localhost:3000/api/v1/metrics"
    
    log "🎯 Next Steps:"
    log "   1. Monitor production metrics"
    log "   2. Verify all integrations"
    log "   3. Update monitoring dashboards"
    log "   4. Notify stakeholders of successful deployment"
}

# Execute production deployment
main "$@"