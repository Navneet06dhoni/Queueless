import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { config } from '../src/config';
import { setPool } from '../src/db';
import { runMigrationsUp } from '../src/db/migrator';

export function getDbNameFromUrl(connectionUrl: string): string {
  try {
    const parsed = new URL(connectionUrl);
    return parsed.pathname.replace(/^\//, '');
  } catch {
    const parts = connectionUrl.split('/');
    return parts[parts.length - 1].split('?')[0];
  }
}

export function assertTestDatabaseName(dbName: string): void {
  if (!dbName.endsWith('_test')) {
    throw new Error(
      `FATAL SAFETY VIOLATION: Refusing to run tests on non-test database "${dbName}". Database name MUST end with "_test" to prevent wiping development/production data!`
    );
  }
}

export default async function globalSetup(): Promise<void> {
  process.env.NODE_ENV = 'test';
  const testDbUrl = config.TEST_DATABASE_URL;
  const dbName = getDbNameFromUrl(testDbUrl);

  assertTestDatabaseName(dbName);

  // 1. Connect to the default 'postgres' database to ensure 'queueless_test' exists
  const adminUrl = testDbUrl.replace(/\/[^/?]+(\?.*)?$/, '/postgres$1');
  const adminPool = new Pool({ connectionString: adminUrl });

  try {
    const checkDbRes = await adminPool.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName]
    );

    if (checkDbRes.rowCount === 0) {
      console.log(`\n📦 Database "${dbName}" not found. Creating it...`);
      await adminPool.query(`CREATE DATABASE "${dbName}"`);
      console.log(`✅ Created test database "${dbName}".`);
    }
  } catch (err: any) {
    console.error('Error ensuring test database exists:', err.message);
    throw err;
  } finally {
    await adminPool.end();
  }

  // 2. Connect to the test database and run all migrations
  const testPool = new Pool({ connectionString: testDbUrl });
  setPool(testPool);

  try {
    await runMigrationsUp();
    console.log(`✨ All migrations successfully applied to "${dbName}".\n`);
  } catch (err: any) {
    console.error(`Error migrating test database "${dbName}":`, err.message);
    throw err;
  } finally {
    await testPool.end();
  }
}
