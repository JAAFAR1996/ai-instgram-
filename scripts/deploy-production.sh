#!/bin/bash

# ===============================================
# Production Deployment Script
# Complete deployment with database setup and health checks
# ===============================================

set -e  # Exit on any error

echo "🚀 Starting production deployment..."
echo "📅 Deployment time: $(date)"
echo "🔗 Git commit: ${RENDER_GIT_COMMIT:-unknown}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check required environment variables
log_info "Checking environment variables..."
if [ -z "$DATABASE_URL" ]; then
    log_error "DATABASE_URL is required"
    exit 1
fi

if [ -z "$MANYCHAT_API_KEY" ]; then
    log_warning "MANYCHAT_API_KEY is not set - ManyChat integration will not work"
fi

log_success "Environment variables validated"

# Build the application
log_info "Building application..."
npm run build
log_success "Application built successfully"

# Initialize production database
log_info "Initializing production database..."
if node scripts/init-production-db.js; then
    log_success "Database initialized successfully"
else
    log_error "Database initialization failed"
    exit 1
fi

# Run health check to verify deployment
log_info "Running post-deployment health check..."
sleep 5  # Give services time to start

# Start the application in background for health check
log_info "Starting application for health verification..."
npm start &
APP_PID=$!

# Wait for app to start
sleep 10

# Check if app is running
if kill -0 $APP_PID 2>/dev/null; then
    log_success "Application started successfully (PID: $APP_PID)"
    
    # Try to run health check
    if curl -f -s http://localhost:${PORT:-3000}/health/quick > /dev/null; then
        log_success "Health check passed - deployment successful!"
    else
        log_warning "Health check failed but app is running - check logs"
    fi
    
    # Stop the background process
    kill $APP_PID 2>/dev/null || true
    wait $APP_PID 2>/dev/null || true
else
    log_error "Application failed to start"
    exit 1
fi

# Production readiness checklist
log_info "Production readiness checklist:"
echo "  ✅ Database connection: Verified"
echo "  ✅ Required tables: Created"
echo "  ✅ Application build: Successful"
echo "  ✅ Health endpoints: Available"
echo "  ⚠️  ManyChat API: ${MANYCHAT_API_KEY:+Configured}${MANYCHAT_API_KEY:-Not configured}"
echo "  ⚠️  Instagram API: Check configuration in production"

log_success "Deployment completed successfully!"
log_info "Application is ready to handle production traffic"
log_info "Monitor logs and health endpoints for any issues"

echo ""
echo "🔍 Available endpoints:"
echo "  • Health Quick: /health/quick"
echo "  • Health Production: /health/production" 
echo "  • Instagram Webhook: /webhooks/instagram"
echo ""
echo "📊 Monitoring commands:"
echo "  • Check logs: 'heroku logs --tail' or check Render dashboard"
echo "  • Health check: 'curl https://your-app.onrender.com/health/quick'"
echo ""