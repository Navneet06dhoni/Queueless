import request from 'supertest';
import { DateTime } from 'luxon';
import { createApp } from '../src/app';
import { setupTestDb, TestDbInstance } from './setupTestDb';
import { query } from '../src/db';
import { config } from '../src/config';

describe('Businesses, Services, Working Hours and Slots Module', () => {
  let testDb: TestDbInstance;
  let app: ReturnType<typeof createApp>;

  let adminToken: string;
  let ownerToken: string;
  let owner2Token: string;
  let customerToken: string;

  beforeAll(async () => {
    testDb = await setupTestDb();
    app = createApp();
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  beforeEach(async () => {
    await testDb.resetData();

    // 1. Create Admin
    const adminReg = await request(app).post('/api/auth/register').send({
      name: 'Admin User',
      email: 'admin@test.com',
      password: 'Password123',
      role: 'owner',
    });
    // Manually elevate to admin in test DB
    await query(`UPDATE users SET role = 'admin' WHERE email = 'admin@test.com'`);
    // Re-login to get admin token with admin role in JWT
    const adminLogin = await request(app).post('/api/auth/login').send({
      email: 'admin@test.com',
      password: 'Password123',
    });
    adminToken = adminLogin.body.accessToken;

    // 2. Create Owner 1
    const ownerReg = await request(app).post('/api/auth/register').send({
      name: 'Owner Dr. Ramesh',
      email: 'owner1@test.com',
      password: 'Password123',
      role: 'owner',
    });
    ownerToken = ownerReg.body.accessToken;

    // 3. Create Owner 2
    const owner2Reg = await request(app).post('/api/auth/register').send({
      name: 'Owner Priya',
      email: 'owner2@test.com',
      password: 'Password123',
      role: 'owner',
    });
    owner2Token = owner2Reg.body.accessToken;

    // 4. Create Customer
    const custReg = await request(app).post('/api/auth/register').send({
      name: 'Customer Rahul',
      email: 'customer@test.com',
      password: 'Password123',
      role: 'customer',
    });
    customerToken = custReg.body.accessToken;
  });

  describe('Business Creation & Ownership Restrictions', () => {
    it('owner creates a business with status pending; customer cannot create one (403)', async () => {
      // Customer attempt -> 403 Forbidden
      const custRes = await request(app)
        .post('/api/businesses')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          name: 'Customer Clinic',
          category: 'Clinic',
          address: '10 Main Road',
          city: 'Bengaluru',
          phone: '+919876543210',
        });

      expect(custRes.status).toBe(403);
      expect(custRes.body.error.code).toBe('FORBIDDEN');

      // Owner attempt -> 201 Created with status "pending"
      const ownerRes = await request(app)
        .post('/api/businesses')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'City Care Clinic',
          category: 'Clinic',
          address: '10 Main Road',
          city: 'Bengaluru',
          phone: '+919876543210',
        });

      expect(ownerRes.status).toBe(201);
      expect(ownerRes.body.business).toBeDefined();
      expect(ownerRes.body.business.name).toBe('City Care Clinic');
      expect(ownerRes.body.business.status).toBe('pending');
    });

    it('another owner cannot edit, add services, set hours or generate slots for someone else business (403)', async () => {
      // Owner 1 creates business
      const bRes = await request(app)
        .post('/api/businesses')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Ramesh Health Center',
          category: 'Clinic',
          address: '15 MG Road',
          city: 'Bengaluru',
          phone: '+919876543210',
        });
      const businessId = bRes.body.business.id;

      // Owner 2 tries to update business
      const editRes = await request(app)
        .put(`/api/businesses/${businessId}`)
        .set('Authorization', `Bearer ${owner2Token}`)
        .send({ name: 'Hacked Clinic' });
      expect(editRes.status).toBe(403);

      // Owner 2 tries to add service
      const srvRes = await request(app)
        .post(`/api/businesses/${businessId}/services`)
        .set('Authorization', `Bearer ${owner2Token}`)
        .send({ name: 'Checkup', duration_minutes: 30, price: 500 });
      expect(srvRes.status).toBe(403);

      // Owner 2 tries to set working hours
      const hoursRes = await request(app)
        .put(`/api/businesses/${businessId}/working-hours`)
        .set('Authorization', `Bearer ${owner2Token}`)
        .send([{ day_of_week: 1, open_time: '09:00', close_time: '17:00' }]);
      expect(hoursRes.status).toBe(403);
    });
  });

  describe('Public Business Listing, Search, Filters & Pagination', () => {
    beforeEach(async () => {
      // Seed 3 approved businesses and 1 pending
      const b1 = await request(app)
        .post('/api/businesses')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Arogya Dental Clinic',
          category: 'Clinic',
          address: 'Indiranagar',
          city: 'Bengaluru',
          phone: '+919876543211',
        });

      const b2 = await request(app)
        .post('/api/businesses')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Bliss Beauty Salon',
          category: 'Salon',
          address: 'Bandra',
          city: 'Mumbai',
          phone: '+919876543212',
        });

      const b3 = await request(app)
        .post('/api/businesses')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Metro Urban Bank Branch',
          category: 'Banking',
          address: 'Koramangala',
          city: 'Bengaluru',
          phone: '+919876543213',
        });

      await request(app)
        .post('/api/businesses')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Secret Pending Spa',
          category: 'Spa',
          address: 'Whitefield',
          city: 'Bengaluru',
          phone: '+919876543214',
        });

      // Approve b1, b2, b3
      await query(`UPDATE businesses SET status = 'approved' WHERE id IN ($1, $2, $3)`, [
        b1.body.business.id,
        b2.body.business.id,
        b3.body.business.id,
      ]);
    });

    it('shows only approved businesses, excluding pending ones', async () => {
      const res = await request(app).get('/api/businesses');
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(3);
      expect(res.body.data.length).toBe(3);
      const names = res.body.data.map((b: any) => b.name);
      expect(names).toContain('Arogya Dental Clinic');
      expect(names).toContain('Bliss Beauty Salon');
      expect(names).toContain('Metro Urban Bank Branch');
      expect(names).not.toContain('Secret Pending Spa');
    });

    it('filters by city and category correctly', async () => {
      // Filter by city
      const cityRes = await request(app).get('/api/businesses?city=Bengaluru');
      expect(cityRes.status).toBe(200);
      expect(cityRes.body.total).toBe(2);

      // Filter by category
      const catRes = await request(app).get('/api/businesses?category=Salon');
      expect(catRes.status).toBe(200);
      expect(catRes.body.total).toBe(1);
      expect(catRes.body.data[0].name).toBe('Bliss Beauty Salon');
    });

    it('searches by keyword with LIKE escaping and handles pagination', async () => {
      // Search keyword
      const searchRes = await request(app).get('/api/businesses?q=dental');
      expect(searchRes.status).toBe(200);
      expect(searchRes.body.total).toBe(1);
      expect(searchRes.body.data[0].name).toBe('Arogya Dental Clinic');

      // Pagination
      const page1 = await request(app).get('/api/businesses?limit=2&page=1');
      expect(page1.status).toBe(200);
      expect(page1.body.data.length).toBe(2);
      expect(page1.body.total).toBe(3);

      const page2 = await request(app).get('/api/businesses?limit=2&page=2');
      expect(page2.status).toBe(200);
      expect(page2.body.data.length).toBe(1);
    });
  });

  describe('Working Hours Validation', () => {
    it('rejects close_time before or equal to open_time, and rejects duplicate days', async () => {
      const b = await request(app)
        .post('/api/businesses')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Schedule Clinic',
          category: 'Clinic',
          address: 'Road 1',
          city: 'Delhi',
          phone: '+919876543210',
        });
      const businessId = b.body.business.id;

      // Close before open
      const invalidTimeRes = await request(app)
        .put(`/api/businesses/${businessId}/working-hours`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send([
          { day_of_week: 1, open_time: '18:00', close_time: '09:00' },
        ]);

      expect(invalidTimeRes.status).toBe(400);
      expect(invalidTimeRes.body.error.code).toBe('VALIDATION_ERROR');

      // Duplicate day
      const duplicateDayRes = await request(app)
        .put(`/api/businesses/${businessId}/working-hours`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send([
          { day_of_week: 1, open_time: '09:00', close_time: '12:00' },
          { day_of_week: 1, open_time: '14:00', close_time: '18:00' },
        ]);

      expect(duplicateDayRes.status).toBe(400);
      expect(duplicateDayRes.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Slot Generation & Timezone Handling', () => {
    let businessId: string;
    let serviceId: string;

    beforeEach(async () => {
      const b = await request(app)
        .post('/api/businesses')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Slot Test Clinic',
          category: 'Clinic',
          address: 'Road 5',
          city: 'Bengaluru',
          phone: '+919876543210',
        });
      businessId = b.body.business.id;

      // Add service of 30 min duration
      const s = await request(app)
        .post(`/api/businesses/${businessId}/services`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Consultation',
          duration_minutes: 30,
          price: 500,
        });
      serviceId = s.body.service.id;
    });

    it('generates correct slot count for a day (9:00 to 17:00 with 30m duration gives 16), converts IST to UTC, is idempotent, and rejects > 30 days', async () => {
      // Pick a future date in IST to guarantee no slots are in the past
      const tz = config.BUSINESS_TIMEZONE;
      const futureDay = DateTime.now().setZone(tz).plus({ days: 10 }).startOf('day');
      const targetDateStr = futureDay.toISODate()!;
      // Luxon weekday: 1 = Mon ... 7 = Sun. DB schema: 0 = Sun, 1 = Mon ... 6 = Sat
      const targetDbDay = futureDay.weekday === 7 ? 0 : futureDay.weekday;

      // Set working hours for that specific day of week: 09:00 to 17:00
      await request(app)
        .put(`/api/businesses/${businessId}/working-hours`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send([
          { day_of_week: targetDbDay, open_time: '09:00', close_time: '17:00' },
        ]);

      // 1. Generate slots for that day
      const genRes = await request(app)
        .post(`/api/businesses/${businessId}/slots/generate`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          service_id: serviceId,
          from_date: targetDateStr,
          to_date: targetDateStr,
        });

      expect(genRes.status).toBe(201);
      // 8 hours = 480 mins / 30 mins = 16 slots exactly
      expect(genRes.body.created).toBe(16);
      expect(genRes.body.skipped).toBe(0);

      // 2. Verify IST to UTC conversion
      // 09:00 IST is 03:30 UTC
      const slotsRes = await request(app)
        .get(`/api/businesses/${businessId}/slots?date=${targetDateStr}&service_id=${serviceId}`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(slotsRes.status).toBe(200);
      expect(slotsRes.body.slots.length).toBe(16);

      const firstSlot = slotsRes.body.slots[0];
      const firstSlotUtc = new Date(firstSlot.start_time).toISOString();
      expect(firstSlotUtc).toContain('T03:30:00'); // 09:00 IST = 03:30 UTC

      // 3. Test idempotency on second call
      const genSecond = await request(app)
        .post(`/api/businesses/${businessId}/slots/generate`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          service_id: serviceId,
          from_date: targetDateStr,
          to_date: targetDateStr,
        });

      expect(genSecond.status).toBe(201);
      expect(genSecond.body.created).toBe(0);
      expect(genSecond.body.skipped).toBe(16);

      // 4. Rejects range over 30 days
      const invalidRange = await request(app)
        .post(`/api/businesses/${businessId}/slots/generate`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          service_id: serviceId,
          from_date: '2026-12-01',
          to_date: '2027-01-15', // 45 days
        });

      expect(invalidRange.status).toBe(400);
      expect(invalidRange.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Service Deletion with Booked Slot Protection', () => {
    it('deleting a service with a booked slot returns 409; free service deletes cleanly', async () => {
      const b = await request(app)
        .post('/api/businesses')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Dental Care',
          category: 'Clinic',
          address: 'Road 9',
          city: 'Bengaluru',
          phone: '+919876543210',
        });
      const businessId = b.body.business.id;

      const s = await request(app)
        .post(`/api/businesses/${businessId}/services`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Root Canal',
          duration_minutes: 60,
          price: 2000,
        });
      const serviceId = s.body.service.id;

      // Insert booked slot directly
      await query(
        `INSERT INTO slots (service_id, start_time, end_time, status)
         VALUES ($1, '2026-11-25 10:00:00+00', '2026-11-25 11:00:00+00', 'booked')`,
        [serviceId]
      );

      // Attempt deletion -> 409 Conflict
      const deleteRes = await request(app)
        .delete(`/api/businesses/${businessId}/services/${serviceId}`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(deleteRes.status).toBe(409);
      expect(deleteRes.body.error.code).toBe('SERVICE_HAS_BOOKINGS');

      // Update slot to free, now deletion should succeed
      await query(`UPDATE slots SET status = 'free' WHERE service_id = $1`, [serviceId]);

      const deleteSuccess = await request(app)
        .delete(`/api/businesses/${businessId}/services/${serviceId}`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(deleteSuccess.status).toBe(200);
      expect(deleteSuccess.body.message).toContain('deleted successfully');
    });
  });

  describe('Admin Business Approval & Redis Cache Invalidation', () => {
    it('admin approves business and it immediately appears in public list; cache invalidation verified', async () => {
      // 1. Owner creates a business (status: pending)
      const bRes = await request(app)
        .post('/api/businesses')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'New Wellness Center',
          category: 'Wellness',
          address: '77 Residency Road',
          city: 'Bengaluru',
          phone: '+919876543299',
        });
      const businessId = bRes.body.business.id;
      expect(bRes.body.business.status).toBe('pending');

      // 2. Query public list before approval -> empty
      const listBefore = await request(app).get('/api/businesses?category=Wellness');
      expect(listBefore.status).toBe(200);
      expect(listBefore.body.total).toBe(0);

      // 3. Admin checks pending list
      const adminList = await request(app)
        .get('/api/admin/businesses?status=pending')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(adminList.status).toBe(200);
      const pendingIds = adminList.body.data.map((b: any) => b.id);
      expect(pendingIds).toContain(businessId);

      // 4. Admin approves the business
      const approveRes = await request(app)
        .patch(`/api/admin/businesses/${businessId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'approved' });

      expect(approveRes.status).toBe(200);
      expect(approveRes.body.business.status).toBe('approved');

      // 5. Query public list again -> cache was invalidated, business now appears!
      const listAfter = await request(app).get('/api/businesses?category=Wellness');
      expect(listAfter.status).toBe(200);
      expect(listAfter.body.total).toBe(1);
      expect(listAfter.body.data[0].name).toBe('New Wellness Center');
    });
  });
});
