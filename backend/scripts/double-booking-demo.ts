import http from 'http';
import { createApp } from '../src/app';
import { config } from '../src/config';
import { pool } from '../src/db';
import { hashPassword, generateAccessToken } from '../src/modules/auth/auth.utils';

async function isServerRunning(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  console.log('🚀 Running Double-Booking Concurrency Demo...');

  // 1. Ensure 20 stress customers exist in database (idempotent)
  console.log('📦 Ensuring 20 stress customers exist in DB...');
  const passwordHash = await hashPassword('StressPass123!');
  const customers: { id: string; email: string }[] = [];

  for (let i = 1; i <= 20; i++) {
    const email = `stress_customer_${i}@queueless.local`;
    const name = `Stress Customer ${i}`;

    const res = await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, 'customer')
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, email`,
      [name, email, passwordHash]
    );
    customers.push(res.rows[0]);
  }
  console.log(`✅ 20 stress customers ready.`);

  // 2. Sign tokens directly using JWT helper (bypassing login rate limiter)
  const tokens = customers.map((c) =>
    generateAccessToken({ id: c.id, role: 'customer' })
  );

  // 3. Automatically find a free future slot of an approved business
  console.log('🔍 Looking for a free future slot in an approved business...');
  let slotRes = await pool.query(
    `SELECT s.id, s.start_time, s.service_id, b.name as business_name
     FROM slots s
     JOIN services sv ON s.service_id = sv.id
     JOIN businesses b ON sv.business_id = b.id
     WHERE b.status = 'approved'
       AND s.status = 'free'
       AND s.start_time > NOW() + INTERVAL '5 minutes'
     ORDER BY s.start_time ASC
     LIMIT 1`
  );

  let targetSlotId: string;

  if (slotRes.rows.length > 0) {
    targetSlotId = slotRes.rows[0].id;
    console.log(`🎯 Found existing free slot: ${targetSlotId} at ${slotRes.rows[0].business_name}`);
  } else {
    console.log('⚠️ No free future slot found. Generating a test approved business, service, and slot...');
    // Ensure an owner exists
    let ownerRes = await pool.query(`SELECT id FROM users WHERE role = 'owner' LIMIT 1`);
    let ownerId: string;
    if (ownerRes.rows.length === 0) {
      const insOwner = await pool.query(
        `INSERT INTO users (name, email, password_hash, role)
         VALUES ('Demo Owner', 'demo_owner@queueless.local', $1, 'owner')
         RETURNING id`,
        [passwordHash]
      );
      ownerId = insOwner.rows[0].id;
    } else {
      ownerId = ownerRes.rows[0].id;
    }

    // Create approved business
    const bizRes = await pool.query(
      `INSERT INTO businesses (owner_id, name, category, address, city, phone, status)
       VALUES ($1, 'Demo Clinic', 'clinic', '101 MG Road', 'Bengaluru', '+919876543210', 'approved')
       RETURNING id`,
      [ownerId]
    );
    const businessId = bizRes.rows[0].id;

    // Create service
    const svcRes = await pool.query(
      `INSERT INTO services (business_id, name, duration_minutes, price)
       VALUES ($1, 'General Consultation', 30, 500)
       RETURNING id`,
      [businessId]
    );
    const serviceId = svcRes.rows[0].id;

    // Create future slot (tomorrow at 10:00 AM)
    const futureTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
    futureTime.setHours(10, 0, 0, 0);
    const endTime = new Date(futureTime.getTime() + 30 * 60 * 1000);

    const newSlot = await pool.query(
      `INSERT INTO slots (service_id, start_time, end_time, status)
       VALUES ($1, $2, $3, 'free')
       RETURNING id`,
      [serviceId, futureTime, endTime]
    );
    targetSlotId = newSlot.rows[0].id;
    console.log(`🎯 Created new slot for demo: ${targetSlotId}`);
  }

  // 4. Ensure an HTTP server is reachable to handle the requests
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
    console.log(`🌐 Demo server listening on ${targetBaseUrl}`);
  } else {
    console.log(`🌐 Using running backend server at ${targetBaseUrl}`);
  }

  // 5. Fire 20 simultaneous POST /api/appointments for the slot
  console.log(`\n⚡ Firing 20 simultaneous booking requests for Slot ${targetSlotId}...`);
  const startTime = Date.now();

  const requests = tokens.map(async (token, idx) => {
    try {
      const res = await fetch(`${targetBaseUrl}/appointments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ slot_id: targetSlotId }),
      });
      const data = await res.json().catch(() => ({}));
      return { customer: idx + 1, status: res.status, data };
    } catch (err: any) {
      return { customer: idx + 1, status: 500, data: { error: err.message } };
    }
  });

  const results = await Promise.all(requests);
  const duration = Date.now() - startTime;
  console.log(`⏱️ Completed 20 concurrent requests in ${duration}ms\n`);

  // 6. Aggregate results into status code counts
  const statusCounts: Record<number, number> = {};
  for (const r of results) {
    statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
  }

  console.log('=== RESULTS TABLE ===');
  console.table(
    Object.entries(statusCounts).map(([status, count]) => ({
      'HTTP Status': Number(status),
      Count: count,
      Description:
        status === '201'
          ? 'Booked Successfully'
          : status === '409'
          ? 'Blocked (Conflict / Already Booked)'
          : 'Other',
    }))
  );

  // 7. Verify in PostgreSQL that exactly ONE active appointment exists for this slot
  const dbCheck = await pool.query(
    `SELECT a.id, a.customer_id, a.status, u.name, u.email
     FROM appointments a
     JOIN users u ON a.customer_id = u.id
     WHERE a.slot_id = $1 AND a.status <> 'cancelled'`,
    [targetSlotId]
  );

  console.log(`\n🔎 Database Verification for Slot ${targetSlotId}:`);
  console.log(`Active Appointments in DB: ${dbCheck.rowCount}`);
  if (dbCheck.rows[0]) {
    console.log(`Winning Booking ID: ${dbCheck.rows[0].id}`);
    console.log(`Customer: ${dbCheck.rows[0].name} (${dbCheck.rows[0].email})`);
  }

  // 8. Print PASS or FAIL
  const passed =
    statusCounts[201] === 1 &&
    statusCounts[409] === 19 &&
    dbCheck.rowCount === 1;

  if (serverInstance) {
    serverInstance.close();
  }
  await pool.end();

  if (passed) {
    console.log('\n========================================');
    console.log('✅ TEST RESULT: PASS');
    console.log('Concurrency locking flawlessly prevented double booking!');
    console.log('========================================\n');
  } else {
    console.error('\n========================================');
    console.error('❌ TEST RESULT: FAIL');
    console.error(`Expected: 1 x 201, 19 x 409, 1 DB row.`);
    console.error(`Received: ${JSON.stringify(statusCounts)}, DB rows: ${dbCheck.rowCount}`);
    console.error('========================================\n');
    process.exitCode = 1;
  }
}

main().catch(async (err) => {
  console.error('Demo script crashed:', err);
  try {
    await pool.end();
  } catch {}
  process.exitCode = 1;
});
