import { Pool, QueryResultRow } from 'pg';
import { config } from '../config';

const isTest = config.NODE_ENV === 'test';
export const connectionString = isTest ? config.TEST_DATABASE_URL : config.DATABASE_URL;

export function assertTestDatabaseName(name: string): void {
  if (!name.endsWith('_test')) {
    throw new Error(`CRITICAL SAFETY ERROR: Test database name must end with '_test', but got '${name}'`);
  }
}

if (isTest) {
  const urlParts = connectionString.split('/');
  const dbName = urlParts[urlParts.length - 1].split('?')[0];
  assertTestDatabaseName(dbName);
}

export const pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30000,
});

export const query = async <T extends QueryResultRow = any>(sql: string, params?: any[]) => {
  return pool.query<T>(sql, params);
};
