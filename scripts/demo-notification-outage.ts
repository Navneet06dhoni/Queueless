import { execSync, spawn, ChildProcess } from 'child_process';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../backend/.env') });

const GATEWAY_URL = 'http://localhost:8080';
const BACKEND_URL = 'http://localhost:5000';
const MAILHOG_URL = 'http://localhost:8025';
const RABBITMQ_API = 'http://localhost:15672/api/queues/%2F/notification.q';
const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/queueless';
const NOTIF_DB_URL = 'postgresql://notification_user:notification_password@localhost:5432/notification_db';

const pool = new Pool({ connectionString: DB_URL });
const notifPool = new Pool({ connectionString: NOTIF_DB_URL });

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isBackendRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/health`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForBackend(maxWaitMs = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (await isBackendRunning()) return true;
    await sleep(500);
  }
  return false;
}

function killProcessTree(pid: number) {
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', pid.toString(), '/T', '/F']);
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch {
    // Ignore
  }
}

async function runOutageDemo() {
  console.log('⚡ Starting Notification Service Outage & Queue Decoupling Demo...\n');

  let backendProc: ChildProcess | null = null;
  const alreadyRunning = await isBackendRunning();

  if (!alreadyRunning) {
    console.log('📦 Launching monolith backend on port 5000 (NOTIFICATIONS_MODE=service)...');
    const serverScript = path.resolve(__dirname, '../backend/src/server.ts');
    backendProc = spawn('npx', ['tsx', serverScript], {
      cwd: path.resolve(__dirname, '..'),
      shell: true,
      stdio: 'pipe',
      env: { ...process.env, PORT: '5000', NOTIFICATIONS_MODE: 'service', EVENT_TRANSPORT: 'rabbitmq' },
    });

    const ready = await waitForBackend();
    if (!ready) {
      if (backendProc.pid) killProcessTree(backendProc.pid);
      throw new Error('Failed to start monolith backend on port 5000 within 15 seconds');
    }
    console.log('✅ Monolith backend is up on http://localhost:5000\n');
  }

  try {
    // 1. Clear MailHog before test
    console.log('🧹 Clearing MailHog messages (DELETE http://localhost:8025/api/v1/messages)...');
    await fetch(`${MAILHOG_URL}/api/v1/messages`, { method: 'DELETE' }).catch(() => {});
    console.log('   ✅ MailHog cleared.');

    // 2. Register fresh customer (no customer1 reuse)
    const custEmail = `outage_cust_${Date.now()}@example.com`;
    const custPass = 'FreshCustomer123!';
    console.log(`🔑 Registering fresh customer ${custEmail}...`);
    const regRes = await fetch(`${BACKEND_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: custEmail, password: custPass, name: 'Outage Customer', role: 'customer' }),
    });
    if (!regRes.ok) throw new Error(`Customer registration failed: ${await regRes.text()}`);
    const regData = await regRes.json();
    const token = regData.accessToken;
    const custId = regData.user.id;

    // 3. Stop notification-service container
    console.log('🛑 Stopping notification-service container...');
    execSync('docker compose stop notification-service', { stdio: 'inherit' });
    console.log('   ✅ notification-service stopped.');
    await sleep(2500); // Allow consumer TCP connection to close in RabbitMQ broker

    // 4. Create 10 available slots in database on distinct future days
    console.log('\n📅 Creating 10 fresh future slots for outage booking test...');
    const bizRes = await pool.query(`SELECT id, owner_id FROM businesses WHERE status = 'approved' LIMIT 1`);
    const bizId = bizRes.rows[0].id;
    const ownerId = bizRes.rows[0].owner_id;
    const svcRes = await pool.query(`SELECT id FROM services WHERE business_id = $1 LIMIT 1`, [bizId]);
    const svcId = svcRes.rows[0].id;

    const startDayOffset = 200 + Math.floor(Math.random() * 1000);
    const slotIds: string[] = [];

    for (let i = 0; i < 10; i++) {
      // Put each slot at 11:00 UTC on a distinct future day to avoid any overlap
      const start = new Date(Date.now() + 86400000 * (startDayOffset + i) + 11 * 3600000);
      const end = new Date(start.getTime() + 1800000);
      const slot = await pool.query<{ id: string }>(
        `INSERT INTO slots (service_id, start_time, end_time, status)
         VALUES ($1, $2, $3, 'free')
         RETURNING id`,
        [svcId, start.toISOString(), end.toISOString()]
      );
      slotIds.push(slot.rows[0].id);
    }

    // Measure starting notification rows count in notification_db
    const initialRowsRes = await notifPool.query(`SELECT COUNT(*) as count FROM notifications`);
    const initialRowsCount = parseInt(initialRowsRes.rows[0].count, 10);

    // 5. Fire 10 bookings via gateway
    console.log('\n🚀 Firing 10 bookings through gateway while notification-service is DOWN...');
    const startTime = Date.now();
    const bookingResults: number[] = [];

    for (let i = 0; i < 10; i++) {
      const res = await fetch(`${GATEWAY_URL}/api/appointments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ slot_id: slotIds[i] }),
      });
      bookingResults.push(res.status);
      if (res.status !== 201) {
        const errText = await res.text();
        console.error(`      Booking ${i} failed (${res.status}): ${errText}`);
      }
    }
    const elapsedMs = Date.now() - startTime;

    console.log(`   Bookings completed in ${elapsedMs}ms.`);
    const all201 = bookingResults.every((s) => s === 201);
    if (!all201) {
      throw new Error(`Outage check failed: some bookings did not return 201: ${JSON.stringify(bookingResults)}`);
    }
    console.log('   ✅ PASS: All 10 bookings returned 201 Created immediately without blocking!');

    // 6. Query RabbitMQ Management API to verify queue depth reaches EXACTLY 10
    console.log('\n🐰 Waiting for monolith outbox relay to publish to RabbitMQ notification.q...');
    const authHeader = 'Basic ' + Buffer.from('guest:guest').toString('base64');
    let queuedMessages = 0;
    for (let i = 0; i < 20; i++) {
      await sleep(1000);
      try {
        const rmqRes = await fetch(RABBITMQ_API, {
          headers: { Authorization: authHeader },
        });
        if (rmqRes.ok) {
          const rmqData = await rmqRes.json();
          queuedMessages = rmqData.messages_ready ?? rmqData.messages ?? 0;
          if (queuedMessages === 10) break;
        }
      } catch {}
    }

    console.log(`   Messages buffered in notification.q: ${queuedMessages}`);
    if (queuedMessages === 10) {
      console.log('   ✅ PASS: notification.q has buffered EXACTLY 10 events safely while service is offline');
    } else {
      throw new Error(`Expected EXACTLY 10 queued messages while service is down, found ${queuedMessages}`);
    }

    // 7. Restart notification-service container
    console.log('\n🔄 Starting notification-service container...');
    execSync('docker compose start notification-service', { stdio: 'inherit' });
    console.log('   ✅ notification-service restarted.');

    // 8. Wait for queue depth to drain to EXACTLY 0 and verify delivery in notification_db and MailHog
    console.log('\n⏳ Waiting up to 25s for consumer to catch up and drain queue to 0...');
    let queueDrained = false;
    let finalQueued = -1;

    for (let i = 0; i < 25; i++) {
      await sleep(1000);
      try {
        const checkRes = await fetch(RABBITMQ_API, {
          headers: { Authorization: authHeader },
        });
        if (checkRes.ok) {
          const d = await checkRes.json();
          finalQueued = d.messages_ready ?? d.messages ?? 0;
          if (finalQueued === 0) {
            queueDrained = true;
            break;
          }
        }
      } catch {
        // Retry
      }
    }

    console.log(`   Final messages buffered in notification.q: ${finalQueued}`);
    if (queueDrained && finalQueued === 0) {
      console.log('   ✅ PASS: notification.q drained back to EXACTLY 0 messages');
    } else {
      throw new Error(`Queue did not drain to 0 messages. Final count: ${finalQueued}`);
    }

    // Check notifications in notification_db
    const custNotifRes = await notifPool.query(
      `SELECT COUNT(*) as count FROM notifications WHERE user_id = $1`,
      [custId]
    );
    const custNotifCount = parseInt(custNotifRes.rows[0].count, 10);

    const finalRowsRes = await notifPool.query(`SELECT COUNT(*) as count FROM notifications`);
    const finalRowsCount = parseInt(finalRowsRes.rows[0].count, 10);
    const addedRows = finalRowsCount - initialRowsCount;
    const ownerNotifCount = addedRows - custNotifCount;

    console.log(`   Customer notifications created: ${custNotifCount}`);
    console.log(`   Owner notifications created: ${ownerNotifCount}`);
    console.log(`   Total new rows created in notification_db: ${addedRows}`);

    if (custNotifCount === 10 && ownerNotifCount === 10 && addedRows === 20) {
      console.log(`   ✅ PASS: EXACTLY 20 new notification rows created (10 customer, 10 owner)!`);
    } else {
      throw new Error(
        `Expected EXACTLY 20 rows (10 customer, 10 owner), got total=${addedRows}, cust=${custNotifCount}, owner=${ownerNotifCount}`
      );
    }

    // Check MailHog messages (wait up to 5s if needed for SMTP delivery)
    let mailCount = 0;
    for (let i = 0; i < 10; i++) {
      const mailRes = await fetch(`${MAILHOG_URL}/api/v2/messages`);
      if (mailRes.ok) {
        const mailData = await mailRes.json();
        mailCount = mailData.count || (mailData.items ? mailData.items.length : 0);
        if (mailCount === 10) break;
      }
      await sleep(500);
    }

    console.log(`   Emails delivered to MailHog: ${mailCount}`);
    if (mailCount === 10) {
      console.log(`   ✅ PASS: MailHog received EXACTLY 10 confirmation emails after restart!`);
    } else {
      throw new Error(`Expected EXACTLY 10 emails in MailHog, found ${mailCount}`);
    }

    console.log('\n🎉 NOTIFICATION OUTAGE RESILIENCE DEMO COMPLETED SUCCESSFULLY!\n');
  } finally {
    try {
      execSync('docker compose start notification-service', { stdio: 'ignore' });
    } catch {}
    if (backendProc?.pid) {
      killProcessTree(backendProc.pid);
    }
    await pool.end();
    await notifPool.end();
  }
}

runOutageDemo().catch((err) => {
  console.error('\n❌ OUTAGE DEMO FAILED:', err.message);
  process.exit(1);
});
