// =============================================================================
// Migrate Script - StreamServer
// =============================================================================

require('../utils/loadEnv').loadEnv();

const fs = require('fs');
const path = require('path');
const { query, pool } = require('./connection');
const logger = require('../utils/logger');

function resolveMigrationsDir() {
  const candidates = [
    // Docker image: COPY infrastructure/postgres/migrations → /app/migrations
    path.join(__dirname, '../../migrations'),
    // Local/dev: repo root infrastructure/postgres/migrations
    path.join(__dirname, '../../../infrastructure/postgres/migrations')
  ];
  return candidates.find((dir) => fs.existsSync(dir)) || null;
}

async function runMigrations() {
  const migrationsDir = resolveMigrationsDir();
  if (!migrationsDir) {
    logger.warn('No migrations directory found — skipping');
    return;
  }

  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const applied = await query(
      'SELECT 1 FROM schema_migrations WHERE filename = $1',
      [file]
    );
    if (applied.rows.length > 0) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    logger.info(`Applying migration: ${file}`);
    await query(sql);
    await query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
    logger.info(`✅ Migration applied: ${file}`);
  }
}

async function main() {
  try {
    await query('SELECT 1');
    logger.info('✅ Database reachable');
    await runMigrations();
    logger.info('✅ Migrations complete');
  } catch (err) {
    logger.error('❌ Migration failed:', err);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
}

main();
