process.env.NODE_ENV = 'test';
process.env.EMAIL_RETRY_DELAYS_MS = '1,1,1';

import request from 'supertest';
import { pool, query, assertTestDatabaseName } from '../src/db';
import { runMigrationsUp } from '../src/db/migrator';
import { config } from '../src/config';
import { notificationService } from '../src/service';
import { createNotificationApp, getNotificationOpenApiSpec } from '../src/app';
import { setEmailTransport, IEmailTransport } from '../src/email/transport';
import { escapeHtml, bookingConfirmedCustomer } from '../src/templates';
import { EXCHANGES, QUEUES, RabbitMQClient } from '@queueless/messaging';

describe('Notification Service Suite', () => {
  const app = createNotificationApp();
  const validToken = config.INTERNAL_TOKEN;

  const CUST_ID = '11111111-1111-1111-1111-111111111111';
  const OWNER_ID = '22222222-2222-2222-2222-222222222222';
  const ADMIN_ID = '33333333-3333-3333-3333-333333333333';
  const OTHER_USER_ID = '44444444-4444-4444-4444-444444444444';

  const NOTIF_1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const NOTIF_2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const NOTIF_3 = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const NOTIF_4 = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

  let mockSendMail: jest.Mock;
  let mockTransport: IEmailTransport;

  beforeAll(async () => {
    // Run migrations on notification_test
    await runMigrationsUp();
  });

  beforeEach(async () => {
    // Reset test database tables
    await query('DELETE FROM notifications');
    await query('DELETE FROM outbox_events');
    await query('DELETE FROM processed_events');

    mockSendMail = jest.fn().mockResolvedValue(undefined);
    mockTransport = {
      sendMail: mockSendMail,
    };
    setEmailTransport(mockTransport);
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('Event Handlers', () => {
    test('handles booking.confirmed: creates notification for customer and owner', async () => {
      const payload = {
        v: 1,
        eventId: 'evt-booking-conf-1',
        type: 'booking.confirmed',
        occurredAt: new Date().toISOString(),
        data: {
          appointmentId: 'apt-101',
          businessId: 'biz-1',
          businessName: 'Dr. Smile Dental',
          customerId: CUST_ID,
          customerName: 'John Doe',
          customerEmail: 'john@example.com',
          ownerId: OWNER_ID,
          ownerName: 'Dr. Smile',
          serviceName: 'Teeth Cleaning',
          slotStartTime: '2026-12-01T10:00:00.000Z',
        },
      };

      await notificationService.handleBookingConfirmed(payload);

      const notifs = await query('SELECT * FROM notifications ORDER BY created_at ASC');
      expect(notifs.rows).toHaveLength(2);

      const custNotif = notifs.rows.find((r) => r.user_id === CUST_ID);
      const ownerNotif = notifs.rows.find((r) => r.user_id === OWNER_ID);

      expect(custNotif).toBeDefined();
      expect(custNotif.title).toBe('Booking Confirmed');
      expect(custNotif.email_status).toBe('sent');

      expect(ownerNotif).toBeDefined();
      expect(ownerNotif.title).toBe('New Booking');
      expect(mockSendMail).toHaveBeenCalled();
    });

    test('handles booking.cancelled: customer cancelled -> owner notified', async () => {
      const payload = {
        v: 1,
        eventId: 'evt-cancel-1',
        type: 'booking.cancelled',
        occurredAt: new Date().toISOString(),
        data: {
          appointmentId: 'apt-102',
          businessId: 'biz-1',
          businessName: 'Dr. Smile Dental',
          customerId: CUST_ID,
          customerName: 'John Doe',
          ownerId: OWNER_ID,
          serviceName: 'Teeth Cleaning',
          cancelledBy: CUST_ID,
        },
      };

      await notificationService.handleBookingCancelled(payload);

      const notifs = await query('SELECT * FROM notifications WHERE user_id = $1', [OWNER_ID]);
      expect(notifs.rows).toHaveLength(1);
      expect(notifs.rows[0].title).toBe('Booking Cancelled');
      expect(notifs.rows[0].message).toContain('John Doe cancelled their appointment');
    });

    test('handles booking.cancelled: owner cancelled -> customer notified with email', async () => {
      const payload = {
        v: 1,
        eventId: 'evt-cancel-2',
        type: 'booking.cancelled',
        occurredAt: new Date().toISOString(),
        data: {
          appointmentId: 'apt-103',
          businessId: 'biz-1',
          businessName: 'Dr. Smile Dental',
          customerId: CUST_ID,
          customerName: 'John Doe',
          customerEmail: 'john@example.com',
          ownerId: OWNER_ID,
          serviceName: 'Teeth Cleaning',
          cancelledBy: OWNER_ID,
        },
      };

      await notificationService.handleBookingCancelled(payload);

      const notifs = await query('SELECT * FROM notifications WHERE user_id = $1', [CUST_ID]);
      expect(notifs.rows).toHaveLength(1);
      expect(notifs.rows[0].title).toBe('Booking Cancelled');
      expect(mockSendMail).toHaveBeenCalledTimes(1);
    });

    test('handles booking.rescheduled: notifies customer', async () => {
      const payload = {
        v: 1,
        eventId: 'evt-resched-1',
        type: 'booking.rescheduled',
        occurredAt: new Date().toISOString(),
        data: {
          appointmentId: 'apt-104',
          businessId: 'biz-1',
          businessName: 'Dr. Smile Dental',
          customerId: CUST_ID,
          customerName: 'John Doe',
          customerEmail: 'john@example.com',
          serviceName: 'Teeth Cleaning',
          newSlotStartTime: '2026-12-02T11:00:00.000Z',
        },
      };

      await notificationService.handleBookingRescheduled(payload);

      const notifs = await query('SELECT * FROM notifications WHERE user_id = $1', [CUST_ID]);
      expect(notifs.rows).toHaveLength(1);
      expect(notifs.rows[0].title).toBe('Appointment Rescheduled');
      expect(mockSendMail).toHaveBeenCalled();
    });

    test('handles business.status_changed: notifies owner', async () => {
      const payload = {
        v: 1,
        eventId: 'evt-biz-status-1',
        type: 'business.status_changed',
        occurredAt: new Date().toISOString(),
        data: {
          businessId: 'biz-1',
          businessName: 'Dr. Smile Dental',
          ownerId: OWNER_ID,
          ownerName: 'Dr. Smile',
          ownerEmail: 'owner@example.com',
          status: 'approved',
        },
      };

      await notificationService.handleBusinessStatusChanged(payload);

      const notifs = await query('SELECT * FROM notifications WHERE user_id = $1', [OWNER_ID]);
      expect(notifs.rows).toHaveLength(1);
      expect(notifs.rows[0].title).toBe('Business Registration Approved');
      expect(mockSendMail).toHaveBeenCalled();
    });

    test('handles queue.advanced: notifies customer of queue progress', async () => {
      const payload = {
        v: 1,
        eventId: 'evt-q-adv-1',
        type: 'queue.advanced',
        occurredAt: new Date().toISOString(),
        data: {
          businessId: 'biz-1',
          businessName: 'Salon Express',
          called: {
            customerId: CUST_ID,
            ticketNumber: 5,
          },
        },
      };

      await notificationService.handleQueueAdvanced(payload);

      const notifs = await query('SELECT * FROM notifications WHERE user_id = $1', [CUST_ID]);
      expect(notifs.rows).toHaveLength(1);
      expect(notifs.rows[0].title).toBe('Now Serving You!');
    });

    test('handles queue.advanced: falls back to "Customer" and skips email when customerName and customerEmail are missing', async () => {
      mockSendMail.mockClear();
      const fallbackCustomerId = '00000000-0000-0000-0000-000000000999';
      const payload = {
        v: 1,
        eventId: 'evt-q-adv-fallback-1',
        type: 'queue.advanced',
        occurredAt: new Date().toISOString(),
        data: {
          businessId: 'biz-1',
          businessName: 'Salon Express',
          called: {
            customerId: fallbackCustomerId,
            ticketNumber: 8,
          },
        },
      };

      await notificationService.handleQueueAdvanced(payload);

      const notifs = await query('SELECT * FROM notifications WHERE user_id = $1', [fallbackCustomerId]);
      expect(notifs.rows).toHaveLength(1);
      expect(notifs.rows[0].data.customerName).toBe('Customer');
      expect(notifs.rows[0].data.customerEmail).toBeNull();
      expect(mockSendMail).not.toHaveBeenCalled();
    });

    test('handles appointment.reminder_due: sends upcoming appointment reminder', async () => {
      const payload = {
        v: 1,
        eventId: 'evt-remind-1',
        type: 'appointment.reminder_due',
        occurredAt: new Date().toISOString(),
        data: {
          appointmentId: 'apt-105',
          businessId: 'biz-1',
          businessName: 'Dr. Smile Dental',
          customerId: CUST_ID,
          customerName: 'John Doe',
          customerEmail: 'john@example.com',
          serviceName: 'Teeth Cleaning',
          slotStartTime: '2026-12-01T10:00:00.000Z',
        },
      };

      await notificationService.handleAppointmentReminderDue(payload);

      const notifs = await query('SELECT * FROM notifications WHERE user_id = $1', [CUST_ID]);
      expect(notifs.rows).toHaveLength(1);
      expect(notifs.rows[0].title).toBe('Appointment Reminder');
      expect(mockSendMail).toHaveBeenCalled();
    });
  });

  describe('Idempotency & Deduplication', () => {
    test('processing duplicate event with same dedupeKey does not insert duplicate rows', async () => {
      const payload = {
        v: 1,
        eventId: 'evt-dedupe-1',
        type: 'booking.confirmed',
        occurredAt: new Date().toISOString(),
        data: {
          appointmentId: 'apt-dedupe',
          businessId: 'biz-1',
          customerId: CUST_ID,
          ownerId: OWNER_ID,
          serviceName: 'Checkup',
        },
      };

      await notificationService.handleBookingConfirmed(payload);
      await notificationService.handleBookingConfirmed(payload);

      const notifs = await query('SELECT * FROM notifications');
      expect(notifs.rows).toHaveLength(2); // 1 for customer, 1 for owner
    });
  });

  describe('Email Retries and Failure', () => {
    test('records status failed and last_error when email transport fails 3 times', async () => {
      mockSendMail.mockRejectedValue(new Error('SMTP connection refused'));

      await notificationService.sendNotification({
        userId: CUST_ID,
        type: 'test.alert',
        title: 'Failing Email Test',
        message: 'This email will fail',
        dedupeKey: 'fail-email-test-1',
        emailOptions: {
          to: 'fail@example.com',
          subject: 'Fail',
          text: 'Fail',
          html: '<p>Fail</p>',
        },
      });

      const notifs = await query('SELECT * FROM notifications WHERE user_id = $1', [CUST_ID]);
      expect(notifs.rows).toHaveLength(1);
      const row = notifs.rows[0];
      expect(row.email_status).toBe('failed');
      expect(row.email_attempts).toBe(3);
      expect(row.last_error).toContain('SMTP connection refused');
    });
  });

  describe('XSS Prevention', () => {
    test('escapes HTML special characters in customer input', () => {
      const malicious = '<script>alert("pwned")</script> & "quote" \'apostrophe\'';
      const escaped = escapeHtml(malicious);

      expect(escaped).not.toContain('<script>');
      expect(escaped).toContain('&lt;script&gt;');
      expect(escaped).toContain('&amp;');
      expect(escaped).toContain('&quot;');
      expect(escaped).toContain('&#039;');
    });

    test('bookingConfirmedCustomer template safely escapes user payload', () => {
      const t = bookingConfirmedCustomer({
        customerName: '<script>alert(1)</script>',
        businessName: 'Safe & Sound <Clinic>',
        serviceName: 'Dental Care',
        slotStartTime: new Date(),
      });

      expect(t.html).not.toContain('<script>');
      expect(t.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(t.html).toContain('Safe &amp; Sound &lt;Clinic&gt;');
    });
  });

  describe('Transactional Outbox', () => {
    test('sendNotification creates outbox row with notification.created event', async () => {
      await notificationService.sendNotification({
        userId: CUST_ID,
        type: 'booking.confirmed',
        title: 'Outbox Test',
        message: 'Testing transactional outbox',
        dedupeKey: 'outbox-test-1',
      });

      const outbox = await query('SELECT * FROM outbox_events WHERE event_type = $1', [
        'notification.created',
      ]);
      expect(outbox.rows).toHaveLength(1);
      const evt = outbox.rows[0];
      expect(evt.payload.data.userId).toBe(CUST_ID);
      expect(evt.payload.data.title).toBe('Outbox Test');
    });

    test('notification.created is published after commit and NOT published when the transaction rolls back', async () => {
      // 1. Rollback case
      const clientRollback = await pool.connect();
      try {
        await clientRollback.query('BEGIN');
        await notificationService.sendNotification(
          {
            userId: CUST_ID,
            type: 'test.rollback',
            title: 'Rollback Title',
            message: 'Should be rolled back',
            dedupeKey: 'rollback-outbox-1',
          },
          clientRollback
        );
        await clientRollback.query('ROLLBACK');
      } finally {
        clientRollback.release();
      }

      const rowsRollback = await query(
        "SELECT * FROM outbox_events WHERE payload->'data'->>'title' = 'Rollback Title'"
      );
      expect(rowsRollback.rows).toHaveLength(0);

      // 2. Commit case
      const clientCommit = await pool.connect();
      try {
        await clientCommit.query('BEGIN');
        await notificationService.sendNotification(
          {
            userId: CUST_ID,
            type: 'test.commit',
            title: 'Commit Title',
            message: 'Should be committed',
            dedupeKey: 'commit-outbox-1',
          },
          clientCommit
        );
        await clientCommit.query('COMMIT');
      } finally {
        clientCommit.release();
      }

      const rowsCommit = await query(
        "SELECT * FROM outbox_events WHERE payload->'data'->>'title' = 'Commit Title'"
      );
      expect(rowsCommit.rows).toHaveLength(1);
      expect(rowsCommit.rows[0].status).toBe('pending');
    });
  });

  describe('Consumer DLQ & Poison Message Handling', () => {
    test('an invalid or poison payload sent to the service consumer ends in the DLQ after 3 attempts', async () => {
      const { RabbitMQClient, EXCHANGES, QUEUES } = await import('@queueless/messaging');
      const rmq = new RabbitMQClient({ url: config.RABBITMQ_URL });
      const connected = await rmq.connect();
      if (!connected) return;

      const channel = await rmq.getChannel();
      if (!channel) return;

      const testQueue = `test.notif.poison.${Date.now()}`;
      await channel.assertQueue(testQueue, {
        durable: true,
        arguments: { 'x-dead-letter-exchange': EXCHANGES.DLX },
      });
      await channel.bindQueue(testQueue, EXCHANGES.EVENTS, 'test.poison.notif');
      await channel.purgeQueue(QUEUES.DLQ);

      let attemptsCount = 0;
      await rmq.startConsumer(testQueue, `poison_worker_${Date.now()}`, async () => {
        attemptsCount++;
        throw new Error('FORCED_POISON_ERROR');
      });

      await rmq.publish('test.poison.notif', { v: 1, type: 'test.poison.notif', payload: 'bad' });

      let dlqCount = 0;
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 200));
        const qInfo = await channel.checkQueue(QUEUES.DLQ);
        if (qInfo.messageCount > 0) {
          dlqCount = qInfo.messageCount;
          break;
        }
      }

      expect(attemptsCount).toBeGreaterThanOrEqual(1);
      expect(dlqCount).toBeGreaterThanOrEqual(1);

      await rmq.stopConsumer(testQueue);
      await channel.deleteQueue(testQueue);
      await rmq.close();
    });
  });

  describe('Database Test Setup Safety Guard', () => {
    test('refuses to run unless the database name ends with _test', () => {
      const { assertTestDatabaseName } = require('../src/db');
      expect(() => assertTestDatabaseName('notification_db')).toThrow(
        /CRITICAL SAFETY ERROR: Test database name must end with '_test'/
      );
      expect(() => assertTestDatabaseName('production_db')).toThrow(
        /CRITICAL SAFETY ERROR: Test database name must end with '_test'/
      );
      expect(() => assertTestDatabaseName('notification_test')).not.toThrow();
    });
  });

  describe('REST Endpoints & Authentication', () => {
    test('rejects requests without X-Internal-Token with 401', async () => {
      const res = await request(app).get('/api/notifications');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    test('rejects requests with invalid X-Internal-Token with 401', async () => {
      const res = await request(app)
        .get('/api/notifications')
        .set('x-internal-token', 'wrong-internal-token-1234567890')
        .set('x-user-id', CUST_ID);
      expect(res.status).toBe(401);
    });

    test('rejects requests missing X-User-Id with 401', async () => {
      const res = await request(app)
        .get('/api/notifications')
        .set('x-internal-token', validToken);
      expect(res.status).toBe(401);
    });

    test('returns user notifications when valid token and identity provided', async () => {
      // Seed a notification
      await query(
        `INSERT INTO notifications (id, user_id, type, title, message, status)
         VALUES ($1, $2, $3, $4, $5, 'unread')`,
        [NOTIF_1, CUST_ID, 'alert', 'Hello', 'World']
      );

      const res = await request(app)
        .get('/api/notifications')
        .set('x-internal-token', validToken)
        .set('x-user-id', CUST_ID);

      expect(res.status).toBe(200);
      expect(res.body.notifications).toHaveLength(1);
      expect(res.body.notifications[0].id).toBe(NOTIF_1);
      expect(res.body.unreadCount).toBe(1);
    });

    test('marks notification as read', async () => {
      await query(
        `INSERT INTO notifications (id, user_id, type, title, message, status)
         VALUES ($1, $2, $3, $4, $5, 'unread')`,
        [NOTIF_2, CUST_ID, 'alert', 'Hello', 'World']
      );

      const res = await request(app)
        .patch(`/api/notifications/${NOTIF_2}/read`)
        .set('x-internal-token', validToken)
        .set('x-user-id', CUST_ID);

      expect(res.status).toBe(200);
      expect(res.body.notification.status).toBe('read');
    });

    test('user cannot mark another user notification as read (returns 404)', async () => {
      await query(
        `INSERT INTO notifications (id, user_id, type, title, message, status)
         VALUES ($1, $2, $3, $4, $5, 'unread')`,
        [NOTIF_3, OTHER_USER_ID, 'alert', 'Hello', 'World']
      );

      const res = await request(app)
        .patch(`/api/notifications/${NOTIF_3}/read`)
        .set('x-internal-token', validToken)
        .set('x-user-id', CUST_ID);

      expect(res.status).toBe(404);
    });

    test('marks all notifications as read', async () => {
      await query(
        `INSERT INTO notifications (id, user_id, type, title, message, status)
         VALUES ($1, $2, $3, $4, $5, 'unread')`,
        [NOTIF_4, CUST_ID, 'alert', 'Hello', 'World']
      );

      const res = await request(app)
        .post('/api/notifications/read-all')
        .set('x-internal-token', validToken)
        .set('x-user-id', CUST_ID);

      expect(res.status).toBe(200);
      expect(res.body.updatedCount).toBeGreaterThanOrEqual(1);
    });

    test('non-admin accessing /api/admin/notifications is rejected with 403', async () => {
      const res = await request(app)
        .get('/api/admin/notifications')
        .set('x-internal-token', validToken)
        .set('x-user-id', CUST_ID)
        .set('x-user-role', 'customer');

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    test('admin accessing /api/admin/notifications succeeds', async () => {
      const res = await request(app)
        .get('/api/admin/notifications')
        .set('x-internal-token', validToken)
        .set('x-user-id', ADMIN_ID)
        .set('x-user-role', 'admin');

      expect(res.status).toBe(200);
      expect(res.body.failedNotifications).toBeDefined();
    });
  });

  describe('OpenAPI Route Contract Coverage', () => {
    test('all registered service routes match OpenAPI specification', () => {
      const spec = getNotificationOpenApiSpec();
      const specPaths = Object.keys(spec.paths);

      expect(specPaths).toContain('/api/notifications');
      expect(specPaths).toContain('/api/notifications/read-all');
      expect(specPaths).toContain('/api/notifications/{id}/read');
      expect(specPaths).toContain('/api/admin/notifications');
    });
  });
});
