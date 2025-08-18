#!/bin/bash
# ==============================================
# AI Sales Platform Development Setup Script
# ==============================================

set -e

echo "🚀 Setting up AI Sales Platform Development Environment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Docker is running
check_docker() {
    print_status "Checking Docker..."
    if ! docker info >/dev/null 2>&1; then
        print_error "Docker is not running. Please start Docker and try again."
        exit 1
    fi
    print_success "Docker is running"
}

# Check if ports are available
check_ports() {
    print_status "Checking if required ports are available..."
    
    ports=(5432 6379 3000 8080 8001)
    for port in "${ports[@]}"; do
        if lsof -i :$port >/dev/null 2>&1; then
            print_warning "Port $port is already in use"
        else
            print_success "Port $port is available"
        fi
    done
}

# Install dependencies
install_dependencies() {
    print_status "Installing Node.js dependencies..."
    
    if command -v bun >/dev/null 2>&1; then
        print_status "Using Bun package manager..."
        bun install
    elif command -v npm >/dev/null 2>&1; then
        print_status "Using npm package manager..."
        npm install
    else
        print_error "Neither Bun nor npm found. Please install one of them."
        exit 1
    fi
    
    print_success "Dependencies installed"
}

# Setup environment file
setup_env() {
    print_status "Setting up environment file..."
    
    if [ ! -f .env.development ]; then
        print_error ".env.development file not found"
        exit 1
    fi
    
    if [ ! -f .env ]; then
        cp .env.development .env
        print_success "Created .env file from .env.development"
    else
        print_warning ".env file already exists"
    fi
}

# Start Docker services
start_docker_services() {
    print_status "Starting Docker services..."
    
    docker-compose -f docker-compose.dev.yml down --remove-orphans
    docker-compose -f docker-compose.dev.yml up -d
    
    # Wait for services to be ready
    print_status "Waiting for services to be ready..."
    sleep 10
    
    # Check PostgreSQL
    max_attempts=30
    attempt=1
    while [ $attempt -le $max_attempts ]; do
        if docker-compose -f docker-compose.dev.yml exec -T postgres pg_isready -U postgres -d ai_sales_dev >/dev/null 2>&1; then
            print_success "PostgreSQL is ready"
            break
        fi
        print_status "Waiting for PostgreSQL... (attempt $attempt/$max_attempts)"
        sleep 2
        attempt=$((attempt + 1))
    done
    
    if [ $attempt -gt $max_attempts ]; then
        print_error "PostgreSQL failed to start"
        exit 1
    fi
    
    # Check Redis
    if docker-compose -f docker-compose.dev.yml exec -T redis redis-cli ping >/dev/null 2>&1; then
        print_success "Redis is ready"
    else
        print_error "Redis failed to start"
        exit 1
    fi
}

# Initialize database
init_database() {
    print_status "Initializing database..."
    
    # Database should already be initialized by init scripts
    # But we can run additional setup here if needed
    
    print_success "Database initialized"
}

# Show service URLs
show_urls() {
    print_success "Development environment is ready! 🎉"
    echo ""
    echo "📍 Service URLs:"
    echo "   🔗 API Server: http://localhost:3000"
    echo "   🗄️  Database Admin: http://localhost:8080"
    echo "      Username: postgres"
    echo "      Password: dev_password_123"
    echo "      Database: ai_sales_dev"
    echo "   📊 Redis Insight: http://localhost:8001"
    echo "   📈 Grafana: http://localhost:3001 (admin/admin123)"
    echo ""
    echo "🔧 Development Commands:"
    echo "   📦 Start API: bun run dev"
    echo "   🔍 View logs: docker-compose -f docker-compose.dev.yml logs -f"
    echo "   🛑 Stop services: docker-compose -f docker-compose.dev.yml down"
    echo ""
}

# Main execution
main() {
    echo "Starting setup process..."
    
    check_docker
    check_ports
    install_dependencies
    setup_env
    start_docker_services
    init_database
    show_urls
    
    print_success "Setup completed successfully! 🚀"
}

# Run main function
main