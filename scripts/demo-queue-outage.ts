import { execSync, spawn, ChildProcess } from 'child_process';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { io as ioClient, Socket } from 'socket.io-client';
import bcrypt from 'bcryptjs';

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../backend/.env') });

const GATEWAY_URL = 'http://localhost:8080';
const BACKEND_URL = 'http://localhost:5000';
const QUEUE_SERVICE_DIRECT_URL = 'http://127.0.0.1:3003';
const MAILHOG_URL = 'http://localhost:8025';
const RABBITMQ_API = 'http://localhost:15672/api/queues/%2F/notification.q';
const pgPass = process.env.POSTGRES_PASSWORD || '';
const DB_URL = `postgresql://postgres:${pgPass}@localhost:5432/queueless`;
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || '';

const pool = new Pool({ connectionString: DB_URL });

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkGatewayStackReadiness(): Promise<{ ok: boolean; reason?: string }> {
  try {
    const gwRes = await fetch(`${GATEWAY_URL}/healthz`, { signal: AbortSignal.timeout(2000) });
    if (!gwRes.ok) return { ok: false, reason: `Gateway /healthz returned ${gwRes.status}` };

    const coreRes = await fetch(`${GATEWAY_URL}/api/health`, { signal: AbortSignal.timeout(2000) });
    if (!coreRes.ok) return { ok: false, reason: `Core via Gateway /api/health returned ${coreRes.status}` };

    const queueRes = await fetch(`${GATEWAY_URL}/api/queue/00000000-0000-0000-0000-000000000000/status`, {
      signal: AbortSignal.timeout(2000),
    });
    if (queueRes.status === 502 || queueRes.status === 503) {
      return { ok: false, reason: `Queue service via Gateway returned ${queueRes.status}` };
    }

    const notifRes = await fetch(`${GATEWAY_URL}/api/notifications`, { signal: AbortSignal.timeout(2000) });
    if (notifRes.status === 502 || notifRes.status === 503) {
      return { ok: false, reason: `Notification service via Gateway returned ${notifRes.status}` };
    }

    return { ok: true };
  } catch (err: any) {
    return { ok: false, reason: err.message };
  }
}

