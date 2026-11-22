import crypto from 'crypto';
import { query } from '../src/db';
import { adminService } from '../src/modules/admin/admin.service';
import { events } from '../src/events';
import { initBookingSubscriptions } from '../src/modules/booking';
import { initQueueSubscriptions } from '../src/modules/queue';
import { queueRedis } from '../src/modules/queue/queue.redis';
import { setupTestDb, TestDbInstance } from './setupTestDb';

describe('user.blocked Decoupled Dual Consumption', () => {
  let testDb: TestDbInstance;
  let adminId: string;
  let customerId: string;
  let ownerId: string;
  let businessId: string;
  let serviceId: string;
  let slotId: string;
  let appointmentId: string;
  let queueEntryId: string;

  beforeAll(async () => {
    testDb = await setupTestDb();
    initBookingSubscriptions();
    initQueueSubscriptions();
  });

  afterAll(async () => {
    await events.flush();
    await testDb.cleanup();
  });

  beforeEach(async () => {
    // 1. Create admin, customer, owner
    adminId = crypto.randomUUID();
    customerId = crypto.randomUUID();
    ownerId = crypto.randomUUID();
    businessId = crypto.randomUUID();
    serviceId = crypto.randomUUID();
    slotId = crypto.randomUUID();
    appointmentId = crypto.randomUUID();
    queueEntryId = crypto.randomUUID();

    await query(`
      INSERT INTO users (id, name, email, password_hash, role)
      VALUES 
        ($1, 'Admin User', 'admin-block-test@test.local', 'hash', 'admin'),
        ($2, 'Bad Customer', 'bad-customer@test.local', 'hash', 'customer'),
        ($3, 'Biz Owner', 'biz-owner-block@test.local', 'hash', 'owner')
    `, [adminId, customerId, ownerId]);

    // 2. Create business and service
    await query(`
      INSERT INTO businesses (id, owner_id, name, address, city, phone, category, status, queue_open)
      VALUES ($1, $2, 'Blocked Test Biz', 'Addr', 'City', '9999999999', 'salon', 'approved', true)
    `, [businessId, ownerId]);

    await query(`
      INSERT INTO services (id, business_id, name, duration_minutes, price)
      VALUES ($1, $2, 'Haircut', 30, 25.00)
    `, [serviceId, businessId]);

    // 3. Create a future slot and booked appointment for the customer
    const futureTime = new Date(Date.now() + 24 * 60 * 60 * 1000); // Tomorrow
    const futureEndTime = new Date(futureTime.getTime() + 30 * 60 * 1000);

    await query(`
      INSERT INTO slots (id, service_id, start_time, end_time, status)
      VALUES ($1, $2, $3, $4, 'booked')
    `, [slotId, serviceId, futureTime.toISOString(), futureEndTime.toISOString()]);

    await query(`
      INSERT INTO appointments (id, slot_id, customer_id, status)
      VALUES ($1, $2, $3, 'confirmed')
    `, [appointmentId, slotId, customerId]);

    // 4. Create an active queue entry for the customer
    await query(`
      INSERT INTO queue_history (id, business_id, customer_id, ticket_number, source, score, joined_at, status)
      VALUES ($1, $2, $3, 101, 'online', 1000, NOW(), 'waiting')
    `, [queueEntryId, businessId, customerId]);

    await queueRedis.addEntry(businessId, {
      id: queueEntryId,
      businessId,
      customerId,
      ticketNumber: 101,
      source: 'online',
      joinedAt: new Date().toISOString(),
      score: 1000,
    });
  });

  afterEach(async () => {
    await queueRedis.clearBusinessQueue(businessId);
    await query(`DELETE FROM queue_history WHERE business_id = $1`, [businessId]);
    await query(`DELETE FROM appointments WHERE id = $1`, [appointmentId]);
    await query(`DELETE FROM slots WHERE id = $1`, [slotId]);
    await query(`DELETE FROM services WHERE id = $1`, [serviceId]);
    await query(`DELETE FROM businesses WHERE id = $1`, [businessId]);
    await query(`DELETE FROM users WHERE id IN ($1, $2, $3)`, [adminId, customerId, ownerId]);
    await query(`DELETE FROM admin_audit_log WHERE admin_id = $1`, [adminId]);
  });

  test('admin blocks user: booking module cancels appointments and queue module evicts from queues via user.blocked event', async () => {
    // Before blocking: appointment is confirmed, slot is booked, user is waiting in queue
    const apptBefore = await query(`SELECT status FROM appointments WHERE id = $1`, [appointmentId]);
    expect(apptBefore.rows[0].status).toBe('confirmed');

    const slotBefore = await query(`SELECT status FROM slots WHERE id = $1`, [slotId]);
    expect(slotBefore.rows[0].status).toBe('booked');

    const waitingBefore = await queueRedis.getWaitingEntries(businessId);
    expect(waitingBefore.some((e) => e.customerId === customerId)).toBe(true);

    // Admin blocks user
    const result = await adminService.blockUser(adminId, customerId, 'Policy violation');
    expect(result.message).toBe('User blocked successfully');

    // Flush event bus so asynchronous handlers for user.blocked execute
    await events.flush();

    // Verify 1: User record is blocked
    const userRes = await query<{ is_blocked: boolean; blocked_reason: string }>(
      `SELECT is_blocked, blocked_reason FROM users WHERE id = $1`,
      [customerId]
    );
    expect(userRes.rows[0].is_blocked).toBe(true);
    expect(userRes.rows[0].blocked_reason).toBe('Policy violation');

    // Verify 2: Booking module reacted - appointment cancelled and slot freed
    const apptAfter = await query<{ status: string }>(
      `SELECT status FROM appointments WHERE id = $1`,
      [appointmentId]
    );
    expect(apptAfter.rows[0].status).toBe('cancelled');

    const slotAfter = await query<{ status: string }>(
      `SELECT status FROM slots WHERE id = $1`,
      [slotId]
    );
    expect(slotAfter.rows[0].status).toBe('free');

    // Verify 3: Queue module reacted - user evicted from live queue
    const waitingAfter = await queueRedis.getWaitingEntries(businessId);
    expect(waitingAfter.some((e) => e.customerId === customerId)).toBe(false);

    const queueHistoryAfter = await query<{ status: string }>(
      `SELECT status FROM queue_history WHERE id = $1`,
      [queueEntryId]
    );
    expect(queueHistoryAfter.rows[0].status).toBe('left');
  });
});
