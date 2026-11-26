import http from 'http';
import { AddressInfo } from 'net';
import request from 'supertest';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { createApp } from '../src/app';
import redis from '../src/config/redis';
import { events } from '../src/events';
import { clock } from '../src/utils/clock';
import { generateAccessToken } from '../src/modules/auth/auth.utils';
import { queueService } from '../src/modules/queue/queue.service';
import { queueRedisClient } from '../src/modules/queue/queue.redis';
import { closeSocketServer, initSocketServer } from '../src/socket';
import { config } from '../src/config';
import { setupTestDb, TestDbInstance } from './setupTestDb';

describe('Live Virtual Queue & Hybrid Check-in Module', () => {
  const origQueueMode = config.QUEUE_MODE;
  const origSocketMode = config.SOCKET_MODE;
  const origCheckinEarly = config.CHECKIN_EARLY_MINUTES;
  let testDb: TestDbInstance;
  let app: ReturnType<typeof createApp>;
  let httpServer: http.Server;
  let serverPort: number;

  let ownerId: string;
  let ownerToken: string;
  let otherOwnerId: string;
  let otherOwnerToken: string;
  let customer1Id: string;
  let customer1Token: string;
  let customer2Id: string;
  let customer2Token: string;
  let customer3Id: string;
  let customer3Token: string;

  let businessId: string;
  let business2Id: string;
  let serviceId: string;

  beforeAll(async () => {
    (config as any).QUEUE_MODE = 'embedded';
    (config as any).SOCKET_MODE = 'embedded';
    (config as any).CHECKIN_EARLY_MINUTES = 15;
    testDb = await setupTestDb();
    app = createApp();

    httpServer = http.createServer(app);
    initSocketServer(httpServer);
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => resolve());
    });
    serverPort = (httpServer.address() as AddressInfo).port;

    // Connect to Redis test database
    try {
      await redis.connect();
    } catch { }
  }, 15000);

  afterAll(async () => {
    (config as any).QUEUE_MODE = origQueueMode;
    (config as any).SOCKET_MODE = origSocketMode;
    (config as any).CHECKIN_EARLY_MINUTES = origCheckinEarly;
    clock.resetNow();
    await closeSocketServer();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    try {
      await redis.flushdb();
      await redis.quit();
    } catch { }
    await testDb.cleanup();
  });

  beforeEach(async () => {
    clock.resetNow();
    await testDb.resetData();
    await redis.flushdb();

    // Set fixed working-hours time: 2026-11-20 11:00:00 (Friday)
    // Friday in Asia/Kolkata is weekday 5. 11:00 AM is between 08:00 and 20:00
    const fixedNow = new Date('2026-11-20T05:30:00.000Z'); // 11:00 AM IST
    clock.setNow(fixedNow);

    // Seed test users
    ownerId = '11111111-1111-1111-1111-111111111111';
    ownerToken = generateAccessToken({ id: ownerId, role: 'owner' });

    otherOwnerId = '22222222-2222-2222-2222-222222222222';
    otherOwnerToken = generateAccessToken({ id: otherOwnerId, role: 'owner' });

    customer1Id = '33333333-3333-3333-3333-333333333333';
    customer1Token = generateAccessToken({ id: customer1Id, role: 'customer' });

    customer2Id = '44444444-4444-4444-4444-444444444444';
    customer2Token = generateAccessToken({ id: customer2Id, role: 'customer' });

    customer3Id = '55555555-5555-5555-5555-555555555555';
    customer3Token = generateAccessToken({ id: customer3Id, role: 'customer' });

    await testDb.db.public.none(`
      INSERT INTO users (id, name, email, password_hash, role) VALUES
      ('${ownerId}', 'Dr. Sharma', 'sharma@clinic.local', 'hash', 'owner'),
      ('${otherOwnerId}', 'Salon Owner', 'salon@test.local', 'hash', 'owner'),
      ('${customer1Id}', 'Rahul Customer', 'rahul@test.local', 'hash', 'customer'),
      ('${customer2Id}', 'Sneha Customer', 'sneha@test.local', 'hash', 'customer'),
      ('${customer3Id}', 'Amit Customer', 'amit@test.local', 'hash', 'customer');
    `);

    // Seed businesses
    businessId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    business2Id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

    await testDb.db.public.none(`
      INSERT INTO businesses (id, owner_id, name, category, address, city, phone, status, queue_open) VALUES
      ('${businessId}', '${ownerId}', 'City Health Clinic', 'clinic', '100 MG Road', 'Bengaluru', '+919999999991', 'approved', true),
      ('${business2Id}', '${otherOwnerId}', 'Style Salon', 'salon', '50 Indiranagar', 'Bengaluru', '+919999999992', 'approved', true);

      -- Working hours for all 7 days (0 to 6) 08:00 to 20:00
      INSERT INTO working_hours (business_id, day_of_week, open_time, close_time) VALUES
      ('${businessId}', 0, '08:00', '20:00'),
      ('${businessId}', 1, '08:00', '20:00'),
      ('${businessId}', 2, '08:00', '20:00'),
      ('${businessId}', 3, '08:00', '20:00'),
      ('${businessId}', 4, '08:00', '20:00'),
      ('${businessId}', 5, '08:00', '20:00'),
      ('${businessId}', 6, '08:00', '20:00'),
      ('${business2Id}', 5, '08:00', '20:00');

      -- Services
      INSERT INTO services (id, business_id, name, duration_minutes, price) VALUES
      ('88888888-8888-8888-8888-888888888888', '${businessId}', 'General Consultation', 30, 500);
    `);

    serviceId = '88888888-8888-8888-8888-888888888888';
  });

  describe('Basic Join, Duplicate Rules & Ticket Ordering', () => {
    it('join gives position 1, second customer gets position 2, and ticket numbers increase per day', async () => {
      const res1 = await request(app)
        .post(`/api/queue/${businessId}/join`)
        .set('Authorization', `Bearer ${customer1Token}`)
        .expect(201);

      expect(res1.body.position).toBe(1);
      expect(res1.body.ticketNumber).toBe(1);

      const res2 = await request(app)
        .post(`/api/queue/${businessId}/join`)
        .set('Authorization', `Bearer ${customer2Token}`)
        .expect(201);

      expect(res2.body.position).toBe(2);
      expect(res2.body.ticketNumber).toBe(2);

      // Verify public status
      const pubStatus = await request(app)
        .get(`/api/queue/${businessId}/status`)
        .expect(200);

      expect(pubStatus.body.waitingCount).toBe(2);
      expect(pubStatus.body.isOpen).toBe(true);
    });

    it('a customer joining twice gets 409, and a customer already in business A queue gets 409 for business B', async () => {
      // First join succeeds
      await request(app)
        .post(`/api/queue/${businessId}/join`)
        .set('Authorization', `Bearer ${customer1Token}`)
        .expect(201);

      // Same customer joins same business again -> 409
      const dupRes = await request(app)
        .post(`/api/queue/${businessId}/join`)
        .set('Authorization', `Bearer ${customer1Token}`)
        .expect(409);

      expect(dupRes.body.error.message).toMatch(/already in an active queue/i);

      // Same customer attempts to join another business -> 409
      const otherRes = await request(app)
        .post(`/api/queue/${business2Id}/join`)
        .set('Authorization', `Bearer ${customer1Token}`)
        .expect(409);

      expect(otherRes.body.error.message).toMatch(/already in an active queue/i);
    });
  });

  describe('Concurrency Stress Testing', () => {
    it('CONCURRENCY: 30 customers join the same business simultaneously -> positions 1 to 30, no duplicates, ZCARD = 30', async () => {
      // Create 30 customer tokens directly in memory
      const tokens: string[] = [];
      for (let i = 1; i <= 30; i++) {
        const id = `66666666-0000-0000-0000-${i.toString().padStart(12, '0')}`;
        await testDb.db.public.none(`
          INSERT INTO users (id, name, email, password_hash, role)
          VALUES ('${id}', 'Stress Customer ${i}', 'stress${i}@queueless.test', 'hash', 'customer');
        `);
        tokens.push(generateAccessToken({ id, role: 'customer' }));
      }

      // Fire 30 simultaneous joins
      const results = await Promise.all(
        tokens.map((token) =>
          request(app)
            .post(`/api/queue/${businessId}/join`)
            .set('Authorization', `Bearer ${token}`)
        )
      );

      // All 30 must succeed
      for (const res of results) {
        expect(res.status).toBe(201);
      }

      const positions = results.map((r) => r.body.position).sort((a, b) => a - b);
      const tickets = results.map((r) => r.body.ticketNumber).sort((a, b) => a - b);

      expect(positions).toHaveLength(30);
      expect(new Set(positions).size).toBe(30);
      expect(positions[0]).toBe(1);
      expect(positions[29]).toBe(30);

      expect(new Set(tickets).size).toBe(30);

      // Verify Redis ZCARD
      const zcard = await redis.zcard(`queue:${businessId}`);
      expect(zcard).toBe(30);
    });

    it('CONCURRENCY: the same customer fires 10 simultaneous joins, and exactly one succeeds with one row in queue_history', async () => {
      const results = await Promise.all(
        Array(10)
          .fill(null)
          .map(() =>
            request(app)
              .post(`/api/queue/${businessId}/join`)
              .set('Authorization', `Bearer ${customer1Token}`)
          )
      );

      const status201 = results.filter((r) => r.status === 201);
      const status409 = results.filter((r) => r.status === 409);

      expect(status201).toHaveLength(1);
      expect(status409).toHaveLength(9);

      // Exactly 1 row in DB
      const dbRows = await testDb.db.public.many(`
        SELECT * FROM queue_history WHERE customer_id = '${customer1Id}' AND status = 'waiting'
      `);
      expect(dbRows).toHaveLength(1);
    });
  });

  describe('FIFO & Calling Next with Auto-Completion', () => {
    it('FIFO: next calls customers in join order, and next auto-completes the previous entry', async () => {
      // Customer 1 joins at 11:00
      await request(app)
        .post(`/api/queue/${businessId}/join`)
        .set('Authorization', `Bearer ${customer1Token}`)
        .expect(201);

      // Customer 2 joins at 11:01
      clock.setNow(new Date('2026-11-20T05:31:00.000Z'));
      await request(app)
        .post(`/api/queue/${businessId}/join`)
        .set('Authorization', `Bearer ${customer2Token}`)
        .expect(201);

      // Owner calls next -> Customer 1 is called
      const next1 = await request(app)
        .post(`/api/queue/${businessId}/next`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(next1.body.current.customerId).toBe(customer1Id);
      expect(next1.body.current.ticketNumber).toBe(1);

      // Verify DB status of Customer 1 is 'called'
      const checkC1 = await testDb.db.public.one(`
        SELECT status FROM queue_history WHERE customer_id = '${customer1Id}'
      `);
      expect(checkC1.status).toBe('called');

      // Owner calls next again -> Customer 1 is auto-completed, Customer 2 is called
      clock.setNow(new Date('2026-11-20T05:40:00.000Z'));
      const next2 = await request(app)
        .post(`/api/queue/${businessId}/next`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(next2.body.current.customerId).toBe(customer2Id);
      expect(next2.body.current.ticketNumber).toBe(2);

      // Verify Customer 1 is completed
      const checkC1Completed = await testDb.db.public.one(`
        SELECT status, completed_at FROM queue_history WHERE customer_id = '${customer1Id}'
      `);
      expect(checkC1Completed.status).toBe('completed');
      expect(checkC1Completed.completed_at).not.toBeNull();

      // Owner calls next when queue is empty -> returns 409
      const emptyNext = await request(app)
        .post(`/api/queue/${businessId}/next`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(409);

      expect(emptyNext.body.error.code).toBe('QUEUE_EMPTY');
    });

    it('CONCURRENCY: two simultaneous POST /next calls call two different customers, never the same one', async () => {
      // Join 2 customers
      await request(app)
        .post(`/api/queue/${businessId}/join`)
        .set('Authorization', `Bearer ${customer1Token}`);
      await request(app)
        .post(`/api/queue/${businessId}/join`)
        .set('Authorization', `Bearer ${customer2Token}`);

      // Fire 2 simultaneous next calls
      const [res1, res2] = await Promise.all([
        request(app).post(`/api/queue/${businessId}/next`).set('Authorization', `Bearer ${ownerToken}`),
        request(app).post(`/api/queue/${businessId}/next`).set('Authorization', `Bearer ${ownerToken}`),
      ]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      const calledIds = [res1.body.current.customerId, res2.body.current.customerId];
      expect(new Set(calledIds).size).toBe(2);
      expect(calledIds).toContain(customer1Id);
      expect(calledIds).toContain(customer2Id);
    });
  });

  describe('Hybrid Queue Rules with Appointments and Clock Override', () => {
    it('hybrid rule: an appointment at 10:00 that checks in at 09:55 is behind a walk-in who joined at 09:50, ahead of a walk-in who joined at 10:05, rejected at 09:40 (too early), and rejected at 10:20 (too late)', async () => {
      const appointmentSlotStart = new Date('2026-11-20T04:30:00.000Z'); // 10:00 AM IST
      const appointmentSlotEnd = new Date('2026-11-20T05:00:00.000Z');

      const slotId = '11110000-0000-0000-0000-000000000001';
      const apptId = '22220000-0000-0000-0000-000000000002';

      await testDb.db.public.none(`
        INSERT INTO slots (id, service_id, start_time, end_time, status)
        VALUES ('${slotId}', '${serviceId}', '${appointmentSlotStart.toISOString()}', '${appointmentSlotEnd.toISOString()}', 'booked');

        INSERT INTO appointments (id, slot_id, customer_id, status)
        VALUES ('${apptId}', '${slotId}', '${customer1Id}', 'confirmed');
      `);

      // 1. Check-in attempt at 09:40 AM IST (20 min before 10:00 AM, early limit is 15 min) -> rejected 409
      clock.setNow(new Date('2026-11-20T04:10:00.000Z')); // 09:40 AM IST
      const tooEarlyRes = await request(app)
        .post(`/api/queue/${businessId}/check-in`)
        .set('Authorization', `Bearer ${customer1Token}`)
        .send({ appointment_id: apptId })
        .expect(409);

      expect(tooEarlyRes.body.error.code).toBe('CHECKIN_TOO_EARLY');

      // 2. Walk-in A joins at 09:50 AM IST
      clock.setNow(new Date('2026-11-20T04:20:00.000Z')); // 09:50 AM IST
      await request(app)
        .post(`/api/queue/${businessId}/walk-in`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Walk-in Early' })
        .expect(201);

      // 3. Customer 1 checks in at 09:55 AM IST (Within 15m window) -> succeeds!
      clock.setNow(new Date('2026-11-20T04:25:00.000Z')); // 09:55 AM IST
      const checkinRes = await request(app)
        .post(`/api/queue/${businessId}/check-in`)
        .set('Authorization', `Bearer ${customer1Token}`)
        .send({ appointment_id: apptId })
        .expect(201);

      expect(checkinRes.body.ticketNumber).toBeDefined();

      // 4. Walk-in B joins at 10:05 AM IST
      clock.setNow(new Date('2026-11-20T04:35:00.000Z')); // 10:05 AM IST
      await request(app)
        .post(`/api/queue/${businessId}/walk-in`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Walk-in Late' })
        .expect(201);

      // Check Queue Ordering:
      // Walk-in A joined at 09:50 -> score = 09:50 (Position 1)
      // Customer 1 checked in at 09:55 with appointment at 10:00 -> score = 10:00 (Position 2)
      // Walk-in B joined at 10:05 -> score = 10:05 (Position 3)
      const waiting = await queueRedisClient.getWaitingEntries(businessId);
      expect(waiting).toHaveLength(3);
      expect(waiting[0].walkInName).toBe('Walk-in Early');
      expect(waiting[1].customerId).toBe(customer1Id);
      expect(waiting[2].walkInName).toBe('Walk-in Late');

      // 5. Test Late Check-in rejection: Another appointment at 10:30 attempted at 10:50 (grace window 15 min) -> rejected 409
      const appt2SlotStart = new Date('2026-11-20T05:00:00.000Z'); // 10:30 AM IST
      const appt2SlotEnd = new Date('2026-11-20T05:30:00.000Z');
      const appt2SlotId = '11110000-0000-0000-0000-000000000003';
      const appt2Id = '22220000-0000-0000-0000-000000000004';
      await testDb.db.public.none(`
        INSERT INTO slots (id, service_id, start_time, end_time, status)
        VALUES ('${appt2SlotId}', '${serviceId}', '${appt2SlotStart.toISOString()}', '${appt2SlotEnd.toISOString()}', 'booked');

        INSERT INTO appointments (id, slot_id, customer_id, status)
        VALUES ('${appt2Id}', '${appt2SlotId}', '${customer2Id}', 'confirmed');
      `);

      clock.setNow(new Date('2026-11-20T05:20:00.000Z')); // 10:50 AM IST (20 min after start)
      const tooLateRes = await request(app)
        .post(`/api/queue/${businessId}/check-in`)
        .set('Authorization', `Bearer ${customer2Token}`)
        .send({ appointment_id: appt2Id })
        .expect(409);

      expect(tooLateRes.body.error.code).toBe('CHECKIN_EXPIRED');
    });
  });

  describe('Leave, Skip & Estimated Wait Calculation', () => {
    it('leave removes the entry and the positions of people behind decrease', async () => {
      // Customer 1, 2, 3 join
      await request(app).post(`/api/queue/${businessId}/join`).set('Authorization', `Bearer ${customer1Token}`);
      await request(app).post(`/api/queue/${businessId}/join`).set('Authorization', `Bearer ${customer2Token}`);
      await request(app).post(`/api/queue/${businessId}/join`).set('Authorization', `Bearer ${customer3Token}`);

      // Customer 3 checks position -> position 3
      const posBefore = await request(app)
        .get(`/api/queue/${businessId}/position`)
        .set('Authorization', `Bearer ${customer3Token}`)
        .expect(200);
      expect(posBefore.body.position).toBe(3);

      // Customer 2 leaves
      await request(app)
        .post(`/api/queue/${businessId}/leave`)
        .set('Authorization', `Bearer ${customer2Token}`)
        .expect(200);

      // Customer 3 checks position again -> position decreased to 2!
      const posAfter = await request(app)
        .get(`/api/queue/${businessId}/position`)
        .set('Authorization', `Bearer ${customer3Token}`)
        .expect(200);
      expect(posAfter.body.position).toBe(2);
    });

    it('estimated wait equals position x the rolling average (with history entries of known durations)', async () => {
      // Insert completed entries with known 10 minute durations (10:00 to 10:10)
      await testDb.db.public.none(`
        INSERT INTO queue_history (business_id, customer_id, joined_at, called_at, completed_at, status, ticket_number, source, score)
        VALUES
        ('${businessId}', NULL, '2026-11-20 09:00:00+00', '2026-11-20 09:10:00+00', '2026-11-20 09:20:00+00', 'completed', 100, 'walk_in', 1000),
        ('${businessId}', NULL, '2026-11-20 09:20:00+00', '2026-11-20 09:30:00+00', '2026-11-20 09:40:00+00', 'completed', 101, 'walk_in', 2000);
      `);

      // Clear any cached average in Redis
      await redis.del(`queue:avg_service:${businessId}`);

      // Join 3 customers
      await request(app).post(`/api/queue/${businessId}/join`).set('Authorization', `Bearer ${customer1Token}`);
      await request(app).post(`/api/queue/${businessId}/join`).set('Authorization', `Bearer ${customer2Token}`);
      const res3 = await request(app).post(`/api/queue/${businessId}/join`).set('Authorization', `Bearer ${customer3Token}`);

      // Position 3 with average 10 min service time = 30 min wait
      expect(res3.body.position).toBe(3);
      expect(res3.body.estimatedWaitMinutes).toBe(30);
    });

    it('skip with requeue puts the entry at the end', async () => {
      // Customer 1 and 2 join
      await request(app).post(`/api/queue/${businessId}/join`).set('Authorization', `Bearer ${customer1Token}`);
      clock.setNow(new Date('2026-11-20T05:32:00.000Z'));
      await request(app).post(`/api/queue/${businessId}/join`).set('Authorization', `Bearer ${customer2Token}`);

      // Owner calls next -> Customer 1 is current
      await request(app).post(`/api/queue/${businessId}/next`).set('Authorization', `Bearer ${ownerToken}`);

      // Owner skips with requeue = true
      clock.setNow(new Date('2026-11-20T05:35:00.000Z'));
      await request(app)
        .post(`/api/queue/${businessId}/skip`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ requeue: true })
        .expect(200);

      // Customer 1 was re-queued at the end (now behind Customer 2)
      const waiting = await queueRedisClient.getWaitingEntries(businessId);
      expect(waiting).toHaveLength(2);
      expect(waiting[0].customerId).toBe(customer2Id);
      expect(waiting[1].customerId).toBe(customer1Id);
    });
  });

  describe('Rebuild Queues Idempotency', () => {
    it('rebuildQueues: flush Redis, call rebuild, and the order and positions are identical', async () => {
      // Join Customer 1, 2, 3
      await request(app).post(`/api/queue/${businessId}/join`).set('Authorization', `Bearer ${customer1Token}`);
      clock.setNow(new Date('2026-11-20T05:32:00.000Z'));
      await request(app).post(`/api/queue/${businessId}/join`).set('Authorization', `Bearer ${customer2Token}`);
      clock.setNow(new Date('2026-11-20T05:34:00.000Z'));
      await request(app).post(`/api/queue/${businessId}/join`).set('Authorization', `Bearer ${customer3Token}`);

      const beforeRebuild = await queueRedisClient.getWaitingEntries(businessId);
      expect(beforeRebuild).toHaveLength(3);

      // Flush Redis completely
      await redis.flushdb();

      const afterFlush = await queueRedisClient.getWaitingEntries(businessId);
      expect(afterFlush).toHaveLength(0);

      // Rebuild queues from PostgreSQL
      await queueService.rebuildQueues();

      const afterRebuild = await queueRedisClient.getWaitingEntries(businessId);
      expect(afterRebuild).toHaveLength(3);
      expect(afterRebuild[0].id).toBe(beforeRebuild[0].id);
      expect(afterRebuild[1].id).toBe(beforeRebuild[1].id);
      expect(afterRebuild[2].id).toBe(beforeRebuild[2].id);
    });
  });

  describe('Authorization & Working Hours Restrictions', () => {
    it('an owner of another business gets 403 on next, a customer gets 403, and a closed queue gets 409', async () => {
      // Add one customer to queue
      await request(app).post(`/api/queue/${businessId}/join`).set('Authorization', `Bearer ${customer1Token}`);

      // Customer gets 403 on owner endpoint
      await request(app)
        .post(`/api/queue/${businessId}/next`)
        .set('Authorization', `Bearer ${customer1Token}`)
        .expect(403);

      // Other owner gets 403 on this business
      await request(app)
        .post(`/api/queue/${businessId}/next`)
        .set('Authorization', `Bearer ${otherOwnerToken}`)
        .expect(403);

      // Close the queue
      await request(app)
        .patch(`/api/queue/${businessId}/open`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ open: false })
        .expect(200);

      // Join returns 409 when queue is closed
      const closedRes = await request(app)
        .post(`/api/queue/${businessId}/join`)
        .set('Authorization', `Bearer ${customer2Token}`)
        .expect(409);

      expect(closedRes.body.error.code).toBe('QUEUE_CLOSED');
    });

    it('returns 409 on join outside working hours', async () => {
      // Set time to 23:00 (11:00 PM), outside 08:00 to 20:00
      clock.setNow(new Date('2026-11-20T17:30:00.000Z')); // 23:00 IST

      const res = await request(app)
        .post(`/api/queue/${businessId}/join`)
        .set('Authorization', `Bearer ${customer1Token}`)
        .expect(409);

      expect(res.body.error.code).toBe('OUTSIDE_WORKING_HOURS');
    });
  });

  describe('Socket.io Real-Time Events & Privacy Protection', () => {
    it('unauthenticated socket is rejected; customer receives live position and called events; privacy is preserved', async () => {
      // 1. Unauthenticated socket is rejected
      await new Promise<void>((resolve) => {
        const unauthSocket = ioClient(`http://localhost:${serverPort}`, {
          transports: ['websocket'],
          reconnection: false,
        });

        unauthSocket.on('connect_error', (err) => {
          expect(err.message).toMatch(/Authentication error/i);
          unauthSocket.disconnect();
          resolve();
        });
      });

      // 2. Connect Customer 1 and Customer 2
      const socketC1: ClientSocket = ioClient(`http://localhost:${serverPort}`, {
        auth: { token: customer1Token },
        transports: ['websocket'],
      });
      const socketC2: ClientSocket = ioClient(`http://localhost:${serverPort}`, {
        auth: { token: customer2Token },
        transports: ['websocket'],
      });

      await Promise.all([
        new Promise<void>((resolve) => socketC1.on('connect', () => resolve())),
        new Promise<void>((resolve) => socketC2.on('connect', () => resolve())),
      ]);

      // 3. Customer 2 joins queue:watch room
      await new Promise<void>((resolve) => {
        socketC2.emit('queue:watch', { businessId }, (ack: any) => {
          expect(ack.status).toBeDefined();
          resolve();
        });
      });

      // Customer 2 attempts watch-owner -> must be forbidden
      await new Promise<void>((resolve) => {
        socketC2.emit('queue:watch-owner', { businessId }, (ack: any) => {
          expect(ack.error).toMatch(/Forbidden/i);
          resolve();
        });
      });

      // 4. Customer 1 joins queue via REST -> Customer 1 receives queue:position
      const c1PosPromise = new Promise<any>((resolve) => {
        socketC1.on('queue:position', (data) => resolve(data));
      });

      await request(app)
        .post(`/api/queue/${businessId}/join`)
        .set('Authorization', `Bearer ${customer1Token}`)
        .expect(201);

      const c1Pos = await c1PosPromise;
      expect(c1Pos.ticketNumber).toBe(1);
      expect(c1Pos.position).toBe(1);

      // 5. Customer 2 joins queue -> Customer 2 receives queue:position
      const c2PosPromise = new Promise<any>((resolve) => {
        socketC2.on('queue:position', (data) => resolve(data));
      });

      await request(app)
        .post(`/api/queue/${businessId}/join`)
        .set('Authorization', `Bearer ${customer2Token}`)
        .expect(201);

      const c2Pos = await c2PosPromise;
      expect(c2Pos.ticketNumber).toBe(2);
      expect(c2Pos.position).toBe(2);

      // 6. Owner calls next -> Customer 1 receives queue:called, Customer 2 receives updated position 1!
      const c1CalledPromise = new Promise<any>((resolve) => {
        socketC1.on('queue:called', (data) => resolve(data));
      });
      const c2UpdatedPosPromise = new Promise<any>((resolve) => {
        socketC2.on('queue:position', (data) => resolve(data));
      });

      await request(app)
        .post(`/api/queue/${businessId}/next`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const calledData = await c1CalledPromise;
      expect(calledData.ticketNumber).toBe(1);

      const updatedC2Pos = await c2UpdatedPosPromise;
      expect(updatedC2Pos.position).toBe(1); // advanced to position 1!

      // 7. Privacy check: customer socket never received any event with another customer's name
      expect(c1Pos).not.toHaveProperty('name');
      expect(c1Pos).not.toHaveProperty('customerName');
      expect(updatedC2Pos).not.toHaveProperty('name');
      expect(updatedC2Pos).not.toHaveProperty('customerName');

      socketC1.disconnect();
      socketC2.disconnect();
    });

    it('events: queue.advanced carries the correct upcoming list', async () => {
      let advancedPayload: any = null;
      events.subscribe('queue.advanced', (payload) => {
        advancedPayload = payload;
      });

      // Join 3 customers
      await request(app).post(`/api/queue/${businessId}/join`).set('Authorization', `Bearer ${customer1Token}`);
      await request(app).post(`/api/queue/${businessId}/join`).set('Authorization', `Bearer ${customer2Token}`);
      await request(app).post(`/api/queue/${businessId}/join`).set('Authorization', `Bearer ${customer3Token}`);

      // Call next
      await request(app).post(`/api/queue/${businessId}/next`).set('Authorization', `Bearer ${ownerToken}`);

      // Wait a tick for event delivery
      await new Promise((r) => setTimeout(r, 50));

      expect(advancedPayload).not.toBeNull();
      expect(advancedPayload.businessId).toBe(businessId);
      expect(advancedPayload.calledCustomerId).toBe(customer1Id);
      expect(advancedPayload.upcoming).toHaveLength(2);
      expect(advancedPayload.upcoming[0]).toEqual({ customerId: customer2Id, position: 1 });
      expect(advancedPayload.upcoming[1]).toEqual({ customerId: customer3Id, position: 2 });
    });
  });
});
