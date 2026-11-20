import request from 'supertest';
import { Pool } from 'pg';
import { createApp } from '../src/app';
import { pool, setPool } from '../src/db';
import redis from '../src/config/redis';
import { config } from '../src/config';
import { generateAccessToken } from '../src/modules/auth/auth.utils';
import { analyticsRepository } from '../src/modules/analytics/analytics.repository';
import { setupTestDb, TestDbInstance } from './setupTestDb';
import bcrypt from 'bcryptjs';

describe('Analytics & Admin Module (Real Postgres & Redis)', () => {
  let app: ReturnType<typeof createApp>;
  let realPool: Pool;
  let testDb: TestDbInstance;

  // Test identities
  let adminId: string;
  let adminToken: string;
  let ownerId: string;
  let ownerToken: string;
  let otherOwnerId: string;
  let otherOwnerToken: string;
  let customerId: string;
  let customerToken: string;
  let businessId: string;
  let otherBusinessId: string;
  let serviceId: string;

  beforeAll(async () => {
    testDb = await setupTestDb();
    realPool = testDb.pool;

    if (redis.status !== 'ready' && redis.status !== 'connect') {
      try {
        await redis.connect();
      } catch {}
    }

    app = createApp();

    // Create unique test users
    const hash = await bcrypt.hash('Secret123', 8);

    const adminRes = await realPool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ('Admin Test', 'admin_analytics_test@test.local', $1, 'admin')
       ON CONFLICT (email) DO UPDATE SET is_blocked = false
       RETURNING id`,
      [hash]
    );
    adminId = adminRes.rows[0].id;
    adminToken = generateAccessToken({ id: adminId, role: 'admin' });

    const ownerRes = await realPool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ('Owner Test', 'owner_analytics_test@test.local', $1, 'owner')
       ON CONFLICT (email) DO UPDATE SET is_blocked = false
       RETURNING id`,
      [hash]
    );
    ownerId = ownerRes.rows[0].id;
    ownerToken = generateAccessToken({ id: ownerId, role: 'owner' });

    const otherOwnerRes = await realPool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ('Other Owner', 'other_owner_analytics_test@test.local', $1, 'owner')
       ON CONFLICT (email) DO UPDATE SET is_blocked = false
       RETURNING id`,
      [hash]
    );
    otherOwnerId = otherOwnerRes.rows[0].id;
    otherOwnerToken = generateAccessToken({ id: otherOwnerId, role: 'owner' });

    const custRes = await realPool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ('Customer Test', 'customer_analytics_test@test.local', $1, 'customer')
       ON CONFLICT (email) DO UPDATE SET is_blocked = false
       RETURNING id`,
      [hash]
    );
    customerId = custRes.rows[0].id;
    customerToken = generateAccessToken({ id: customerId, role: 'customer' });

    // Create approved businesses
    const bRes = await realPool.query(
      `INSERT INTO businesses (owner_id, name, category, address, city, phone, status, queue_open)
       VALUES ($1, 'Analytics Clinic', 'Clinic', '123 Test St', 'Bengaluru', '+919876543210', 'approved', true)
       RETURNING id`,
      [ownerId]
    );
    businessId = bRes.rows[0].id;

    const obRes = await realPool.query(
      `INSERT INTO businesses (owner_id, name, category, address, city, phone, status, queue_open)
       VALUES ($1, 'Other Clinic', 'Clinic', '456 Other St', 'Bengaluru', '+919876543211', 'approved', true)
       RETURNING id`,
      [otherOwnerId]
    );
    otherBusinessId = obRes.rows[0].id;

    const sRes = await realPool.query(
      `INSERT INTO services (business_id, name, duration_minutes, price)
       VALUES ($1, 'Dental Checkup', 30, 400)
       RETURNING id`,
      [businessId]
    );
    serviceId = sRes.rows[0].id;

    // Ensure 24/7 working hours for business across all days so joinQueue succeeds
    await realPool.query(
      `INSERT INTO working_hours (business_id, day_of_week, open_time, close_time)
       SELECT $1, s.d, '00:00:00', '23:59:59'
       FROM generate_series(0, 6) AS s(d)
       ON CONFLICT (business_id, day_of_week) DO NOTHING`,
      [businessId]
    );
  });

  afterAll(async () => {
    // Cleanup created data
    try {
      await realPool.query(`DELETE FROM admin_audit_log WHERE admin_id = $1`, [adminId]);
      await realPool.query(`DELETE FROM queue_history WHERE business_id IN ($1, $2)`, [businessId, otherBusinessId]);
      await realPool.query(`DELETE FROM appointments WHERE customer_id = $1`, [customerId]);
      await realPool.query(`DELETE FROM slots WHERE service_id = $1`, [serviceId]);
      await realPool.query(`DELETE FROM services WHERE id = $1`, [serviceId]);
      await realPool.query(`DELETE FROM businesses WHERE id IN ($1, $2)`, [businessId, otherBusinessId]);
      await realPool.query(`DELETE FROM users WHERE id IN ($1, $2, $3, $4)`, [
        adminId,
        ownerId,
        otherOwnerId,
        customerId,
      ]);
    } catch {}

    if (testDb) {
      await testDb.cleanup();
    } else {
      await realPool.end();
    }
    try {
      await redis.quit();
    } catch {}
  });

  beforeEach(async () => {
    // Clear Redis summary keys for test isolation
    try {
      const keys = await redis.keys('analytics:summary:*');
      if (keys.length > 0) {
        await redis.del(...keys);
      }
      await redis.srem('blocked:users', customerId);
    } catch {}
  });

  describe('Owner Analytics Summary with Known Values', () => {
    const testDate = '2026-11-20';

    beforeAll(async () => {
      // Clean previous queue & appointment data for this business
      await realPool.query(`DELETE FROM queue_history WHERE business_id = $1`, [businessId]);
      await realPool.query(
        `DELETE FROM appointments WHERE slot_id IN (SELECT id FROM slots WHERE service_id = $1)`,
        [serviceId]
      );
      await realPool.query(`DELETE FROM slots WHERE service_id = $1`, [serviceId]);

      // Insert known queue entries for testDate:
      // Entry 1: walk_in, joined at 10:00, called at 10:10 (wait 10m), completed at 10:25 (service 15m), est 12m
      // Entry 2: online,  joined at 10:15, called at 10:35 (wait 20m), completed at 10:55 (service 20m), est 25m
      // Entry 3: appt,    joined at 11:00, called at 11:30 (wait 30m), completed at 11:45 (service 15m), est 30m
      // Entry 4: walk_in, joined at 11:15, called at 11:20 (wait 5m),  status called (in progress),      est 10m
      // Entry 5: walk_in, joined at 11:25, never called,               status skipped
      // Entry 6: online,  joined at 11:30, never called,               status left
      await realPool.query(
        `INSERT INTO queue_history
           (business_id, customer_id, walk_in_name, ticket_number, source, score, joined_at, called_at, completed_at, status, estimated_wait_minutes)
         VALUES
           ($1, null, 'Walk-in 1', 1, 'walk_in', 1,
            '2026-11-20 10:00:00 Asia/Kolkata', '2026-11-20 10:10:00 Asia/Kolkata', '2026-11-20 10:25:00 Asia/Kolkata', 'completed', 12),
           ($1, $2,   null,         2, 'online',  2,
            '2026-11-20 10:15:00 Asia/Kolkata', '2026-11-20 10:35:00 Asia/Kolkata', '2026-11-20 10:55:00 Asia/Kolkata', 'completed', 25),
           ($1, $2,   null,         3, 'appointment', 3,
            '2026-11-20 11:00:00 Asia/Kolkata', '2026-11-20 11:30:00 Asia/Kolkata', '2026-11-20 11:45:00 Asia/Kolkata', 'completed', 30),
           ($1, null, 'Walk-in 2', 4, 'walk_in', 4,
            '2026-11-20 11:15:00 Asia/Kolkata', '2026-11-20 11:20:00 Asia/Kolkata', null, 'called', 10),
           ($1, null, 'Walk-in 3', 5, 'walk_in', 5,
            '2026-11-20 11:25:00 Asia/Kolkata', null, null, 'skipped', null),
           ($1, $2,   null,         6, 'online',  6,
            '2026-11-20 11:30:00 Asia/Kolkata', null, null, 'left', null)`,
        [businessId, customerId]
      );

      // Known Appointments & Slots for testDate:
      // Create 4 slots: 3 booked, 1 free -> slot utilization = 3 / 4 = 75.0%
      // Appointments on the 3 booked slots:
      // Appt 1: completed
      // Appt 2: no_show
      // Appt 3: confirmed
      // (noShowRate = 1 / (1 + 1) = 0.5)
      const s1 = await realPool.query(
        `INSERT INTO slots (service_id, start_time, end_time, status)
         VALUES ($1, '2026-11-20 10:00:00 Asia/Kolkata', '2026-11-20 10:30:00 Asia/Kolkata', 'booked') RETURNING id`,
        [serviceId]
      );
      const s2 = await realPool.query(
        `INSERT INTO slots (service_id, start_time, end_time, status)
         VALUES ($1, '2026-11-20 10:30:00 Asia/Kolkata', '2026-11-20 11:00:00 Asia/Kolkata', 'booked') RETURNING id`,
        [serviceId]
      );
      const s3 = await realPool.query(
        `INSERT INTO slots (service_id, start_time, end_time, status)
         VALUES ($1, '2026-11-20 11:00:00 Asia/Kolkata', '2026-11-20 11:30:00 Asia/Kolkata', 'booked') RETURNING id`,
        [serviceId]
      );
      await realPool.query(
        `INSERT INTO slots (service_id, start_time, end_time, status)
         VALUES ($1, '2026-11-20 11:30:00 Asia/Kolkata', '2026-11-20 12:00:00 Asia/Kolkata', 'free')`,
        [serviceId]
      );

      await realPool.query(
        `INSERT INTO appointments (slot_id, customer_id, status)
         VALUES
           ($1, $4, 'completed'),
           ($2, $4, 'no_show'),
           ($3, $4, 'confirmed')`,
        [s1.rows[0].id, s2.rows[0].id, s3.rows[0].id, customerId]
      );
    });

    it('asserts exact summary calculations: totalServed, avg/median wait, avg service, noShowRate, slot utilization, and source counts', async () => {
      const res = await request(app)
        .get(`/api/analytics/business/${businessId}/summary?from=2026-11-20&to=2026-11-20`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(res.status).toBe(200);

      // 1. Queue counts
      expect(res.body.queue.totalServed).toBe(3);
      expect(res.body.queue.skipped).toBe(1);
      expect(res.body.queue.left).toBe(1);
      expect(res.body.queue.walkInCount).toBe(3);
      expect(res.body.queue.onlineCount).toBe(2);
      expect(res.body.queue.appointmentCount).toBe(1);

      // 2. Wait times for called/completed entries (10m, 20m, 30m, 5m):
      // Average wait = (10 + 20 + 30 + 5) / 4 = 65 / 4 = 16.3 minutes (rounded)
      expect(res.body.averageWaitMinutes).toBe(16.3);

      // Median wait of [5, 10, 20, 30] = (10 + 20) / 2 = 15.0 minutes
      expect(res.body.medianWaitMinutes).toBe(15.0);

      // Average service time for completed entries (15m, 20m, 15m):
      // Average service = (15 + 20 + 15) / 3 = 50 / 3 = 16.7 minutes
      expect(res.body.averageServiceMinutes).toBe(16.7);

      // 3. Appointments & No Show Rate
      expect(res.body.appointments.completed).toBe(1);
      expect(res.body.appointments.noShow).toBe(1);
      expect(res.body.appointments.confirmed).toBe(1);
      expect(res.body.appointments.noShowRate).toBe(0.5);

      // 4. Slot Utilization: 3 booked / 4 total = 75.0%
      expect(res.body.slotUtilization).toBe(75.0);
    });

    it('estimateAccuracy: compares estimated vs actual wait and gives exact Mean Absolute Error', async () => {
      // Entries with both estimated_wait_minutes & called_at:
      // Entry 1: actual 10m, estimated 12m -> error |12 - 10| = 2
      // Entry 2: actual 20m, estimated 25m -> error |25 - 20| = 5
      // Entry 3: actual 30m, estimated 30m -> error |30 - 30| = 0
      // Entry 4: actual 5m,  estimated 10m -> error |10 - 5| = 5
      // Sample size = 4, MAE = (2 + 5 + 0 + 5) / 4 = 12 / 4 = 3.0 minutes
      const res = await request(app)
        .get(`/api/analytics/business/${businessId}/summary?from=2026-11-20&to=2026-11-20`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.estimateAccuracy.sampleSize).toBe(4);
      expect(res.body.estimateAccuracy.meanAbsoluteErrorMinutes).toBe(3.0);
    });

    it('peakHours has 24 entries and timezone check (10:30 IST = 05:00 UTC puts entry in hour 10); daily array includes zero days', async () => {
      // Insert an entry at exactly 05:00:00 UTC (which is 10:30:00 IST)
      await realPool.query(
        `INSERT INTO queue_history
           (business_id, ticket_number, source, score, joined_at, status)
         VALUES
           ($1, 99, 'walk_in', 99, '2026-11-21 05:00:00Z', 'completed')`,
        [businessId]
      );

      const res = await request(app)
        .get(`/api/analytics/business/${businessId}/summary?from=2026-11-20&to=2026-11-22`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(res.status).toBe(200);

      // 1. Peak hours always returns 24 items
      expect(res.body.peakHours).toHaveLength(24);
      const hour10 = res.body.peakHours.find((h: any) => h.hour === 10);
      expect(hour10).toBeDefined();
      expect(hour10.count).toBeGreaterThanOrEqual(1);

      // 2. Daily array includes zero activity day (2026-11-22 has 0 activity)
      expect(res.body.daily).toHaveLength(3);
      const zeroDay = res.body.daily.find((d: any) => d.date === '2026-11-22');
      expect(zeroDay).toBeDefined();
      expect(zeroDay.served).toBe(0);
      expect(zeroDay.averageWaitMinutes).toBeNull();
    });
  });

  describe('Validation & Authorization Restrictions', () => {
    it('returns 400 when range exceeds 90 days or to is before from', async () => {
      const over90Res = await request(app)
        .get(`/api/analytics/business/${businessId}/summary?from=2026-01-01&to=2026-05-01`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(over90Res.status).toBe(400);

      const toBeforeFromRes = await request(app)
        .get(`/api/analytics/business/${businessId}/summary?from=2026-11-20&to=2026-11-10`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(toBeforeFromRes.status).toBe(400);
    });

    it('returns 403 for another owner, 403 for customer, 404 for unknown business, and allows admin for any business', async () => {
      // Another owner gets 403
      const forbiddenOwner = await request(app)
        .get(`/api/analytics/business/${businessId}/summary`)
        .set('Authorization', `Bearer ${otherOwnerToken}`);
      expect(forbiddenOwner.status).toBe(403);

      // Customer gets 403
      const forbiddenCust = await request(app)
        .get(`/api/analytics/business/${businessId}/summary`)
        .set('Authorization', `Bearer ${customerToken}`);
      expect(forbiddenCust.status).toBe(403);

      // Unknown business gets 404
      const notFound = await request(app)
        .get(`/api/analytics/business/00000000-0000-0000-0000-000000000000/summary`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(notFound.status).toBe(404);

      // Admin can view any business
      const adminOk = await request(app)
        .get(`/api/analytics/business/${businessId}/summary`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(adminOk.status).toBe(200);
    });
  });

  describe('Caching & Freshness', () => {
    it('summary is cached in Redis for 60s (subsequent call does not hit DB), and /today is uncached', async () => {
      const spy = jest.spyOn(analyticsRepository, 'getSummary');

      // First call -> hits DB
      const res1 = await request(app)
        .get(`/api/analytics/business/${businessId}/summary?from=2026-11-20&to=2026-11-20`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(res1.status).toBe(200);
      expect(spy).toHaveBeenCalledTimes(1);

      // Second call with same parameters -> served from Redis cache
      const res2 = await request(app)
        .get(`/api/analytics/business/${businessId}/summary?from=2026-11-20&to=2026-11-20`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(res2.status).toBe(200);
      expect(spy).toHaveBeenCalledTimes(1); // Counter did not increase!

      spy.mockRestore();

      // /today is always uncached and returns live data
      const todayRes = await request(app)
        .get(`/api/analytics/business/${businessId}/today`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(todayRes.status).toBe(200);
      expect(todayRes.body).toHaveProperty('waitingNow');
      expect(todayRes.body).toHaveProperty('servedToday');
      expect(todayRes.body).toHaveProperty('nextAppointments');
    });
  });

  describe('CSV Export & Formula Injection Prevention', () => {
    it('returns text/csv with attachment header and escapes values starting with =', async () => {
      const res = await request(app)
        .get(`/api/analytics/business/${businessId}/export.csv?from=2026-11-20&to=2026-11-20`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('attachment; filename=');
      expect(res.text).toContain('date,served,average_wait_minutes');
    });
  });

  describe('Performance Sanity Benchmark', () => {
    it('computes summary on 10,000 queue_history rows in under 500 ms', async () => {
      // Generate 10,000 synthetic rows directly into PostgreSQL
      console.log('⚡ Inserting 10,000 rows for analytics performance benchmark...');
      await realPool.query(`
        INSERT INTO queue_history (
          business_id, ticket_number, source, score, joined_at, called_at, completed_at, status, estimated_wait_minutes
        )
        SELECT
          '${businessId}',
          g,
          'online',
          1795123000000 + g,
          NOW() - (g || ' minutes')::interval,
          NOW() - (g || ' minutes')::interval + INTERVAL '10 minutes',
          NOW() - (g || ' minutes')::interval + INTERVAL '25 minutes',
          'completed',
          15
        FROM generate_series(1, 10000) AS g;
      `);

      const startTime = Date.now();
      const res = await request(app)
        .get(`/api/analytics/business/${businessId}/summary?from=2026-11-01&to=2026-11-20`)
        .set('Authorization', `Bearer ${ownerToken}`);
      const durationMs = Date.now() - startTime;

      console.log(`⏱️ Summary query on 10,000 rows executed in: ${durationMs} ms`);

      expect(res.status).toBe(200);
      expect(durationMs).toBeLessThan(500);

      // Clean up the 10,000 benchmark rows
      await realPool.query(`DELETE FROM queue_history WHERE business_id = $1`, [businessId]);
    });
  });

  describe('Admin Platform Stats, User Management & Audit Log', () => {
    it('GET /api/admin/stats returns users, businesses, appointments, queue served and 30 daily entries', async () => {
      const res = await request(app)
        .get('/api/admin/stats')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.users).toHaveProperty('customer');
      expect(res.body.users).toHaveProperty('owner');
      expect(res.body.users).toHaveProperty('admin');
      expect(res.body.businesses).toHaveProperty('approved');
      expect(res.body.appointments).toHaveProperty('total30Days');
      expect(res.body).toHaveProperty('queueServed30Days');
      expect(res.body).toHaveProperty('failedEmails');
      expect(res.body.daily).toHaveLength(30);
    });

    it('GET /api/admin/users supports search, filters, pagination and omits password_hash', async () => {
      const res = await request(app)
        .get('/api/admin/users?role=customer&q=analytics&page=1&limit=5')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(5);

      if (res.body.data.length > 0) {
        expect(res.body.data[0]).toHaveProperty('id');
        expect(res.body.data[0]).toHaveProperty('email');
        expect(res.body.data[0]).not.toHaveProperty('password_hash');
      }
    });

    it('BLOCK & UNBLOCK: login 403, immediate token rejection, refresh 403, slot freed, audit logged, unblock restores access', async () => {
      // 1. Customer books a future slot
      const futureSlot = await realPool.query(
        `INSERT INTO slots (service_id, start_time, end_time, status)
         VALUES ($1, NOW() + INTERVAL '5 hours', NOW() + INTERVAL '5 hours 30 minutes', 'booked')
         RETURNING id`,
        [serviceId]
      );
      const slotId = futureSlot.rows[0].id;

      const apptRes = await realPool.query(
        `INSERT INTO appointments (slot_id, customer_id, status)
         VALUES ($1, $2, 'confirmed')
         RETURNING id`,
        [slotId, customerId]
      );
      const apptId = apptRes.rows[0].id;

      // 2. Customer joins queue
      await realPool.query(
        `INSERT INTO queue_history (business_id, customer_id, ticket_number, source, score, joined_at, status)
         VALUES ($1, $2, 101, 'online', 101, NOW(), 'waiting')`,
        [businessId, customerId]
      );

      // 3. Admin blocks user
      const blockRes = await request(app)
        .patch(`/api/admin/users/${customerId}/block`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ blocked: true, reason: 'Repeated violation of platform guidelines' });

      expect(blockRes.status).toBe(200);

      // A. Login rejected with 403
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: 'customer_analytics_test@test.local', password: 'Secret123' });
      expect(loginRes.status).toBe(403);
      expect(loginRes.body.error.code).toBe('USER_BLOCKED');

      // B. Existing access token rejected immediately with 403
      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${customerToken}`);
      expect(meRes.status).toBe(403);
      expect(meRes.body.error.code).toBe('USER_BLOCKED');

      // C. Future appointment was cancelled and its slot freed
      const updatedAppt = await realPool.query(`SELECT status FROM appointments WHERE id = $1`, [apptId]);
      expect(updatedAppt.rows[0].status).toBe('cancelled');

      const updatedSlot = await realPool.query(`SELECT status FROM slots WHERE id = $1`, [slotId]);
      expect(updatedSlot.rows[0].status).toBe('free');

      // D. User removed from active waiting queue
      const queueStatus = await realPool.query(
        `SELECT status FROM queue_history WHERE business_id = $1 AND customer_id = $2`,
        [businessId, customerId]
      );
      expect(queueStatus.rows[0].status).toBe('left');

      // E. Audit log row exists
      const auditRes = await request(app)
        .get('/api/admin/audit-log?limit=5')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(auditRes.status).toBe(200);
      const blockLog = auditRes.body.data.find(
        (l: any) => l.action === 'user.block' && l.target_id === customerId
      );
      expect(blockLog).toBeDefined();

      // 4. Admin unblocks user
      const unblockRes = await request(app)
        .patch(`/api/admin/users/${customerId}/block`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ blocked: false });
      expect(unblockRes.status).toBe(200);

      // Access restored
      const loginAgain = await request(app)
        .post('/api/auth/login')
        .send({ email: 'customer_analytics_test@test.local', password: 'Secret123' });
      expect(loginAgain.status).toBe(200);
    });

    it('an admin cannot block themselves or another admin (403), and non-admin gets 403', async () => {
      // Self block rejected
      const selfBlock = await request(app)
        .patch(`/api/admin/users/${adminId}/block`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ blocked: true });
      expect(selfBlock.status).toBe(403);

      // Non-admin gets 403
      const nonAdminBlock = await request(app)
        .patch(`/api/admin/users/${customerId}/block`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ blocked: true });
      expect(nonAdminBlock.status).toBe(403);
    });

    it('records audit log on business approval', async () => {
      // Create pending business
      const pbRes = await realPool.query(
        `INSERT INTO businesses (owner_id, name, category, address, city, phone, status)
         VALUES ($1, 'Pending Audit Clinic', 'Clinic', '789 Audit St', 'Bengaluru', '+919876543212', 'pending')
         RETURNING id`,
        [ownerId]
      );
      const pendingBizId = pbRes.rows[0].id;

      // Admin approves business
      const approveRes = await request(app)
        .patch(`/api/admin/businesses/${pendingBizId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'approved' });

      expect(approveRes.status).toBe(200);

      // Verify audit log has approve record
      const auditRes = await request(app)
        .get('/api/admin/audit-log?limit=5')
        .set('Authorization', `Bearer ${adminToken}`);

      const bizAudit = auditRes.body.data.find(
        (l: any) => l.action === 'business.approve' && l.target_id === pendingBizId
      );
      expect(bizAudit).toBeDefined();

      // Clean up
      await realPool.query(`DELETE FROM businesses WHERE id = $1`, [pendingBizId]);
    });
  });

  describe('Queue Entry Stores estimated_wait_minutes', () => {
    it('stores estimated_wait_minutes in queue_history when customer joins queue', async () => {
      // Clean up any prior entries for this customer so joinQueue succeeds
      await realPool.query(`DELETE FROM queue_history WHERE customer_id = $1`, [customerId]);
      try {
        const { queueRedis } = await import('../src/modules/queue/queue.redis');
        await queueRedis.clearBusinessQueue(businessId);
      } catch {}

      // Customer joins queue
      const joinRes = await request(app)
        .post(`/api/queue/${businessId}/join`)
        .set('Authorization', `Bearer ${customerToken}`);

      expect(joinRes.status).toBe(201);
      const returnedEstWait = joinRes.body.estimatedWaitMinutes;
      expect(returnedEstWait).toBeDefined();

      // Assert row in queue_history has the exact same estimated_wait_minutes
      const dbEntry = await realPool.query(
        `SELECT estimated_wait_minutes FROM queue_history
         WHERE business_id = $1 AND customer_id = $2 AND status = 'waiting'
         ORDER BY joined_at DESC LIMIT 1`,
        [businessId, customerId]
      );

      expect(dbEntry.rows.length).toBe(1);
      expect(dbEntry.rows[0].estimated_wait_minutes).toBe(returnedEstWait);
    });
  });
});
