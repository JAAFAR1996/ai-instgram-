#!/bin/bash
# ==============================================
# Database Setup and Testing Script
# ==============================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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

# Function to run database operations
setup_database() {
    print_status "Setting up database..."
    
    # Check if PostgreSQL is running
    if ! docker ps | grep -q "ai-sales-postgres"; then
        print_error "PostgreSQL container is not running. Please start it first:"
        echo "docker-compose -f docker-compose.dev.yml up -d postgres"
        exit 1
    fi
    
    # Wait for PostgreSQL to be ready
    print_status "Waiting for PostgreSQL to be ready..."
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
    
    # Run migrations
    print_status "Running database migrations..."
    if bun run src/database/migrate.ts migrate; then
        print_success "Migrations completed successfully"
    else
        print_error "Migrations failed"
        exit 1
    fi
    
    # Seed database
    print_status "Seeding database with test data..."
    if bun run src/database/seed.ts seed; then
        print_success "Database seeded successfully"
    else
        print_error "Database seeding failed"
        exit 1
    fi
    
    # Test database
    print_status "Testing database functionality..."
    if bun run src/database/test.ts test; then
        print_success "Database tests passed"
    else
        print_error "Database tests failed"
        exit 1
    fi
}

# Function to show database status
show_status() {
    print_status "Database Status:"
    
    # Check migration status
    echo ""
    bun run src/database/migrate.ts status
    
    # Show database statistics
    echo ""
    bun run src/database/test.ts stats
}

# Function to reset database
reset_database() {
    print_warning "⚠️ WARNING: This will destroy ALL data!"
    read -p "Are you sure you want to reset the database? (yes/no): " confirm
    
    if [ "$confirm" = "yes" ]; then
        print_status "Resetting database..."
        bun run src/database/migrate.ts reset
        print_success "Database reset completed"
    else
        print_status "Database reset cancelled"
    fi
}

# Function to backup database
backup_database() {
    print_status "Creating database backup..."
    
    timestamp=$(date +"%Y%m%d_%H%M%S")
    backup_file="backup_${timestamp}.sql"
    
    docker-compose -f docker-compose.dev.yml exec -T postgres pg_dump -U postgres -d ai_sales_dev > "backups/${backup_file}"
    
    if [ $? -eq 0 ]; then
        print_success "Database backup created: backups/${backup_file}"
    else
        print_error "Database backup failed"
        exit 1
    fi
}

# Function to test specific queries
test_queries() {
    print_status "Testing application queries..."
    bun run src/database/test.ts queries
}

# Main menu
show_menu() {
    echo ""
    echo "🗄️ Database Management Menu"
    echo "=========================="
    echo "1. Setup database (migrate + seed + test)"
    echo "2. Show database status"
    echo "3. Run migrations only"
    echo "4. Seed database only"
    echo "5. Test database only"
    echo "6. Test application queries"
    echo "7. Create database backup"
    echo "8. Reset database (DANGER!)"
    echo "9. Exit"
    echo ""
}

# Main execution
main() {
    if [ $# -eq 0 ]; then
        # Interactive mode
        while true; do
            show_menu
            read -p "Choose an option (1-9): " choice
            
            case $choice in
                1)
                    setup_database
                    ;;
                2)
                    show_status
                    ;;
                3)
                    print_status "Running migrations..."
                    bun run src/database/migrate.ts migrate
                    ;;
                4)
                    print_status "Seeding database..."
                    bun run src/database/seed.ts seed
                    ;;
                5)
                    print_status "Testing database..."
                    bun run src/database/test.ts test
                    ;;
                6)
                    test_queries
                    ;;
                7)
                    backup_database
                    ;;
                8)
                    reset_database
                    ;;
                9)
                    print_status "Goodbye!"
                    exit 0
                    ;;
                *)
                    print_error "Invalid option. Please choose 1-9."
                    ;;
            esac
        done
    else
        # Command line mode
        case $1 in
            setup)
                setup_database
                ;;
            status)
                show_status
                ;;
            migrate)
                bun run src/database/migrate.ts migrate
                ;;
            seed)
                bun run src/database/seed.ts seed
                ;;
            test)
                bun run src/database/test.ts test
                ;;
            queries)
                test_queries
                ;;
            backup)
                backup_database
                ;;
            reset)
                reset_database
                ;;
            *)
                echo "Usage: $0 [setup|status|migrate|seed|test|queries|backup|reset]"
                exit 1
                ;;
        esac
    fi
}

# Create backups directory if it doesn't exist
mkdir -p backups

# Run main function
main "$@"