async function loginWithRetry(targetUrl: string, email: string, pass: string, maxRetries = 6): Promise<string> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const res = await fetch(`${targetUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pass }),
    });

    if (res.ok) {
      const data = await res.json();
      return (data.data?.accessToken || data.accessToken) as string;
    }

    if (res.status === 429) {
      const retryAfterHeader = res.headers.get('Retry-After');
      const waitSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) || 12 : 12;
      console.log(`   ⏳ Rate limit (429) encountered for ${email}. Waiting ${waitSeconds}s according to Retry-After header before retry (attempt ${attempt}/${maxRetries})...`);
      await sleep(waitSeconds * 1000 + 500);
      continue;
    }

    const errText = await res.text().catch(() => '');
    throw new Error(`Login failed for ${email} with status ${res.status}: ${errText}`);
  }
  throw new Error(`Login failed for ${email} after ${maxRetries} attempts due to rate limit.`);
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
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch {}
}

function stopBackendProcess(proc: ChildProcess | null) {
  if (proc && proc.pid) {
    killProcessTree(proc.pid);
    return;
  }
  // If not spawned by us, find and kill port 5000 process
  try {
    if (process.platform === 'win32') {
      const netstat = execSync('netstat -ano | findstr :5000', { encoding: 'utf8' });
      const lines = netstat.split('\n');
      for (const line of lines) {
        if (line.includes('LISTENING')) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && pid !== '0') {
            killProcessTree(parseInt(pid, 10));
          }
        }
      }
    }
  } catch {}
}

function startBackendProcess(): ChildProcess {
  const serverScript = path.resolve(__dirname, '../backend/src/server.ts');
  const proc = spawn('npx', ['tsx', serverScript], {
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
      TRUST_PROXY: '1',
    },
  });
  return proc;
}

async function getRabbitQueueDepth(): Promise<number> {
  const authHeader = 'Basic ' + Buffer.from('guest:guest').toString('base64');
  const res = await fetch(RABBITMQ_API, { headers: { Authorization: authHeader } });
  if (!res.ok) throw new Error(`RabbitMQ API returned ${res.status}`);
  const data = await res.json();
  return (data.messages_ready ?? data.messages ?? 0) as number;
}

async function getMailHogCount(toEmail: string): Promise<number> {
  const res = await fetch(`${MAILHOG_URL}/api/v2/messages`);
  if (!res.ok) return 0;
  const data = await res.json();
  const items = data.items || [];
  return items.filter((m: any) =>
    m.To?.some((t: any) => `${t.Mailbox}@${t.Domain}`.toLowerCase() === toEmail.toLowerCase())
  ).length;
}

async function runDemo() {
  console.log('⚡ Starting Three-Way Queue Outage & Resilience Demo (Phase 10d-3)...\n');
  let overallSuccess = true;

  function report(name: string, passed: boolean, details?: string) {
    if (passed) {
      console.log(`   PASS: ${name}${details ? ' - ' + details : ''}`);
    } else {
      overallSuccess = false;
      console.error(`   FAIL: ${name}${details ? ' - ' + details : ''}`);
    }
  }

  const useHostBackend = process.argv.includes('--host-backend');
  let isContainerizedCore = !useHostBackend;
  let backendProc: ChildProcess | null = null;

  if (useHostBackend) {
    console.log('🎯 Target: Host Backend (http://localhost:5000) [--host-backend flag active]\n');
    const backendAlreadyRunning = await isBackendRunning();
    if (!backendAlreadyRunning) {
      console.log('📦 Starting monolith backend process on port 5000...');
      backendProc = startBackendProcess();
      const ready = await waitForBackend(30000);
      if (!ready) {
        throw new Error('Failed to start backend on port 5000');
      }
      console.log('   ✅ Backend started on port 5000\n');
    } else {
      console.log('ℹ️  Monolith backend is already running on port 5000.\n');
    }
  } else {
    console.log('🎯 Target: Gateway (http://localhost:8080) [Containerized Stack]\n');
    const readiness = await checkGatewayStackReadiness();
    if (!readiness.ok) {
      console.error(`❌ Stack is not healthy: ${readiness.reason}`);
      console.error('Stack is not healthy: run docker compose up -d and check docker compose ps');
      process.exit(1);
    }
  }

  try {
    // Clean slate: Clear MailHog and RabbitMQ notification.q
    console.log('🧹 Clearing MailHog and notification.q...');
    await fetch(`${MAILHOG_URL}/api/v1/messages`, { method: 'DELETE' }).catch(() => {});
    const rmqAuth = 'Basic ' + Buffer.from('guest:guest').toString('base64');
    await fetch('http://127.0.0.1:15672/api/queues/%2F/notification.q/contents', {
      method: 'DELETE',
      headers: { Authorization: rmqAuth },
    }).catch(() => {});
    console.log('   ✅ MailHog and notification.q cleared\n');

    // Setup fresh test entities: 1 Owner, 1 Business, 2 Customers
    const ts = Date.now();
    const ownerEmail = `demo_owner_${ts}@example.com`;
    const cust1Email = `demo_cust1_${ts}@example.com`;
    const cust2Email = `demo_cust2_${ts}@example.com`;
    const defaultPass = 'DemoPassword123!';
    const passHash = await bcrypt.hash(defaultPass, 10);

    const ownerRes = await pool.query<{ id: string }>(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ('Demo Owner', $1, $2, 'owner') RETURNING id`,
      [ownerEmail, passHash]
    );
    const ownerId = ownerRes.rows[0].id;

    const bizRes = await pool.query<{ id: string }>(
      `INSERT INTO businesses (owner_id, name, category, address, city, phone, status, queue_open)
       VALUES ($1, 'Demo Outage Clinic', 'clinic', '100 Resilience Blvd', 'Mumbai', '9898989898', 'approved', true)
       RETURNING id`,
      [ownerId]
    );
    const bizId = bizRes.rows[0].id;

    // Working hours
    for (let d = 0; d <= 6; d++) {
      await pool.query(
        `INSERT INTO working_hours (business_id, day_of_week, open_time, close_time)
         VALUES ($1, $2, '00:00:00', '23:59:59')
         ON CONFLICT (business_id, day_of_week) DO UPDATE SET open_time = '00:00:00', close_time = '23:59:59'`,
        [bizId, d]
      );
    }

    // Service for appointment tests
    const svcRes = await pool.query<{ id: string }>(
      `INSERT INTO services (business_id, name, duration_minutes, price)
       VALUES ($1, 'Demo Consultation', 30, 500) RETURNING id`,
      [bizId]
    );
    const svcId = svcRes.rows[0].id;

    // Customer 1
    const cust1Res = await pool.query<{ id: string }>(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ('Demo Customer One', $1, $2, 'customer') RETURNING id`,
      [cust1Email, passHash]
    );
    const cust1Id = cust1Res.rows[0].id;

    // Customer 2
    const cust2Res = await pool.query<{ id: string }>(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ('Demo Customer Two', $1, $2, 'customer') RETURNING id`,
      [cust2Email, passHash]
    );
    const cust2Id = cust2Res.rows[0].id;

    // Login users to get access tokens using retry on 429
    const loginTargetUrl = isContainerizedCore ? GATEWAY_URL : BACKEND_URL;
    const ownerToken = await loginWithRetry(loginTargetUrl, ownerEmail, defaultPass);
    const cust1Token = await loginWithRetry(loginTargetUrl, cust1Email, defaultPass);
    const cust2Token = await loginWithRetry(loginTargetUrl, cust2Email, defaultPass);

    // =========================================================================
    // SCENARIO (A): NOTIFICATION SERVICE DOWN
    // =========================================================================
    console.log('\n=============================================================');
    console.log('📌 SCENARIO (A): NOTIFICATION SERVICE DOWN');
    console.log('=============================================================');
    console.log('🛑 Stopping notification-service container...');
    execSync('docker compose stop notification-service', { stdio: 'inherit' });
    await sleep(2500); // Allow RabbitMQ consumer TCP connection to close cleanly

    const rmqBefore = await getRabbitQueueDepth();
    console.log(`   Initial notification.q depth: ${rmqBefore}`);

    // Queue operation 1: Customer 1 joins queue via gateway
    console.log('1. Customer 1 joins queue...');
    const join1Res = await fetch(`${GATEWAY_URL}/api/queue/${bizId}/join`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cust1Token}` },
    });
    const join1Data = await join1Res.json();
    report(
      'Customer 1 join succeeds with status 201 while notification-service is down',
      join1Res.status === 201 && join1Data.ticketNumber === 1,
      `Status: ${join1Res.status}, Ticket: ${join1Data.ticketNumber}`
    );

    // Queue operation 2: Customer 2 joins queue via gateway
    console.log('2. Customer 2 joins queue...');
    const join2Res = await fetch(`${GATEWAY_URL}/api/queue/${bizId}/join`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cust2Token}` },
    });
    const join2Data = await join2Res.json();
    report(
      'Customer 2 join succeeds with status 201 while notification-service is down',
      join2Res.status === 201 && join2Data.ticketNumber === 2,
      `Status: ${join2Res.status}, Ticket: ${join2Data.ticketNumber}`
    );

    // Queue operation 3: Owner calls next (Customer 1 called)
    console.log('3. Owner calls next (Customer 1)...');
    const next1Res = await fetch(`${GATEWAY_URL}/api/queue/${bizId}/next`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const next1Data = await next1Res.json();
    const calledTicket1 = next1Data.current?.ticketNumber ?? next1Data.ticketNumber;
    report(
      'Owner call next succeeds with status 200 while notification-service is down',
      next1Res.status === 200 && calledTicket1 === 1,
      `Status: ${next1Res.status}, Called Ticket: ${calledTicket1}`
    );

    // Queue operation 4: Owner calls next (Customer 2 called)
    console.log('4. Owner calls next (Customer 2)...');
    const next2Res = await fetch(`${GATEWAY_URL}/api/queue/${bizId}/next`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const next2Data = await next2Res.json();
    const calledTicket2 = next2Data.current?.ticketNumber ?? next2Data.ticketNumber;
    report(
      'Owner call next succeeds with status 200 while notification-service is down',
      next2Res.status === 200 && calledTicket2 === 2,
      `Status: ${next2Res.status}, Called Ticket: ${calledTicket2}`
    );

    // 4 queue operations emitted events: 2x queue.joined + 2x queue.advanced = 4 messages in notification.q
    const expectedBufferedCount = 4;
    console.log(`\n⏳ Verifying notification.q buffers exactly ${expectedBufferedCount} messages...`);
    let bufferedCount = 0;
    for (let i = 0; i < 15; i++) {
      await sleep(1000);
      bufferedCount = await getRabbitQueueDepth();
      if (bufferedCount === expectedBufferedCount) break;
    }
    report(
      `notification.q buffers exactly ${expectedBufferedCount} messages`,
      bufferedCount === expectedBufferedCount,
      `Buffered: ${bufferedCount}, Expected: ${expectedBufferedCount}`
    );

    // Restart notification-service
    console.log('\n🔄 Restarting notification-service container...');
    execSync('docker compose start notification-service', { stdio: 'inherit' });

    // Wait for queue to drain to EXACTLY 0
    console.log('⏳ Waiting up to 20s for notification.q to drain to 0...');
    let finalDepth = -1;
    for (let i = 0; i < 20; i++) {
      await sleep(1000);
      finalDepth = await getRabbitQueueDepth();
      if (finalDepth === 0) break;
    }
    report('notification.q drains to 0 after restart', finalDepth === 0, `Final depth: ${finalDepth}`);

    // Verify EXACT expected emails arrived in MailHog:
    // 2 call-next actions for customers with email -> exactly 2 emails (1 for cust1, 1 for cust2)
    console.log('⏳ Verifying exact email delivery in MailHog...');
    let cust1Emails = 0;
    let cust2Emails = 0;
    for (let i = 0; i < 20; i++) {
      await sleep(1000);
      cust1Emails = await getMailHogCount(cust1Email);
      cust2Emails = await getMailHogCount(cust2Email);
      if (cust1Emails === 1 && cust2Emails === 2) break;
    }
    const totalEmails = cust1Emails + cust2Emails;
    report(
      'Exactly 3 emails arrive in MailHog (1 called for Customer 1, 1 next + 1 called for Customer 2)',
      cust1Emails === 1 && cust2Emails === 2 && totalEmails === 3,
      `Customer 1 emails: ${cust1Emails}, Customer 2 emails: ${cust2Emails}, Total: ${totalEmails}`
    );

    // =========================================================================
    // SCENARIO (B): QUEUE SERVICE DOWN
    // =========================================================================
    console.log('\n=============================================================');
    console.log('📌 SCENARIO (B): QUEUE SERVICE DOWN');
    console.log('=============================================================');

    // First, let customer 1 join queue again before stopping queue service so we can verify state recovery
    console.log('1. Setting up pre-outage queue entry for Customer 1...');
    const preJoinRes = await fetch(`${GATEWAY_URL}/api/queue/${bizId}/join`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cust1Token}` },
    });
    const preJoinData = await preJoinRes.json();
    const preOutageTicket = preJoinData.ticketNumber;
    console.log(`   Customer 1 pre-outage ticket: ${preOutageTicket}`);

    console.log('🛑 Stopping queue-service container...');
    execSync('docker compose stop queue-service', { stdio: 'inherit' });
    await sleep(2000);

    // Core serves Business API
    console.log('\n2. Testing Core APIs while queue-service is DOWN:');
    const bizListRes = await fetch(`${GATEWAY_URL}/api/businesses`);
    report(
      'Core serves business API (GET /api/businesses) with 200',
      bizListRes.status === 200,
      `Status: ${bizListRes.status}`
    );

    // Core serves Booking API
    const slotStartTime = new Date(Date.now() + 86400000 * 300);
    const slotEndTime = new Date(slotStartTime.getTime() + 1800000);
    const slotRes = await pool.query<{ id: string }>(
      `INSERT INTO slots (service_id, start_time, end_time, status)
       VALUES ($1, $2, $3, 'free') RETURNING id`,
      [svcId, slotStartTime.toISOString(), slotEndTime.toISOString()]
    );
    const bookRes = await fetch(`${GATEWAY_URL}/api/appointments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cust1Token}`,
      },
      body: JSON.stringify({ slot_id: slotRes.rows[0].id }),
    });
    report(
      'Core serves booking API (POST /api/appointments) with 201',
      bookRes.status === 201,
      `Status: ${bookRes.status}`
    );

    // Core serves Admin API
    const adminPassHash = await bcrypt.hash(defaultPass, 10);
    const adminEmail = `demo_admin_${ts}@example.com`;
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ('Demo Admin', $1, $2, 'admin')`,
      [adminEmail, adminPassHash]
    );
    const adminToken = await loginWithRetry(loginTargetUrl, adminEmail, defaultPass);
    const adminBizRes = await fetch(`${GATEWAY_URL}/api/admin/businesses`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    report(
      'Core serves admin API (GET /api/admin/businesses) with 200',
      adminBizRes.status === 200,
      `Status: ${adminBizRes.status}`
    );

    // Core Analytics Summary returns 200 with partial: true
    console.log('\n3. Testing Core Analytics summary with fail-soft queue port:');
    const todayStr = new Date().toISOString().split('T')[0];
    const analyticsRes = await fetch(
      `${GATEWAY_URL}/api/analytics/business/${bizId}/summary?from=${todayStr}&to=${todayStr}`,
      { headers: { Authorization: `Bearer ${ownerToken}` } }
    );
    const analyticsData = await analyticsRes.json();
    report(
      'Core analytics summary returns 200 with partial: true while queue is DOWN',
      analyticsRes.status === 200 && analyticsData.partial === true && analyticsData.queue === null,
      `Status: ${analyticsRes.status}, Partial: ${analyticsData.partial}, Queue: ${analyticsData.queue}`
    );

    // Queue endpoints through gateway return JSON UPSTREAM_UNAVAILABLE in <2s
    console.log('\n4. Testing Gateway queue route fast-fail:');
    const qStart = Date.now();
    const qGateRes = await fetch(`${GATEWAY_URL}/api/queue/${bizId}/status`);
    const qElapsed = Date.now() - qStart;
    const qGateData = await qGateRes.json();
    report(
      'Queue endpoint through gateway returns UPSTREAM_UNAVAILABLE in <2000ms',
      (qGateRes.status === 502 || qGateRes.status === 504) &&
        qGateData.error?.code === 'UPSTREAM_UNAVAILABLE' &&
        qElapsed < 2000,
      `Status: ${qGateRes.status}, Code: ${qGateData.error?.code}, Duration: ${qElapsed}ms`
    );

    // Restart queue-service
    console.log('\n🔄 Restarting queue-service container...');
    execSync('docker compose start queue-service', { stdio: 'inherit' });

    // Wait for queue service healthy (via Gateway queue route or direct URL if published)
    let qHealthy = false;
    for (let i = 0; i < 20; i++) {
      await sleep(1000);
      try {
        const hRes = await fetch(`${GATEWAY_URL}/api/queue/${bizId}/status`);
        if (hRes.ok) {
          qHealthy = true;
          break;
        }
      } catch {}
      try {
        const hRes = await fetch(`${QUEUE_SERVICE_DIRECT_URL}/health`);
        if (hRes.ok) {
          qHealthy = true;
          break;
        }
      } catch {}
    }
    report('Queue service healthy after restart', qHealthy);

    // Verify positions identical to before stop (rebuilt from queue_db)
    console.log('\n5. Verifying queue position recovery from queue_db:');
    const recoverRes = await fetch(`${GATEWAY_URL}/api/queue/me`, {
      headers: { Authorization: `Bearer ${cust1Token}` },
    });
    const recoverData = await recoverRes.json();
    report(
      'Customer 1 ticket and position restored identically from queue_db',
      recoverRes.status === 200 &&
        recoverData.ticketNumber === preOutageTicket &&
        recoverData.position === 1,
      `Status: ${recoverRes.status}, Ticket: ${recoverData?.ticketNumber}, Position: ${recoverData?.position}`
    );

    // Verify Sockets reconnect
    console.log('\n6. Verifying WebSocket reconnect through gateway...');
    const testSocket: Socket = ioClient(GATEWAY_URL, {
      auth: { token: cust1Token },
      transports: ['websocket'],
      reconnection: true,
    });
    const socketConnected = await new Promise<boolean>((resolve) => {
      testSocket.on('connect', () => resolve(true));
      setTimeout(() => resolve(false), 5000);
    });
    testSocket.disconnect();
    report('Socket reconnects successfully through gateway after queue-service restart', socketConnected);

    // =========================================================================
    // SCENARIO (C): CORE DOWN (MONOLITH STOPPED)
    // =========================================================================
    console.log('\n=============================================================');
    console.log('📌 SCENARIO (C): CORE DOWN (MONOLITH STOPPED)');
    console.log('=============================================================');

    // Connect a socket BEFORE core goes down
    console.log('1. Connecting WebSocket client to gateway BEFORE core shutdown...');
    let socketReceivedCalled = false;
    let socketCalledTicket: number | undefined;

    const liveSocket: Socket = ioClient(GATEWAY_URL, {
      auth: { token: cust1Token },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve) => {
      if (liveSocket.connected) resolve();
      else liveSocket.on('connect', () => resolve());
    });
    console.log('   ✅ Socket connected to gateway (routed to queue-service)');

    liveSocket.on('queue:called', (payload: any) => {
      socketReceivedCalled = true;
      socketCalledTicket = payload?.ticketNumber;
    });

    // Stop monolith backend process
    console.log('\n2. Stopping monolith backend process...');
    if (isContainerizedCore) {
      execSync('docker compose stop core', { stdio: 'pipe' });
    } else {
      stopBackendProcess(backendProc);
      backendProc = null;
    }
    await sleep(2000);

    const coreIsDown = !(await isBackendRunning());
    report('Monolith backend process is stopped', coreIsDown);

    // Public queue status route still works through gateway (no auth_request)
    console.log('\n3. Testing public queue status through gateway while core is DOWN:');
    const pubStatusRes = await fetch(`${GATEWAY_URL}/api/queue/${bizId}/status`);
    const pubStatusData = await pubStatusRes.json();
    report(
      'Public route (GET /api/queue/:id/status) returns 200 through gateway while core is DOWN',
      pubStatusRes.status === 200 && typeof pubStatusData.isOpen === 'boolean',
      `Status: ${pubStatusRes.status}, IsOpen: ${pubStatusData.isOpen}`
    );

    // Socket connected before outage keeps receiving updates when owner action sent to 127.0.0.1:3003
    console.log('\n4. Sending owner call-next directly to queue-service with internal token:');
    let directActionRes: { status: number; json: () => Promise<any> };
    if (isContainerizedCore) {
      const raw = execSync(
        `docker compose exec -T queue-service node -e "fetch('http://127.0.0.1:3003/api/queue/${bizId}/next', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Internal-Token': '${INTERNAL_TOKEN}', 'X-User-Id': '${ownerId}', 'X-User-Role': 'owner', 'X-User-Name': 'Demo Owner', 'X-User-Email': '${ownerEmail}' } }).then(async r => console.log(JSON.stringify({ status: r.status, data: await r.json() })))"`,
        { encoding: 'utf8' }
      );
      const parsed = JSON.parse(raw.trim());
      directActionRes = { status: parsed.status, json: async () => parsed.data };
    } else {
      const fetchRes = await fetch(`${QUEUE_SERVICE_DIRECT_URL}/api/queue/${bizId}/next`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Token': INTERNAL_TOKEN,
          'X-User-Id': ownerId,
          'X-User-Role': 'owner',
          'X-User-Name': 'Demo Owner',
          'X-User-Email': ownerEmail,
        },
      });
      directActionRes = { status: fetchRes.status, json: () => fetchRes.json() };
    }
    const directActionData = await directActionRes.json();
    const directCalledTicket = directActionData.current?.ticketNumber ?? directActionData.ticketNumber;
    report(
      'Direct owner action to queue-service (127.0.0.1:3003) succeeds with 200',
      directActionRes.status === 200 && directCalledTicket === preOutageTicket,
      `Status: ${directActionRes.status}, Called Ticket: ${directCalledTicket}`
    );

    // Wait for live socket to receive the update
    for (let i = 0; i < 10; i++) {
      if (socketReceivedCalled) break;
      await sleep(500);
    }
    liveSocket.disconnect();
    report(
      'Connected socket received queue:called event in real-time despite core outage',
      socketReceivedCalled && socketCalledTicket === preOutageTicket,
      `Received: ${socketReceivedCalled}, Ticket: ${socketCalledTicket}`
    );

    // Authenticated requests through gateway fail fast with UPSTREAM_UNAVAILABLE (due to auth_request subrequest)
    console.log('\n5. Testing authenticated request through gateway while core is DOWN:');
    const authStart = Date.now();
    const authReqRes = await fetch(`${GATEWAY_URL}/api/queue/me`, {
      headers: { Authorization: `Bearer ${cust1Token}` },
    });
    const authElapsed = Date.now() - authStart;
    let authReqData: any = {};
    try {
      authReqData = await authReqRes.json();
    } catch {}
    report(
      'Authenticated request through gateway fails fast (<2000ms) with UPSTREAM_UNAVAILABLE',
      (authReqRes.status === 502 || authReqRes.status === 500) &&
        authReqData.error?.code === 'UPSTREAM_UNAVAILABLE' &&
        authElapsed < 2000,
      `Status: ${authReqRes.status}, Code: ${authReqData.error?.code}, Duration: ${authElapsed}ms`
    );

    // Restart core so environment is restored
    console.log('\n🔄 Restarting monolith backend process...');
    if (isContainerizedCore) {
      execSync('docker compose start core', { stdio: 'pipe' });
    } else {
      backendProc = startBackendProcess();
    }
    const coreRestored = await waitForBackend(30000);
    report('Monolith backend restored and healthy', coreRestored);

    console.log('\n-------------------------------------------------------------');
    if (overallSuccess) {
      console.log('🎉 THREE-WAY QUEUE OUTAGE DEMO PASSED ALL SCENARIOS WITH EXACT COUNTS!');
    } else {
      console.error('❌ SOME CHECKS FAILED IN OUTAGE DEMO');
    }
    console.log('-------------------------------------------------------------\n');
  } finally {
    if (backendProc && backendProc.pid) {
      killProcessTree(backendProc.pid);
    }
    await pool.end();
  }

  if (!overallSuccess) {
    process.exit(1);
  }
}

runDemo().catch((err) => {
  console.error('❌ Outage demo crashed with error:', err);
  process.exit(1);
});
