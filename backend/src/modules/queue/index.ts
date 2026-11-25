import { events } from '../../events';
import { logger } from '../../utils/logger';
import { rabbitMQClient, QUEUES } from '../../events/rabbitmq';
import { config } from '../../config';
import { query } from '../../db';
import { queueRedis } from './queue.redis';
import { queueService } from './queue.service';

let subscribed = false;

const handleUserBlocked = async (userId: string) => {
  try {
    const entriesRes = await query<{ id: string; business_id: string }>(
      `UPDATE queue_history
       SET status = 'left'
       WHERE customer_id = $1 AND status IN ('waiting', 'called')
       RETURNING id, business_id`,
      [userId]
    );

    for (const entry of entriesRes.rows) {
      await queueRedis.removeEntry(entry.business_id, entry.id, userId);
      await queueService.broadcastQueueState(entry.business_id);
      await queueService.updateWaitingPositions(entry.business_id);
    }
  } catch (err: any) {
    logger.error({ err: err?.message || err, userId }, '[QueueModule] Failed to evict blocked user from queues');
  }
};

export const _resetSubscribedForTesting = (): void => {
  subscribed = false;
};

export const initQueueSubscriptions = (): void => {
  if (config.QUEUE_MODE === 'service') {
    logger.info('[QueueModule] QUEUE_MODE is service; skipping monolith queue subscriptions');
    return;
  }
  if (subscribed) return;
  subscribed = true;

  events.subscribe('user.blocked', async (envelope) => {
    const userId = envelope.data?.userId || envelope.userId;
    if (!userId) return;
    await handleUserBlocked(userId);
  });

  if (config.EVENT_TRANSPORT === 'rabbitmq') {
    rabbitMQClient.onConnect(async () => {
      // Startup guard: check if queue.q already has a consumer attached
      try {
        const ch = await rabbitMQClient.getChannel();
        if (ch) {
          const queueInfo = await ch.checkQueue(QUEUES.QUEUE);
          if (queueInfo.consumerCount > 0) {
            logger.warn(
              { consumerCount: queueInfo.consumerCount, queue: QUEUES.QUEUE },
              '⚠️ [QueueStartupGuard] Queue already has active consumer attached! Refusing to attach duplicate queue consumer.'
            );
            return;
          }
        }
      } catch (checkErr: any) {
        logger.warn({ err: checkErr.message }, '[QueueStartupGuard] Could not check queue status');
      }

      await rabbitMQClient.startConsumer(
        QUEUES.QUEUE,
        'queue_consumer',
        async (envelope: any) => {
          if (envelope.type === 'user.blocked') {
            const userId = envelope.data?.userId || envelope.userId;
            if (userId) {
              await handleUserBlocked(userId);
            }
          }
        }
      );
    });
  }
};
