/**
 * ===============================================
 * Instagram Integration Migrations Runner
 * Executes all Instagram-related database migrations
 * ===============================================
 */

const { getDatabase } = require('./src/database/connection');
const fs = require('fs').promises;
const path = require('path');

// Migration files in order
const MIGRATION_FILES = [
    '007_instagram_stories_infrastructure.sql',
    '008_instagram_comments_infrastructure.sql', 
    '009_instagram_media_infrastructure.sql',
    '010_instagram_testing_infrastructure.sql'
];

const MIGRATIONS_DIR = path.join(__dirname, 'database', 'migrations');

/**
 * Main migration runner
 */
async function runInstagramMigrations() {
    console.log('🚀 ======================================');
    console.log('🚀 Instagram Integration Migrations');
    console.log('🚀 ======================================\n');

    try {
        // Initialize database connection
        console.log('🔍 Connecting to database...');
        const db = getDatabase();
        const sql = db.getSQL();
        console.log('✅ Database connected\n');

        // Check current migration status
        console.log('📋 Checking migration status...');
        await ensureMigrationTable(sql);
        const appliedMigrations = await getAppliedMigrations(sql);
        console.log(`📊 Applied migrations: ${appliedMigrations.size}\n`);

        // Run each migration
        let migrationsApplied = 0;
        
        for (const migrationFile of MIGRATION_FILES) {
            const migrationName = migrationFile.replace('.sql', '');
            
            if (appliedMigrations.has(migrationName)) {
                console.log(`⏭️  Skipping ${migrationName} (already applied)`);
                continue;
            }

            console.log(`🔄 Running migration: ${migrationName}...`);
            
            try {
                // Read migration file
                const migrationPath = path.join(MIGRATIONS_DIR, migrationFile);
                const migrationSQL = await fs.readFile(migrationPath, 'utf8');
                
                // Execute migration
                const startTime = Date.now();
                await sql(migrationSQL);
                const executionTime = Date.now() - startTime;
                
                // Record migration
                await recordMigration(sql, migrationName, migrationPath);
                
                console.log(`✅ Completed ${migrationName} (${executionTime}ms)`);
                migrationsApplied++;
                
            } catch (error) {
                console.error(`❌ Failed to run ${migrationName}:`, error.message);
                throw error;
            }
        }

        // Summary
        console.log(`\n📈 Migration Summary:`);
        console.log(`  Total files: ${MIGRATION_FILES.length}`);
        console.log(`  Previously applied: ${appliedMigrations.size}`);
        console.log(`  Newly applied: ${migrationsApplied}`);
        
        if (migrationsApplied > 0) {
            console.log(`\n🎉 Successfully applied ${migrationsApplied} new migrations!`);
            
            // Verify tables were created
            console.log(`\n🔍 Verifying table creation...`);
            await verifyTablesCreated(sql);
            console.log(`✅ All tables verified successfully`);
            
        } else {
            console.log(`\n✨ All migrations already applied - database is up to date!`);
        }

        // Show next steps
        console.log(`\n📋 Next Steps:`);
        console.log(`  1. Run tests: npm run test:instagram`);
        console.log(`  2. Verify API integration: npm run api:validate`);
        console.log(`  3. Check system health: npm run health:check`);
        console.log(`  4. Review documentation: docs/testing-strategy.md`);

        console.log(`\n🏁 Migration process completed successfully!`);

    } catch (error) {
        console.error('\n❌ Migration process failed:', error);
        console.error('Stack trace:', error.stack);
        process.exit(1);
    }
}

/**
 * Ensure migration tracking table exists
 */
async function ensureMigrationTable(sql) {
    await sql`
        CREATE TABLE IF NOT EXISTS migrations (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) UNIQUE NOT NULL,
            file_path TEXT,
            executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            execution_time_ms INTEGER,
            success BOOLEAN DEFAULT TRUE
        )
    `;
}

/**
 * Get list of applied migrations
 */
async function getAppliedMigrations(sql) {
    try {
        const results = await sql`
            SELECT name FROM migrations 
            WHERE success = TRUE
            ORDER BY executed_at
        `;
        
        return new Set(results.map(row => row.name));
    } catch (error) {
        // Table might not exist yet
        return new Set();
    }
}

