import http from 'http';
import { createApp } from '../src/app';
import { config } from '../src/config';
import { pool } from '../src/db';
import { generateAccessToken } from '../src/modules/auth/auth.utils';
import { events } from '../src/events';

async function isServerRunning(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  console.log('📬 Running Notification & MailHog Live Demo...\n');

  // 1. Fetch seed users and an approved business
  const custRes = await pool.query(
    `SELECT id, name, email FROM users WHERE email = 'customer1@example.com'`
  );
  const ownerRes = await pool.query(
    `SELECT id, name, email FROM users WHERE email = 'owner1@clinic.in'`
  );
  const bizRes = await pool.query(
    `SELECT id, name FROM businesses WHERE status = 'approved' AND queue_open = true LIMIT 1`
  );

  if (custRes.rows.length === 0 || ownerRes.rows.length === 0 || bizRes.rows.length === 0) {
    console.error('❌ Missing seed data. Please run: npm --prefix backend run seed');
    process.exit(1);
  }

  const customer = custRes.rows[0];
  const owner = ownerRes.rows[0];
  const business = bizRes.rows[0];

  console.log(`👤 Customer: ${customer.name} (${customer.email})`);
  console.log(`🏢 Owner:    ${owner.name} (${owner.email})`);
  console.log(`🏥 Business: ${business.name} (${business.id})\n`);

  // Direct tokens to avoid rate limiters
  const custToken = generateAccessToken({ id: customer.id, role: 'customer' });
  const ownerToken = generateAccessToken({ id: owner.id, role: 'owner' });

  // Ensure business has 24/7 working hours across all days for demo so joinQueue succeeds regardless of timezone/time
  await pool.query(
    `INSERT INTO working_hours (business_id, day_of_week, open_time, close_time)
     SELECT $1, s.d, '00:00:00', '23:59:59'
     FROM generate_series(0, 6) AS s(d)
     ON CONFLICT (business_id, day_of_week)
     DO UPDATE SET open_time = '00:00:00', close_time = '23:59:59'`,
    [business.id]
  );

  // 2. Ensure an HTTP server is reachable
  let serverInstance: http.Server | null = null;
  let targetBaseUrl = `http://localhost:${config.PORT}/api`;

  const serverAlreadyRunning = await isServerRunning(targetBaseUrl);
  if (!serverAlreadyRunning) {
    console.log(`🌐 Backend not running on port ${config.PORT}. Starting in-process HTTP server for demo...`);
    const app = createApp();
    serverInstance = http.createServer(app);
    await new Promise<void>((resolve) => {
      serverInstance!.listen(0, () => resolve());
    });
    const addr = serverInstance.address() as any;
    targetBaseUrl = `http://localhost:${addr.port}/api`;
  } else {
    console.log(`🌐 Using running backend server at ${targetBaseUrl}`);
  }

  // 3. Create a fresh free future slot for demo booking
  const svcRes = await pool.query(
    `SELECT id FROM services WHERE business_id = $1 LIMIT 1`,
    [business.id]
  );
  let serviceId: string;
  if (svcRes.rows.length > 0) {
    serviceId = svcRes.rows[0].id;
  } else {
    const newSvc = await pool.query(
      `INSERT INTO services (business_id, name, duration_minutes, price)
       VALUES ($1, 'General Physician Consultation', 30, 400)
       RETURNING id`,
      [business.id]
    );
    serviceId = newSvc.rows[0].id;
  }

  const slotRes = await pool.query(
    `INSERT INTO slots (service_id, start_time, end_time, status)
     VALUES ($1, NOW() + INTERVAL '2 hours' + (RANDOM() * 100000)::int * INTERVAL '1 millisecond', NOW() + INTERVAL '2 hours 30 minutes', 'free')
     RETURNING id`,
    [serviceId]
  );
  const targetSlotId = slotRes.rows[0].id;

  // Record initial notification counts
  const beforeCountRes = await pool.query(`SELECT COUNT(*) FROM notifications`);
  const initialNotifCount = Number(beforeCountRes.rows[0].count);

  // Clean up any conflicting previous appointment for customer to allow clean demo booking
  await pool.query(
    `UPDATE appointments SET status = 'cancelled' WHERE customer_id = $1 AND status = 'confirmed'`,
    [customer.id]
  );

  // Clear previous waiting entries for this customer to ensure clean demo run
  await pool.query(
    `UPDATE queue_history SET status = 'completed' WHERE customer_id = $1 AND status IN ('waiting', 'called')`,
    [customer.id]
  );
  try {
    const { queueRedis } = await import('../src/modules/queue/queue.redis');
    await queueRedis.removeFromQueue(business.id, customer.id);
  } catch {}

  console.log('1️⃣ Booking appointment as customer...');
  const bookRes = await fetch(`${targetBaseUrl}/appointments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${custToken}`,
    },
    body: JSON.stringify({ slot_id: targetSlotId }),
  });
  const bookData = await bookRes.json();
  console.log(`   Status: ${bookRes.status} (Appointment ID: ${bookData.appointment?.id || 'none'}) ${bookRes.status !== 201 ? JSON.stringify(bookData) : ''}`);

  console.log('2️⃣ Joining live virtual queue as customer...');
  const joinRes = await fetch(`${targetBaseUrl}/queue/${business.id}/join`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${custToken}`,
    },
  });
  const joinData = await joinRes.json();
  console.log(`   Status: ${joinRes.status} (Ticket #${joinData.ticketNumber || 'none'}, Position: ${joinData.position || 'none'}) ${joinRes.status !== 201 ? JSON.stringify(joinData) : ''}`);

  console.log('3️⃣ Calling next customer as business owner...');
  const nextRes = await fetch(`${targetBaseUrl}/queue/${business.id}/next`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ownerToken}`,
    },
  });
  const nextData = await nextRes.json();
  console.log(`   Status: ${nextRes.status} (Now Serving: ${nextData.current?.name || 'none'})`);

  // Wait for async events and email delivery to flush
  console.log('\n⏳ Awaiting async event handlers and MailHog SMTP delivery...');
  await events.flush();
  await new Promise((r) => setTimeout(r, 4500));

  // Query notifications produced
  const afterNotifs = await pool.query(
    `SELECT n.id, n.user_id, u.name as user_name, u.role, n.type, n.title, n.email_status, n.created_at
     FROM notifications n
     JOIN users u ON n.user_id = u.id
     ORDER BY n.created_at DESC
     LIMIT 10`
  );

  console.log('\n=== NOTIFICATIONS PRODUCED (PostgreSQL) ===');
  console.table(
    afterNotifs.rows.map((row) => ({
      Recipient: `${row.user_name} (${row.role})`,
      Type: row.type,
      Title: row.title,
      'Email Status': row.email_status,
      Time: new Date(row.created_at).toLocaleTimeString(),
    }))
  );

  // Check MailHog API if reachable
  try {
    const mhRes = await fetch('http://localhost:8025/api/v2/messages?limit=5', {
      signal: AbortSignal.timeout(2000),
    });
    if (mhRes.ok) {
      const mhData = await mhRes.json();
      console.log('=== EMAILS RECEIVED IN MAILHOG (http://localhost:8025) ===');
      console.log(`Total messages in MailHog: ${mhData.total}`);
      if (mhData.items && mhData.items.length > 0) {
        console.table(
          mhData.items.slice(0, 5).map((item: any) => ({
            ID: item.ID,
            To: item.Raw.To.join(', '),
            Subject: item.Content.Headers.Subject ? item.Content.Headers.Subject[0] : '',
            Date: new Date(item.Created).toLocaleTimeString(),
          }))
        );
      }
    }
  } catch {
    console.log('ℹ️ MailHog Web UI is accessible at http://localhost:8025');
  }

  if (serverInstance) {
    serverInstance.close();
  }
  await pool.end();

  console.log('\n========================================');
  console.log('🎉 Notification Demo Completed Successfully!');
  console.log('Open http://localhost:8025 in your browser to inspect formatted HTML emails.');
  console.log('========================================\n');
}

main().catch(async (err) => {
  console.error('Demo crashed:', err);
  try {
    await pool.end();
  } catch {}
  process.exitCode = 1;
});
