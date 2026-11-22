import fs from 'fs';
import path from 'path';
import { pool, query } from './index';

export const runMigrationsUp = async (): Promise<void> => {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) PRIMARY KEY,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const executedRes = await query<{ name: string }>(`SELECT name FROM schema_migrations`);
  const executed = new Set(executedRes.rows.map((r) => r.name));

  const migrationsDir = path.resolve(__dirname, '../../migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
    .sort();

  for (const file of files) {
    if (!executed.has(file)) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [file]);
        await client.query('COMMIT');
        console.log(`✅ Applied migration: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }
  }
};

export const runMigrationsDown = async (): Promise<void> => {
  const migrationsDir = path.resolve(__dirname, '../../migrations');
  const downFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.down.sql'))
    .sort()
    .reverse();

  for (const file of downFiles) {
    const upName = file.replace('.down.sql', '.sql');
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(`DELETE FROM schema_migrations WHERE name = $1`, [upName]);
      await client.query('COMMIT');
      console.log(`⏪ Reverted migration: ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
};

if (require.main === module) {
  const action = process.argv[2];
  if (action === 'down') {
    runMigrationsDown().then(() => pool.end()).catch((e) => {
      console.error(e);
      process.exit(1);
    });
  } else {
    runMigrationsUp().then(() => pool.end()).catch((e) => {
      console.error(e);
      process.exit(1);
    });
  }
}
