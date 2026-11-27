import { createServiceMetrics } from '@queueless/common';
import { redis, setRedisLatencyObserver } from './redis';
import { getIO } from './socket';

export const queueMetrics = createServiceMetrics({
  serviceName: 'queue-service',
  onBeforeScrape: async () => {
    const io = getIO();
    socketConnectionsActive.set(io?.engine?.clientsCount ?? 0);

    if (redis.status === 'ready') {
      try {
        const keys = await redis.keys('queue:*');
        const queueKeys = keys.filter((k) => {
          const parts = k.split(':');
          return (
            parts.length === 2 &&
            parts[0] === 'queue' &&
            parts[1].length > 0
          );
        });

        if (queueKeys.length === 0) {
          queueWaitingTotal.set(0);
          return;
        }

        const pipeline = redis.pipeline();
        for (const k of queueKeys) {
          pipeline.zcard(k);
        }
        const results = await pipeline.exec();
        let total = 0;
        if (results) {
          for (const [err, val] of results) {
            if (!err && typeof val === 'number') {
              total += val;
            }
          }
        }
        queueWaitingTotal.set(total);
      } catch {
        // ignore if Redis unavailable
      }
    }
  },
});

export const queueJoinsTotal = queueMetrics.registerCounter({
  name: 'queueless_queue_joins_total',
  help: 'Total number of customer queue joins',
});

export const queueCallsTotal = queueMetrics.registerCounter({
  name: 'queueless_queue_calls_total',
  help: 'Total number of queue next-customer calls',
});

export const queueWaitingTotal = queueMetrics.registerGauge({
  name: 'queueless_queue_waiting_total',
  help: 'Total number of customers currently waiting across all queues',
});

export const socketConnectionsActive = queueMetrics.registerGauge({
  name: 'queueless_socket_connections_active',
  help: 'Number of active Socket.io connections',
});

export const redisLatencySeconds = queueMetrics.registerHistogram({
  name: 'queueless_redis_latency_seconds',
  help: 'Latency of Redis operations in seconds',
  labelNames: ['operation'] as const,
  buckets: [0.0005, 0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
});

setRedisLatencyObserver((operation, seconds) => {
  redisLatencySeconds.observe({ operation }, seconds);
});
