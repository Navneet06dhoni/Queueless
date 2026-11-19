import fs from 'fs';
import path from 'path';
import { newDb } from 'pg-mem';

describe('Database Migration Schema Verification', () => {
  let db: ReturnType<typeof newDb>;

  beforeEach(() => {
    db = newDb();
    db.registerExtension('pgcrypto', () => {});
    db.public.registerFunction({
      name: 'gen_random_uuid',
      impure: true,
      implementation: () => crypto.randomUUID(),
    });
  });

  it('should successfully apply 001_initial_schema.sql and create all 8 core tables', () => {
    const migrationPath = path.join(__dirname, '../src/db/migrations/001_initial_schema.sql');
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    expect(() => db.public.none(sql)).not.toThrow();

    const expectedTables = [
      'users',
      'businesses',
      'services',
      'working_hours',
      'slots',
      'appointments',
      'queue_history',
      'notifications'
    ];

    for (const table of expectedTables) {
      const rows = db.public.many(`SELECT * FROM ${table}`);
      expect(rows).toEqual([]);
    }
  });

  it('should enforce unique constraint on users(email)', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/001_initial_schema.sql'), 'utf-8');
    db.public.none(sql);

    db.public.none(`
      INSERT INTO users (name, email, password_hash, role)
      VALUES ('Aarav Patel', 'aarav@example.com', 'hash1', 'customer');
    `);

    // Duplicate email insert must throw
    expect(() => {
      db.public.none(`
        INSERT INTO users (name, email, password_hash, role)
        VALUES ('Aarav Duplicate', 'aarav@example.com', 'hash2', 'customer');
      `);
    }).toThrow();
  });

  it('should enforce unique constraint on slots(service_id, start_time)', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/001_initial_schema.sql'), 'utf-8');
    db.public.none(sql);

    // Create user, business, service
    db.public.none(`
      INSERT INTO users (id, name, email, password_hash, role)
      VALUES ('11111111-1111-1111-1111-111111111111', 'Owner Dr. Rao', 'rao@clinic.in', 'hash', 'owner');
      
      INSERT INTO businesses (id, owner_id, name, category, address, city, phone)
      VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Rao Clinic', 'Clinic', '12 MG Road', 'Bengaluru', '+919876543210');

      INSERT INTO services (id, business_id, name, duration_minutes, price)
      VALUES ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'General Consultation', 30, 500);
    `);

    // Insert first slot
    db.public.none(`
      INSERT INTO slots (service_id, start_time, end_time, status)
      VALUES ('33333333-3333-3333-3333-333333333333', '2026-11-20 10:00:00+00', '2026-11-20 10:30:00+00', 'free');
    `);

    // Duplicate slot on same service_id and start_time must throw
    expect(() => {
      db.public.none(`
        INSERT INTO slots (service_id, start_time, end_time, status)
        VALUES ('33333333-3333-3333-3333-333333333333', '2026-11-20 10:00:00+00', '2026-11-20 10:30:00+00', 'free');
      `);
    }).toThrow();
  });

  it('should enforce unique constraint on appointments(slot_id)', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/001_initial_schema.sql'), 'utf-8');
    db.public.none(sql);

    db.public.none(`
      INSERT INTO users (id, name, email, password_hash, role)
      VALUES ('11111111-1111-1111-1111-111111111111', 'Owner Dr. Rao', 'rao@clinic.in', 'hash', 'owner'),
             ('44444444-4444-4444-4444-444444444444', 'Customer Priya', 'priya@example.com', 'hash', 'customer'),
             ('55555555-5555-5555-5555-555555555555', 'Customer Rohan', 'rohan@example.com', 'hash', 'customer');
      
      INSERT INTO businesses (id, owner_id, name, category, address, city, phone)
      VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Rao Clinic', 'Clinic', '12 MG Road', 'Bengaluru', '+919876543210');

      INSERT INTO services (id, business_id, name, duration_minutes, price)
      VALUES ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'Consultation', 30, 500);

      INSERT INTO slots (id, service_id, start_time, end_time, status)
      VALUES ('99999999-9999-9999-9999-999999999999', '33333333-3333-3333-3333-333333333333', '2026-11-20 10:00:00+00', '2026-11-20 10:30:00+00', 'booked');

      INSERT INTO appointments (slot_id, customer_id, status)
      VALUES ('99999999-9999-9999-9999-999999999999', '44444444-4444-4444-4444-444444444444', 'confirmed');
    `);

    // Duplicate appointment booking for same slot must throw
    expect(() => {
      db.public.none(`
        INSERT INTO appointments (slot_id, customer_id, status)
        VALUES ('99999999-9999-9999-9999-999999999999', '55555555-5555-5555-5555-555555555555', 'confirmed');
      `);
    }).toThrow();
  });

  it('should successfully apply 002_refresh_tokens.sql and rollback', () => {
    const up001 = fs.readFileSync(path.join(__dirname, '../src/db/migrations/001_initial_schema.sql'), 'utf-8');
    const up002 = fs.readFileSync(path.join(__dirname, '../src/db/migrations/002_refresh_tokens.sql'), 'utf-8');
    const down002 = fs.readFileSync(path.join(__dirname, '../src/db/migrations/002_refresh_tokens.down.sql'), 'utf-8');

    db.public.none(up001);
    expect(() => db.public.none(up002)).not.toThrow();

    const rows = db.public.many('SELECT * FROM refresh_tokens');
    expect(rows).toEqual([]);

    expect(() => db.public.none(down002)).not.toThrow();
  });

  it('should successfully rollback using 001_initial_schema.down.sql', () => {
    const upSql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/001_initial_schema.sql'), 'utf-8');
    const downSql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/001_initial_schema.down.sql'), 'utf-8');

    db.public.none(upSql);
    expect(() => db.public.none(downSql)).not.toThrow();
  });
});
