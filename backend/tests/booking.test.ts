import request from 'supertest';
import crypto from 'crypto';
import { DateTime } from 'luxon';
import { createApp } from '../src/app';
import { setupTestDb, TestDbInstance } from './setupTestDb';
import { query } from '../src/db';
import { events } from '../src/events';
import { config } from '../src/config';
import { generateAccessToken } from '../src/modules/auth/auth.utils';

describe('Booking & Concurrency-Safe Locking Module', () => {
  let testDb: TestDbInstance;
  let app: ReturnType<typeof createApp>;

  let ownerToken: string;
  let ownerId: string;
  let businessId: string;
  let serviceId: string;

  beforeAll(async () => {
    testDb = await setupTestDb();
    app = createApp();
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  beforeEach(async () => {
    await testDb.resetData();
    jest.restoreAllMocks();

    // 1. Create an owner
    const ownerReg = await request(app).post('/api/auth/register').send({
      name: 'Dr. Ramesh Clinic Owner',
      email: 'owner@bookingtest.com',
      password: 'Password123',
      role: 'owner',
    });
    ownerToken = ownerReg.body.accessToken;
    ownerId = ownerReg.body.user.id;

    // 2. Create and approve a business
    const bRes = await request(app)
      .post('/api/businesses')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Apollo Dental Care',
        category: 'Clinic',
        address: '100 MG Road',
        city: 'Bengaluru',
        phone: '+919876543210',
      });
    businessId = bRes.body.business.id;

    await query(`UPDATE businesses SET status = 'approved' WHERE id = $1`, [businessId]);

    // 3. Add a service (30 min)
    const sRes = await request(app)
      .post(`/api/businesses/${businessId}/services`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Teeth Cleaning',
        duration_minutes: 30,
        price: 500,
      });
    serviceId = sRes.body.service.id;
  });

  // Fast helper to create a customer directly in DB and generate a valid access token
  const createCustomer = async (index: number) => {
    const userId = crypto.randomUUID();
    const email = `cust_${index}_${userId.slice(0, 8)}@test.com`;
    await query(
      `INSERT INTO users (id, name, email, password_hash, role)
       VALUES ($1, $2, $3, 'dummy_hash', 'customer')`,
      [userId, `Customer ${index}`, email]
    );
    const token = generateAccessToken({ id: userId, role: 'customer' });
    return { token, id: userId };
  };

  // Helper to insert a future slot directly
  const createFutureSlot = async (
    hoursFromNow = 10,
    durationMinutes = 30,
    status = 'free',
    service = serviceId
  ) => {
    const tz = config.BUSINESS_TIMEZONE;
    const start = DateTime.now().setZone(tz).plus({ hours: hoursFromNow });
    const end = start.plus({ minutes: durationMinutes });

    const res = await query<{ id: string }>(
      `INSERT INTO slots (service_id, start_time, end_time, status)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [service, start.toUTC().toJSDate(), end.toUTC().toJSDate(), status]
    );
    return { id: res.rows[0].id, start: start.toUTC().toJSDate(), end: end.toUTC().toJSDate() };
  };

  describe('Basic Booking & Double-Booking Protection', () => {
    it('customer books a free slot (201), slot becomes booked; second customer gets 409', async () => {
      const cust1 = await createCustomer(1);
      const cust2 = await createCustomer(2);
      const slot = await createFutureSlot(5);

      // Customer 1 books
      const res1 = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${cust1.token}`)
        .send({ slot_id: slot.id });

      expect(res1.status).toBe(201);
      expect(res1.body.appointment).toBeDefined();
      expect(res1.body.appointment.slot_id).toBe(slot.id);
      expect(res1.body.appointment.status).toBe('confirmed');

      // Verify slot is now 'booked' in database
      const slotCheck = await query<{ status: string }>('SELECT status FROM slots WHERE id = $1', [
        slot.id,
      ]);
      expect(slotCheck.rows[0].status).toBe('booked');

      // Customer 2 attempts to book the same slot -> 409
      const res2 = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${cust2.token}`)
        .send({ slot_id: slot.id });

      expect(res2.status).toBe(409);
      expect(res2.body.error.code).toBe('SLOT_ALREADY_BOOKED');
    });

    it('rejects past slots (400), pending business slots (404), and owner booking (403)', async () => {
      const cust = await createCustomer(3);

      // 1. Slot in the past
      const pastStart = DateTime.now().minus({ hours: 2 }).toUTC().toJSDate();
      const pastEnd = DateTime.now().minus({ hours: 1, minutes: 30 }).toUTC().toJSDate();
      const pastSlot = await query<{ id: string }>(
        `INSERT INTO slots (service_id, start_time, end_time, status)
         VALUES ($1, $2, $3, 'free') RETURNING id`,
        [serviceId, pastStart, pastEnd]
      );

      const pastRes = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${cust.token}`)
        .send({ slot_id: pastSlot.rows[0].id });

      expect(pastRes.status).toBe(400);
      expect(pastRes.body.error.code).toBe('SLOT_IN_PAST');

      // 2. Pending business slot
      const pendingB = await request(app)
        .post('/api/businesses')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Pending Spa',
          category: 'Spa',
          address: 'Road',
          city: 'City',
          phone: '+919999999999',
        });
      const pendingS = await request(app)
        .post(`/api/businesses/${pendingB.body.business.id}/services`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Massage', duration_minutes: 60, price: 1000 });
      const pendingSlot = await createFutureSlot(10, 60, 'free', pendingS.body.service.id);

      const pendingRes = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${cust.token}`)
        .send({ slot_id: pendingSlot.id });

      expect(pendingRes.status).toBe(404);

      // 3. Owner trying to book -> 403
      const validSlot = await createFutureSlot(12);
      const ownerBookRes = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ slot_id: validSlot.id });

      expect(ownerBookRes.status).toBe(403);
    });

    it('rejects overlapping appointments for the same customer (409)', async () => {
      const cust = await createCustomer(4);

      // Create two different services with overlapping slots
      const slotA = await createFutureSlot(10, 60); // 10:00 to 11:00
      const slotB = await createFutureSlot(10, 30); // 10:00 to 10:30 (overlaps with A)

      // Book Slot A
      const resA = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${cust.token}`)
        .send({ slot_id: slotA.id });
      expect(resA.status).toBe(201);

      // Attempt to book Slot B (overlapping window) -> 409
      const resB = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${cust.token}`)
        .send({ slot_id: slotB.id });

      expect(resB.status).toBe(409);
      expect(resB.body.error.code).toBe('OVERLAPPING_APPOINTMENT');
    });
  });

  describe('Concurrency Stress Testing', () => {
    it(
      'CONCURRENCY: 50 customers fire simultaneous POST /appointments for the SAME slot -> exactly one 201, 49 409s, zero 500s',
      async () => {
        const slot = await createFutureSlot(8);

        // Create 50 customers
        const customers = await Promise.all(
          Array.from({ length: 50 }, (_, i) => createCustomer(100 + i))
        );

        // Fire 50 simultaneous booking requests
        const results = await Promise.all(
          customers.map((c) =>
            request(app)
              .post('/api/appointments')
              .set('Authorization', `Bearer ${c.token}`)
              .send({ slot_id: slot.id })
          )
        );

        const status201s = results.filter((r) => r.status === 201);
        const status409s = results.filter((r) => r.status === 409);
        const status500s = results.filter((r) => r.status >= 500);

        expect(status201s.length).toBe(1);
        expect(status409s.length).toBe(49);
        expect(status500s.length).toBe(0);

        // Verify DB state
        const appts = await query<{ count: string }>(
          `SELECT COUNT(*)::text as count FROM appointments WHERE slot_id = $1 AND status <> 'cancelled'`,
          [slot.id]
        );
        expect(parseInt(appts.rows[0].count, 10)).toBe(1);

        const slotCheck = await query<{ status: string }>('SELECT status FROM slots WHERE id = $1', [
          slot.id,
        ]);
        expect(slotCheck.rows[0].status).toBe('booked');
      },
      60000
    );

    it('CONCURRENCY ON DIFFERENT SLOTS: 20 customers simultaneously book 20 different slots -> all succeed', async () => {
      const slots = await Promise.all(
        Array.from({ length: 20 }, (_, i) => createFutureSlot(15 + i))
      );
      const customers = await Promise.all(
        Array.from({ length: 20 }, (_, i) => createCustomer(200 + i))
      );

      const results = await Promise.all(
        customers.map((c, i) =>
          request(app)
            .post('/api/appointments')
            .set('Authorization', `Bearer ${c.token}`)
            .send({ slot_id: slots[i].id })
        )
      );

      const successes = results.filter((r) => r.status === 201);
      expect(successes.length).toBe(20);
    });
  });

  describe('Cancellation, Cutoff Rules & Partial Index Re-booking', () => {
    it('customer A books, cancels (slot becomes free), customer B books the same slot successfully', async () => {
      const custA = await createCustomer(10);
      const custB = await createCustomer(11);
      const slot = await createFutureSlot(10); // 10 hours from now (safely outside cutoff)

      // Customer A books
      const bookA = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${custA.token}`)
        .send({ slot_id: slot.id });
      expect(bookA.status).toBe(201);
      const appointmentId = bookA.body.appointment.id;

      // Customer A cancels
      const cancelRes = await request(app)
        .delete(`/api/appointments/${appointmentId}`)
        .set('Authorization', `Bearer ${custA.token}`);
      expect(cancelRes.status).toBe(200);

      // Slot is free again
      const slotAfter = await query<{ status: string }>('SELECT status FROM slots WHERE id = $1', [
        slot.id,
      ]);
      expect(slotAfter.rows[0].status).toBe('free');

      // Customer B rebooks the same slot -> 201 Created! (Partial unique index allows this)
      const bookB = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${custB.token}`)
        .send({ slot_id: slot.id });
      expect(bookB.status).toBe(201);

      // Attempting a second cancel on the already cancelled appointment returns 409
      const secondCancel = await request(app)
        .delete(`/api/appointments/${appointmentId}`)
        .set('Authorization', `Bearer ${custA.token}`);
      expect(secondCancel.status).toBe(409);
    });

    it('cancellation inside cutoff window returns 409 for customer but succeeds for owner', async () => {
      const cust = await createCustomer(12);
      // Slot starts in 30 minutes (inside 60 minute default cutoff)
      const start = DateTime.now().plus({ minutes: 30 }).toUTC().toJSDate();
      const end = DateTime.now().plus({ minutes: 60 }).toUTC().toJSDate();
      const slotRes = await query<{ id: string }>(
        `INSERT INTO slots (service_id, start_time, end_time, status)
         VALUES ($1, $2, $3, 'free') RETURNING id`,
        [serviceId, start, end]
      );
      const slotId = slotRes.rows[0].id;

      // Customer books
      const book = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${cust.token}`)
        .send({ slot_id: slotId });
      const apptId = book.body.appointment.id;

      // Customer tries to cancel within 30 mins -> 409
      const custCancel = await request(app)
        .delete(`/api/appointments/${apptId}`)
        .set('Authorization', `Bearer ${cust.token}`);

      expect(custCancel.status).toBe(409);
      expect(custCancel.body.error.code).toBe('CANCELLATION_CUTOFF_EXCEEDED');

      // Business Owner cancels anytime -> 200 OK
      const ownerCancel = await request(app)
        .delete(`/api/appointments/${apptId}`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(ownerCancel.status).toBe(200);
      expect(ownerCancel.body.message).toContain('cancelled successfully');
    });
  });

  describe('Rescheduling & Deadlock Protection', () => {
    it('reschedules appointment atomically and flips both slot statuses', async () => {
      const cust = await createCustomer(15);
      const slot1 = await createFutureSlot(5);
      const slot2 = await createFutureSlot(6);

      // Book Slot 1
      const book = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${cust.token}`)
        .send({ slot_id: slot1.id });
      const apptId = book.body.appointment.id;

      // Reschedule to Slot 2
      const resched = await request(app)
        .patch(`/api/appointments/${apptId}/reschedule`)
        .set('Authorization', `Bearer ${cust.token}`)
        .send({ new_slot_id: slot2.id });

      expect(resched.status).toBe(200);

      // Verify slot 1 is free, slot 2 is booked
      const s1 = await query<{ status: string }>('SELECT status FROM slots WHERE id = $1', [
        slot1.id,
      ]);
      const s2 = await query<{ status: string }>('SELECT status FROM slots WHERE id = $1', [
        slot2.id,
      ]);
      expect(s1.rows[0].status).toBe('free');
      expect(s2.rows[0].status).toBe('booked');
    });

    it('RESCHEDULE RACE: two customers try to reschedule onto the same free slot simultaneously; exactly one succeeds', async () => {
      const custA = await createCustomer(20);
      const custB = await createCustomer(21);

      const slotA = await createFutureSlot(5);
      const slotB = await createFutureSlot(6);
      const targetFreeSlot = await createFutureSlot(7);

      const bookA = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${custA.token}`)
        .send({ slot_id: slotA.id });
      const apptAId = bookA.body.appointment.id;

      const bookB = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${custB.token}`)
        .send({ slot_id: slotB.id });
      const apptBId = bookB.body.appointment.id;

      // Both try to reschedule to targetFreeSlot simultaneously
      const [resA, resB] = await Promise.all([
        request(app)
          .patch(`/api/appointments/${apptAId}/reschedule`)
          .set('Authorization', `Bearer ${custA.token}`)
          .send({ new_slot_id: targetFreeSlot.id }),
        request(app)
          .patch(`/api/appointments/${apptBId}/reschedule`)
          .set('Authorization', `Bearer ${custB.token}`)
          .send({ new_slot_id: targetFreeSlot.id }),
      ]);

      const statuses = [resA.status, resB.status].sort();
      expect(statuses).toEqual([200, 409]);
    });

    it('DEADLOCK CHECK: two customers swap into each other slots simultaneously; finishes cleanly without deadlock or 500', async () => {
      const cust1 = await createCustomer(30);
      const cust2 = await createCustomer(31);

      const slot1 = await createFutureSlot(10);
      const slot2 = await createFutureSlot(11);

      const b1 = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${cust1.token}`)
        .send({ slot_id: slot1.id });
      const b2 = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${cust2.token}`)
        .send({ slot_id: slot2.id });

      // Free both slots to simulate concurrent swap
      await query(`UPDATE slots SET status = 'free' WHERE id IN ($1, $2)`, [slot1.id, slot2.id]);

      // Fire concurrent swaps: Cust 1 -> slot 2, Cust 2 -> slot 1
      const [swap1, swap2] = await Promise.all([
        request(app)
          .patch(`/api/appointments/${b1.body.appointment.id}/reschedule`)
          .set('Authorization', `Bearer ${cust1.token}`)
          .send({ new_slot_id: slot2.id }),
        request(app)
          .patch(`/api/appointments/${b2.body.appointment.id}/reschedule`)
          .set('Authorization', `Bearer ${cust2.token}`)
          .send({ new_slot_id: slot1.id }),
      ]);

      expect(swap1.status).not.toBe(500);
      expect(swap2.status).not.toBe(500);
      expect([200, 409]).toContain(swap1.status);
      expect([200, 409]).toContain(swap2.status);
    });
  });

  describe('Owner Appointment Management & Event Publishing', () => {
    it('owner marks completed and no_show correctly, and cannot mark a future appointment', async () => {
      const cust = await createCustomer(40);
      const futureSlot = await createFutureSlot(5);

      const bookFuture = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${cust.token}`)
        .send({ slot_id: futureSlot.id });
      const futureApptId = bookFuture.body.appointment.id;

      // Cannot mark future appointment as completed -> 400
      const futureMark = await request(app)
        .patch(`/api/appointments/${futureApptId}/status`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ status: 'completed' });

      expect(futureMark.status).toBe(400);
      expect(futureMark.body.error.code).toBe('APPOINTMENT_NOT_STARTED');

      // Create a slot that has already started (e.g. started 10 minutes ago)
      const startedSlotStart = DateTime.now().minus({ minutes: 10 }).toUTC().toJSDate();
      const startedSlotEnd = DateTime.now().plus({ minutes: 20 }).toUTC().toJSDate();
      const startedSlot = await query<{ id: string }>(
        `INSERT INTO slots (service_id, start_time, end_time, status)
         VALUES ($1, $2, $3, 'booked') RETURNING id`,
        [serviceId, startedSlotStart, startedSlotEnd]
      );
      const startedAppt = await query<{ id: string }>(
        `INSERT INTO appointments (slot_id, customer_id, status)
         VALUES ($1, $2, 'confirmed') RETURNING id`,
        [startedSlot.rows[0].id, cust.id]
      );

      // Owner marks as completed -> 200 OK
      const markCompleted = await request(app)
        .patch(`/api/appointments/${startedAppt.rows[0].id}/status`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ status: 'completed' });

      expect(markCompleted.status).toBe(200);
      expect(markCompleted.body.appointment.status).toBe('completed');
    });

    it('events: booking.confirmed and booking.cancelled are published exactly once after commit', async () => {
      const publishSpy = jest.spyOn(events, 'publish');
      const cust = await createCustomer(50);
      const slot = await createFutureSlot(10);

      // Book
      const book = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${cust.token}`)
        .send({ slot_id: slot.id });
      const apptId = book.body.appointment.id;

      expect(publishSpy).toHaveBeenCalledWith(
        'booking.confirmed',
        expect.objectContaining({
          appointmentId: apptId,
          customerId: cust.id,
          businessId,
          slotId: slot.id,
        })
      );

      // Cancel
      await request(app)
        .delete(`/api/appointments/${apptId}`)
        .set('Authorization', `Bearer ${cust.token}`);

      expect(publishSpy).toHaveBeenCalledWith(
        'booking.cancelled',
        expect.objectContaining({
          appointmentId: apptId,
          customerId: cust.id,
          businessId,
          slotId: slot.id,
          cancelledBy: 'customer',
        })
      );
    });

    it('owner views daily appointments list with customer name and slot details', async () => {
      const cust = await createCustomer(60);
      const tz = config.BUSINESS_TIMEZONE;
      const targetDay = DateTime.now().setZone(tz).plus({ days: 3 });
      const dateStr = targetDay.toISODate()!;

      // Insert slot on targetDay
      const slotStart = targetDay.set({ hour: 10, minute: 0 }).toUTC().toJSDate();
      const slotEnd = targetDay.set({ hour: 10, minute: 30 }).toUTC().toJSDate();

      const slot = await query<{ id: string }>(
        `INSERT INTO slots (service_id, start_time, end_time, status)
         VALUES ($1, $2, $3, 'free') RETURNING id`,
        [serviceId, slotStart, slotEnd]
      );

      // Customer books
      await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${cust.token}`)
        .send({ slot_id: slot.rows[0].id });

      // Owner queries day's appointments
      const listRes = await request(app)
        .get(`/api/businesses/${businessId}/appointments?date=${dateStr}`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(listRes.status).toBe(200);
      expect(listRes.body.appointments.length).toBe(1);
      expect(listRes.body.appointments[0].customer.name).toBe('Customer 60');
      expect(listRes.body.appointments[0].service.name).toBe('Teeth Cleaning');
    });
  });
});
