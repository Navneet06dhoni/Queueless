import fs from 'fs';
import path from 'path';
import { Pool, PoolClient } from 'pg';
import { config } from '../src/config';
import { getDbNameFromUrl, assertTestDatabaseName } from './globalSetup';

describe('Database Migration Schema Verification (Real PostgreSQL)', () => {
  let pool: Pool;
  let client: PoolClient;

  beforeAll(async () => {
    const testDbUrl = config.TEST_DATABASE_URL;
    const dbName = getDbNameFromUrl(testDbUrl);
    assertTestDatabaseName(dbName);

    pool = new Pool({ connectionString: testDbUrl });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    client = await pool.connect();
    await client.query('DROP SCHEMA IF EXISTS schema_test CASCADE;');
    await client.query('CREATE SCHEMA schema_test;');
    await client.query('SET search_path TO schema_test, public;');
  });

  afterEach(async () => {
    try {
      await client.query('DROP SCHEMA IF EXISTS schema_test CASCADE;');
    } finally {
      client.release();
    }
  });

  it('should successfully apply 001_initial_schema.sql and create all 8 core tables', async () => {
    const migrationPath = path.join(__dirname, '../src/db/migrations/001_initial_schema.sql');
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    await client.query(sql);

    const expectedTables = [
      'users',
      'businesses',
      'services',
      'working_hours',
      'slots',
      'appointments',
      'queue_history',
      'notifications',
    ];

    for (const table of expectedTables) {
      const res = await client.query(`SELECT * FROM ${table}`);
      expect(res.rows).toEqual([]);
    }
  });

  it('should enforce unique constraint on users(email)', async () => {
    const sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/001_initial_schema.sql'), 'utf-8');
    await client.query(sql);

    await client.query(`
      INSERT INTO users (name, email, password_hash, role)
      VALUES ('Aarav Patel', 'aarav@example.com', 'hash1', 'customer');
    `);

    // Duplicate email insert must throw
    await expect(
      client.query(`
        INSERT INTO users (name, email, password_hash, role)
        VALUES ('Aarav Duplicate', 'aarav@example.com', 'hash2', 'customer');
      `)
    ).rejects.toThrow();
  });

  it('should enforce unique constraint on slots(service_id, start_time)', async () => {
    const sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/001_initial_schema.sql'), 'utf-8');
    await client.query(sql);

    await client.query(`
      INSERT INTO users (id, name, email, password_hash, role)
      VALUES ('11111111-1111-1111-1111-111111111111', 'Owner Dr. Rao', 'rao@clinic.in', 'hash', 'owner');
      
      INSERT INTO businesses (id, owner_id, name, category, address, city, phone)
      VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Rao Clinic', 'clinic', '12 MG Road', 'Bengaluru', '+919876543210');

      INSERT INTO services (id, business_id, name, duration_minutes, price)
      VALUES ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'General Consultation', 30, 500);
    `);

    // Insert first slot
    await client.query(`
      INSERT INTO slots (service_id, start_time, end_time, status)
      VALUES ('33333333-3333-3333-3333-333333333333', '2026-11-20 10:00:00+00', '2026-11-20 10:30:00+00', 'free');
    `);

    // Duplicate slot on same service_id and start_time must throw
    await expect(
      client.query(`
        INSERT INTO slots (service_id, start_time, end_time, status)
        VALUES ('33333333-3333-3333-3333-333333333333', '2026-11-20 10:00:00+00', '2026-11-20 10:30:00+00', 'free');
      `)
    ).rejects.toThrow();
  });

  it('should enforce partial unique index on appointments(slot_id) allowing rebooking after cancellation', async () => {
    const up001 = fs.readFileSync(path.join(__dirname, '../src/db/migrations/001_initial_schema.sql'), 'utf-8');
    const up004 = fs.readFileSync(path.join(__dirname, '../src/db/migrations/004_appointments_partial_unique_index.sql'), 'utf-8');
    await client.query(up001);
    await client.query(up004);

    await client.query(`
      INSERT INTO users (id, name, email, password_hash, role)
      VALUES ('11111111-1111-1111-1111-111111111111', 'Owner Dr. Rao', 'rao@clinic.in', 'hash', 'owner'),
             ('44444444-4444-4444-4444-444444444444', 'Customer Priya', 'priya@example.com', 'hash', 'customer'),
             ('55555555-5555-5555-5555-555555555555', 'Customer Rohan', 'rohan@example.com', 'hash', 'customer');
      
      INSERT INTO businesses (id, owner_id, name, category, address, city, phone)
      VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Rao Clinic', 'clinic', '12 MG Road', 'Bengaluru', '+919876543210');

      INSERT INTO services (id, business_id, name, duration_minutes, price)
      VALUES ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'Consultation', 30, 500);

      INSERT INTO slots (id, service_id, start_time, end_time, status)
      VALUES ('99999999-9999-9999-9999-999999999999', '33333333-3333-3333-3333-333333333333', '2026-11-20 10:00:00+00', '2026-11-20 10:30:00+00', 'booked');

      -- First confirmed booking
      INSERT INTO appointments (id, slot_id, customer_id, status)
      VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '99999999-9999-9999-9999-999999999999', '44444444-4444-4444-4444-444444444444', 'confirmed');
    `);

    // Duplicate active booking for the same slot must throw
    await expect(
      client.query(`
        INSERT INTO appointments (id, slot_id, customer_id, status)
        VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '99999999-9999-9999-9999-999999999999', '55555555-5555-5555-5555-555555555555', 'confirmed');
      `)
    ).rejects.toThrow();

    // Cancel the first appointment
    await client.query(`
      UPDATE appointments 
      SET status = 'cancelled' 
      WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    `);

    // Now rebooking the same slot for customer 2 must succeed!
    const rebookRes = await client.query(`
      INSERT INTO appointments (id, slot_id, customer_id, status)
      VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '99999999-9999-9999-9999-999999999999', '55555555-5555-5555-5555-555555555555', 'confirmed')
      RETURNING id;
    `);
    expect(rebookRes.rowCount).toBe(1);
  });

  it('should successfully apply 002_refresh_tokens.sql and rollback', async () => {
    const up001 = fs.readFileSync(path.join(__dirname, '../src/db/migrations/001_initial_schema.sql'), 'utf-8');
    const up002 = fs.readFileSync(path.join(__dirname, '../src/db/migrations/002_refresh_tokens.sql'), 'utf-8');
    const down002 = fs.readFileSync(path.join(__dirname, '../src/db/migrations/002_refresh_tokens.down.sql'), 'utf-8');

    await client.query(up001);
    await client.query(up002);

    const rows = await client.query('SELECT * FROM refresh_tokens');
    expect(rows.rows).toEqual([]);

    await client.query(down002);
  });

  it('should successfully apply 003_business_search_indexes.sql and rollback', async () => {
    const up001 = fs.readFileSync(path.join(__dirname, '../src/db/migrations/001_initial_schema.sql'), 'utf-8');
    const up002 = fs.readFileSync(path.join(__dirname, '../src/db/migrations/002_refresh_tokens.sql'), 'utf-8');
    const up003 = fs.readFileSync(path.join(__dirname, '../src/db/migrations/003_business_search_indexes.sql'), 'utf-8');
    const down003 = fs.readFileSync(path.join(__dirname, '../src/db/migrations/003_business_search_indexes.down.sql'), 'utf-8');

    await client.query(up001);
    await client.query(up002);
    await client.query(up003);
    await client.query(down003);
  });

  it('should successfully apply 004_appointments_partial_unique_index.sql and rollback', async () => {
    const up001 = fs.readFileSync(path.join(__dirname, '../src/db/migrations/001_initial_schema.sql'), 'utf-8');
    const up004 = fs.readFileSync(path.join(__dirname, '../src/db/migrations/004_appointments_partial_unique_index.sql'), 'utf-8');
    const down004 = fs.readFileSync(path.join(__dirname, '../src/db/migrations/004_appointments_partial_unique_index.down.sql'), 'utf-8');

    await client.query(up001);
    await client.query(up004);
    await client.query(down004);
  });

  it('should successfully apply 005_queue_system.sql and rollback', async () => {
    const up001 = fs.readFileSync(path.join(__dirname, '../src/db/migrations/001_initial_schema.sql'), 'utf-8');
    const up005 = fs.readFileSync(path.join(__dirname, '../src/db/migrations/005_queue_system.sql'), 'utf-8');
    const down005 = fs.readFileSync(path.join(__dirname, '../src/db/migrations/005_queue_system.down.sql'), 'utf-8');

    await client.query(up001);
    await client.query(up005);

    // Verify queue_open on businesses and new columns on queue_history
    const bizColumns = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'businesses' AND column_name = 'queue_open' AND table_schema = 'schema_test'
    `);
    expect(bizColumns.rows.length).toBe(1);

    await client.query(down005);
  });

  it('should successfully apply 006_notifications_system.sql and rollback', async () => {
    const up001 = fs.readFileSync(path.join(__dirname, '../src/db/migrations/001_initial_schema.sql'), 'utf-8');
    const up006 = fs.readFileSync(path.join(__dirname, '../src/db/migrations/006_notifications_system.sql'), 'utf-8');
    const down006 = fs.readFileSync(path.join(__dirname, '../src/db/migrations/006_notifications_system.down.sql'), 'utf-8');

    await client.query(up001);
    await client.query(up006);

    const notifColumns = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'notifications' AND column_name = 'dedupe_key' AND table_schema = 'schema_test'
    `);
    expect(notifColumns.rows.length).toBe(1);

    await client.query(down006);
  });

  it('should successfully apply 007_analytics_and_admin.sql and rollback', async () => {
    const up001 = fs.readFileSync(path.join(__dirname, '../src/db/migrations/001_initial_schema.sql'), 'utf-8');
    const up007 = fs.readFileSync(path.join(__dirname, '../src/db/migrations/007_analytics_and_admin.sql'), 'utf-8');
    const down007 = fs.readFileSync(path.join(__dirname, '../src/db/migrations/007_analytics_and_admin.down.sql'), 'utf-8');

    await client.query(up001);
    await client.query(up007);

    const auditRes = await client.query(`SELECT id, admin_id, action FROM admin_audit_log`);
    expect(auditRes.rows).toEqual([]);

    const userBlockedCol = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'is_blocked' AND table_schema = 'schema_test'
    `);
    expect(userBlockedCol.rows.length).toBe(1);

    await client.query(down007);
  });

  it('should successfully rollback using 001_initial_schema.down.sql', async () => {
    const upSql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/001_initial_schema.sql'), 'utf-8');
    const downSql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/001_initial_schema.down.sql'), 'utf-8');

    await client.query(upSql);
    await client.query(downSql);
  });
});
