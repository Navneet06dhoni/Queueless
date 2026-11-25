import http from 'http';
import { createInternalClient } from '@queueless/common';
import { HttpQueuePortAdapter, QueuePort } from '../src/modules/queue/queue.ports';
import { AnalyticsRepository } from '../src/modules/analytics/analytics.repository';

describe('QueuePort & HttpQueuePortAdapter (Fail-Soft & Resilience)', () => {
  let fakeQueueServer: http.Server;
  let serverPort: number;
  let lastRequestUrl: string | undefined;
  let simulateDelayMs = 0;
  let simulateStatus = 200;
  let simulateResponse: any = {};

  beforeAll(async () => {
    fakeQueueServer = http.createServer(async (req, res) => {
      lastRequestUrl = req.url;
      if (simulateDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, simulateDelayMs));
      }

      res.writeHead(simulateStatus, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(simulateResponse));
    });

    await new Promise<void>((resolve) => {
      fakeQueueServer.listen(0, '127.0.0.1', () => {
        const addr = fakeQueueServer.address() as any;
        serverPort = addr.port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => fakeQueueServer.close(() => resolve()));
  });

  beforeEach(() => {
    simulateDelayMs = 0;
    simulateStatus = 200;
    simulateResponse = {};
  });

  const getAdapter = () => {
    const client = createInternalClient({
      baseUrl: `http://127.0.0.1:${serverPort}`,
      internalToken: 'internal-secret',
      timeoutMs: 100, // fast timeout for tests
      maxFailures: 3,
    });
    return new HttpQueuePortAdapter(client);
  };

  it('HttpQueuePortAdapter: fetches stats when remote server is UP', async () => {
    simulateResponse = { queueServed30Days: 42 };
    const adapter = getAdapter();

    const stats = await adapter.getQueueStats();
    expect(stats).toEqual({ queueServed30Days: 42 });
    expect(lastRequestUrl).toBe('/internal/stats?days=30');
  });

  it('HttpQueuePortAdapter: calls /internal/analytics/business/:id/summary and /internal/analytics/business/:id/today', async () => {
    simulateResponse = {
      queue: { totalServed: 5, skipped: 0, left: 1, walkInCount: 2, onlineCount: 2, appointmentCount: 1 },
      averageWaitMinutes: 10,
      medianWaitMinutes: 8,
      averageServiceMinutes: 12,
      estimateAccuracy: { sampleSize: 5, meanAbsoluteErrorMinutes: 1.5 },
      peakHours: [],
      daily: [],
    };
    const adapter = getAdapter();

    const analytics = await adapter.getQueueAnalytics('biz-456', '2026-11-01', '2026-11-20');
    expect(analytics.queue.totalServed).toBe(5);
    expect(lastRequestUrl).toBe('/internal/analytics/business/biz-456/summary?from=2026-11-01&to=2026-11-20');

    simulateResponse = { waitingNow: 3, servedToday: 7, averageWaitMinutesToday: 9.2 };
    const today = await adapter.getQueueToday('biz-456');
    expect(today.waitingNow).toBe(3);
    expect(lastRequestUrl).toBe('/internal/analytics/business/biz-456/today');
  });

  it('Contract test: every URL HttpQueuePortAdapter calls exists as a route in queue service OpenAPI spec', () => {
    const { getQueueOpenApiSpec } = require('../../services/queue-service/src/docs/openapi');
    const spec = getQueueOpenApiSpec();
    const paths = Object.keys(spec.paths);

    expect(paths).toContain('/internal/stats');
    expect(paths).toContain('/internal/analytics/business/{id}/summary');
    expect(paths).toContain('/internal/analytics/business/{id}/today');
  });

  it('Analytics parity: exact equality of numbers between monolith and queue service for identical data', async () => {
    const { Pool } = require('pg');
    const { query: coreQuery } = require('../src/db');
    const { QueuePortImpl } = require('../src/modules/queue/queue.ports');
    const { QueueRepository } = require('../../services/queue-service/src/repository');

    const queueDbPool = new Pool({
      connectionString: 'postgresql://postgres:postgrespassword@localhost:5432/queue_test',
    });

    // Ensure a valid business exists in core DB
    let bizRes = await coreQuery(`SELECT id FROM businesses WHERE status = 'approved' LIMIT 1`);
      let testBizId: string;
      if (bizRes.rows.length > 0) {
        testBizId = bizRes.rows[0].id;
      } else {
        const ownerRes = await coreQuery(`
          INSERT INTO users (id, name, email, password_hash, role)
          VALUES ('11111111-9999-9999-9999-999999999999', 'Test Owner', 'parity-owner@example.com', 'hash', 'owner')
          ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
          RETURNING id
        `);
        const insertedBiz = await coreQuery(`
          INSERT INTO businesses (id, owner_id, name, category, address, city, phone, status)
          VALUES ('44444444-4444-4444-4444-444444444444', $1, 'Parity Clinic', 'clinic', '123 Test St', 'Mumbai', '9876543210', 'approved')
          ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
          RETURNING id
        `, [ownerRes.rows[0].id]);
        testBizId = insertedBiz.rows[0].id;
      }
    // Ensure valid customer exists in core DB
    let userRes = await coreQuery(`SELECT id FROM users WHERE role = 'customer' LIMIT 1`);
    let cust1: string;
    if (userRes.rows.length > 0) {
      cust1 = userRes.rows[0].id;
    } else {
      const u = await coreQuery(`
        INSERT INTO users (id, name, email, password_hash, role)
        VALUES ('55555555-5555-5555-5555-555555555551', 'Parity Customer', 'parity-cust@example.com', 'hash', 'customer')
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
      `);
      cust1 = u.rows[0].id;
    }

    // Clear prior test rows
    await coreQuery(`DELETE FROM queue_history WHERE business_id = $1`, [testBizId]);
    await queueDbPool.query(`DELETE FROM queue_history WHERE business_id = $1`, [testBizId]);

    // Insert identical rows into core and queue_db
    const insertSql = `
      INSERT INTO queue_history (
        id, business_id, customer_id, ticket_number, source, status,
        joined_at, called_at, completed_at, estimated_wait_minutes
      ) VALUES
      ('aaaaaaaa-1111-1111-1111-111111111111', $1, $2, 1, 'online', 'completed', NOW() - INTERVAL '30 minutes', NOW() - INTERVAL '15 minutes', NOW() - INTERVAL '5 minutes', 10),
      ('bbbbbbbb-2222-2222-2222-222222222222', $1, NULL, 2, 'walk_in', 'waiting', NOW() - INTERVAL '10 minutes', NULL, NULL, 15)
    `;

    await coreQuery(insertSql, [testBizId, cust1]);
    await queueDbPool.query(insertSql, [testBizId, cust1]);

    try {
      const monolithPort = new QueuePortImpl();
      const queueRepo = new QueueRepository(async (sql: string, params?: any[]) => queueDbPool.query(sql, params));

      const todayStr = new Date().toISOString().split('T')[0];

      // 1. Summary comparison
      const coreSummary = await monolithPort.getQueueAnalytics(testBizId, todayStr, todayStr);
      const queueSummary = await queueRepo.getQueueAnalyticsSummary(testBizId, todayStr, todayStr);

      expect(coreSummary.queue.totalServed).toBe(queueSummary.queue.totalServed);
      expect(coreSummary.queue.walkInCount).toBe(queueSummary.queue.walkInCount);
      expect(coreSummary.queue.onlineCount).toBe(queueSummary.queue.onlineCount);
      expect(coreSummary.averageWaitMinutes).toBe(queueSummary.averageWaitMinutes);
      expect(coreSummary.averageServiceMinutes).toBe(queueSummary.averageServiceMinutes);

      // 2. Today metrics comparison
      const coreToday = await monolithPort.getQueueToday(testBizId);
      const queueToday = await queueRepo.getQueueTodayMetrics(testBizId);

      expect(coreToday.servedToday).toBe(queueToday.servedToday);
      expect(coreToday.averageWaitMinutesToday).toBe(queueToday.averageWaitMinutesToday);

      // 3. Stats comparison
      const coreStats = await monolithPort.getQueueStats();
      const queueStats = await queueRepo.get30DayStats(30);

      expect(coreStats.queueServed30Days).toBeGreaterThanOrEqual(1);
      expect(coreStats.queueServed30Days).toBe(queueStats.queueServed30Days);
    } finally {
      await coreQuery(`DELETE FROM queue_history WHERE business_id = $1`, [testBizId]);
      await queueDbPool.query(`DELETE FROM queue_history WHERE business_id = $1`, [testBizId]);
      await queueDbPool.end();
    }
  });

  it('AnalyticsRepository: fail-soft rule when queue service is UP', async () => {
    const mockQueueData = {
      queue: {
        totalServed: 10,
        skipped: 1,
        left: 2,
        walkInCount: 5,
        onlineCount: 3,
        appointmentCount: 2,
      },
      averageWaitMinutes: 12.5,
      medianWaitMinutes: 10.0,
      averageServiceMinutes: 15.0,
      estimateAccuracy: { sampleSize: 10, meanAbsoluteErrorMinutes: 2.1 },
      peakHours: [{ hour: 14, count: 5 }],
      daily: [{ date: '2026-11-20', served: 10, averageWaitMinutes: 12.5 }],
    };

    const mockQPort: QueuePort = {
      getQueueStats: async () => ({ queueServed30Days: 10 }),
      getQueueAnalytics: async () => mockQueueData,
      getQueueToday: async () => ({ waitingNow: 2, servedToday: 5, averageWaitMinutesToday: 8.5 }),
    };

    const mockBkPort: any = {
      getAppointmentAnalytics: async () => ({
        appointments: { confirmed: 4, completed: 3, noShow: 0, cancelled: 1, noShowRate: 0 },
        slotUtilization: 85.0,
      }),
    };

    const repo = new AnalyticsRepository(mockQPort, mockBkPort);
    const summary = await repo.getSummary('biz-123', '2026-11-01', '2026-11-20');

    expect(summary.partial).toBe(false);
    expect(summary.queue?.totalServed).toBe(10);
    expect(summary.appointments?.confirmed).toBe(4);
  });

  it('AnalyticsRepository: fail-soft rule when queue service is DOWN (queue fields become null, partial: true)', async () => {
    const failingQPort: QueuePort = {
      getQueueStats: async () => { throw new Error('Queue service unavailable'); },
      getQueueAnalytics: async () => { throw new Error('Connection refused to queue service'); },
      getQueueToday: async () => { throw new Error('Queue service unavailable'); },
    };

    const mockBkPort: any = {
      getAppointmentAnalytics: async () => ({
        appointments: { confirmed: 4, completed: 3, noShow: 0, cancelled: 1, noShowRate: 0 },
        slotUtilization: 85.0,
      }),
    };

    const repo = new AnalyticsRepository(failingQPort, mockBkPort);
    const summary = await repo.getSummary('biz-123', '2026-11-01', '2026-11-20');

    expect(summary.partial).toBe(true);
    expect(summary.queue).toBeNull();
    expect(summary.averageWaitMinutes).toBeNull();
    expect(summary.medianWaitMinutes).toBeNull();
    expect(summary.averageServiceMinutes).toBeNull();
    expect(summary.estimateAccuracy).toBeNull();
    expect(summary.peakHours).toEqual([]);
    expect(summary.daily).toEqual([]);
    expect(summary.appointments?.confirmed).toBe(4);
  });

  it('AnalyticsRepository: fail-soft rule when queue service is SLOW (>2s timeout)', async () => {
    const slowQPort: QueuePort = {
      getQueueStats: async () => ({ queueServed30Days: 0 }),
      getQueueAnalytics: async () => {
        // Simulates timeout (>2000ms)
        await new Promise((resolve) => setTimeout(resolve, 2500));
        return {} as any;
      },
      getQueueToday: async () => ({ waitingNow: 0, servedToday: 0, averageWaitMinutesToday: null }),
    };

    const mockBkPort: any = {
      getAppointmentAnalytics: async () => ({
        appointments: { confirmed: 2, completed: 2, noShow: 0, cancelled: 0, noShowRate: 0 },
        slotUtilization: 50.0,
      }),
    };

    const repo = new AnalyticsRepository(slowQPort, mockBkPort);
    const start = Date.now();
    const summary = await repo.getSummary('biz-123', '2026-11-01', '2026-11-20');
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(1900);
    expect(elapsed).toBeLessThan(2400); // Timed out around 2000ms without waiting for 2500ms
    expect(summary.partial).toBe(true);
    expect(summary.queue).toBeNull();
  }, 10000);

  afterAll(async () => {
    const { pool } = require('../src/db');
    await pool.end();
  });
});
