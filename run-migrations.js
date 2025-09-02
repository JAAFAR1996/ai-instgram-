import { runDatabaseMigrations } from './dist/database/migrate.js';
import process from 'process';

console.log('🚀 Starting migration process...');

runDatabaseMigrations()
  .then(() => {
    console.log('✅ Migrations completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  });
