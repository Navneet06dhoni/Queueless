import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { DateTime } from 'luxon';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

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

export interface CleanStateCounts {
  appointmentsCount: number;
  queueHistoryCoreCount: number;
  queueHistoryServiceCount: number;
  slotsCount: number;
  redisQueueKeysCount: number;
}

export async function cleanResetState(): Promise<CleanStateCounts> {
  try {
    await redis.connect();
  } catch {
    // Already connected or transient
  }

  // 1. Delete all appointments
  await corePool.query('DELETE FROM appointments');

  // 2. Delete all queue entries in core and queue_db
  await corePool.query('DELETE FROM queue_history');
  try {
    await queueDbPool.query('DELETE FROM queue_history');
  } catch {
    // queue_db might not exist in monolith mode
  }

  // 3. Reset queue_settings in core
  await corePool.query(
    `UPDATE queue_settings
     SET queue_open = true`
  );
  try {
    await queueDbPool.query(
      `UPDATE queue_settings
       SET queue_open = true`
    );
  } catch {}

  // 4. Flush Redis queue keys
  try {
    const keys = await redis.keys('queue:*');
    const posKeys = await redis.keys('position:*');
    const allKeys = [...keys, ...posKeys];
    if (allKeys.length > 0) {
      await redis.del(...allKeys);
    }
  } catch {
    // Redis might be empty
  }

  // 5. Ensure benchmark business and services exist, then regenerate 600 slots
  const bizRes = await corePool.query(
    "SELECT id FROM businesses WHERE name = 'Benchmark Clinic' LIMIT 1"
  );
  if (bizRes.rows.length === 0) {
    throw new Error('Benchmark business not found. Run bench/prepare.ts first.');
  }
  const businessId = bizRes.rows[0].id;

  // Restore active business and open queue keys in Redis
  try {
    await redis.sadd('businesses:active', businessId);
    await redis.set(`queue:${businessId}:settings:isOpen`, '1');
    await redis.set(`queue:${businessId}:open`, 'true');
    await redis.del(
      `queue:${businessId}:waiting`,
      `queue:${businessId}:nowServing`,
      `queue:${businessId}:counter`
    );
  } catch {}

  const srvRes = await corePool.query(
    'SELECT id, name, duration_minutes FROM services WHERE business_id = $1 ORDER BY name ASC',
    [businessId]
  );
  if (srvRes.rows.length < 2) {
    throw new Error('Benchmark services not found. Run bench/prepare.ts first.');
  }
  const services = srvRes.rows;

  // Clear existing slots for these services
  const srvIds = services.map((s: any) => s.id);
  await corePool.query('DELETE FROM slots WHERE service_id = ANY($1)', [srvIds]);

  // Generate 600 slots for tomorrow (300 per service)
  const tomorrow = DateTime.now().setZone('Asia/Kolkata').plus({ days: 1 }).startOf('day');
  const freshSlots: Array<{ id: string; serviceId: string; startTime: string; endTime: string }> = [];

  for (const srv of services) {
    let currentSlotTime = tomorrow.set({ hour: 0, minute: 0 });
    const slotValues: any[] = [];
    const placeholders: string[] = [];

    for (let i = 0; i < 300; i++) {
      const startTime = currentSlotTime.toISO()!;
      const endTime = currentSlotTime.plus({ minutes: 2 }).toISO()!;
      currentSlotTime = currentSlotTime.plus({ minutes: 2 });

      const pIdx = i * 4;
      placeholders.push(`($${pIdx + 1}, $${pIdx + 2}, $${pIdx + 3}, $${pIdx + 4})`);
      slotValues.push(srv.id, startTime, endTime, 'free');
    }

    const insertedSlots = await corePool.query(
      `INSERT INTO slots (service_id, start_time, end_time, status)
       VALUES ${placeholders.join(', ')}
       RETURNING id, service_id, start_time, end_time`,
      slotValues
    );

    for (const r of insertedSlots.rows) {
      freshSlots.push({
        id: r.id,
        serviceId: r.service_id,
        startTime: r.start_time,
        endTime: r.end_time,
      });
    }
  }

  // Update tokens.json with the regenerated slots
  const tokensPath = path.resolve(__dirname, 'tokens.json');
  if (fs.existsSync(tokensPath)) {
    const tokensData = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
    tokensData.slots = freshSlots;
    fs.writeFileSync(tokensPath, JSON.stringify(tokensData, null, 2));
  }

  // Query row counts
  const apptCountRes = await corePool.query('SELECT COUNT(*) AS c FROM appointments');
  const queueHistoryCoreRes = await corePool.query('SELECT COUNT(*) AS c FROM queue_history');
  let queueHistoryServiceCount = 0;
  try {
    const qeRes = await queueDbPool.query('SELECT COUNT(*) AS c FROM queue_history');
    queueHistoryServiceCount = Number(qeRes.rows[0].c);
  } catch {
    queueHistoryServiceCount = 0;
  }
  const slotsCountRes = await corePool.query('SELECT COUNT(*) AS c FROM slots WHERE service_id = ANY($1)', [srvIds]);

  let redisQueueKeysCount = 0;
  try {
    const keys = await redis.keys('queue:*');
    redisQueueKeysCount = keys.length;
  } catch {
    redisQueueKeysCount = 0;
  }

  return {
    appointmentsCount: Number(apptCountRes.rows[0].c),
    queueHistoryCoreCount: Number(queueHistoryCoreRes.rows[0].c),
    queueHistoryServiceCount,
    slotsCount: Number(slotsCountRes.rows[0].c),
    redisQueueKeysCount,
  };
}

if (require.main === module) {
  cleanResetState()
    .then((counts) => {
      console.log('✅ Clean State Reset Complete:');
      console.log(`   - Appointments: ${counts.appointmentsCount}`);
      console.log(`   - Queue History (Core): ${counts.queueHistoryCoreCount}`);
      console.log(`   - Queue History (Service): ${counts.queueHistoryServiceCount}`);
      console.log(`   - Slots Available: ${counts.slotsCount}`);
      console.log(`   - Redis Queue Keys: ${counts.redisQueueKeysCount}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Clean state reset failed:', err);
      process.exit(1);
    });
}
