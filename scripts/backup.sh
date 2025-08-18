#!/bin/bash
# ==============================================
# AI Sales Platform Backup Script
# ==============================================

set -e

# Configuration
BACKUP_DIR="./backups"
DATE=$(date +"%Y%m%d_%H%M%S")
POSTGRES_CONTAINER="ai-sales-postgres-prod"
REDIS_CONTAINER="ai-sales-redis-prod"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

print_status() {
    echo -e "${YELLOW}[BACKUP]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Create backup directory
mkdir -p $BACKUP_DIR

# PostgreSQL Backup
backup_postgres() {
    print_status "Starting PostgreSQL backup..."
    
    POSTGRES_BACKUP_FILE="$BACKUP_DIR/postgres_backup_$DATE.sql"
    
    if docker exec $POSTGRES_CONTAINER pg_dump -U ai_sales -d ai_sales_prod > $POSTGRES_BACKUP_FILE; then
        gzip $POSTGRES_BACKUP_FILE
        print_success "PostgreSQL backup completed: ${POSTGRES_BACKUP_FILE}.gz"
    else
        print_error "PostgreSQL backup failed"
        return 1
    fi
}

# Redis Backup
backup_redis() {
    print_status "Starting Redis backup..."
    
    REDIS_BACKUP_FILE="$BACKUP_DIR/redis_backup_$DATE.rdb"
    
    if docker exec $REDIS_CONTAINER redis-cli BGSAVE; then
        # Wait for background save to complete
        sleep 5
        
        if docker cp $REDIS_CONTAINER:/data/dump.rdb $REDIS_BACKUP_FILE; then
            gzip $REDIS_BACKUP_FILE
            print_success "Redis backup completed: ${REDIS_BACKUP_FILE}.gz"
        else
            print_error "Redis backup failed"
            return 1
        fi
    else
        print_error "Redis BGSAVE failed"
        return 1
    fi
}

# Application Files Backup
backup_app_files() {
    print_status "Starting application files backup..."
    
    APP_BACKUP_FILE="$BACKUP_DIR/app_files_$DATE.tar.gz"
    
    tar -czf $APP_BACKUP_FILE \
        --exclude='node_modules' \
        --exclude='dist' \
        --exclude='logs' \
        --exclude='.git' \
        --exclude='backups' \
        .
    
    print_success "Application files backup completed: $APP_BACKUP_FILE"
}

# Cleanup old backups (keep last 7 days)
cleanup_old_backups() {
    print_status "Cleaning up old backups..."
    
    find $BACKUP_DIR -name "*.gz" -mtime +7 -delete
    find $BACKUP_DIR -name "*.tar.gz" -mtime +7 -delete
    
    print_success "Old backups cleaned up"
}

# Main backup function
main() {
    print_status "Starting backup process at $(date)"
    
    # Check if containers are running
    if ! docker ps | grep -q $POSTGRES_CONTAINER; then
        print_error "PostgreSQL container is not running"
        exit 1
    fi
    
    if ! docker ps | grep -q $REDIS_CONTAINER; then
        print_error "Redis container is not running"
        exit 1
    fi
    
    # Perform backups
    backup_postgres
    backup_redis
    backup_app_files
    cleanup_old_backups
    
    print_success "Backup process completed successfully at $(date)"
    
    # Show backup info
    echo ""
    echo "📊 Backup Summary:"
    echo "   📁 Backup directory: $BACKUP_DIR"
    echo "   📈 Backup size: $(du -sh $BACKUP_DIR | cut -f1)"
    echo "   📂 Files created:"
    ls -la $BACKUP_DIR/*$DATE* | while read line; do
        echo "      $line"
    done
}

# Run backup
main