import { createHealthRouter } from '@queueless/common';
import { query } from '../../db';
import redis from '../../config/redis';
import { outboxRepository } from '../../events/outbox.repository';

export const healthRouter = createHealthRouter({
  serviceName: 'queueless-backend',
  checks: {
    database: async () => {
      await query('SELECT 1');
      return true;
    },
    redis: async () => {
      if (redis.status === 'ready' || redis.status === 'connect') {
        await redis.ping();
        return true;
      }
      await redis.ping();
      return true;
    },
  },
  getOldestUnpublishedOutboxAgeSeconds: async () => {
    try {
      return await outboxRepository.getOldestUnpublishedAgeSeconds();
    } catch {
      return null;
    }
  },
});

export default healthRouter;
