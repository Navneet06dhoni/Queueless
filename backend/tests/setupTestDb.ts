import { Pool, QueryResult, QueryResultRow } from 'pg';
import { config } from '../src/config';
import { setPool } from '../src/db';
import { events } from '../src/events';
import { getDbNameFromUrl, assertTestDatabaseName } from './globalSetup';

export interface TestDbInstance {
  pool: Pool;
  cleanup: () => Promise<void>;
  resetData: () => Promise<void>;
  query: <T extends QueryResultRow = any>(text: string, params?: any[]) => Promise<QueryResult<T>>;
  db: {
    public: {
      none: (sql: string, params?: any[]) => Promise<void>;
      many: <T = any>(sql: string, params?: any[]) => Promise<T[]>;
      one: <T = any>(sql: string, params?: any[]) => Promise<T>;
    };
  };
}

export const setupTestDb = async (): Promise<TestDbInstance> => {
  const testDbUrl = config.TEST_DATABASE_URL;
  const dbName = getDbNameFromUrl(testDbUrl);

  // Safety check: REFUSE to run unless database name ends with _test
  assertTestDatabaseName(dbName);

  const testPool = new Pool({
    connectionString: testDbUrl,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  setPool(testPool);

  const resetData = async () => {
    // Wait for in-flight async events to complete before wiping tables
    await events.flush();

    await testPool.query(`
      TRUNCATE TABLE 
        admin_audit_log,
        notifications,
        queue_history,
        appointments,
        slots,
        working_hours,
        services,
        businesses,
        refresh_tokens,
        users
      RESTART IDENTITY CASCADE;
    `);
  };

  const cleanup = async () => {
    await events.flush();
    if (!(testPool as any).ending && !(testPool as any).ended) {
      await testPool.end();
    }
  };

  return {
    pool: testPool,
    cleanup,
    resetData,
    query: (text, params) => testPool.query(text, params) as any,
    db: {
      public: {
        none: async (sql, params) => {
          await testPool.query(sql, params);
        },
        many: async (sql, params) => {
          const res = await testPool.query(sql, params);
          return res.rows as any;
        },
        one: async (sql, params) => {
          const res = await testPool.query(sql, params);
          return res.rows[0] as any;
        },
      },
    },
  };
};
