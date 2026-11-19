import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { newDb, IMemoryDb } from 'pg-mem';
import { setPool } from '../src/db';

export interface TestDbInstance {
  db: IMemoryDb;
  pool: any;
  cleanup: () => Promise<void>;
  resetData: () => void;
}

export const setupTestDb = async (): Promise<TestDbInstance> => {
  const memDb = newDb();

  // Register extensions & functions
  memDb.registerExtension('pgcrypto', () => {});
  memDb.public.registerFunction({
    name: 'gen_random_uuid',
    impure: true,
    implementation: () => crypto.randomUUID(),
  });

  // Apply migrations 001 and 002
  const mig001 = fs.readFileSync(
    path.join(__dirname, '../src/db/migrations/001_initial_schema.sql'),
    'utf-8'
  );
  memDb.public.none(mig001);

  const mig002 = fs.readFileSync(
    path.join(__dirname, '../src/db/migrations/002_refresh_tokens.sql'),
    'utf-8'
  );
  memDb.public.none(mig002);

  const mig003 = fs.readFileSync(
    path.join(__dirname, '../src/db/migrations/003_business_search_indexes.sql'),
    'utf-8'
  );
  memDb.public.none(mig003);

  const mig004 = fs.readFileSync(
    path.join(__dirname, '../src/db/migrations/004_appointments_partial_unique_index.sql'),
    'utf-8'
  );
  memDb.public.none(mig004);

  const adapter = memDb.adapters.createPg();
  const testPool = new adapter.Pool();

  setPool(testPool);

  const resetData = () => {
    memDb.public.none('DELETE FROM refresh_tokens;');
    memDb.public.none('DELETE FROM notifications;');
    memDb.public.none('DELETE FROM queue_history;');
    memDb.public.none('DELETE FROM appointments;');
    memDb.public.none('DELETE FROM slots;');
    memDb.public.none('DELETE FROM working_hours;');
    memDb.public.none('DELETE FROM services;');
    memDb.public.none('DELETE FROM businesses;');
    memDb.public.none('DELETE FROM users;');
  };

  const cleanup = async () => {
    await testPool.end();
  };

  return {
    db: memDb,
    pool: testPool,
    cleanup,
    resetData,
  };
};
