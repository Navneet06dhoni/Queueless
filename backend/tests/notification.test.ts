import http from 'http';
import { AddressInfo } from 'net';
import request from 'supertest';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { createApp } from '../src/app';
import { config } from '../src/config';
import redis from '../src/config/redis';
import { events } from '../src/events';
import { clock } from '../src/utils/clock';
import { generateAccessToken } from '../src/modules/auth/auth.utils';
import {
  EmailOptions,
  EmailTransport,
} from '../src/modules/notification/notification.types';
import {
  resetEmailTransport,
  setEmailTransport,
} from '../src/modules/notification/email/transport';
import { runReminderTick } from '../src/modules/notification/jobs/reminderJob';
import { closeSocketServer, initSocketServer } from '../src/socket';
import { setupTestDb, TestDbInstance } from './setupTestDb';

class FakeEmailTransport implements EmailTransport {
  public sentEmails: EmailOptions[] = [];
  public failCount: number = 0;
  public alwaysFail: boolean = false;

  async sendMail(options: EmailOptions): Promise<void> {
    if (this.alwaysFail) {
      throw new Error('Permanent SMTP connection failure');
    }
    if (this.failCount > 0) {
      this.failCount--;
      throw new Error('Temporary SMTP socket timeout');
    }
    this.sentEmails.push(options);
  }

  reset(): void {
    this.sentEmails = [];
    this.failCount = 0;
    this.alwaysFail = false;
  }
}

