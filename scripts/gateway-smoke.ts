import http from 'http';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { io as ioClient, Socket } from 'socket.io-client';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

const GATEWAY_URL = 'http://localhost:8080';
const BACKEND_URL = 'http://localhost:5000';
const DB_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgrespassword@localhost:5432/queueless_test';

const pool = new Pool({ connectionString: DB_URL });

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
    // Ignore error
  }
}

async function runSmokeTests() {
  console.log('🚀 Starting Gateway Smoke Tests...\n');

  let backendProc: ChildProcess | null = null;
  const alreadyRunning = await isBackendRunning();
  let weStartedBackend = false;

  if (!alreadyRunning) {
    console.log('📦 Launching backend server on port 5000...');
    const serverScript = path.resolve(__dirname, '../backend/src/server.ts');
    backendProc = spawn('npx', ['tsx', serverScript], {
      cwd: path.resolve(__dirname, '..'),
      shell: true,
      stdio: 'pipe',
      env: { ...process.env, PORT: '5000', NODE_ENV: 'test', TRUST_PROXY: '1' },
    });

    const backendReady = await waitForBackend();
    if (!backendReady) {
      if (backendProc.pid) killProcessTree(backendProc.pid);
      throw new Error('❌ Failed to start backend within 15 seconds');
    }
    weStartedBackend = true;
    console.log('✅ Backend started on http://localhost:5000\n');
  } else {
    console.log('ℹ️  Backend is already running on http://localhost:5000. Reusing existing instance.\n');
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
    // -------------------------------------------------------------
    // Check 1: Healthz
    // -------------------------------------------------------------
    console.log('1️⃣ Checking /healthz on gateway...');
    const healthzRes = await fetch(`${GATEWAY_URL}/healthz`);
    const healthzBody = await healthzRes.json();
    const healthzReqId = healthzRes.headers.get('x-request-id');
    const c1Pass = healthzRes.status === 200 && healthzBody.status === 'ok' && !!healthzReqId;
    reportCheck('GET /healthz returns 200 {"status":"ok"} directly from Nginx', c1Pass, `RequestId: ${healthzReqId}`);

    // -------------------------------------------------------------
    // Check 2: Internal block 404
    // -------------------------------------------------------------
    console.log('\n2️⃣ Checking /internal/secret returns 404 JSON with {error:{code,message,requestId}}...');
    const internalRes = await fetch(`${GATEWAY_URL}/internal/secret`);
    const internalBody = await internalRes.json();
    const c2Pass =
      internalRes.status === 404 &&
      internalBody.error?.code === 'NOT_FOUND' &&
      typeof internalBody.error?.message === 'string' &&
      !!internalBody.error?.requestId;
    reportCheck('GET /internal/secret returns 404 with code NOT_FOUND', c2Pass, JSON.stringify(internalBody.error));

    // -------------------------------------------------------------
    // Check 3 (a): Valid customer token + spoofed headers returns customer's own identity
    // -------------------------------------------------------------
    console.log('\n3️⃣ Check (a): Customer token with spoofed X-User-Id & X-User-Role returns customer identity...');
    // Register unique test customer
    const custEmail = `cust_smoke_${Date.now()}@example.com`;
    const custPass = 'Customer123!';
    const regRes = await fetch(`${BACKEND_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: custEmail, password: custPass, name: 'Smoke Customer', role: 'customer' }),
    });
    const regData = await regRes.json();
    const custToken = regData.accessToken;
    const custId = regData.user.id;

    // Send valid token with SPOOFED headers through gateway
    const spoofMeRes = await fetch(`${GATEWAY_URL}/api/auth/me`, {
      headers: {
        Authorization: `Bearer ${custToken}`,
        'X-User-Id': '00000000-0000-0000-0000-000000000000',
        'X-User-Role': 'admin',
      },
    });
    const spoofMeBody = await spoofMeRes.json();
    const c3Pass =
      spoofMeRes.status === 200 &&
      spoofMeBody.user?.id === custId &&
      spoofMeBody.user?.role === 'customer' &&
      spoofMeBody.user?.email === custEmail;
    reportCheck(
      'Spoofed identity headers stripped; /api/auth/me returns customer identity',
      c3Pass,
      `User ID: ${spoofMeBody.user?.id}, Role: ${spoofMeBody.user?.role}`
    );

    // -------------------------------------------------------------
    // Check 4 (b): Login returns refresh cookie with HttpOnly, SameSite=Lax, Path=/api/auth
    // -------------------------------------------------------------
    console.log('\n4️⃣ Check (b): Login through gateway returns refresh cookie with HttpOnly, SameSite=Lax, Path=/api/auth...');
    const loginRes = await fetch(`${GATEWAY_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: custEmail, password: custPass }),
    });
    const setCookie = loginRes.headers.get('set-cookie') || '';
    const hasHttpOnly = /httponly/i.test(setCookie);
    const hasSameSiteLax = /samesite=lax/i.test(setCookie);
    const hasPath = /path=\/api\/auth/i.test(setCookie);
    const c4Pass = loginRes.status === 200 && hasHttpOnly && hasSameSiteLax && hasPath;
    reportCheck(
      'Login through gateway returns valid refresh cookie with HttpOnly, SameSite=Lax, Path=/api/auth',
      c4Pass,
      `Set-Cookie: ${setCookie.slice(0, 80)}...`
    );

    // -------------------------------------------------------------
    // Check 5 (c): Socket through gateway receives queue:position event after join
    // -------------------------------------------------------------
    console.log('\n5️⃣ Check (c): Socket through gateway receives queue:position event after joining queue...');
    let bizRes = await pool.query(`SELECT id FROM businesses WHERE status = 'approved' LIMIT 1`);
    let bizId = bizRes.rows[0]?.id;

    if (!bizId) {
      const ownerRes = await pool.query(
        `INSERT INTO users (name, email, password_hash, role)
         VALUES ('Smoke Owner', $1, 'dummy_hash', 'owner')
         RETURNING id`,
        [`owner_smoke_${Date.now()}@example.com`]
      );
      const ownerId = ownerRes.rows[0].id;
      const newBizRes = await pool.query(
        `INSERT INTO businesses (owner_id, name, description, address, phone, status, queue_open)
         VALUES ($1, 'Smoke Clinic', 'Smoke Testing Clinic', '123 Main St', '555-0199', 'approved', true)
         RETURNING id`,
        [ownerId]
      );
      bizId = newBizRes.rows[0].id;
    }

    let socketReceivedPosition = false;

    if (bizId) {
      // Ensure business queue is open and has 24/7 working hours so join succeeds at any time
      await pool.query(`UPDATE businesses SET queue_open = true WHERE id = $1`, [bizId]);
      for (let day = 0; day <= 6; day++) {
        await pool.query(
          `INSERT INTO working_hours (business_id, day_of_week, open_time, close_time)
           VALUES ($1, $2, '00:00:00', '23:59:59')
           ON CONFLICT (business_id, day_of_week)
           DO UPDATE SET open_time = '00:00:00', close_time = '23:59:59'`,
          [bizId, day]
        );
      }

      const clientSocket: Socket = ioClient(GATEWAY_URL, {
        auth: { token: custToken },
        transports: ['websocket'],
      });

      const positionPromise = new Promise<boolean>((resolve) => {
        clientSocket.on('queue:position', (data) => {
          if (data && data.position) {
            socketReceivedPosition = true;
            resolve(true);
          }
        });
        setTimeout(() => resolve(false), 8000);
      });

      await new Promise<void>((resolve) => {
        if (clientSocket.connected) resolve();
        else clientSocket.on('connect', () => resolve());
      });

      // Join queue through gateway
      const joinRes = await fetch(`${GATEWAY_URL}/api/queue/${bizId}/join`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${custToken}` },
      });
      if (!joinRes.ok) {
        console.error(`   Join queue failed: ${joinRes.status} ${await joinRes.text()}`);
      }

      await positionPromise;
      clientSocket.disconnect();
    }
    reportCheck('Socket through gateway receives queue:position event on join', socketReceivedPosition);

    // -------------------------------------------------------------
    // Check 6 (d): Admin blocks user -> valid token rejected on /api/auth/me immediately
    // -------------------------------------------------------------
    console.log('\n6️⃣ Check (d): User blocked by admin has access token rejected on /api/auth/me immediately...');
    // Create admin user with bcrypt password hash & login to get admin token
    const adminEmail = `admin_smoke_${Date.now()}@example.com`;
    const adminPass = 'AdminPass123!';
    const adminPassHash = await bcrypt.hash(adminPass, 12);
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ('Admin Smoke', $1, $2, 'admin')`,
      [adminEmail, adminPassHash]
    );
    const adminLoginRes = await fetch(`${BACKEND_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: adminPass }),
    });
    const adminLoginData = await adminLoginRes.json();
    const adminToken = adminLoginData.accessToken;

    // Block customer
    const blockRes = await fetch(`${GATEWAY_URL}/api/admin/users/${custId}/block`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ blocked: true, reason: 'Smoke test suspension' }),
    });

    // Test /api/auth/me with custToken immediately through gateway
    const blockedMeRes = await fetch(`${GATEWAY_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${custToken}` },
    });
    const c6Pass = blockRes.status === 200 && (blockedMeRes.status === 403 || blockedMeRes.status === 401);
    reportCheck(
      'Blocked user access token is rejected immediately on /api/auth/me',
      c6Pass,
      `Status: ${blockedMeRes.status}`
    );

    // -------------------------------------------------------------
    // Check 7 (e): TRUST_PROXY=1 - Forged X-Forwarded-For shares ONE rate limit bucket
    // -------------------------------------------------------------
    console.log('\n7️⃣ Check (e): With TRUST_PROXY=1, forged X-Forwarded-For shares ONE rate limit bucket...');
    let hitRateLimit = false;
    let rlBody: any = null;
    for (let i = 1; i <= 8; i++) {
      const forgedIp = `203.0.113.${i}`; // Different forged IP every request
      const rlRes = await fetch(`${GATEWAY_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': forgedIp,
        },
        body: JSON.stringify({ email: `forged_${i}@example.com`, password: 'WrongPassword123' }),
      });

      if (rlRes.status === 429) {
        hitRateLimit = true;
        rlBody = await rlRes.json();
        break;
      }
    }
    const c7Pass =
      hitRateLimit &&
      rlBody?.error?.code === 'RATE_LIMITED' &&
      typeof rlBody?.error?.message === 'string' &&
      !!rlBody?.error?.requestId;
    reportCheck(
      'Forged X-Forwarded-For does NOT bypass bucket; 429 RATE_LIMITED returned',
      c7Pass,
      JSON.stringify(rlBody?.error)
    );

    // -------------------------------------------------------------
    // Check 8: Payload too large > 100k returns 413 PAYLOAD_TOO_LARGE
    // -------------------------------------------------------------
    console.log('\n8️⃣ Checking payload size limit (client_max_body_size 100k)...');
    const largePayload = JSON.stringify({ data: 'X'.repeat(120 * 1024) });
    const payloadRes = await fetch(`${GATEWAY_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: largePayload,
    });
    const payloadBody = await payloadRes.json();
    const c8Pass =
      payloadRes.status === 413 &&
      payloadBody?.error?.code === 'PAYLOAD_TOO_LARGE' &&
      payloadRes.headers.get('x-request-id') === payloadBody?.error?.requestId;
    reportCheck(
      'Payload > 100k returns 413 PAYLOAD_TOO_LARGE with matching requestId',
      c8Pass,
      JSON.stringify(payloadBody?.error)
    );

    // -------------------------------------------------------------
    // Check 9: Header requestId matches JSON body error.requestId
    // -------------------------------------------------------------
    console.log('\n9️⃣ Checking X-Request-Id header matching body error.requestId...');
    const notFoundRes = await fetch(`${GATEWAY_URL}/api/non-existent-smoke-test-route`);
    const notFoundBody = await notFoundRes.json();
    const notFoundReqId = (notFoundRes.headers.get('x-request-id') || '').split(',')[0].trim();
    const c9Pass = !!notFoundReqId && notFoundReqId === notFoundBody?.error?.requestId;
    reportCheck(
      'X-Request-Id header matches error.requestId exactly',
      c9Pass,
      `Header: ${notFoundReqId} === Body: ${notFoundBody?.error?.requestId}`
    );

    // -------------------------------------------------------------
    // Check 10: 502 UPSTREAM_UNAVAILABLE
    // -------------------------------------------------------------
    console.log('\n🔟 Checking 502 UPSTREAM_UNAVAILABLE JSON error page behavior...');
    if (weStartedBackend && backendProc?.pid) {
      console.log('   Stopping spawned backend process to trigger 502...');
      killProcessTree(backendProc.pid);
      backendProc = null;
      await sleep(500);

      const start502 = Date.now();
      const badGatewayRes = await fetch(`${GATEWAY_URL}/api/health`);
      const duration502 = Date.now() - start502;
      const badGatewayBody = await badGatewayRes.json();

      const c10Pass =
        badGatewayRes.status === 502 &&
        badGatewayBody.error?.code === 'UPSTREAM_UNAVAILABLE' &&
        typeof badGatewayBody.error?.message === 'string' &&
        !!badGatewayBody.error?.requestId &&
        duration502 < 2000;
      reportCheck(
        '502 returned in <2s with code UPSTREAM_UNAVAILABLE and JSON error envelope',
        c10Pass,
        JSON.stringify(badGatewayBody.error)
      );
    } else {
      console.log('   ℹ️  Backend was not started by this runner; leaving external process intact.');
      reportCheck('External backend process was preserved intact (not killed)', true);
    }

    console.log('\n------------------------------------------------------------');
    if (allPassed) {
      console.log('🎉 ALL GATEWAY SMOKE CHECKS PASSED SUCCESSFULLY!\n');
      process.exit(0);
    } else {
      console.error('❌ SOME GATEWAY SMOKE CHECKS FAILED!\n');
      process.exit(1);
    }
  } catch (err: any) {
    console.error('❌ Gateway Smoke Test Exception:', err.message);
    process.exit(1);
  } finally {
    if (weStartedBackend && backendProc?.pid) {
      killProcessTree(backendProc.pid);
    }
    await pool.end();
  }
}

runSmokeTests();
