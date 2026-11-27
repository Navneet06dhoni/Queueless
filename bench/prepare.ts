/**
 * Benchmark Seed & Preparation Tool (bench/prepare.ts)
 * 
 * NOTICE: This benchmark preparation tool reads the JWT signing secret directly from
 * .env in the local development environment to pre-sign tokens for 300 benchmark customers
 * and 1 owner. This tool is strictly for local benchmark harness preparation and is NEVER
 * used by the application in production or in CI test pipelines.
 */

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { Pool } from 'pg';
import Redis from 'ioredis';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { DateTime } from 'luxon';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const JWT_SECRET = process.env.JWT_ACCESS_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('❌ [FATAL] JWT_ACCESS_SECRET is missing or too short in .env');
  process.exit(1);
}

const pgUser = process.env.POSTGRES_USER || process.env.DB_USER || 'postgres';
const pgPassword = process.env.POSTGRES_PASSWORD || process.env.DB_PASSWORD || '';
const pgHost = process.env.DB_HOST === 'postgres' ? 'localhost' : (process.env.DB_HOST || 'localhost');
const pgPort = Number(process.env.DB_PORT) || 5432;
const redisHost = process.env.REDIS_HOST === 'redis' ? 'localhost' : (process.env.REDIS_HOST || 'localhost');
const redisPort = Number(process.env.REDIS_PORT) || 6379;

const corePool = new Pool({
  host: pgHost,
  port: pgPort,
  user: pgUser,
  password: pgPassword,
  database: process.env.POSTGRES_DB || 'queueless',
});

const queueDbPool = new Pool({
  host: pgHost,
  port: pgPort,
  user: pgUser,
  password: pgPassword,
  database: process.env.QUEUE_DB_NAME || 'queue_db',
});

const redis = new Redis({
  host: redisHost,
  port: redisPort,
  lazyConnect: true,
});

