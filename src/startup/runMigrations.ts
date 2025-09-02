import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';

export async function runMigrations(pool: Pool) {
  // Prefer repository migrations path, fallback to root ./migrations if exists
  const candidates = [
    path.join(process.cwd(), 'src', 'database', 'migrations'),
    path.join(process.cwd(), 'migrations'),
  ];
  const dir = candidates.find(d => fs.existsSync(d));
  if (!dir) return;

  // Natural sort by numeric prefix (e.g., 001_, 015_, 074_)
  const files = fs.readdirSync(dir)
    .filter(f => /^\d+_.*\.sql$/.test(f))
    .sort((a, b) => {
      const na = parseInt(a.split('_')[0] || '0', 10);
      const nb = parseInt(b.split('_')[0] || '0', 10);
      if (na !== nb) return na - nb;
      return a.localeCompare(b);
    });

  const client = await pool.connect();
  try {
    // Create migrations tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    for (const f of files) {
      // Check if migration already applied
      const { rows } = await client.query(
        'SELECT 1 FROM _migrations WHERE name = $1',
        [f]
      );
      
      if (rows.length > 0) {
        console.log(`⏭️  Migration already applied: ${f}`);
        continue;
      }

      const sql = fs.readFileSync(path.join(dir, f), 'utf8');
      console.log('🔄 Running migration:', f);
      await client.query('BEGIN');
      await client.query(sql);
      // Record migration as applied
      await client.query('INSERT INTO _migrations (name) VALUES ($1)', [f]);
      await client.query('COMMIT');
      console.log('✅ Migration done:', f);
    }
  } catch (e: any) {
    await client.query('ROLLBACK');
    console.error('⚠️ Migration failed (non-fatal):', e.message);
  } finally {
    client.release();
  }
}
