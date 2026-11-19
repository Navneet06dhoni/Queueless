import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { config } from '../config';

export let pool = new Pool(
  config.DATABASE_URL
    ? { connectionString: config.DATABASE_URL }
    : {
        host: config.DB_HOST,
        port: config.DB_PORT,
        user: config.DB_USER,
        password: config.DB_PASSWORD,
        database: config.DB_NAME,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      }
);

export const setPool = (newPool: any): void => {
  pool = newPool;
};

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client:', err);
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
