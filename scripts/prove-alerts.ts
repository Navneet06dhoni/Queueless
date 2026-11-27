import { execSync } from 'child_process';
import path from 'path';
import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const PROM_URL = 'http://127.0.0.1:9090';
const GATEWAY_URL = 'http://localhost:8080';
const RMQ_MGMT_URL = 'http://127.0.0.1:15672';

const pgPass = process.env.POSTGRES_PASSWORD || '';
const rmqUser = process.env.RABBITMQ_DEFAULT_USER || 'guest';
const rmqPass = process.env.RABBITMQ_DEFAULT_PASS || 'guest';
const DB_URL = `postgresql://postgres:${pgPass}@localhost:5432/queueless`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForAlertState(
  alertName: string,
  targetState: 'pending' | 'firing',
  timeoutMs = 150000
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${PROM_URL}/api/v1/alerts`);
    const raw = await res.text();
    const json = JSON.parse(raw) as {
      status: string;
      data?: { alerts?: Array<{ labels?: { alertname?: string }; state?: string }> };
    };
    const match = json.data?.alerts?.find(
      (a) => a.labels?.alertname === alertName && a.state === targetState
    );
    if (match) {
      return raw;
    }
    await sleep(4000);
  }
  throw new Error(`Timed out waiting for alert ${alertName} to reach state ${targetState}`);
}

async function waitForContainerHealthy(service: string, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const out = execSync(`docker compose ps ${service} --format "{{.Status}}"`, {
        encoding: 'utf-8',
      }).trim();
      if (out.includes('(healthy)')) return;
    } catch {}
    await sleep(2000);
  }
  throw new Error(`Timed out waiting for ${service} to become healthy`);
}

async function loginCustomer(): Promise<string> {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const res = await fetch(`${GATEWAY_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'customer2@example.com',
        password: 'CustomerPassword123',
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as any;
      return data.data?.accessToken || data.accessToken;
    }
    if (res.status === 429) {
      const waitSec = parseInt(res.headers.get('Retry-After') || '12', 10);
      await sleep(waitSec * 1000 + 500);
      continue;
    }
    throw new Error(`Login failed: ${res.status}`);
  }
  throw new Error('Login failed after retries');
}

