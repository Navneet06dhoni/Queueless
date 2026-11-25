import http from 'http';
import { io as ioClient, Socket } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import { createApp } from '../backend/src/app';
import { initSocketServer, closeSocketServer } from '../backend/src/socket';
import { config } from '../backend/src/config';
import { pool } from '../backend/src/db';

async function runRollbackProof() {
  console.log('🔄 Running Phase 10d-3 Rollback Proof (QUEUE_MODE=embedded & SOCKET_MODE=embedded)...\n');

  // Verify config shows embedded
  (config as any).QUEUE_MODE = 'embedded';
  (config as any).SOCKET_MODE = 'embedded';
  (config as any).EVENT_TRANSPORT = 'memory';

  const app = createApp();
  const server = http.createServer(app);
  initSocketServer(server);

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://localhost:${port}`;
  console.log(`✅ Embedded monolith running on ${baseUrl}\n`);

  try {
    // 1. Prepare test owner, business, and customer
    const ownerEmail = `rb_owner_${Date.now()}@example.com`;
    const custEmail = `rb_cust_${Date.now()}@example.com`;

    const ownerRes = await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ('Rollback Owner', $1, 'dummy_hash', 'owner')
       RETURNING id`,
      [ownerEmail]
    );
    const ownerId = ownerRes.rows[0].id;

    const bizRes = await pool.query(
      `INSERT INTO businesses (owner_id, name, category, address, city, phone, status, queue_open)
       VALUES ($1, 'Rollback Clinic', 'healthcare', '123 Test St', 'City', '555-0199', 'approved', true)
       RETURNING id`,
      [ownerId]
    );
    const bizId = bizRes.rows[0].id;

    for (let day = 0; day <= 6; day++) {
      await pool.query(
        `INSERT INTO working_hours (business_id, day_of_week, open_time, close_time)
         VALUES ($1, $2, '00:00:00', '23:59:59')
         ON CONFLICT (business_id, day_of_week)
         DO UPDATE SET open_time = '00:00:00', close_time = '23:59:59'`,
        [bizId, day]
      );
    }

    const custRes = await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ('Rollback Customer', $1, 'dummy_hash', 'customer')
       RETURNING id`,
      [custEmail]
    );
    const custId = custRes.rows[0].id;

    const custToken = jwt.sign(
      { sub: custId, id: custId, role: 'customer', email: custEmail, name: 'Rollback Customer' },
      config.JWT_ACCESS_SECRET,
      { expiresIn: '1h' }
    );
    const ownerToken = jwt.sign(
      { sub: ownerId, id: ownerId, role: 'owner', email: ownerEmail, name: 'Rollback Owner' },
      config.JWT_ACCESS_SECRET,
      { expiresIn: '1h' }
    );

    // 2. Connect customer Socket.io to embedded server
    const clientSocket: Socket = ioClient(baseUrl, {
      auth: { token: custToken },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve) => {
      if (clientSocket.connected) resolve();
      else clientSocket.on('connect', () => resolve());
    });
    console.log('   PASS: Customer socket connected to embedded monolith socket server');

    let positionReceived = false;
    let calledReceived = false;

    clientSocket.on('queue:position', (data) => {
      if (data?.position === 1) {
        positionReceived = true;
      }
    });

    clientSocket.on('queue:called', (data) => {
      if (data?.ticketNumber) {
        calledReceived = true;
      }
    });

    // 3. Customer Joins Queue on embedded route
    const joinRes = await fetch(`${baseUrl}/api/queue/${bizId}/join`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${custToken}` },
    });
    const joinData = await joinRes.json();
    console.log('JOIN RES:', joinRes.status, JSON.stringify(joinData));
    console.log(`   PASS: Customer joined queue via embedded route (status ${joinRes.status}, ticket: ${joinData?.ticketNumber})`);

    // Wait for position event
    for (let i = 0; i < 20; i++) {
      if (positionReceived) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    console.log(`   PASS: Customer received queue:position event on socket: ${positionReceived}`);

    // 4. Owner calls next customer via embedded route
    const nextRes = await fetch(`${baseUrl}/api/queue/${bizId}/next`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const nextData = await nextRes.json();
    console.log(`   PASS: Owner called next via embedded route (status ${nextRes.status}, ticket: ${nextData?.ticketNumber})`);

    // Wait for called event
    for (let i = 0; i < 20; i++) {
      if (calledReceived) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    console.log(`   PASS: Customer received queue:called event on socket: ${calledReceived}`);

    clientSocket.disconnect();

    if (positionReceived && calledReceived && joinRes.ok && nextRes.ok) {
      console.log('\n🎉 ROLLBACK PROOF PASSED: Monolith successfully functions in embedded mode!\n');
    } else {
      throw new Error('Rollback proof events not received as expected');
    }
  } finally {
    await closeSocketServer();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  }
}

runRollbackProof()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Rollback proof failed:', err);
    process.exit(1);
  });
