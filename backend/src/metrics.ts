import { createServiceMetrics } from '@queueless/common';
import { pool } from './db';
import { outboxRepository } from './events/outbox.repository';

export const coreMetrics = createServiceMetrics({
  serviceName: 'core',
  onBeforeScrape: async () => {
    // DB pool gauges
    const total = pool.totalCount ?? 0;
    const idle = pool.idleCount ?? 0;
    const waiting = pool.waitingCount ?? 0;
    dbPoolInUse.set(Math.max(0, total - idle));
    dbPoolWaiting.set(waiting);

    // Outbox gauges
    try {
      const res = await pool.query<{ cnt: number }>(
        `SELECT COUNT(*)::int AS cnt FROM outbox_events WHERE status = 'pending'`
      );
      outboxPendingCount.set(res.rows[0]?.cnt ?? 0);
    } catch {
      // ignore if DB not ready
    }

    try {
      const oldestAge = await outboxRepository.getOldestUnpublishedAgeSeconds();
      outboxOldestPendingAgeSeconds.set(oldestAge ?? 0);
    } catch {
      // ignore if DB not ready
    }
  },
});

export const bookingsCreatedTotal = coreMetrics.registerCounter({
  name: 'queueless_bookings_created_total',
  help: 'Total number of confirmed bookings created',
});

export const bookingConflictsTotal = coreMetrics.registerCounter({
  name: 'queueless_booking_conflicts_total',
  help: 'Total number of booking conflicts (HTTP 409)',
});

export const outboxPendingCount = coreMetrics.registerGauge({
  name: 'queueless_outbox_pending_count',
  help: 'Number of pending events in the core outbox table',
});

export const outboxOldestPendingAgeSeconds = coreMetrics.registerGauge({
  name: 'queueless_outbox_oldest_pending_age_seconds',
  help: 'Age in seconds of the oldest pending event in the core outbox table',
});

export const dbPoolInUse = coreMetrics.registerGauge({
  name: 'queueless_db_pool_in_use',
  help: 'Number of PostgreSQL pool connections currently in use',
});

export const dbPoolWaiting = coreMetrics.registerGauge({
  name: 'queueless_db_pool_waiting',
  help: 'Number of clients waiting for a PostgreSQL pool connection',
});
