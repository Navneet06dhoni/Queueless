import http from 'http';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';

const GATEWAY_URL = 'http://localhost:8080';
const BACKEND_URL = 'http://localhost:5000';

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForBackend(maxWaitMs = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(`${BACKEND_URL}/api/health`);
      if (res.ok) return true;
    } catch {
      // Wait and retry
    }
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
  console.log('🚀 Starting Gateway Smoke Tests (10 Verification Checks)...\n');

  // Spawn backend process
  console.log('📦 Launching backend server on port 5000...');
  const serverScript = path.resolve(__dirname, '../backend/src/server.ts');
  const backendProc = spawn('npx', ['tsx', serverScript], {
    cwd: path.resolve(__dirname, '..'),
    shell: true,
    stdio: 'pipe',
    env: { ...process.env, PORT: '5000', NODE_ENV: 'test' },
  });

  backendProc.stderr?.on('data', (d) => {
    // Log unexpected errors
  });

  const backendReady = await waitForBackend();
  if (!backendReady) {
    killProcessTree(backendProc.pid!);
    throw new Error('❌ Failed to start backend within 15 seconds');
  }
  console.log('✅ Backend is up and healthy on http://localhost:5000\n');

  try {
    // -------------------------------------------------------------
    // Check (1): GET /healthz returns 200 {"status":"ok"} directly from Nginx
    // -------------------------------------------------------------
    console.log('1️⃣ Checking /healthz on gateway...');
    const healthzRes = await fetch(`${GATEWAY_URL}/healthz`);
    const healthzBody = await healthzRes.json();
    if (healthzRes.status !== 200 || healthzBody.status !== 'ok') {
      throw new Error(`Check 1 failed: /healthz returned ${healthzRes.status} ${JSON.stringify(healthzBody)}`);
    }
    const healthzReqId = healthzRes.headers.get('x-request-id');
    if (!healthzReqId) throw new Error('Check 1 failed: missing X-Request-Id header on /healthz');
    console.log(`   ✅ /healthz returned 200 {"status":"ok"} with X-Request-Id: ${healthzReqId}`);

    // -------------------------------------------------------------
    // Check (2): GET /internal/secret returns 404
    // -------------------------------------------------------------
    console.log('2️⃣ Checking /internal/secret returns 404 JSON...');
    const internalRes = await fetch(`${GATEWAY_URL}/internal/secret`);
    const internalBody = await internalRes.json();
    if (internalRes.status !== 404 || internalBody.error?.code !== 'NOT_FOUND') {
      throw new Error(`Check 2 failed: /internal/secret returned ${internalRes.status} ${JSON.stringify(internalBody)}`);
    }
    console.log(`   ✅ /internal/secret blocked with 404 NOT_FOUND: ${JSON.stringify(internalBody.error)}`);

    // -------------------------------------------------------------
    // Check (3): Sending X-User-Id: spoofed does NOT reach the backend
    // -------------------------------------------------------------
    console.log('3️⃣ Checking spoofed identity headers are stripped by gateway...');
    const spoofRes = await fetch(`${GATEWAY_URL}/api/auth/me`, {
      headers: {
        'X-User-Id': '00000000-0000-0000-0000-000000000000',
        'X-User-Role': 'admin',
        'X-Internal-Secret': 'super-secret',
      },
    });
    if (spoofRes.status !== 401) {
      const spoofBody = await spoofRes.json();
      throw new Error(`Check 3 failed: spoofed headers bypassed auth and returned ${spoofRes.status}: ${JSON.stringify(spoofBody)}`);
    }
    console.log('   ✅ Spoofed identity headers X-User-Id and X-User-Role were stripped by the gateway (401 returned)');

    // -------------------------------------------------------------
    // Check (5): A POST with body > 100k returns 413 with our JSON format
    // -------------------------------------------------------------
    console.log('4️⃣ Checking payload size limit (client_max_body_size 100k)...');
    const largePayload = JSON.stringify({ data: 'A'.repeat(120 * 1024) });
    const payloadRes = await fetch(`${GATEWAY_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: largePayload,
    });
    const payloadBody = await payloadRes.json();
    if (payloadRes.status !== 413 || payloadBody.error?.code !== 'PAYLOAD_TOO_LARGE') {
      throw new Error(`Check 5 failed: large body returned ${payloadRes.status}: ${JSON.stringify(payloadBody)}`);
    }
    const payloadReqId = payloadRes.headers.get('x-request-id');
    if (!payloadReqId || payloadReqId !== payloadBody.error?.requestId) {
      throw new Error(`Check 5 failed: X-Request-Id header (${payloadReqId}) does not match body requestId (${payloadBody.error?.requestId})`);
    }
    console.log(`   ✅ 120k payload triggered 413 PAYLOAD_TOO_LARGE JSON with matching requestId: ${payloadReqId}`);

    // -------------------------------------------------------------
    // Check (6): WebSocket connection succeeds at ws://localhost:8080/socket.io/?EIO=4&transport=websocket
    // -------------------------------------------------------------
    console.log('5️⃣ Checking WebSocket proxying on ws://localhost:8080/socket.io/...');
    const wsUrl = `ws://localhost:8080/socket.io/?EIO=4&transport=websocket`;
    const wsReceived = await new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('WebSocket connection timed out'));
      }, 5000);

      ws.onmessage = (event) => {
        clearTimeout(timer);
        ws.close();
        resolve(event.data.toString());
      };

      ws.onerror = (err) => {
        clearTimeout(timer);
        reject(err);
      };
    });
    if (!wsReceived.startsWith('0')) {
      throw new Error(`Check 6 failed: unexpected WebSocket message: ${wsReceived}`);
    }
    console.log(`   ✅ WebSocket handshake succeeded: ${wsReceived.slice(0, 40)}...`);

    // -------------------------------------------------------------
    // Check (7 & 8): /api/auth/me canary auth_request verification vs direct monolith
    // -------------------------------------------------------------
    console.log('6️⃣ Checking canary auth_request verification on /api/auth/me...');
    // Register unique test user to obtain valid access token
    const testEmail = `gateway_test_${Date.now()}@example.com`;
    const regRes = await fetch(`${BACKEND_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: 'Password123!',
        name: 'Gateway Tester',
        role: 'customer',
      }),
    });
    const regData = await regRes.json();
    const token = regData.accessToken;
    if (!token) throw new Error(`Could not obtain access token: ${JSON.stringify(regData)}`);

    // Test through Gateway (auth_request canary)
    const gatewayMeRes = await fetch(`${GATEWAY_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const gatewayMeBody = await gatewayMeRes.json();
    if (gatewayMeRes.status !== 200 || !gatewayMeBody.user?.id) {
      throw new Error(`Check 7 failed: gateway /api/auth/me returned ${gatewayMeRes.status} ${JSON.stringify(gatewayMeBody)}`);
    }
    console.log(`   ✅ Gateway /api/auth/me succeeded via auth_request canary (User: ${gatewayMeBody.user.email})`);

    // Test directly against Monolith :5000 (monolith fallback)
    const directMeRes = await fetch(`${BACKEND_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const directMeBody = await directMeRes.json();
    if (directMeRes.status !== 200 || directMeBody.user?.id !== gatewayMeBody.user?.id) {
      throw new Error(`Check 8 failed: direct /api/auth/me returned ${directMeRes.status} instead of matching user`);
    }
    console.log(`   ✅ Monolith :5000 /api/auth/me directly returned identical user object`);

    // Check invalid token through gateway returns 401 JSON
    const invalidMeRes = await fetch(`${GATEWAY_URL}/api/auth/me`, {
      headers: { Authorization: 'Bearer invalid.token.here' },
    });
    const invalidMeBody = await invalidMeRes.json();
    if (invalidMeRes.status !== 401 || invalidMeBody.error?.code !== 'UNAUTHORIZED') {
      throw new Error(`Invalid token check failed: status ${invalidMeRes.status} body ${JSON.stringify(invalidMeBody)}`);
    }
    console.log(`   ✅ Invalid token correctly rejected with 401 UNAUTHORIZED JSON`);

    // -------------------------------------------------------------
    // Check (9): Response contains X-Request-Id matching JSON body error.requestId
    // -------------------------------------------------------------
    console.log('7️⃣ Checking X-Request-Id header matching error.requestId...');
    const notFoundRes = await fetch(`${GATEWAY_URL}/api/non-existent-endpoint-test`);
    const notFoundBody = await notFoundRes.json();
    const notFoundReqIdHeader = (notFoundRes.headers.get('x-request-id') || '').split(',')[0].trim();
    if (!notFoundReqIdHeader || notFoundReqIdHeader !== notFoundBody.error?.requestId) {
      throw new Error(`Check 9 failed: header ${notFoundReqIdHeader} did not match body ${notFoundBody.error?.requestId}`);
    }
    console.log(`   ✅ X-Request-Id (${notFoundReqIdHeader}) matched body error.requestId exactly`);

    // -------------------------------------------------------------
    // Check (4): Rate limit on /api/auth/login triggers 429 on 6th rapid request
    // -------------------------------------------------------------
    console.log('8️⃣ Checking edge rate limit on /api/auth/login (5 req/min, burst 2)...');
    let triggered429 = false;
    let rateLimitReqId = '';
    for (let i = 1; i <= 10; i++) {
      const rlRes = await fetch(`${GATEWAY_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `test${i}@example.com`, password: 'wrongpassword123' }),
      });
      if (rlRes.status === 429) {
        triggered429 = true;
        const rlBody = await rlRes.json();
        rateLimitReqId = rlRes.headers.get('x-request-id') || '';
        if (rlBody.error?.code !== 'TOO_MANY_REQUESTS') {
          throw new Error(`Rate limit JSON error code expected TOO_MANY_REQUESTS, got ${JSON.stringify(rlBody)}`);
        }
        if (rlBody.error?.requestId !== rateLimitReqId) {
          throw new Error(`Rate limit requestId mismatch: ${rateLimitReqId} vs ${rlBody.error?.requestId}`);
        }
        console.log(`   ✅ Request #${i} triggered 429 TOO_MANY_REQUESTS JSON (requestId: ${rateLimitReqId})`);
        break;
      }
    }
    if (!triggered429) {
      throw new Error('Check 4 failed: rate limit 429 was not triggered within 10 rapid requests');
    }

    // -------------------------------------------------------------
    // Check (10): Kill backend process; GET /api/health returns 502 with JSON within 2s
    // -------------------------------------------------------------
    console.log('9️⃣ Killing backend process to test 502 Bad Gateway behavior...');
    killProcessTree(backendProc.pid!);
    await sleep(500);

    const start502 = Date.now();
    const badGatewayRes = await fetch(`${GATEWAY_URL}/api/health`);
    const duration502 = Date.now() - start502;
    const badGatewayBody = await badGatewayRes.json();

    if (badGatewayRes.status !== 502) {
      throw new Error(`Check 10 failed: expected 502, got ${badGatewayRes.status}`);
    }
    if (badGatewayBody.error?.code !== 'BAD_GATEWAY') {
      throw new Error(`Check 10 failed: expected BAD_GATEWAY, got ${JSON.stringify(badGatewayBody)}`);
    }
    if (duration502 > 2000) {
      throw new Error(`Check 10 failed: 502 response took ${duration502}ms (expected < 2000ms)`);
    }
    const bgReqId = badGatewayRes.headers.get('x-request-id');
    if (!bgReqId || bgReqId !== badGatewayBody.error?.requestId) {
      throw new Error(`Check 10 failed: 502 X-Request-Id mismatch: ${bgReqId} vs ${badGatewayBody.error?.requestId}`);
    }
    console.log(`   ✅ 502 Bad Gateway JSON returned in ${duration502}ms with code BAD_GATEWAY and matching requestId: ${bgReqId}\n`);

    console.log('🎉 ALL 10 GATEWAY SMOKE CHECKS PASSED SUCCESSFULLY!');
    process.exit(0);
  } catch (err: any) {
    console.error('❌ Gateway Smoke Test Failed:', err.message);
    killProcessTree(backendProc.pid!);
    process.exit(1);
  }
}

runSmokeTests();
