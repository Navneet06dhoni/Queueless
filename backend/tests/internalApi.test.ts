import request from 'supertest';
import { createApp } from '../src/app';
import { query } from '../src/db';
import { config } from '../src/config';
import { generateAccessToken } from '../src/modules/auth/auth.utils';
import { setUserBlockedCache } from '../src/middleware/auth';
import { setupTestDb, TestDbInstance } from './setupTestDb';

describe('Internal Core API (/internal)', () => {
  const app = createApp();
  let testDb: TestDbInstance;
  let ownerId: string;
  let customerId: string;
  let blockedCustomerId: string;
  let businessId: string;
  let appointmentId: string;

  beforeAll(async () => {
    testDb = await setupTestDb();
    // 1. Create owner
    const ownerRes = await query<{ id: string }>(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ('Internal Owner', 'owner-internal@example.com', 'hash123', 'owner')
       RETURNING id`
    );
    ownerId = ownerRes.rows[0].id;

    // 2. Create customer
    const custRes = await query<{ id: string }>(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ('Internal Customer', 'cust-internal@example.com', 'hash123', 'customer')
       RETURNING id`
    );
    customerId = custRes.rows[0].id;

    // 3. Create blocked customer
    const blockedRes = await query<{ id: string }>(
      `INSERT INTO users (name, email, password_hash, role, is_blocked)
       VALUES ('Blocked Customer', 'blocked-internal@example.com', 'hash123', 'customer', true)
       RETURNING id`
    );
    blockedCustomerId = blockedRes.rows[0].id;
    await setUserBlockedCache(blockedCustomerId, true);

    // 4. Create business
    const bizRes = await query<{ id: string }>(
      `INSERT INTO businesses (owner_id, name, category, address, city, phone, status, queue_open)
       VALUES ($1, 'Internal Business', 'Healthcare', '123 Test St', 'City', '1234567890', 'approved', true)
       RETURNING id`,
      [ownerId]
    );
    businessId = bizRes.rows[0].id;

    // Add working hours for today (all days 0..6 to ensure match)
    for (let day = 0; day <= 6; day++) {
      await query(
        `INSERT INTO working_hours (business_id, day_of_week, open_time, close_time)
         VALUES ($1, $2, '09:00:00', '17:00:00')`,
        [businessId, day]
      );
    }

    // 5. Create service, slot, appointment
    const srvRes = await query<{ id: string }>(
      `INSERT INTO services (business_id, name, duration_minutes, price)
       VALUES ($1, 'Checkup', 30, 50.00)
       RETURNING id`,
      [businessId]
    );
    const serviceId = srvRes.rows[0].id;

    const slotRes = await query<{ id: string }>(
      `INSERT INTO slots (service_id, start_time, end_time, status)
       VALUES ($1, NOW() + INTERVAL '1 hour', NOW() + INTERVAL '1 hour 30 min', 'booked')
       RETURNING id`,
      [serviceId]
    );
    const slotId = slotRes.rows[0].id;

    const apptRes = await query<{ id: string }>(
      `INSERT INTO appointments (slot_id, customer_id, status)
       VALUES ($1, $2, 'confirmed')
       RETURNING id`,
      [slotId, customerId]
    );
    appointmentId = apptRes.rows[0].id;
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  describe('Authentication & Security', () => {
    it('returns 401 when X-Internal-Token header is missing', async () => {
      const res = await request(app).get(`/internal/businesses/${businessId}/queue-info`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 when X-Internal-Token header is invalid', async () => {
      const res = await request(app)
        .get(`/internal/businesses/${businessId}/queue-info`)
        .set('X-Internal-Token', 'wrong-token-value');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('GET /internal/businesses/:id/queue-info', () => {
    it('returns 404 for unknown business id', async () => {
      const res = await request(app)
        .get('/internal/businesses/00000000-0000-0000-0000-000000000000/queue-info')
        .set('X-Internal-Token', config.INTERNAL_TOKEN);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('BUSINESS_NOT_FOUND');
    });

    it('returns business queue info with today working hours', async () => {
      const res = await request(app)
        .get(`/internal/businesses/${businessId}/queue-info`)
        .set('X-Internal-Token', config.INTERNAL_TOKEN);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: businessId,
        name: 'Internal Business',
        ownerId,
        status: 'approved',
        workingHoursToday: {
          openTime: '09:00:00',
          closeTime: '17:00:00',
          isOpenToday: true,
        },
      });
    });
  });

  describe('GET /internal/appointments/:id/check-in-info', () => {
    it('returns 404 for unknown appointment id', async () => {
      const res = await request(app)
        .get('/internal/appointments/00000000-0000-0000-0000-000000000000/check-in-info')
        .set('X-Internal-Token', config.INTERNAL_TOKEN);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('APPOINTMENT_NOT_FOUND');
    });

    it('returns appointment check-in details', async () => {
      const res = await request(app)
        .get(`/internal/appointments/${appointmentId}/check-in-info`)
        .set('X-Internal-Token', config.INTERNAL_TOKEN);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(appointmentId);
      expect(res.body.customerId).toBe(customerId);
      expect(res.body.businessId).toBe(businessId);
      expect(res.body.status).toBe('confirmed');
      expect(res.body.slotStartTime).toBeDefined();
    });
  });

  describe('POST /internal/auth/verify-token', () => {
    it('returns 401 when token is missing from body', async () => {
      const res = await request(app)
        .post('/internal/auth/verify-token')
        .set('X-Internal-Token', config.INTERNAL_TOKEN)
        .send({});
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('TOKEN_REQUIRED');
    });

    it('returns 401 when token is invalid or malformed', async () => {
      const res = await request(app)
        .post('/internal/auth/verify-token')
        .set('X-Internal-Token', config.INTERNAL_TOKEN)
        .send({ token: 'not-a-valid-jwt' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_TOKEN');
    });

    it('returns 401 when token belongs to a blocked user', async () => {
      const blockedToken = generateAccessToken({
        id: blockedCustomerId,
        role: 'customer',
        name: 'Blocked User',
      });

      const res = await request(app)
        .post('/internal/auth/verify-token')
        .set('X-Internal-Token', config.INTERNAL_TOKEN)
        .send({ token: blockedToken });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('USER_BLOCKED');
    });

    it('returns user identity { userId, role, name } for valid token', async () => {
      const validToken = generateAccessToken({
        id: customerId,
        role: 'customer',
        name: 'Internal Customer',
        email: 'cust-internal@example.com',
      });

      const res = await request(app)
        .post('/internal/auth/verify-token')
        .set('X-Internal-Token', config.INTERNAL_TOKEN)
        .send({ token: validToken });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        userId: customerId,
        role: 'customer',
        name: 'Internal Customer',
      });
    });
  });
});
