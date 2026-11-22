import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { config } from '../config';
import { logger } from '../utils/logger';

const getInitialPoolConfig = () => {
  const isTest = process.env.NODE_ENV === 'test' || config.NODE_ENV === 'test';
  if (isTest && config.TEST_DATABASE_URL) {
    return { connectionString: config.TEST_DATABASE_URL };
  }
  if (config.DATABASE_URL) {
    return { connectionString: config.DATABASE_URL };
  }
  return {
    host: config.DB_HOST,
    port: config.DB_PORT,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    database: isTest ? 'queueless_test' : config.DB_NAME,
    max: config.DB_POOL_MAX,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };
};

export let pool = new Pool(getInitialPoolConfig());

export const setPool = (newPool: any): void => {
  pool = newPool;
};

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected error on idle PostgreSQL client');
});

export const query = async <T extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> => {
  const start = Date.now();
  const res = await pool.query<T>(text, params);
  const duration = Date.now() - start;
  if (config.NODE_ENV === 'development') {
    // optional debug query logging
    // console.log('executed query', { text, duration, rows: res.rowCount });
  }
  return res;
};

/**
 * Execute work inside an isolated database transaction
 */
export const withTransaction = async <T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

export const getClient = async (): Promise<PoolClient> => {
  return await pool.connect();
};

export const closePool = async (): Promise<void> => {
  await pool.end();
};

export default {
  query,
  withTransaction,
  getClient,
  closePool,
  pool,
};
