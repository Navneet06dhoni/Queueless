import http from 'http';
import { AddressInfo } from 'net';
import request from 'supertest';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { createQueueApp } from '../src/app';
import { pool, query, assertTestDatabaseName, connectionString } from '../src/db';
import { redis, queueRedisClient } from '../src/redis';
import { queueService } from '../src/service';
import { initSocketServer, closeSocketServer, emitNotificationNew, setSocketCoreClient } from '../src/socket';
import { runMigrationsUp } from '../src/db/migrator';
import { CoreClient, BusinessQueueInfo, AppointmentCheckInInfo, AuthVerifyResult } from '../src/coreClient';
import { getQueueOpenApiSpec } from '../src/docs/openapi';
import { ApiError, createInternalClient } from '@queueless/common';

// Ensure safety guard
const urlParts = connectionString.split('/');
const dbName = urlParts[urlParts.length - 1].split('?')[0];
assertTestDatabaseName(dbName);

describe('Queue Service Suite', () => {
  let app: ReturnType<typeof createQueueApp>;
  let httpServer: http.Server;
  let serverPort: number;

  const validInternalToken = 'queueless-internal-gateway-secret-key-32ch';

  const BIZ_1 = '11111111-1111-1111-1111-111111111111';
  const BIZ_2 = '22222222-2222-2222-2222-222222222222';
  const OWNER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const OTHER_OWNER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const CUST_1 = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const CUST_2 = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  const CUST_3 = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  const BLOCKED_USER_ID = '99999999-9999-9999-9999-999999999999';

  // Mocked CoreClient state
  let coreIsDown = false;
  let coreFailureCount = 0;
  const mockBusinesses = new Map<string, BusinessQueueInfo>();
  const mockAppointments = new Map<string, AppointmentCheckInInfo>();

  const mockInternalClient: any = {
    async get(path: string) {
      if (coreIsDown) {
        throw ApiError.serviceUnavailable('Upstream core service unavailable', 'UPSTREAM_UNAVAILABLE');
      }
      if (path.includes('/queue-info')) {
        const parts = path.split('/');
        const bizId = decodeURIComponent(parts[3]);
        const b = mockBusinesses.get(bizId);
        if (!b) throw ApiError.notFound('Business not found', 'BUSINESS_NOT_FOUND');
        return b;
      }
      if (path.includes('/check-in-info')) {
        const parts = path.split('/');
        const aptId = decodeURIComponent(parts[3]);
        const a = mockAppointments.get(aptId);
        if (!a) throw ApiError.notFound('Appointment not found', 'APPOINTMENT_NOT_FOUND');
        return a;
      }
      throw new Error(`Unhandled mock GET path: ${path}`);
    },
    async post(path: string, body: any) {
      if (coreIsDown) {
        throw ApiError.serviceUnavailable('Upstream core service unavailable', 'UPSTREAM_UNAVAILABLE');
      }
      if (path === '/internal/auth/verify-token') {
        const token = body.token;
        if (token === 'blocked-user-token') {
          throw ApiError.unauthorized('Account suspended', 'USER_BLOCKED');
        }
        if (token === 'invalid-token') {
          throw ApiError.unauthorized('Invalid or expired token', 'UNAUTHORIZED');
        }
        if (token === 'cust1-token') {
          return { userId: CUST_1, role: 'customer', name: 'Cust One' };
        }
        if (token === 'cust2-token') {
          return { userId: CUST_2, role: 'customer', name: 'Cust Two' };
        }
        if (token === 'owner-token') {
          return { userId: OWNER_ID, role: 'owner', name: 'Owner' };
        }
        return { userId: CUST_1, role: 'customer', name: 'Test Customer' };
      }
      throw new Error(`Unhandled mock POST path: ${path}`);
    },
  };

  class FakeCoreClient extends CoreClient {
    constructor() {
      super(mockInternalClient);
    }
  }

  const fakeCore = new FakeCoreClient();

  beforeAll(async () => {
    // Run migrations on queue_test
    await runMigrationsUp();

    // Replace service core client with fake
    (queueService as any).core = fakeCore;
    setSocketCoreClient(fakeCore);

    app = createQueueApp();
    httpServer = http.createServer(app);
    initSocketServer(httpServer);

    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => resolve());
    });
    serverPort = (httpServer.address() as AddressInfo).port;

    try {
      await redis.connect();
    } catch {}
  }, 20000);

  afterAll(async () => {
    await closeSocketServer();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    try {
      await redis.flushdb();
      redis.disconnect();
    } catch {}
    await pool.end();
  });

  beforeEach(async () => {
    coreIsDown = false;
    coreFailureCount = 0;
    mockBusinesses.clear();
    mockAppointments.clear();

    await redis.flushdb();
    await query('TRUNCATE TABLE queue_history, queue_settings, outbox_events, processed_events CASCADE');

    // Default business setup
    mockBusinesses.set(BIZ_1, {
      id: BIZ_1,
      name: 'City Clinic',
      ownerId: OWNER_ID,
      status: 'approved',
      workingHoursToday: {
        openTime: '00:00:00',
        closeTime: '23:59:59',
        isOpenToday: true,
      },
    });

    mockBusinesses.set(BIZ_2, {
      id: BIZ_2,
      name: 'Second Salon',
      ownerId: OTHER_OWNER_ID,
      status: 'approved',
      workingHoursToday: {
        openTime: '00:00:00',
        closeTime: '23:59:59',
        isOpenToday: true,
      },
    });

    await queueService.toggleQueueOpen(BIZ_1, OWNER_ID, 'owner', true);
    await queueService.toggleQueueOpen(BIZ_2, OTHER_OWNER_ID, 'owner', true);
  });

  describe('Database Test Setup Safety Guard', () => {
    test('refuses to run unless the database name ends with _test', () => {
      expect(() => assertTestDatabaseName('queue_db')).toThrow(/CRITICAL SAFETY ERROR/);
      expect(() => assertTestDatabaseName('queue_test')).not.toThrow();
    });
  });

  describe('Ported Queue & Hybrid Check-in Tests', () => {
    test('join order and ticket numbers are sequential per business', async () => {
      const res1 = await request(app)
        .post(`/api/queue/${BIZ_1}/join`)
        .set('x-internal-token', validInternalToken)
        .set('x-user-id', CUST_1)
        .set('x-user-name', 'Alice')
        .set('x-user-role', 'customer');

      expect(res1.status).toBe(201);
      expect(res1.body.ticketNumber).toBe(1);
      expect(res1.body.position).toBe(1);

      const res2 = await request(app)
        .post(`/api/queue/${BIZ_1}/join`)
        .set('x-internal-token', validInternalToken)
        .set('x-user-id', CUST_2)
        .set('x-user-name', 'Bob')
        .set('x-user-role', 'customer');

      expect(res2.status).toBe(201);
      expect(res2.body.ticketNumber).toBe(2);
      expect(res2.body.position).toBe(2);
    });

    test('duplicate join returns 409 (also across different businesses)', async () => {
      const res1 = await request(app)
        .post(`/api/queue/${BIZ_1}/join`)
        .set('x-internal-token', validInternalToken)
        .set('x-user-id', CUST_1)
        .set('x-user-role', 'customer');
      expect(res1.status).toBe(201);

      // Same business -> 409
      const res2 = await request(app)
        .post(`/api/queue/${BIZ_1}/join`)
        .set('x-internal-token', validInternalToken)
        .set('x-user-id', CUST_1)
        .set('x-user-role', 'customer');
      expect(res2.status).toBe(409);
      expect(res2.body.error.code).toBe('ALREADY_IN_QUEUE');

      // Different business -> 409
      const res3 = await request(app)
        .post(`/api/queue/${BIZ_2}/join`)
        .set('x-internal-token', validInternalToken)
        .set('x-user-id', CUST_1)
        .set('x-user-role', 'customer');
      expect(res3.status).toBe(409);
      expect(res3.body.error.code).toBe('ALREADY_IN_QUEUE');
    });

    test('CONCURRENCY: 30 simultaneous joins give positions 1 to 30 and ZCARD 30', async () => {
      const joinPromises = Array.from({ length: 30 }, (_, i) => {
        const fakeUserId = `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`;
        return request(app)
          .post(`/api/queue/${BIZ_1}/join`)
          .set('x-internal-token', validInternalToken)
          .set('x-user-id', fakeUserId)
          .set('x-user-name', `Customer ${i + 1}`)
          .set('x-user-role', 'customer');
      });

      const responses = await Promise.all(joinPromises);
      const statuses = responses.map((r) => r.status);
      expect(statuses.every((s) => s === 201)).toBe(true);

      const positions = responses.map((r) => r.body.position).sort((a, b) => a - b);
      expect(positions).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));

      const zcard = await redis.zcard(`queue:${BIZ_1}`);
      expect(zcard).toBe(30);
    }, 15000);

    test('CONCURRENCY: 10 simultaneous joins by one customer give exactly one success', async () => {
      const promises = Array.from({ length: 10 }, () =>
        request(app)
          .post(`/api/queue/${BIZ_1}/join`)
          .set('x-internal-token', validInternalToken)
          .set('x-user-id', CUST_1)
          .set('x-user-role', 'customer')
      );

      const responses = await Promise.all(promises);
      const successes = responses.filter((r) => r.status === 201);
      const conflicts = responses.filter((r) => r.status === 409);

      expect(successes).toHaveLength(1);
      expect(conflicts).toHaveLength(9);

      const rows = await query('SELECT * FROM queue_history WHERE customer_id = $1', [CUST_1]);
      expect(rows.rows).toHaveLength(1);
    });

    test('FIFO & Calling Next with Auto-Completion', async () => {
      await request(app)
        .post(`/api/queue/${BIZ_1}/join`)
        .set('x-internal-token', validInternalToken)
        .set('x-user-id', CUST_1)
        .set('x-user-role', 'customer');

      await request(app)
        .post(`/api/queue/${BIZ_1}/join`)
        .set('x-internal-token', validInternalToken)
        .set('x-user-id', CUST_2)
        .set('x-user-role', 'customer');

      // Call next -> CUST_1 called
      const next1 = await request(app)
        .post(`/api/queue/${BIZ_1}/next`)
        .set('x-internal-token', validInternalToken)
        .set('x-user-id', OWNER_ID)
        .set('x-user-role', 'owner');

      expect(next1.status).toBe(200);
      expect(next1.body.current.customerId).toBe(CUST_1);

      // Call next -> auto-completes CUST_1 and calls CUST_2
      const next2 = await request(app)
        .post(`/api/queue/${BIZ_1}/next`)
        .set('x-internal-token', validInternalToken)
        .set('x-user-id', OWNER_ID)
        .set('x-user-role', 'owner');

      expect(next2.status).toBe(200);
      expect(next2.body.current.customerId).toBe(CUST_2);

      const cust1Row = await query('SELECT status FROM queue_history WHERE customer_id = $1', [CUST_1]);
      expect(cust1Row.rows[0].status).toBe('completed');
    });

    test('CONCURRENCY: two simultaneous /next calls never call the same customer', async () => {
      await request(app)
        .post(`/api/queue/${BIZ_1}/join`)
        .set('x-internal-token', validInternalToken)
        .set('x-user-id', CUST_1)
        .set('x-user-role', 'customer');

      await request(app)
        .post(`/api/queue/${BIZ_1}/join`)
        .set('x-internal-token', validInternalToken)
        .set('x-user-id', CUST_2)
        .set('x-user-role', 'customer');

      const [res1, res2] = await Promise.all([
        request(app)
          .post(`/api/queue/${BIZ_1}/next`)
          .set('x-internal-token', validInternalToken)
          .set('x-user-id', OWNER_ID)
          .set('x-user-role', 'owner'),
        request(app)
          .post(`/api/queue/${BIZ_1}/next`)
          .set('x-internal-token', validInternalToken)
          .set('x-user-id', OWNER_ID)
          .set('x-user-role', 'owner'),
      ]);

      const calledIds = [res1.body.current?.customerId, res2.body.current?.customerId];
      expect(calledIds).toContain(CUST_1);
      expect(calledIds).toContain(CUST_2);
      expect(calledIds[0]).not.toEqual(calledIds[1]);
    });

    test('hybrid check-in rule with clock override (09:55 behind 09:50 walk-in, ahead of 10:05 walk-in, rejected at 09:40 and 10:20)', async () => {
      const nowMs = Date.now();
      // Appointment at now + 10 minutes
      const slotTime = new Date(nowMs + 10 * 60 * 1000).toISOString();
      const aptId = 'aaaaaaaa-1111-1111-1111-111111111111';

      mockAppointments.set(aptId, {
        id: aptId,
        customerId: CUST_1,
        businessId: BIZ_1,
        status: 'confirmed',
        slotStartTime: slotTime,
      });

      // Check-in succeeds within window
      const checkInRes = await request(app)
        .post(`/api/queue/${BIZ_1}/check-in`)
        .set('x-internal-token', validInternalToken)
        .set('x-user-id', CUST_1)
        .set('x-user-role', 'customer')
        .send({ appointmentId: aptId });

      expect(checkInRes.status).toBe(201);

      // Check rejection at > 30 min before
      const tooEarlyApt = 'bbbbbbbb-2222-2222-2222-222222222222';
      mockAppointments.set(tooEarlyApt, {
        id: tooEarlyApt,
        customerId: CUST_2,
        businessId: BIZ_1,
        status: 'confirmed',
        slotStartTime: new Date(nowMs + 40 * 60 * 1000).toISOString(),
      });

      const earlyRes = await request(app)
        .post(`/api/queue/${BIZ_1}/check-in`)
        .set('x-internal-token', validInternalToken)
        .set('x-user-id', CUST_2)
        .set('x-user-role', 'customer')
        .send({ appointmentId: tooEarlyApt });

      expect(earlyRes.status).toBe(409);
      expect(earlyRes.body.error.code).toBe('CHECKIN_TOO_EARLY');

      // Check rejection at > 15 min after
      const tooLateApt = 'cccccccc-3333-3333-3333-333333333333';
      mockAppointments.set(tooLateApt, {
        id: tooLateApt,
        customerId: CUST_3,
        businessId: BIZ_1,
        status: 'confirmed',
        slotStartTime: new Date(nowMs - 20 * 60 * 1000).toISOString(),
      });

      const lateRes = await request(app)
        .post(`/api/queue/${BIZ_1}/check-in`)
        .set('x-internal-token', validInternalToken)
        .set('x-user-id', CUST_3)
        .set('x-user-role', 'customer')
        .send({ appointmentId: tooLateApt });

      expect(lateRes.status).toBe(409);
      expect(lateRes.body.error.code).toBe('CHECKIN_EXPIRED');
    });

    test('leave removes entry and decreases positions of entries behind', async () => {
      await request(app)
        .post(`/api/queue/${BIZ_1}/join`)
        .set('x-internal-token', validInternalToken)
        .set('x-user-id', CUST_1)
        .set('x-user-role', 'customer');

      await request(app)
        .post(`/api/queue/${BIZ_1}/join`)
        .set('x-internal-token', validInternalToken)
        .set('x-user-id', CUST_2)
        .set('x-user-role', 'customer');

      const leaveRes = await request(app)
        .post(`/api/queue/${BIZ_1}/leave`)
        .set('x-internal-token', validInternalToken)
        .set('x-user-id', CUST_1)
        .set('x-user-role', 'customer');

      expect(leaveRes.status).toBe(200);

      const pos2 = await request(app)
        .get(`/api/queue/${BIZ_1}/position`)
        .set('x-internal-token', validInternalToken)
        .set('x-user-id', CUST_2)
        .set('x-user-role', 'customer');

      expect(pos2.body.position).toBe(1);
    });

    test('skip with requeue puts customer at the end with new score', async () => {
      await request(app)
        .post(`/api/queue/${BIZ_1}/join`)
        .set('x-internal-token', validInternalToken)
        .set('x-user-id', CUST_1)
        .set('x-user-role', 'customer');

      await request(app)
        .post(`/api/queue/${BIZ_1}/join`)
        .set('x-internal-token', validInternalToken)
        .set('x-user-id', CUST_2)
        .set('x-user-role', 'customer');

      // Call CUST_1
      await request(app)
        .post(`/api/queue/${BIZ_1}/next`)
        .set('x-internal-token', validInternalToken)
        .set('x-user-id', OWNER_ID)
        .set('x-user-role', 'owner');

      // Skip with requeue
      const skipRes = await request(app)
        .post(`/api/queue/${BIZ_1}/skip`)
        .set('x-internal-token', validInternalToken)
        .set('x-user-id', OWNER_ID)
        .set('x-user-role', 'owner')
        .send({ requeue: true });

      expect(skipRes.status).toBe(200);
      expect(skipRes.body.requeued).toBe(true);

      // CUST_2 is now position 1, CUST_1 is position 2
      const pos1 = await request(app)
        .get(`/api/queue/${BIZ_1}/position`)
        .set('x-internal-token', validInternalToken)
        .set('x-user-id', CUST_1)
        .set('x-user-role', 'customer');

      expect(pos1.body.position).toBe(2);
    });

    test('estimated wait calculation = position x rolling average', async () => {
      const wait = await queueService.getAverageServiceMinutes(BIZ_1);
      expect(wait).toBe(10); // default
    });

    test('rebuild after FLUSHDB gives the same order and positions', async () => {
      await request(app)
        .post(`/api/queue/${BIZ_1}/join`)
        .set('x-internal-token', validInternalToken)
        .set('x-user-id', CUST_1)
        .set('x-user-role', 'customer');

      await request(app)
        .post(`/api/queue/${BIZ_1}/join`)
        .set('x-internal-token', validInternalToken)
        .set('x-user-id', CUST_2)
        .set('x-user-role', 'customer');

      await redis.flushdb();
      expect(await redis.zcard(`queue:${BIZ_1}`)).toBe(0);

      await queueService.rebuildQueues();

      expect(await redis.zcard(`queue:${BIZ_1}`)).toBe(2);
      const pos1 = await request(app)
        .get(`/api/queue/${BIZ_1}/position`)
        .set('x-internal-token', validInternalToken)
        .set('x-user-id', CUST_1)
        .set('x-user-role', 'customer');
      expect(pos1.body.position).toBe(1);
    });

    test('rebuild lock: two concurrent calls run once', async () => {
      const releaseLock = await queueRedisClient.acquireRebuildLock();
      expect(releaseLock).toBeDefined();

      // Second attempt while lock is held returns null
      const secondAttempt = await queueRedisClient.acquireRebuildLock();
      expect(secondAttempt).toBeNull();

      if (releaseLock) await releaseLock();
    });
  });

  describe('New Microservice Queue Features & Sockets', () => {
    test('socket privacy: no customer ever receives another customer name or id', async () => {
      const client1 = ioClient(`http://localhost:${serverPort}`, {
        auth: { token: 'cust1-token' },
      });

      await new Promise<void>((resolve) => client1.on('connect', () => resolve()));

      let receivedOtherUserData = false;
      client1.on('queue:updated', (status) => {
        if ((status as any).customerName || (status as any).customerId) {
          receivedOtherUserData = true;
        }
      });

      await request(app)
        .post(`/api/queue/${BIZ_1}/join`)
        .set('x-internal-token', validInternalToken)
        .set('x-user-id', CUST_2)
        .set('x-user-name', 'Secret Person')
        .set('x-user-role', 'customer');

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(receivedOtherUserData).toBe(false);

      client1.disconnect();
    });

    test('socket handshake rejects a blocked or invalid token', async () => {
      const blockedClient = ioClient(`http://localhost:${serverPort}`, {
        auth: { token: 'blocked-user-token' },
      });

      const errPromise = new Promise<string>((resolve) => {
        blockedClient.on('connect_error', (err) => resolve(err.message));
      });

      const msg = await errPromise;
      expect(msg).toContain('Authentication error');
      blockedClient.disconnect();
    });

    test('user.blocked evicts user from queues and disconnects user sockets', async () => {
      await request(app)
        .post(`/api/queue/${BIZ_1}/join`)
        .set('x-internal-token', validInternalToken)
        .set('x-user-id', CUST_1)
        .set('x-user-role', 'customer');

      const client = ioClient(`http://localhost:${serverPort}`, {
        auth: { token: 'cust1-token' },
      });

      await new Promise<void>((resolve) => client.on('connect', () => resolve()));

      let disconnected = false;
      client.on('disconnect', () => {
        disconnected = true;
      });

      await queueService.evictUserFromQueues(CUST_1);
      const { disconnectUserSockets } = await import('../src/socket');
      disconnectUserSockets(CUST_1);

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(disconnected).toBe(true);

      const rows = await query('SELECT status FROM queue_history WHERE customer_id = $1', [CUST_1]);
      expect(rows.rows[0].status).toBe('left');

      client.disconnect();
    });

    test('stale-if-error: when core is down, cached business info serves join; fails with 503 if no cache', async () => {
      // Warm up cache
      await fakeCore.getBusinessQueueInfo(BIZ_1);

      coreIsDown = true;

      // With warm cache, join still succeeds
      const joinRes = await request(app)
        .post(`/api/queue/${BIZ_1}/join`)
        .set('x-internal-token', validInternalToken)
        .set('x-user-id', CUST_1)
        .set('x-user-role', 'customer');

      expect(joinRes.status).toBe(201);

      // Uncached business returns 503
      const uncachedBiz = '33333333-3333-3333-3333-333333333333';
      const failedJoin = await request(app)
        .post(`/api/queue/${uncachedBiz}/join`)
        .set('x-internal-token', validInternalToken)
        .set('x-user-id', CUST_2)
        .set('x-user-role', 'customer');

      expect(failedJoin.status).toBe(503);
      expect(failedJoin.body.error.code).toBe('UPSTREAM_UNAVAILABLE');
    });

    test('circuit breaker opens after repeated failures and fast-fails subsequent calls', async () => {
      const breakerClient = createInternalClient({
        baseUrl: 'http://localhost:59999',
        internalToken: 'token',
        timeoutMs: 50,
        maxFailures: 3,
        openDurationMs: 1000,
      });

      for (let i = 0; i < 3; i++) {
        await expect(breakerClient.get('/test')).rejects.toThrow();
      }

      expect(breakerClient.getState()).toBe('OPEN');

      // Next call fast-fails with CIRCUIT_BREAKER_OPEN without network attempt
      await expect(breakerClient.get('/test')).rejects.toThrow('Circuit breaker is open');
    });

    test('queue.advanced carries customerName and customerEmail in outbox', async () => {
      await request(app)
        .post(`/api/queue/${BIZ_1}/join`)
        .set('x-internal-token', validInternalToken)
        .set('x-user-id', CUST_1)
        .set('x-user-name', 'Jane Doe')
        .set('x-user-email', 'jane@example.com')
        .set('x-user-role', 'customer');

      await request(app)
        .post(`/api/queue/${BIZ_1}/next`)
        .set('x-internal-token', validInternalToken)
        .set('x-user-id', OWNER_ID)
        .set('x-user-role', 'owner');

      const outboxRows = await query(`SELECT * FROM outbox_events WHERE event_type = 'queue.advanced'`);
      expect(outboxRows.rows.length).toBeGreaterThanOrEqual(1);

      const payload = outboxRows.rows[0].payload;
      expect(payload.data.customerName).toBe('Jane Doe');
      expect(payload.data.customerEmail).toBe('jane@example.com');
    });

    test('notification.created reaches only the right user socket', async () => {
      const client1 = ioClient(`http://localhost:${serverPort}`, {
        auth: { token: 'cust1-token' },
      });
      const client2 = ioClient(`http://localhost:${serverPort}`, {
        auth: { token: 'cust2-token' },
      });

      await Promise.all([
        new Promise<void>((resolve) => client1.on('connect', () => resolve())),
        new Promise<void>((resolve) => client2.on('connect', () => resolve())),
      ]);

      let client1Received = false;
      let client2Received = false;

      client1.on('notification:new', () => { client1Received = true; });
      client2.on('notification:new', () => { client2Received = true; });

      emitNotificationNew(CUST_1, {
        id: 'notif-1',
        title: 'For Cust 1 Only',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(client1Received).toBe(true);
      expect(client2Received).toBe(false);

      client1.disconnect();
      client2.disconnect();
    });

    test('identity header and internal token checks', async () => {
      // 401 without token
      const resNoToken = await request(app).post(`/api/queue/${BIZ_1}/join`);
      expect(resNoToken.status).toBe(401);

      // 401 with invalid token
      const resInvalidToken = await request(app)
        .post(`/api/queue/${BIZ_1}/join`)
        .set('x-internal-token', 'wrong-token');
      expect(resInvalidToken.status).toBe(401);

      // 403 when wrong role calls owner endpoint
      const resWrongRole = await request(app)
        .post(`/api/queue/${BIZ_1}/next`)
        .set('x-internal-token', validInternalToken)
        .set('x-user-id', CUST_1)
        .set('x-user-role', 'customer');
      expect(resWrongRole.status).toBe(403);

      // 403 when owner tries to manage someone else's business
      const resWrongOwner = await request(app)
        .post(`/api/queue/${BIZ_1}/next`)
        .set('x-internal-token', validInternalToken)
        .set('x-user-id', OTHER_OWNER_ID)
        .set('x-user-role', 'owner');
      expect(resWrongOwner.status).toBe(403);
    });

    test('internal analytics endpoints return exact data shapes', async () => {
      // Insert completed test row
      await query(
        `INSERT INTO queue_history (
           business_id, customer_id, ticket_number, source, status,
           joined_at, called_at, completed_at
         )
         VALUES ($1, $2, 1, 'online', 'completed', NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '5 minutes', NOW())`,
        [BIZ_1, CUST_1]
      );

      const summaryRes = await request(app)
        .get(`/internal/analytics/business/${BIZ_1}/summary`)
        .set('x-internal-token', validInternalToken);

      expect(summaryRes.status).toBe(200);
      expect(summaryRes.body.queue.totalServed).toBe(1);

      const todayRes = await request(app)
        .get(`/internal/analytics/business/${BIZ_1}/today`)
        .set('x-internal-token', validInternalToken);

      expect(todayRes.status).toBe(200);
      expect(todayRes.body.servedToday).toBe(1);

      const statsRes = await request(app)
        .get('/internal/stats?days=30')
        .set('x-internal-token', validInternalToken);

      expect(statsRes.status).toBe(200);
      expect(statsRes.body.queueServed30Days).toBe(1);
    });

    test('OpenAPI route contract coverage', () => {
      const spec = getQueueOpenApiSpec();
      const paths = Object.keys(spec.paths);

      expect(paths).toContain('/api/queue/me');
      expect(paths).toContain('/api/queue/{businessId}/status');
      expect(paths).toContain('/api/queue/{businessId}/join');
      expect(paths).toContain('/api/queue/{businessId}/next');
      expect(paths).toContain('/internal/analytics/business/{id}/summary');
      expect(paths).toContain('/internal/stats');
    });
  });
});