/**
 * Record migration execution
 */
async function recordMigration(sql, migrationName, filePath) {
    await sql`
        INSERT INTO migrations (name, file_path)
        VALUES (${migrationName}, ${filePath})
        ON CONFLICT (name) DO NOTHING
    `;
}

/**
 * Verify that required tables were created
 */
async function verifyTablesCreated(sql) {
    const requiredTables = [
        'story_interactions',
        'story_templates', 
        'comment_interactions',
        'comment_responses',
        'media_messages',
        'media_analysis',
        'hashtag_mentions',
        'test_results',
        'performance_test_results'
    ];

    const existingTables = await sql`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
        AND table_name = ANY(${requiredTables})
    `;

    const foundTables = existingTables.map(row => row.table_name);
    const missingTables = requiredTables.filter(table => !foundTables.includes(table));

    if (missingTables.length > 0) {
        throw new Error(`Missing required tables: ${missingTables.join(', ')}`);
    }

    console.log(`  📊 Verified ${foundTables.length}/${requiredTables.length} tables`);
    
    // Check some table structures
    for (const table of ['story_interactions', 'test_results', 'hashtag_mentions']) {
        const columns = await sql`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = ${table}
            AND table_schema = 'public'
        `;
        console.log(`  📋 ${table}: ${columns.length} columns`);
    }
}

/**
 * Rollback specific migration (advanced usage)
 */
async function rollbackMigration(migrationName) {
    console.log(`🔄 Rolling back migration: ${migrationName}`);
    
    // This would require rollback scripts
    // For now, just remove from migrations table
    const db = getDatabase();
    const sql = db.getSQL();
    
    await sql`
        DELETE FROM migrations 
        WHERE name = ${migrationName}
    `;
    
    console.log(`✅ Migration ${migrationName} marked as not applied`);
    console.log(`⚠️  Note: Manual cleanup of database objects may be required`);
}

/**
 * Show migration status
 */
async function showMigrationStatus() {
    console.log('📊 Migration Status Report\n');
    
    const db = getDatabase();
    const sql = db.getSQL();
    
    try {
        await ensureMigrationTable(sql);
        
        const migrations = await sql`
            SELECT name, executed_at, success
            FROM migrations 
            ORDER BY executed_at DESC
        `;
        
        console.log('Applied migrations:');
        migrations.forEach(migration => {
            const status = migration.success ? '✅' : '❌';
            const date = new Date(migration.executed_at).toLocaleString();
            console.log(`  ${status} ${migration.name} (${date})`);
        });
        
        console.log(`\nTotal applied: ${migrations.length}`);
        
        // Check for pending migrations
        const appliedMigrations = new Set(migrations.map(m => m.name));
        const pendingMigrations = MIGRATION_FILES.filter(file => 
            !appliedMigrations.has(file.replace('.sql', ''))
        );
        
        if (pendingMigrations.length > 0) {
            console.log(`\nPending migrations:`);
            pendingMigrations.forEach(file => {
                console.log(`  ⏳ ${file.replace('.sql', '')}`);
            });
        } else {
            console.log(`\n✨ All migrations are up to date!`);
        }
        
    } catch (error) {
        console.error('❌ Failed to get migration status:', error);
    }
}

// Command line interface
if (require.main === module) {
    const command = process.argv[2];
    
    switch (command) {
        case 'rollback':
            const migrationName = process.argv[3];
            if (!migrationName) {
                console.log('Usage: node run-instagram-migrations.js rollback <migration_name>');
                process.exit(1);
            }
            rollbackMigration(migrationName);
            break;
            
        case 'status':
            showMigrationStatus();
            break;
            
        case 'help':
        case '--help':
        case '-h':
            console.log('Instagram Integration Migrations Runner\n');
            console.log('Commands:');
            console.log('  node run-instagram-migrations.js          - Run all pending migrations');
            console.log('  node run-instagram-migrations.js status   - Show migration status');
            console.log('  node run-instagram-migrations.js rollback <name> - Rollback specific migration');
            console.log('  node run-instagram-migrations.js help     - Show this help\n');
            break;
            
        default:
            runInstagramMigrations();
            break;
    }
}

module.exports = {
    runInstagramMigrations,
    rollbackMigration,
    showMigrationStatus
};