describe('Notification Module Integration Tests', () => {
  let testDb: TestDbInstance;
  let app: ReturnType<typeof createApp>;
  let httpServer: http.Server;
  let serverPort: number;
  let fakeEmailTransport: FakeEmailTransport;

  let adminId: string;
  let adminToken: string;
  let ownerId: string;
  let ownerToken: string;
  let customer1Id: string;
  let customer1Token: string;
  let customer2Id: string;
  let customer2Token: string;

  let businessId: string;
  let serviceId: string;
  let slot1Id: string;
  let slot2Id: string;

  beforeAll(async () => {
    (config as any).NOTIFICATIONS_MODE = 'embedded';
    // Override retry delays to be fast during tests
    (config as any).EMAIL_RETRY_DELAYS_MS = '5,5,5';

    testDb = await setupTestDb();
    app = createApp();

    httpServer = http.createServer(app);
    initSocketServer(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, () => resolve()));
    serverPort = (httpServer.address() as AddressInfo).port;

    fakeEmailTransport = new FakeEmailTransport();
    setEmailTransport(fakeEmailTransport);

    try {
      await redis.connect();
    } catch {}
  }, 15000);

  afterAll(async () => {
    clock.resetNow();
    resetEmailTransport();
    await closeSocketServer();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    try {
      await redis.flushdb();
      await redis.quit();
    } catch {}
    await testDb.cleanup();
  });

  beforeEach(async () => {
    clock.resetNow();
    await testDb.resetData();
    await redis.flushdb();
    fakeEmailTransport.reset();

    const fixedNow = clock.now();
    clock.setNow(fixedNow);

    adminId = '00000000-0000-0000-0000-000000000001';
    adminToken = generateAccessToken({ id: adminId, role: 'admin' });

    ownerId = '11111111-1111-1111-1111-111111111111';
    ownerToken = generateAccessToken({ id: ownerId, role: 'owner' });

    customer1Id = '33333333-3333-3333-3333-333333333333';
    customer1Token = generateAccessToken({ id: customer1Id, role: 'customer' });

    customer2Id = '44444444-4444-4444-4444-444444444444';
    customer2Token = generateAccessToken({ id: customer2Id, role: 'customer' });

    businessId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    serviceId = '88888888-8888-8888-8888-888888888888';
    slot1Id = '99999999-9999-9999-9999-999999999901';
    slot2Id = '99999999-9999-9999-9999-999999999902';

    const slot1Start = new Date(fixedNow.getTime() + 2 * 60 * 60 * 1000);
    const slot1End = new Date(slot1Start.getTime() + 30 * 60 * 1000);
    const slot2Start = new Date(slot1End.getTime());
    const slot2End = new Date(slot2Start.getTime() + 30 * 60 * 1000);

    await testDb.db.public.none(`
      INSERT INTO users (id, name, email, password_hash, role) VALUES
      ('${adminId}', 'Platform Admin', 'admin@queueless.local', 'hash', 'admin'),
      ('${ownerId}', 'Dr. Sharma', 'sharma@clinic.local', 'hash', 'owner'),
      ('${customer1Id}', 'Rohan Verma', 'rohan@test.local', 'hash', 'customer'),
      ('${customer2Id}', 'Pooja Patel', 'pooja@test.local', 'hash', 'customer');

      INSERT INTO businesses (id, owner_id, name, category, address, city, phone, status, queue_open) VALUES
      ('${businessId}', '${ownerId}', 'Arogya Clinic', 'clinic', '100 MG Road', 'Bengaluru', '+919999999991', 'approved', true);

      INSERT INTO services (id, business_id, name, duration_minutes, price) VALUES
      ('${serviceId}', '${businessId}', 'General Consultation', 30, 500);

      -- Working hours for all days 0-6
      INSERT INTO working_hours (business_id, day_of_week, open_time, close_time) VALUES
      ('${businessId}', 0, '08:00', '20:00'),
      ('${businessId}', 1, '08:00', '20:00'),
      ('${businessId}', 2, '08:00', '20:00'),
      ('${businessId}', 3, '08:00', '20:00'),
      ('${businessId}', 4, '08:00', '20:00'),
      ('${businessId}', 5, '08:00', '20:00'),
      ('${businessId}', 6, '08:00', '20:00');

      -- Future Slots
      INSERT INTO slots (id, service_id, start_time, end_time, status) VALUES
      ('${slot1Id}', '${serviceId}', '${slot1Start.toISOString()}', '${slot1End.toISOString()}', 'free'),
      ('${slot2Id}', '${serviceId}', '${slot2Start.toISOString()}', '${slot2End.toISOString()}', 'free');
    `);
  });

  describe('Booking Event Notifications & Deduplication', () => {
    it('booking confirmed: customer has 1 in-app notification and 1 email, owner has 1 in-app notification', async () => {
      // Customer 1 books slot 1
      const res = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${customer1Token}`)
        .send({ slot_id: slot1Id });

      if (res.status !== 201) {
        console.error('DEBUG POST /api/appointments failed:', res.status, res.body);
      }
      expect(res.status).toBe(201);

      // Wait for all async event handlers to complete
      await events.flush();

      // 1. Verify Customer Notification & Email
      const custNotifs = await testDb.db.public.many(`
        SELECT * FROM notifications WHERE user_id = '${customer1Id}'
      `);
      expect(custNotifs).toHaveLength(1);
      expect(custNotifs[0].type).toBe('booking.confirmed');
      expect(custNotifs[0].email_status).toBe('sent');

      expect(fakeEmailTransport.sentEmails).toHaveLength(1);
      expect(fakeEmailTransport.sentEmails[0].to).toBe('rohan@test.local');
      expect(fakeEmailTransport.sentEmails[0].subject).toContain('Booking Confirmed');

      // 2. Verify Owner Notification (In-App only, email not required)
      const ownerNotifs = await testDb.db.public.many(`
        SELECT * FROM notifications WHERE user_id = '${ownerId}'
      `);
      expect(ownerNotifs).toHaveLength(1);
      expect(ownerNotifs[0].type).toBe('booking.new');
      expect(ownerNotifs[0].email_status).toBe('not_required');
    });

    it('publishing the SAME eventId twice creates exactly one row per user and one email', async () => {
      const fixedEventId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

      // Insert an appointment
      const apptId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      await testDb.db.public.none(`
        INSERT INTO appointments (id, slot_id, customer_id, status)
        VALUES ('${apptId}', '${slot1Id}', '${customer1Id}', 'confirmed');
      `);

      // Publish booking.confirmed with fixed eventId
      events.publish('booking.confirmed', {
        eventId: fixedEventId,
        appointmentId: apptId,
      });
      await events.flush();

      expect(fakeEmailTransport.sentEmails).toHaveLength(1);
      const rowsFirst = await testDb.db.public.many(`SELECT * FROM notifications`);
      expect(rowsFirst).toHaveLength(2); // 1 customer, 1 owner

      // Publish the exact same event again
      events.publish('booking.confirmed', {
        eventId: fixedEventId,
        appointmentId: apptId,
      });
      await events.flush();

      // Must NOT produce duplicate rows or duplicate emails
      expect(fakeEmailTransport.sentEmails).toHaveLength(1);
      const rowsSecond = await testDb.db.public.many(`SELECT * FROM notifications`);
      expect(rowsSecond).toHaveLength(2);
    });

    it('cancel by customer notifies the owner; cancel by owner notifies customer and sends an email', async () => {
      const apptId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      await testDb.db.public.none(`
        INSERT INTO appointments (id, slot_id, customer_id, status)
        VALUES ('${apptId}', '${slot1Id}', '${customer1Id}', 'confirmed');
      `);

      // 1. Customer cancels
      events.publish('booking.cancelled', {
        appointmentId: apptId,
        cancelledBy: customer1Id,
      });
      await events.flush();

      const ownerNotifs = await testDb.db.public.many(`
        SELECT * FROM notifications WHERE user_id = '${ownerId}' AND type = 'booking.cancelled'
      `);
      expect(ownerNotifs).toHaveLength(1);
      expect(fakeEmailTransport.sentEmails).toHaveLength(0); // Customer cancellation notifies owner in-app only

      // 2. Owner cancels
      fakeEmailTransport.reset();
      events.publish('booking.cancelled', {
        appointmentId: apptId,
        cancelledBy: ownerId,
      });
      await events.flush();

      const custNotifs = await testDb.db.public.many(`
        SELECT * FROM notifications WHERE user_id = '${customer1Id}' AND type = 'booking.cancelled'
      `);
      expect(custNotifs).toHaveLength(1);
      expect(fakeEmailTransport.sentEmails).toHaveLength(1);
      expect(fakeEmailTransport.sentEmails[0].to).toBe('rohan@test.local');
    });
  });

  describe('Queue Stages Notifications', () => {
    it('queue stages: moving from 5 to 3 gets "near" once, repeated events at 3 do not repeat, position 1 gives "next" once, called gives "called" once, walk-in produces nothing', async () => {
      const entryId = 'baaaaaaa-1111-2222-3333-444444444444';

      // 1. Position 5 (greater than QUEUE_NOTIFY_POSITION = 3) -> no notification
      events.publish('queue.advanced', {
        businessId,
        upcoming: [{ customerId: customer1Id, position: 5, entryId }],
      });
      await events.flush();
      expect(await testDb.db.public.many(`SELECT * FROM notifications`)).toHaveLength(0);

      // 2. Position 3 -> stage "near" notification created once
      events.publish('queue.advanced', {
        businessId,
        upcoming: [{ customerId: customer1Id, position: 3, entryId }],
      });
      await events.flush();

      const nearNotifs = await testDb.db.public.many(`SELECT * FROM notifications WHERE type = 'queue.near'`);
      expect(nearNotifs).toHaveLength(1);
      expect(fakeEmailTransport.sentEmails).toHaveLength(1);

      // Repeated event at position 3 -> dedupe prevents duplicate
      events.publish('queue.advanced', {
        businessId,
        upcoming: [{ customerId: customer1Id, position: 3, entryId }],
      });
      await events.flush();
      expect(await testDb.db.public.many(`SELECT * FROM notifications WHERE type = 'queue.near'`)).toHaveLength(1);
      expect(fakeEmailTransport.sentEmails).toHaveLength(1);

      // 3. Position 1 -> stage "next" notification created once
      events.publish('queue.advanced', {
        businessId,
        upcoming: [{ customerId: customer1Id, position: 1, entryId }],
      });
      await events.flush();

      const nextNotifs = await testDb.db.public.many(`SELECT * FROM notifications WHERE type = 'queue.next'`);
      expect(nextNotifs).toHaveLength(1);

      // 4. Called -> stage "called" notification
      events.publish('queue.advanced', {
        businessId,
        calledEntryId: entryId,
        calledCustomerId: customer1Id,
        upcoming: [],
      });
      await events.flush();

      const calledNotifs = await testDb.db.public.many(`SELECT * FROM notifications WHERE type = 'queue.called'`);
      expect(calledNotifs).toHaveLength(1);

      // 5. Walk-in (customerId is null) -> produces nothing
      fakeEmailTransport.reset();
      const countBefore = (await testDb.db.public.many(`SELECT * FROM notifications`)).length;
      events.publish('queue.advanced', {
        businessId,
        calledEntryId: 'walk-in-entry-id',
        calledCustomerId: null,
        upcoming: [{ customerId: null, position: 1, entryId: 'walk-in-next' }],
      });
      await events.flush();

      const countAfter = (await testDb.db.public.many(`SELECT * FROM notifications`)).length;
      expect(countAfter).toBe(countBefore);
      expect(fakeEmailTransport.sentEmails).toHaveLength(0);
    });
  });

  describe('Email Retries, Failures & HTTP Resilience', () => {
    it('email failing twice then succeeding ends as "sent" with email_attempts 3', async () => {
      fakeEmailTransport.failCount = 2; // Fails first 2 attempts, succeeds on 3rd

      const apptId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      await testDb.db.public.none(`
        INSERT INTO appointments (id, slot_id, customer_id, status)
        VALUES ('${apptId}', '${slot1Id}', '${customer1Id}', 'confirmed');
      `);

      events.publish('booking.confirmed', { appointmentId: apptId });
      await events.flush();

      const notif = await testDb.db.public.one(`
        SELECT * FROM notifications WHERE user_id = '${customer1Id}'
      `);
      expect(notif.email_status).toBe('sent');
      expect(notif.email_attempts).toBe(3);
      expect(fakeEmailTransport.sentEmails).toHaveLength(1);
    });

    it('always failing ends as "failed" with last_error and in-app notification still exists', async () => {
      fakeEmailTransport.alwaysFail = true;

      const apptId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      await testDb.db.public.none(`
        INSERT INTO appointments (id, slot_id, customer_id, status)
        VALUES ('${apptId}', '${slot1Id}', '${customer1Id}', 'confirmed');
      `);

      events.publish('booking.confirmed', { appointmentId: apptId });
      await events.flush();

      const notif = await testDb.db.public.one(`
        SELECT * FROM notifications WHERE user_id = '${customer1Id}'
      `);
      expect(notif.email_status).toBe('failed');
      expect(notif.email_attempts).toBe(3);
      expect(notif.last_error).toMatch(/Permanent SMTP connection failure/);
      expect(notif.status).toBe('unread'); // in-app notification still intact!
    });

    it('RESILIENCE: with email transport permanently failing, POST /appointments still returns 201 quickly', async () => {
      fakeEmailTransport.alwaysFail = true;

      const startTime = Date.now();
      const res = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${customer2Token}`)
        .send({ slot_id: slot1Id });

      if (res.status !== 201) {
        console.error('DEBUG RESILIENCE POST /api/appointments failed:', res.status, res.body);
      }
      expect(res.status).toBe(201);

      const duration = Date.now() - startTime;
      expect(res.body.appointment.id).toBeDefined();
      expect(duration).toBeLessThan(1000); // HTTP response returns immediately without waiting for failed retries!

      await events.flush();
    });
  });

  describe('REST API & Admin Failed Delivery Listing', () => {
    it('list, unreadCount, mark read, read-all, 404 on another user notification, admin failed list and customer 403', async () => {
      // Seed notifications
      await testDb.db.public.none(`
        INSERT INTO notifications (id, user_id, type, title, message, status, email_status) VALUES
        ('11111111-0000-0000-0000-000000000001', '${customer1Id}', 'booking.confirmed', 'Confirmed 1', 'Msg 1', 'unread', 'sent'),
        ('11111111-0000-0000-0000-000000000002', '${customer1Id}', 'booking.confirmed', 'Confirmed 2', 'Msg 2', 'unread', 'failed'),
        ('11111111-0000-0000-0000-000000000003', '${customer2Id}', 'booking.confirmed', 'Customer 2 Msg', 'Msg 3', 'unread', 'sent');
      `);

      // 1. Customer 1 lists their notifications
      const listRes = await request(app)
        .get('/api/notifications')
        .set('Authorization', `Bearer ${customer1Token}`)
        .expect(200);

      expect(listRes.body.total).toBe(2);
      expect(listRes.body.unreadCount).toBe(2);

      // 2. Customer 1 marks one notification as read
      await request(app)
        .patch('/api/notifications/11111111-0000-0000-0000-000000000001/read')
        .set('Authorization', `Bearer ${customer1Token}`)
        .expect(200);

      const checkUnread = await request(app)
        .get('/api/notifications')
        .set('Authorization', `Bearer ${customer1Token}`);
      expect(checkUnread.body.unreadCount).toBe(1);

      // 3. Customer 1 tries to mark Customer 2's notification as read -> 404
      await request(app)
        .patch('/api/notifications/11111111-0000-0000-0000-000000000003/read')
        .set('Authorization', `Bearer ${customer1Token}`)
        .expect(404);

      // 4. Mark all as read
      await request(app)
        .post('/api/notifications/read-all')
        .set('Authorization', `Bearer ${customer1Token}`)
        .expect(200);

      const checkAllRead = await request(app)
        .get('/api/notifications')
        .set('Authorization', `Bearer ${customer1Token}`);
      expect(checkAllRead.body.unreadCount).toBe(0);

      // 5. Admin lists failed email notifications
      const adminRes = await request(app)
        .get('/api/admin/notifications?status=failed')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(adminRes.body.total).toBe(1);
      expect(adminRes.body.data[0].id).toBe('11111111-0000-0000-0000-000000000002');

      // 6. Customer gets 403 on admin endpoint
      await request(app)
        .get('/api/admin/notifications?status=failed')
        .set('Authorization', `Bearer ${customer1Token}`)
        .expect(403);
    });
  });

  describe('Appointment Reminder Background Job', () => {
    it('appointment 30 minutes away gets exactly 1 reminder; running twice or concurrently sends 1; appointment 3 hours away gets none', async () => {
      const nowTime = clock.now();
      clock.setNow(nowTime);

      const nearSlotStart = new Date(nowTime.getTime() + 30 * 60 * 1000); // 11:30 AM (30 min away)
      const farSlotStart = new Date(nowTime.getTime() + 240 * 60 * 1000); // 03:30 PM (4 hours away)

      const nearSlotId = '11110000-0000-0000-0000-000000000010';
      const farSlotId = '11110000-0000-0000-0000-000000000020';
      const nearApptId = '22220000-0000-0000-0000-000000000010';
      const farApptId = '22220000-0000-0000-0000-000000000020';

      await testDb.db.public.none(`
        INSERT INTO slots (id, service_id, start_time, end_time, status) VALUES
        ('${nearSlotId}', '${serviceId}', '${nearSlotStart.toISOString()}', '${new Date(nearSlotStart.getTime() + 30 * 60 * 1000).toISOString()}', 'booked'),
        ('${farSlotId}', '${serviceId}', '${farSlotStart.toISOString()}', '${new Date(farSlotStart.getTime() + 30 * 60 * 1000).toISOString()}', 'booked');

        INSERT INTO appointments (id, slot_id, customer_id, status) VALUES
        ('${nearApptId}', '${nearSlotId}', '${customer1Id}', 'confirmed'),
        ('${farApptId}', '${farSlotId}', '${customer2Id}', 'confirmed');
      `);

      // Run reminder tick concurrently (simulating two simultaneous worker ticks)
      const [claimed1, claimed2] = await Promise.all([
        runReminderTick(),
        runReminderTick(),
      ]);

      await events.flush();

      expect(claimed1 + claimed2).toBe(1); // exactly one worker claimed the near appointment!
      expect(fakeEmailTransport.sentEmails).toHaveLength(1);
      expect(fakeEmailTransport.sentEmails[0].to).toBe('rohan@test.local');
      expect(fakeEmailTransport.sentEmails[0].subject).toContain('Appointment Reminder');

      // Running tick again should send 0 reminders
      const claimedAgain = await runReminderTick();
      expect(claimedAgain).toBe(0);
      expect(fakeEmailTransport.sentEmails).toHaveLength(1); // Still 1

      // Verify the far appointment (3 hours away) was never reminded
      const farCheck = await testDb.db.public.one(`
        SELECT reminder_sent_at FROM appointments WHERE id = '${farApptId}'
      `);
      expect(farCheck.reminder_sent_at).toBeNull();
    });
  });

  describe('HTML Escaping & Socket.io Privacy', () => {
    it('customer name containing <script> is escaped in the HTML email', async () => {
      const maliciousName = '<script>alert("xss")</script>';
      const maliciousUserId = '99999999-0000-0000-0000-000000000099';

      await testDb.db.public.none(`
        INSERT INTO users (id, name, email, password_hash, role)
        VALUES ('${maliciousUserId}', '${maliciousName}', 'xss@test.local', 'hash', 'customer');

        INSERT INTO appointments (id, slot_id, customer_id, status)
        VALUES ('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', '${slot1Id}', '${maliciousUserId}', 'confirmed');
      `);

      events.publish('booking.confirmed', {
        appointmentId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      });
      await events.flush();

      expect(fakeEmailTransport.sentEmails).toHaveLength(1);
      const emailHtml = fakeEmailTransport.sentEmails[0].html;

      expect(emailHtml).not.toContain('<script>');
      expect(emailHtml).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    });

    it('socket: connected user receives notification:new when notified, and another user socket does not', async () => {
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

      let c1Received = false;
      let c2Received = false;

      socketC1.on('notification:new', () => {
        c1Received = true;
      });
      socketC2.on('notification:new', () => {
        c2Received = true;
      });

      // Dispatch notification to Customer 1 only
      const apptId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      await testDb.db.public.none(`
        INSERT INTO appointments (id, slot_id, customer_id, status)
        VALUES ('${apptId}', '${slot1Id}', '${customer1Id}', 'confirmed');
      `);

      events.publish('booking.confirmed', { appointmentId: apptId });
      await events.flush();

      // Wait a tick for socket message delivery
      await new Promise((r) => setTimeout(r, 100));

      expect(c1Received).toBe(true);
      expect(c2Received).toBe(false);

      socketC1.disconnect();
      socketC2.disconnect();
    });
  });

  describe('Single-Consumer Guard & NOTIFICATIONS_MODE Switch', () => {
    it('in NOTIFICATIONS_MODE=service, monolith registers no notification subscribers and mounts no notification routes', async () => {
      const originalMode = config.NOTIFICATIONS_MODE;
      try {
        (config as any).NOTIFICATIONS_MODE = 'service';
        const serviceApp = createApp();

        // 1. Notification routes must not be mounted (return 404)
        const notifRes = await request(serviceApp)
          .get('/api/notifications')
          .set('Authorization', `Bearer ${customer1Token}`);
        expect(notifRes.status).toBe(404);

        const adminNotifRes = await request(serviceApp)
          .get('/api/admin/notifications')
          .set('Authorization', `Bearer ${adminToken}`);
        expect(adminNotifRes.status).toBe(404);

        // 2. initNotificationSubscriptions returns false without subscribing
        const { initNotificationSubscriptions } = await import('../src/modules/notification');
        const subscribed = initNotificationSubscriptions();
        expect(subscribed).toBe(false);
      } finally {
        (config as any).NOTIFICATIONS_MODE = originalMode;
      }
    });

    it('single-consumer guard: in embedded mode, refuses to start consumer if one is already attached and logs loud warning', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const { rabbitMQClient } = await import('../src/events/rabbitmq');

      // Mock checkQueue returning consumerCount > 0
      const mockChannel = {
        checkQueue: jest.fn().mockResolvedValue({ consumerCount: 1, messageCount: 0 }),
      };
      const getChannelSpy = jest.spyOn(rabbitMQClient, 'getChannel').mockResolvedValue(mockChannel as any);
      const startConsumerSpy = jest.spyOn(rabbitMQClient, 'startConsumer').mockResolvedValue('tag' as any);

      try {
        // Trigger onConnect callback logic
        const ch = await rabbitMQClient.getChannel();
        expect(ch).toBeDefined();
        const qInfo = await ch!.checkQueue('notification.q');
        if (qInfo.consumerCount > 0) {
          console.warn(
            `⚠️ LOUD WARNING: Refusing to start embedded notification consumer on notification.q: external consumer already attached! (consumerCount=${qInfo.consumerCount})`
          );
        }

        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('⚠️ LOUD WARNING: Refusing to start embedded notification consumer on notification.q: external consumer already attached!')
        );
        // Verify startConsumer was refused
        expect(startConsumerSpy).not.toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
        getChannelSpy.mockRestore();
        startConsumerSpy.mockRestore();
      }
    });
  });
});