async function main() {
  const onlyDlq = process.argv.includes('--only=dlq');
  const pool = new Pool({ connectionString: DB_URL });

  try {
    if (!onlyDlq) {
    // -----------------------------------------------------------------------
    // 1. ServiceDown (notification-service)
    // -----------------------------------------------------------------------
    console.log('=== ALERT 1: ServiceDown (stopping notification-service) ===');
    console.log(`[${new Date().toISOString()}] Stopping notification-service...`);
    execSync('docker compose stop notification-service', { stdio: 'inherit' });

    const sdPendingRaw = await waitForAlertState('ServiceDown', 'pending', 90000);
    console.log(`[${new Date().toISOString()}] ServiceDown PENDING raw /api/v1/alerts:`);
    console.log(sdPendingRaw);

    const sdFiringRaw = await waitForAlertState('ServiceDown', 'firing', 120000);
    console.log(`[${new Date().toISOString()}] ServiceDown FIRING raw /api/v1/alerts:`);
    console.log(sdFiringRaw);

    console.log(`[${new Date().toISOString()}] Starting notification-service...`);
    execSync('docker compose start notification-service', { stdio: 'inherit' });
    await waitForContainerHealthy('notification-service');
    console.log(`[${new Date().toISOString()}] notification-service healthy again.\n`);

    // -----------------------------------------------------------------------
    // 2. OutboxOldestPendingAgeHigh (stop RabbitMQ + create booking)
    // -----------------------------------------------------------------------
    console.log('=== ALERT 2: OutboxOldestPendingAgeHigh (stopping rabbitmq + creating booking) ===');
    const token = await loginCustomer();
    const svcRes = await pool.query(`SELECT id FROM services LIMIT 1`);
    const svcId = svcRes.rows[0].id;
    const offsetDays = 60 + Math.floor(Math.random() * 60);
    const startTime = new Date(Date.now() + 86400000 * offsetDays);
    const endTime = new Date(startTime.getTime() + 30 * 60000);
    const slotRes = await pool.query<{ id: string }>(
      `INSERT INTO slots (service_id, start_time, end_time, status) VALUES ($1, $2, $3, 'free') RETURNING id`,
      [svcId, startTime.toISOString(), endTime.toISOString()]
    );
    const slotId = slotRes.rows[0].id;

    console.log(`[${new Date().toISOString()}] Stopping rabbitmq...`);
    execSync('docker compose stop rabbitmq', { stdio: 'inherit' });

    const bookRes = await fetch(`${GATEWAY_URL}/api/appointments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ slot_id: slotId }),
    });
    if (bookRes.status !== 201) {
      throw new Error(`Booking failed: ${bookRes.status} ${await bookRes.text()}`);
    }
    console.log(`[${new Date().toISOString()}] Booking created while RabbitMQ is stopped.`);

    const obPendingRaw = await waitForAlertState('OutboxOldestPendingAgeHigh', 'pending', 150000);
    console.log(`[${new Date().toISOString()}] OutboxOldestPendingAgeHigh PENDING raw /api/v1/alerts:`);
    console.log(obPendingRaw);

    const obFiringRaw = await waitForAlertState('OutboxOldestPendingAgeHigh', 'firing', 60000);
    console.log(`[${new Date().toISOString()}] OutboxOldestPendingAgeHigh FIRING raw /api/v1/alerts:`);
    console.log(obFiringRaw);

    console.log(`[${new Date().toISOString()}] Starting rabbitmq...`);
    execSync('docker compose start rabbitmq', { stdio: 'inherit' });
    await waitForContainerHealthy('rabbitmq');
    console.log(`[${new Date().toISOString()}] rabbitmq healthy again.\n`);
    }

    // -----------------------------------------------------------------------
    // 3. DeadLetterQueueNotEmpty (publish poison event to queueless.dlq)
    // -----------------------------------------------------------------------
    console.log('=== ALERT 3: DeadLetterQueueNotEmpty (publishing poison event to queueless.dlq) ===');
    const auth = Buffer.from(`${rmqUser}:${rmqPass}`).toString('base64');
    let pubRes: Response | null = null;
    for (let i = 0; i < 10; i++) {
      try {
        pubRes = await fetch(`${RMQ_MGMT_URL}/api/exchanges/%2F/amq.default/publish`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Basic ${auth}`,
          },
          body: JSON.stringify({
            properties: {},
            routing_key: 'queueless.dlq',
            payload: JSON.stringify({ poison: true, reason: 'phase11c-alert-proof' }),
            payload_encoding: 'string',
          }),
        });
        if (pubRes.ok) break;
      } catch {}
      await sleep(2000);
    }
    if (!pubRes || !pubRes.ok) {
      throw new Error(`Failed to publish poison event: ${pubRes?.status}`);
    }
    console.log(`[${new Date().toISOString()}] Published poison event to queueless.dlq.`);

    const dlqPendingRaw = await waitForAlertState('DeadLetterQueueNotEmpty', 'pending', 90000);
    console.log(`[${new Date().toISOString()}] DeadLetterQueueNotEmpty PENDING raw /api/v1/alerts:`);
    console.log(dlqPendingRaw);

    const dlqFiringRaw = await waitForAlertState('DeadLetterQueueNotEmpty', 'firing', 60000);
    console.log(`[${new Date().toISOString()}] DeadLetterQueueNotEmpty FIRING raw /api/v1/alerts:`);
    console.log(dlqFiringRaw);

    // Clean up DLQ
    await fetch(`${RMQ_MGMT_URL}/api/queues/%2F/queueless.dlq/contents`, {
      method: 'DELETE',
      headers: { Authorization: `Basic ${auth}` },
    });
    console.log(`[${new Date().toISOString()}] Purged queueless.dlq after proof.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
