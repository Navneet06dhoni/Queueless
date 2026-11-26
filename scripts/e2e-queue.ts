import http from 'http';
import { spawn, ChildProcess } from 'child_process';
import { io as ClientIO, Socket } from 'socket.io-client';
import { Pool } from 'pg';
import Redis from 'ioredis';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../backend/.env') });

const GATEWAY_URL = 'http://localhost:8080';
const BACKEND_URL = 'http://localhost:5000';
const MAILHOG_URL = 'http://localhost:8025';
const pgPass = process.env.POSTGRES_PASSWORD || 'postgrespassword';
const queuePass = process.env.QUEUE_DB_PASSWORD || 'queue_password';
const DB_URL = `postgresql://postgres:${pgPass}@localhost:5432/queueless`;
const QUEUE_DB_URL = `postgresql://queue_user:${queuePass}@localhost:5432/queue_db`;

const pool = new Pool({ connectionString: DB_URL });
const queuePool = new Pool({ connectionString: QUEUE_DB_URL });

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isBackendRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${GATEWAY_URL}/api/health`, { signal: AbortSignal.timeout(1000) });
    if (res.ok) return true;
  } catch {}
  try {
    const res = await fetch(`${BACKEND_URL}/api/health`, { signal: AbortSignal.timeout(1000) });
    if (res.ok) return true;
  } catch {}
  return false;
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

async function runE2EQueue() {
  console.log('🚀 Starting End-to-End Queue Service & Socket Gateway Verification...\n');

  let targetBackendUrl = BACKEND_URL;
  try {
    const gwHealth = await fetch(`${GATEWAY_URL}/api/health`, { signal: AbortSignal.timeout(1000) });
    if (gwHealth.ok) {
      targetBackendUrl = GATEWAY_URL;
      console.log(`ℹ️  Containerised core detected via Gateway (${GATEWAY_URL}).`);
    }
  } catch {}

  let backendProc: ChildProcess | null = null;
  const alreadyRunning = await isBackendRunning();
  let weStartedBackend = false;

  if (!alreadyRunning) {
    console.log('📦 Launching monolith backend on port 5000 (QUEUE_MODE=service, SOCKET_MODE=remote)...');
    const serverScript = path.resolve(__dirname, '../backend/src/server.ts');
    let backendErr = '';
    backendProc = spawn('npx', ['tsx', serverScript], {
      cwd: path.resolve(__dirname, '..'),
      shell: true,
      stdio: 'pipe',
      env: {
        ...process.env,
        PORT: '5000',
        QUEUE_MODE: 'service',
        SOCKET_MODE: 'remote',
        NOTIFICATIONS_MODE: 'service',
        EVENT_TRANSPORT: 'rabbitmq',
      },
    });
    backendProc.stderr?.on('data', (d) => {
      backendErr += d.toString();
    });

    const ready = await waitForBackend(30000);
    if (!ready) {
      if (backendProc.pid) killProcessTree(backendProc.pid);
      throw new Error(`Failed to start monolith backend on port 5000 within 30 seconds. Stderr: ${backendErr}`);
    }
    weStartedBackend = true;
    console.log('✅ Monolith backend is up on http://localhost:5000\n');
  }

  let allPassed = true;
  function reportCheck(name: string, passed: boolean, details?: string) {
    if (passed) {
      console.log(`   PASS: ${name}${details ? ' - ' + details : ''}`);
    } else {
      allPassed = false;
      console.error(`   FAIL: ${name}${details ? ' - ' + details : ''}`);
    }
  }

  try {
    // 0. Clear MailHog messages
    try {
      await fetch(`${MAILHOG_URL}/api/v1/messages`, { method: 'DELETE' });
    } catch {
      console.warn('⚠️ Could not clear MailHog messages');
    }

    // 1. Authenticate users directly against backend
    console.log('🔑 Authenticating test users...');
    const loginUser = async (email: string, pass: string) => {
      try {
        const res = await fetch(`${targetBackendUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: pass }),
        });
        if (res.ok) {
          const data = await res.json();
          return { token: data.accessToken, user: data.user };
        }
      } catch {}

      // Fallback if rate-limited: sign token using JWT_ACCESS_SECRET and DB user record
      const uRes = await pool.query('SELECT id, name, email, role FROM users WHERE email = $1', [email]);
      if (uRes.rows.length === 0) throw new Error(`User not found: ${email}`);
      const u = uRes.rows[0];
      const jwtModule = (await import('jsonwebtoken')).default;
      const token = jwtModule.sign(
        { sub: u.id, role: u.role, name: u.name, email: u.email },
        process.env.JWT_ACCESS_SECRET || 'queueless_super_secret_access_token_key_change_in_production_123456',
        { expiresIn: '15m' }
      );
      return { token, user: u };
    };

    const adminRow = await pool.query(`SELECT email FROM users WHERE role = 'admin' LIMIT 1`);
    const adminEmail = adminRow.rows[0]?.email || 'admin@queueless.local';
    // Ensure admin password hash is set to Admin@QueueLess123
    const bcryptModule = (await import('bcryptjs')).default;
    const adminHash = await bcryptModule.hash('Admin@QueueLess123', 10);
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ('Platform Admin', $1, $2, 'admin')
       ON CONFLICT (email) DO UPDATE SET password_hash = $2, role = 'admin'`,
      [adminEmail, adminHash]
    );

    const owner = await loginUser('owner1@clinic.in', 'OwnerPassword123');
    const cust1 = await loginUser('customer1@example.com', 'CustomerPassword123');
    const cust2 = await loginUser('customer2@example.com', 'CustomerPassword123');
    const admin = await loginUser(adminEmail, 'Admin@QueueLess123');

    // 2. Find approved business for owner1 and ensure queue is open + 24/7 working hours
    const bizRes = await pool.query(
      `SELECT id, name FROM businesses WHERE owner_id = $1 AND status = 'approved' LIMIT 1`,
      [owner.user.id]
    );
    if (bizRes.rows.length === 0) throw new Error('No approved business found for owner1');
    const businessId = bizRes.rows[0].id;

    await pool.query(`UPDATE businesses SET queue_open = true WHERE id = $1`, [businessId]);
    for (let day = 0; day <= 6; day++) {
      await pool.query(
        `INSERT INTO working_hours (business_id, day_of_week, open_time, close_time)
         VALUES ($1, $2, '00:00:00', '23:59:59')
         ON CONFLICT (business_id, day_of_week)
         DO UPDATE SET open_time = '00:00:00', close_time = '23:59:59'`,
        [businessId, day]
      );
    }

    // Clean all queue history for this business and test customers
    await pool.query(`DELETE FROM queue_history WHERE business_id = $1 OR customer_id = ANY($2::uuid[])`, [
      businessId,
      [cust1.user.id, cust2.user.id],
    ]);
    await queuePool.query(`DELETE FROM queue_history WHERE business_id = $1 OR customer_id = ANY($2::uuid[])`, [
      businessId,
      [cust1.user.id, cust2.user.id],
    ]);

    const redis = new Redis('redis://localhost:6379/2');
    const bizKeys = await redis.keys(`*${businessId}*`);
    if (bizKeys.length > 0) {
      await redis.del(...bizKeys);
    }
    await redis.del(`queue:user:${cust1.user.id}`, `queue:user:${cust2.user.id}`);
    await redis.quit();

    // -------------------------------------------------------------------------
    // Check 1: Anonymous GET /api/queue/:id/status
    // -------------------------------------------------------------------------
    console.log('1️⃣ Checking anonymous GET /api/queue/:businessId/status...');
    const statusRes = await fetch(`${GATEWAY_URL}/api/queue/${businessId}/status`);
    const statusBody = await statusRes.json();
    const c1Pass = statusRes.status === 200 && statusBody && typeof statusBody.isOpen === 'boolean';
    reportCheck('Anonymous GET /api/queue/:businessId/status returns 200 without auth', c1Pass, JSON.stringify(statusBody));

    // -------------------------------------------------------------------------
    // Sockets Setup through Gateway
    // -------------------------------------------------------------------------
    console.log('\n🔌 Connecting sockets for Owner, Customer 1, and Customer 2 via Gateway...');
    const createSocket = (token: string): Promise<Socket> => {
      const s = ClientIO(GATEWAY_URL, {
        auth: { token },
        transports: ['websocket'],
      });
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Socket connection timeout')), 7000);
        s.on('connect', () => {
          clearTimeout(timeout);
          resolve(s);
        });
        s.on('connect_error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });
    };

    const ownerSocket = await createSocket(owner.token);
    const cust1Socket = await createSocket(cust1.token);
    const cust2Socket = await createSocket(cust2.token);

    // Owner watches this business to receive queue:owner-updated
    await new Promise((resolve) => {
      ownerSocket.emit('owner:watch', { businessId }, () => resolve(true));
      setTimeout(resolve, 500);
    });

    // Track events
    let ownerReceivedUpdate = false;
    let cust1ReceivedPosition: any = null;
    let cust2ReceivedCustomer1Data = false;
    let cust1ReceivedCalled: any = null;

    ownerSocket.on('queue:owner-updated', (data) => {
      if (data && (data.businessId === businessId || Array.isArray(data.waiting))) {
        ownerReceivedUpdate = true;
      }
    });

    cust1Socket.on('queue:position', (data) => {
      cust1ReceivedPosition = data;
    });

    cust1Socket.on('queue:called', (data) => {
      cust1ReceivedCalled = data;
    });

    cust2Socket.on('queue:position', (data) => {
      // Socket privacy verification: customer 2 must not see customer 1's details
      const raw = JSON.stringify(data);
      if (raw.includes(cust1.user.name) || raw.includes(cust1.user.email)) {
        cust2ReceivedCustomer1Data = true;
      }
    });

    // -------------------------------------------------------------------------
    // Check 2: Customer 1 joins queue through Gateway
    // -------------------------------------------------------------------------
    console.log('\n2️⃣ Customer 1 joining queue through Gateway...');
    const joinRes1 = await fetch(`${GATEWAY_URL}/api/queue/${businessId}/join`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cust1.token}` },
    });
    const joinData1 = await joinRes1.json();
    const c2JoinPass = joinRes1.status === 201 && typeof joinData1.ticketNumber === 'number';
    reportCheck('Customer 1 joins queue via Gateway (POST 201)', c2JoinPass, `Ticket: ${joinData1.ticketNumber}`);

    // Wait for socket events
    await sleep(1500);

    const c2PositionPass = cust1ReceivedPosition && cust1ReceivedPosition.position === 1;
    reportCheck('Customer 1 receives queue:position over socket (position: 1)', c2PositionPass, JSON.stringify(cust1ReceivedPosition));

    reportCheck('Owner socket receives queue:owner-updated on customer join', ownerReceivedUpdate);
    reportCheck('Customer 2 socket receives NO information about Customer 1 (privacy)', !cust2ReceivedCustomer1Data);

    // Privacy verification: customer 1's position payload does not contain other user names
    const positionRaw = JSON.stringify(cust1ReceivedPosition || {});
    const noOtherNames = !positionRaw.includes('Customer 2') && !positionRaw.includes('customer2@example.com');
    reportCheck('Customer 1 payload contains no other customer names', noOtherNames);

    // -------------------------------------------------------------------------
    // Check 3: Check-in of real appointment through Gateway
    // -------------------------------------------------------------------------
    console.log('\n3️⃣ Check-in of real appointment through Gateway...');
    // Fetch a service for this business
    let svcRes = await pool.query(`SELECT id FROM services WHERE business_id = $1 LIMIT 1`, [businessId]);
    if (svcRes.rows.length === 0) {
      svcRes = await pool.query(
        `INSERT INTO services (business_id, name, duration_minutes, price) VALUES ($1, 'Check-in Service', 30, 400) RETURNING id`,
        [businessId]
      );
    }
    const serviceId = svcRes.rows[0].id;

    // Create an eligible slot starting 5 minutes in future (well within early/grace window)
    const slotStart = new Date(Date.now() + 5 * 60 * 1000);
    const slotEnd = new Date(slotStart.getTime() + 30 * 60 * 1000);
    const slotRes = await pool.query(
      `INSERT INTO slots (service_id, start_time, end_time, status) VALUES ($1, $2, $3, 'booked') RETURNING id`,
      [serviceId, slotStart, slotEnd]
    );
    const slotId = slotRes.rows[0].id;

    const apptRes = await pool.query(
      `INSERT INTO appointments (customer_id, slot_id, status) VALUES ($1, $2, 'confirmed') RETURNING id`,
      [cust2.user.id, slotId]
    );
    const apptId = apptRes.rows[0].id;

    const checkInRes = await fetch(`${GATEWAY_URL}/api/queue/${businessId}/check-in`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cust2.token}`,
      },
      body: JSON.stringify({ appointment_id: apptId }),
    });
    const checkInData = await checkInRes.json();
    const c3Pass = checkInRes.status === 201 && typeof checkInData.ticketNumber === 'number';
    reportCheck('Real appointment check-in through Gateway succeeds (POST 201)', c3Pass, `Ticket: ${checkInData.ticketNumber}`);

    // -------------------------------------------------------------------------
    // Check 4: Owner Call Next -> Customer 1 called & Notification generated
    // -------------------------------------------------------------------------
    console.log('\n4️⃣ Owner calls next customer through Gateway...');
    const nextRes = await fetch(`${GATEWAY_URL}/api/queue/${businessId}/next`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    const nextData = await nextRes.json();
    const calledTicket = nextData.current?.ticketNumber ?? nextData.ticketNumber;
    const c4NextPass = nextRes.status === 200 && typeof calledTicket === 'number';
    reportCheck('Owner call next succeeds through Gateway (POST 200)', c4NextPass, `Now Serving Ticket: ${calledTicket}`);

    // Wait for called socket event & notification processing
    await sleep(2500);

    const c4CalledPass = cust1ReceivedCalled && cust1ReceivedCalled.ticketNumber === joinData1.ticketNumber;
    reportCheck('Customer 1 socket receives queue:called event', c4CalledPass, JSON.stringify(cust1ReceivedCalled));

    // Check Notification Service in-app notification for Customer 1
    const notifRes = await fetch(`${GATEWAY_URL}/api/notifications`, {
      headers: { Authorization: `Bearer ${cust1.token}` },
    });
    const notifData = await notifRes.json();
    const notifications = notifData.data?.notifications || notifData.notifications || [];
    const calledNotif = notifications.find((n: any) =>
      /called|now serving|turn/i.test(n.title + ' ' + n.message)
    );
    reportCheck('Notification service created in-app notification for Customer 1', !!calledNotif, calledNotif?.title);

    // Check MailHog for email to customer 1
    let userEmails: any[] = [];
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const mailRes = await fetch(`${MAILHOG_URL}/api/v2/messages`);
        const mailData = await mailRes.json();
        userEmails = (mailData.items || []).filter((msg: any) => {
          const raw = JSON.stringify(msg);
          return raw.includes(cust1.user.email);
        });
        if (userEmails.length >= 1) break;
      } catch {
        // Retry
      }
      await sleep(500);
    }
    reportCheck(
      'Notification service delivered called email to Customer 1 in MailHog',
      userEmails.length >= 1,
      `Received ${userEmails.length} email(s) for ${cust1.user.email}`
    );

    // -------------------------------------------------------------------------
    // Check 5: Blocked user socket disconnect and eviction
    // -------------------------------------------------------------------------
    console.log('\n5️⃣ Testing blocked user eviction and socket disconnection...');
    // Create dedicated user to block directly in DB to bypass register edge rate limit
    const blockCustEmail = `block_test_${Date.now()}@example.com`;
    const bcryptMod = (await import('bcryptjs')).default;
    const blockPassHash = await bcryptMod.hash('CustomerPassword123', 10);
    const insertBlockRes = await pool.query(
      `INSERT INTO users (name, email, password_hash, role) VALUES ('Blocked Candidate', $1, $2, 'customer') RETURNING id`,
      [blockCustEmail, blockPassHash]
    );
    const blockCustId = insertBlockRes.rows[0].id;
    const jwtMod = (await import('jsonwebtoken')).default;
    const blockCustToken = jwtMod.sign(
      { sub: blockCustId, role: 'customer', name: 'Blocked Candidate', email: blockCustEmail },
      process.env.JWT_ACCESS_SECRET || 'queueless_super_secret_access_token_key_change_in_production_123456',
      { expiresIn: '15m' }
    );

    // Connect socket
    const blockSocket = await createSocket(blockCustToken);
    let blockSocketDisconnected = false;
    blockSocket.on('disconnect', () => {
      blockSocketDisconnected = true;
    });

    // Join queue through gateway
    const blockJoinRes = await fetch(`${GATEWAY_URL}/api/queue/${businessId}/join`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${blockCustToken}` },
    });
    reportCheck('Candidate user joins queue before block', blockJoinRes.status === 201);

    // Admin blocks user through gateway
    const blockAdminRes = await fetch(`${GATEWAY_URL}/api/admin/users/${blockCustId}/block`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${admin.token}`,
      },
      body: JSON.stringify({ blocked: true, reason: 'E2E Queue suspension test' }),
    });
    reportCheck('Admin blocks candidate user via Gateway', blockAdminRes.status === 200);

    // Wait for user.blocked event to propagate to queue-service
    await sleep(2500);

    reportCheck('Blocked user socket was disconnected', blockSocketDisconnected);

    // Verify candidate is evicted from queue
    const queueMeRes = await fetch(`${GATEWAY_URL}/api/queue/me`, {
      headers: { Authorization: `Bearer ${blockCustToken}` },
    });
    // Either 403 USER_BLOCKED or 404 (evicted)
    const evictedPass = queueMeRes.status === 403 || queueMeRes.status === 404;
    reportCheck('Blocked user is evicted from active queue (returns 403/404 on /api/queue/me)', evictedPass, `Status: ${queueMeRes.status}`);

    // Clean up sockets
    ownerSocket.disconnect();
    cust1Socket.disconnect();
    cust2Socket.disconnect();
    blockSocket.disconnect();

    console.log('\n------------------------------------------------------------');
    if (allPassed) {
      console.log('🎉 ALL END-TO-END QUEUE SERVICE TESTS PASSED SUCCESSFULLY!\n');
      process.exit(0);
    } else {
      console.error('❌ SOME END-TO-END QUEUE SERVICE TESTS FAILED!\n');
      process.exit(1);
    }
  } finally {
    if (weStartedBackend && backendProc?.pid) {
      killProcessTree(backendProc.pid);
    }
    await pool.end();
    await queuePool.end();
  }
}

runE2EQueue().catch((err) => {
  console.error('❌ E2E Queue Test Exception:', err);
  process.exit(1);
});