async function prepareBenchmark() {
  console.log('🚀 Preparing benchmark dataset (idempotent setup)...');

  try {
    await redis.connect();
  } catch (err: any) {
    console.warn('⚠️ Redis direct connect warning:', err.message);
  }

  const defaultPasswordHash = await bcrypt.hash('BenchPass123!', 8);

  // 1. Create or get Owner
  console.log('👤 [1/5] Ensuring benchmark owner user...');
  const ownerEmail = 'bench_owner@queueless.bench';
  const ownerRes = await corePool.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ('Benchmark Owner', $1, $2, 'owner')
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, name, email, role`,
    [ownerEmail, defaultPasswordHash]
  );
  const owner = ownerRes.rows[0];

  const ownerToken = jwt.sign(
    {
      sub: owner.id,
      userId: owner.id,
      name: owner.name,
      email: owner.email,
      role: owner.role,
    },
    JWT_SECRET,
    { expiresIn: '24h' }
  );

  // 2. Create or get 300 Customers
  console.log('👥 [2/5] Ensuring 300 benchmark customer users and pre-signing tokens...');
  const customersList: Array<{ id: string; name: string; email: string; token: string }> = [];

  // Batch insert in chunks of 50
  for (let batch = 0; batch < 6; batch++) {
    const values: any[] = [];
    const placeholders: string[] = [];
    for (let i = 1; i <= 50; i++) {
      const idx = batch * 50 + i;
      const cName = `Bench Customer ${idx}`;
      const cEmail = `bench_customer_${idx}@queueless.bench`;
      const pIdx = (i - 1) * 4;
      placeholders.push(`($${pIdx + 1}, $${pIdx + 2}, $${pIdx + 3}, $${pIdx + 4})`);
      values.push(cName, cEmail, defaultPasswordHash, 'customer');
    }

    await corePool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (email) DO NOTHING`,
      values
    );
  }

  // Retrieve all 300
  const allCustRes = await corePool.query(
    `SELECT id, name, email, role FROM users
     WHERE email LIKE 'bench_customer_%@queueless.bench'
     ORDER BY email ASC
     LIMIT 300`
  );

  for (const c of allCustRes.rows) {
    const token = jwt.sign(
      {
        sub: c.id,
        userId: c.id,
        name: c.name,
        email: c.email,
        role: c.role,
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    customersList.push({
      id: c.id,
      name: c.name,
      email: c.email,
      token,
    });
  }

  // 3. Create or get Approved Bench Business
  console.log('🏢 [3/5] Ensuring approved benchmark business with 24/7 working hours...');
  let bizRes = await corePool.query(`SELECT id FROM businesses WHERE name = 'Benchmark Clinic' LIMIT 1`);
  let bizId: string;

  if (bizRes.rows.length === 0) {
    const newBiz = await corePool.query(
      `INSERT INTO businesses (owner_id, name, category, address, city, phone, status, queue_open)
       VALUES ($1, 'Benchmark Clinic', 'clinic', '100 Benchmark Highway', 'Bengaluru', '+919999999999', 'approved', true)
       RETURNING id`,
      [owner.id]
    );
    bizId = newBiz.rows[0].id;
  } else {
    bizId = bizRes.rows[0].id;
    await corePool.query(
      `UPDATE businesses
       SET status = 'approved', queue_open = true, owner_id = $1
       WHERE id = $2`,
      [owner.id, bizId]
    );
  }

  // Ensure working hours for days 0..6 (00:00 to 23:59 IST)
  for (let day = 0; day <= 6; day++) {
    await corePool.query(
      `INSERT INTO working_hours (business_id, day_of_week, open_time, close_time)
       VALUES ($1, $2, '00:00', '23:59')
       ON CONFLICT (business_id, day_of_week) DO UPDATE
       SET open_time = '00:00', close_time = '23:59'`,
      [bizId, day]
    );
  }

  // Queue settings in core DB
  await corePool.query(
    `INSERT INTO queue_settings (business_id, queue_open)
     VALUES ($1, true)
     ON CONFLICT (business_id) DO UPDATE SET queue_open = true, updated_at = CURRENT_TIMESTAMP`,
    [bizId]
  );

  // Queue settings in queue_db (for microservices deployment)
  try {
    await queueDbPool.query(
      `INSERT INTO queue_settings (business_id, queue_open)
       VALUES ($1, true)
       ON CONFLICT (business_id) DO UPDATE SET queue_open = true, updated_at = CURRENT_TIMESTAMP`,
      [bizId]
    );
  } catch (err: any) {
    console.log('ℹ️ Notice: queue_db queue_settings skipped or unavailable (monolith mode).');
  }

  // Synchronize Redis queue state & clean queue
  try {
    await redis.sadd('businesses:active', bizId);
    await redis.set(`queue:${bizId}:settings:isOpen`, '1');
    await redis.set(`queue:${bizId}:open`, 'true');
    await redis.del(`queue:${bizId}:waiting`, `queue:${bizId}:nowServing`, `queue:${bizId}:counter`);
  } catch (err: any) {
    console.warn('⚠️ Redis/queue sync warning:', err.message);
  }

  // 4. Ensure Two Services
  console.log('🩺 [4/5] Ensuring two services and 600 slots for tomorrow...');
  const svc1Res = await corePool.query(
    `SELECT id, name FROM services WHERE business_id = $1 AND name = 'Express Consultation'`,
    [bizId]
  );
  let svc1Id: string;
  if (svc1Res.rows.length === 0) {
    const ins = await corePool.query(
      `INSERT INTO services (business_id, name, duration_minutes, price)
       VALUES ($1, 'Express Consultation', 15, 500)
       RETURNING id`,
      [bizId]
    );
    svc1Id = ins.rows[0].id;
  } else {
    svc1Id = svc1Res.rows[0].id;
  }

  const svc2Res = await corePool.query(
    `SELECT id, name FROM services WHERE business_id = $1 AND name = 'Comprehensive Review'`,
    [bizId]
  );
  let svc2Id: string;
  if (svc2Res.rows.length === 0) {
    const ins = await corePool.query(
      `INSERT INTO services (business_id, name, duration_minutes, price)
       VALUES ($1, 'Comprehensive Review', 15, 1000)
       RETURNING id`,
      [bizId]
    );
    svc2Id = ins.rows[0].id;
  } else {
    svc2Id = svc2Res.rows[0].id;
  }

  const services = [
    { id: svc1Id, name: 'Express Consultation' },
    { id: svc2Id, name: 'Comprehensive Review' },
  ];

  // 5. Generate 600 Free Slots for Tomorrow (300 per service)
  const tomorrowIST = DateTime.now().setZone('Asia/Kolkata').plus({ days: 1 }).startOf('day');

  // Clear existing future appointments & slots for these services to remain cleanly idempotent
  await corePool.query(
    `DELETE FROM appointments WHERE slot_id IN (SELECT id FROM slots WHERE service_id IN ($1, $2) AND start_time >= $3)`,
    [svc1Id, svc2Id, tomorrowIST.toISO()]
  );
  await corePool.query(
    `DELETE FROM slots WHERE service_id IN ($1, $2) AND start_time >= $3`,
    [svc1Id, svc2Id, tomorrowIST.toISO()]
  );

  const slotRecords: Array<{ id: string; serviceId: string; startTime: string; endTime: string }> = [];

  for (const svc of services) {
    const slotValues: any[] = [];
    const slotPlaceholders: string[] = [];

    // 300 slots per service (spaced every 2 minutes starting at 08:00 IST)
    for (let i = 0; i < 300; i++) {
      const start = tomorrowIST.plus({ hours: 8, minutes: i * 2 });
      const end = start.plus({ minutes: 15 });
      const pIdx = i * 4;
      slotPlaceholders.push(`($${pIdx + 1}, $${pIdx + 2}, $${pIdx + 3}, $${pIdx + 4})`);
      slotValues.push(svc.id, start.toISO(), end.toISO(), 'free');
    }

    const inserted = await corePool.query(
      `INSERT INTO slots (service_id, start_time, end_time, status)
       VALUES ${slotPlaceholders.join(', ')}
       RETURNING id, service_id, start_time, end_time`,
      slotValues
    );

    for (const r of inserted.rows) {
      slotRecords.push({
        id: r.id,
        serviceId: r.service_id,
        startTime: r.start_time,
        endTime: r.end_time,
      });
    }
  }

  // 6. Write to bench/tokens.json
  console.log('💾 [5/5] Writing tokens and test fixtures to bench/tokens.json...');
  const benchDir = path.resolve(__dirname);
  if (!fs.existsSync(benchDir)) {
    fs.mkdirSync(benchDir, { recursive: true });
  }

  const outputData = {
    businessId: bizId,
    businessName: 'Benchmark Clinic',
    owner: {
      id: owner.id,
      name: owner.name,
      email: owner.email,
      token: ownerToken,
    },
    services,
    slots: slotRecords,
    customers: customersList,
  };

  const tokensFilePath = path.resolve(benchDir, 'tokens.json');
  fs.writeFileSync(tokensFilePath, JSON.stringify(outputData, null, 2), { encoding: 'utf-8' });

  console.log(`✅ Benchmark preparation complete!`);
  console.log(`   - Business ID: ${bizId}`);
  console.log(`   - Owner: ${owner.email}`);
  console.log(`   - Customers: ${customersList.length} authenticated with 2-hour tokens`);
  console.log(`   - Free Slots for Tomorrow: ${slotRecords.length}`);
  console.log(`   - Output File: ${tokensFilePath}\n`);

  await corePool.end();
  await queueDbPool.end();
  await redis.quit();
}

if (require.main === module) {
  prepareBenchmark().catch((err) => {
    console.error('❌ Failed to prepare benchmark:', err);
    process.exit(1);
  });
}

export { prepareBenchmark };
