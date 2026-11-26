import fs from 'fs';
import path from 'path';
import { pool, withTransaction } from './index';

const resolveMigrationsDir = (): string => {
  const localDir = path.join(__dirname, 'migrations');
  if (fs.existsSync(localDir)) return localDir;
  const srcDir = path.join(__dirname, '../../src/db/migrations');
  if (fs.existsSync(srcDir)) return srcDir;
  const cwdSrcDir = path.join(process.cwd(), 'src/db/migrations');
  if (fs.existsSync(cwdSrcDir)) return cwdSrcDir;
  const cwdBackendSrcDir = path.join(process.cwd(), 'backend/src/db/migrations');
  if (fs.existsSync(cwdBackendSrcDir)) return cwdBackendSrcDir;
  return localDir;
};

const MIGRATIONS_DIR = resolveMigrationsDir();

export const ensureMigrationsTable = async (): Promise<void> => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) PRIMARY KEY,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
};

export const runMigrationsUp = async (): Promise<void> => {
  console.log('🔄 Checking database migrations...');
  await ensureMigrationsTable();

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
    .sort();

  const executedRes = await pool.query(
    'SELECT name FROM schema_migrations'
  );
  const executedSet = new Set(executedRes.rows.map((r: any) => r.name as string));

  let appliedCount = 0;

  for (const file of files) {
    if (!executedSet.has(file)) {
      console.log(`➡️  Applying migration: ${file}`);
      const filePath = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(filePath, 'utf-8');

      await withTransaction(async (client) => {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      });

      console.log(`✅ Applied migration: ${file}`);
      appliedCount++;
    }
  }

  if (appliedCount === 0) {
    console.log('✨ All migrations are up to date.');
  } else {
    console.log(`🎉 Successfully applied ${appliedCount} migration(s).`);
  }
};

export const runMigrationsDown = async (): Promise<void> => {
  console.log('🔄 Checking rollback migrations...');
  await ensureMigrationsTable();

  const executedRes = await pool.query<{ name: string }>(
    'SELECT name FROM schema_migrations ORDER BY executed_at DESC, name DESC LIMIT 1'
  );

  if (executedRes.rows.length === 0) {
    console.log('ℹ️  No migrations to roll back.');
    return;
  }

  const lastMigration = executedRes.rows[0].name;
  const downFile = lastMigration.replace('.sql', '.down.sql');
  const downPath = path.join(MIGRATIONS_DIR, downFile);

  if (!fs.existsSync(downPath)) {
    throw new Error(`Rollback file ${downFile} not found for migration ${lastMigration}`);
  }

  console.log(`⬅️  Rolling back migration: ${lastMigration} (using ${downFile})`);
  const sql = fs.readFileSync(downPath, 'utf-8');

  await withTransaction(async (client) => {
    await client.query(sql);
    await client.query('DELETE FROM schema_migrations WHERE name = $1', [lastMigration]);
  });

  console.log(`✅ Successfully rolled back: ${lastMigration}`);
};

// If run directly from CLI
if (require.main === module) {
  const direction = process.argv[2] || 'up';
  const action = direction === 'down' ? runMigrationsDown : runMigrationsUp;

  action()
    .then(async () => {
      await pool.end();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('❌ Migration error:', err);
      await pool.end();
      process.exit(1);
    });
}
