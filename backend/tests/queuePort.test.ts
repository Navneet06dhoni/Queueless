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

  it('HttpQueuePortAdapter: returns null on 404 for getQueueEntry', async () => {
    simulateStatus = 404;
    simulateResponse = { error: { code: 'NOT_FOUND', message: 'Queue entry not found' } };
    const adapter = getAdapter();

    const entry = await adapter.getQueueEntry('non-existent-id');
    expect(entry).toBeNull();
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
      evictUserFromQueues: async () => {},
      getQueueAnalytics: async () => mockQueueData,
      getQueueToday: async () => ({ waitingNow: 2, servedToday: 5, averageWaitMinutesToday: 8.5 }),
      getQueueEntry: async () => null,
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
      evictUserFromQueues: async () => { throw new Error('Queue service unavailable'); },
      getQueueAnalytics: async () => { throw new Error('Connection refused to queue service'); },
      getQueueToday: async () => { throw new Error('Queue service unavailable'); },
      getQueueEntry: async () => { throw new Error('Queue service unavailable'); },
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
      evictUserFromQueues: async () => {},
      getQueueAnalytics: async () => {
        // Simulates timeout (>2000ms)
        await new Promise((resolve) => setTimeout(resolve, 2500));
        return {} as any;
      },
      getQueueToday: async () => ({ waitingNow: 0, servedToday: 0, averageWaitMinutesToday: null }),
      getQueueEntry: async () => null,
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
});
