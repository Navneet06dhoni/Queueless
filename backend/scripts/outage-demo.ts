import http from 'http';
import { execSync } from 'child_process';
import amqp from 'amqplib';
import { createApp } from '../src/app';
import { config } from '../src/config';
import { pool } from '../src/db';
import { hashPassword, generateAccessToken } from '../src/modules/auth/auth.utils';
import { startOutboxRelay, stopOutboxRelay } from '../src/events/outboxRelay';
import { rabbitMQClient } from '../src/events/rabbitmq';
import redis from '../src/config/redis';

// Force RabbitMQ transport for this demo
process.env.EVENT_TRANSPORT = 'rabbitmq';
(config as any).EVENT_TRANSPORT = 'rabbitmq';

async function waitForRabbitMQ(maxWaitMs = 45000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const conn = await amqp.connect(config.RABBITMQ_URL);
      await conn.close();
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return false;
}

async function main() {
  console.log('======================================================================');
  console.log('🚨 QueueLess RabbitMQ Outage & Transactional Outbox End-to-End Demo');
  console.log('======================================================================\n');

  let passedAll = true;

  // 1. Clear MailHog
  console.log('[Step 1] Clearing MailHog mailbox via DELETE http://localhost:8025/api/v1/messages...');
  try {
    const clearRes = await fetch('http://localhost:8025/api/v1/messages', { method: 'DELETE' });
    if (!clearRes.ok) throw new Error(`HTTP ${clearRes.status}`);
    const mhCheck = await fetch('http://localhost:8025/api/v2/messages');
    const mhCheckData: any = await mhCheck.json();
    console.log(`✅ MailHog cleared. Current message count: ${mhCheckData.total}`);
  } catch (err: any) {
    console.warn(`⚠️ Warning: Could not clear MailHog (${err.message}). Continuing...`);
  }

  // 2. Stop RabbitMQ broker
  console.log('\n[Step 2] Stopping RabbitMQ container to simulate broker outage...');
  try {
    execSync('docker stop queueless_rabbitmq', { stdio: 'pipe' });
    console.log('🔴 RabbitMQ broker container stopped (queueless_rabbitmq is DOWN).');
  } catch (err: any) {
    console.log('⚠️ RabbitMQ may already be stopped:', err.message);
  }

  // 3. Start API server & Background Outbox Relay
  console.log('\n[Step 3] Initializing API application & background outbox relay...');
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as any;
  const baseUrl = `http://localhost:${address.port}`;
  console.log(`🚀 API server listening on ${baseUrl}`);

  // Start the background relay worker (polls every 500ms)
  startOutboxRelay(500);
  console.log('⚙️ Background outbox relay started (polling every 500ms).');

  // 4. Prepare test data (Admin, Owner, Business, Service, 3 Slots, 3 Customers)
  console.log('\n[Step 4] Preparing test data...');
  const pwdHash = await hashPassword('DemoPass123!');
  const runId = Date.now();

  // Admin user
  const adminRes = await pool.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ('Outage Admin', $1, $2, 'admin')
     RETURNING id`,
    [`outage_admin_${runId}@queueless.local`, pwdHash]
  );
  const adminId = adminRes.rows[0].id;
  const adminToken = generateAccessToken({ id: adminId, role: 'admin' });

  // Owner user & Business
  const ownerRes = await pool.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ('Outage Owner', $1, $2, 'owner')
     RETURNING id`,
    [`outage_owner_${runId}@queueless.local`, pwdHash]
  );
  const ownerId = ownerRes.rows[0].id;

  const bizRes = await pool.query(
    `INSERT INTO businesses (owner_id, name, category, address, city, phone, status)
     VALUES ($1, 'Outage Resilient Clinic', 'Healthcare', '456 Safe Ave', 'Bangalore', '+919988776655', 'approved')
     RETURNING id`,
    [ownerId]
  );
  const bizId = bizRes.rows[0].id;

  const svcRes = await pool.query(
    `INSERT INTO services (business_id, name, duration_minutes, price)
     VALUES ($1, 'General Consultation', 30, 500)
     RETURNING id`,
    [bizId]
  );
  const svcId = svcRes.rows[0].id;

  // 3 Slots in future
  const now = Date.now();
  const slotIds: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const start = new Date(now + (i + 1) * 3600000);
    const end = new Date(start.getTime() + 30 * 60000);
    const sRes = await pool.query(
      `INSERT INTO slots (service_id, start_time, end_time, status)
       VALUES ($1, $2, $3, 'free')
       RETURNING id`,
      [svcId, start, end]
    );
    slotIds.push(sRes.rows[0].id);
  }

  // 3 Customers
  const customerTokens: string[] = [];
  const customerEmails: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const email = `outage_cust_${runId}_${i}@queueless.local`;
    customerEmails.push(email);
    const cRes = await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, 'customer')
       RETURNING id`,
      [`Outage Customer ${i}`, email, pwdHash]
    );
    customerTokens.push(generateAccessToken({ id: cRes.rows[0].id, role: 'customer' }));
  }
  console.log(`✅ Test data ready: 3 slots and 3 customers created.`);

  // 5. Create 3 bookings while RabbitMQ is completely DOWN
  console.log('\n[Step 5] Creating 3 bookings through API while RabbitMQ is DOWN...');
  const appointmentIds: string[] = [];
  let bookingsSuccessful = true;

  for (let i = 0; i < 3; i++) {
    const slotId = slotIds[i];
    const token = customerTokens[i];

    const res = await fetch(`${baseUrl}/api/appointments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ slot_id: slotId }),
    });

    const body: any = await res.json();
    console.log(`   👉 Customer ${i + 1} booking slot ${slotId}: Status ${res.status}`);
    if (res.status === 201) {
      appointmentIds.push(body.appointment.id);
    } else {
      bookingsSuccessful = false;
      console.error('   ❌ Booking failed:', body);
    }
  }

  const assertion1 = bookingsSuccessful && appointmentIds.length === 3;
  console.log(`Assertion 1 (3 bookings returned 201 Created during outage): ${assertion1 ? 'PASS' : 'FAIL'}`);
  if (!assertion1) passedAll = false;

  // 6. Record the 3 outbox ids
  console.log('\n[Step 6] Recording outbox IDs for the 3 bookings from database...');
  const outboxRowsRes = await pool.query<{ id: string; status: string; event_type: string; payload: any }>(
    `SELECT id, status, event_type, payload
     FROM outbox_events
     WHERE event_type = 'booking.confirmed'
       AND payload->'data'->>'appointmentId' = ANY($1::text[])`,
    [appointmentIds]
  );

  const recordedOutboxIds = outboxRowsRes.rows.map((r) => r.id);
  const allPending = outboxRowsRes.rows.every((r) => r.status === 'pending');
  console.log(`📋 Recorded ${recordedOutboxIds.length} outbox IDs:`, recordedOutboxIds);

  const assertion2 = recordedOutboxIds.length === 3 && allPending;
  console.log(`Assertion 2 (3 outbox rows recorded with status 'pending'): ${assertion2 ? 'PASS' : 'FAIL'}`);
  if (!assertion2) passedAll = false;

  // 7. Restart RabbitMQ container
  console.log('\n[Step 7] Restoring RabbitMQ broker...');
  execSync('docker start queueless_rabbitmq', { stdio: 'pipe' });
  console.log('🟢 Waiting for RabbitMQ to accept connections...');
  const isUp = await waitForRabbitMQ(45000);
  if (!isUp) {
    throw new Error('RabbitMQ failed to recover within timeout');
  }
  console.log('✅ RabbitMQ broker is back online and accepting connections.');

  // Re-establish connection for client
  await rabbitMQClient.connect();

  // 8. Let the BACKGROUND relay recover (do not call tickOutboxRelay manually!)
  console.log('\n[Step 8] Waiting for BACKGROUND outbox relay to recover and process events...');
  let publishedCount = 0;
  const pollStart = Date.now();
  while (Date.now() - pollStart < 30000) {
    const checkRes = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count
       FROM outbox_events
       WHERE id = ANY($1::uuid[])
         AND status = 'published'`,
      [recordedOutboxIds]
    );
    publishedCount = parseInt(checkRes.rows[0].count, 10);
    if (publishedCount === 3) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  const assertion3 = publishedCount === 3;
  console.log(`Assertion 3 (All 3 outbox IDs reached status 'published' via background relay): ${assertion3 ? 'PASS' : 'FAIL'}`);
  if (!assertion3) passedAll = false;

  // 9. Assert MailHog holds exactly 3 confirmation emails for those bookings
  console.log('\n[Step 9] Verifying MailHog received exactly 3 confirmation emails...');
  let mailHogMatchingCount = 0;
  const mhStart = Date.now();

  while (Date.now() - mhStart < 20000) {
    try {
      const mhRes = await fetch('http://localhost:8025/api/v2/messages');
      const mhData: any = await mhRes.json();
      const items = mhData.items || [];

      // Filter messages for our 3 customer emails
      const matchingEmails = items.filter((item: any) => {
        const recipients = (item.To || []).map((t: any) => `${t.Mailbox}@${t.Domain}`);
        return recipients.some((r: string) => customerEmails.includes(r));
      });

      mailHogMatchingCount = matchingEmails.length;
      if (mailHogMatchingCount === 3) break;
    } catch {
      // Retry
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`📧 Found ${mailHogMatchingCount} confirmation emails in MailHog for the 3 bookings.`);
  const assertion4 = mailHogMatchingCount === 3;
  console.log(`Assertion 4 (MailHog holds exactly 3 confirmation emails for those bookings): ${assertion4 ? 'PASS' : 'FAIL'}`);
  if (!assertion4) passedAll = false;

  // 10. Summary & Final Verdict
  console.log('\n======================================================================');
  console.log('📊 OUTAGE RESILIENCE TEST RESULTS:');
  console.log(`   - [Assertion 1] 3 Bookings returned 201 during RabbitMQ outage: ${assertion1 ? 'PASS' : 'FAIL'}`);
  console.log(`   - [Assertion 2] 3 Outbox events recorded as pending in PostgreSQL: ${assertion2 ? 'PASS' : 'FAIL'}`);
  console.log(`   - [Assertion 3] Background relay automatically published all 3 events: ${assertion3 ? 'PASS' : 'FAIL'}`);
  console.log(`   - [Assertion 4] MailHog holds exactly 3 confirmation emails: ${assertion4 ? 'PASS' : 'FAIL'}`);
  console.log('----------------------------------------------------------------------');
  console.log(`🏁 FINAL VERDICT: ${passedAll ? 'PASS' : 'FAIL'}`);
  console.log('======================================================================\n');

  // Teardown
  stopOutboxRelay();
  await rabbitMQClient.close();
  await redis.quit();
  server.close();
  await pool.end();

  process.exit(passedAll ? 0 : 1);
}

main().catch((err) => {
  console.error('❌ Demo failed with error:', err);
  try {
    execSync('docker start queueless_rabbitmq', { stdio: 'pipe' });
  } catch {}
  process.exit(1);
});
