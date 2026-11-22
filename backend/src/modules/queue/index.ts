import { events } from '../../events';
import { queuePort } from './queue.ports';
import { logger } from '../../utils/logger';
import { rabbitMQClient, QUEUES } from '../../events/rabbitmq';
import { config } from '../../config';

let subscribed = false;

const handleUserBlocked = async (userId: string) => {
  try {
    await queuePort.evictUserFromQueues(userId);
  } catch (err: any) {
    logger.error({ err: err?.message || err, userId }, '[QueueModule] Failed to evict blocked user from queues');
  }
};

export const initQueueSubscriptions = (): void => {
  if (subscribed) return;
  subscribed = true;

  events.subscribe('user.blocked', async (envelope) => {
    const userId = envelope.data?.userId || envelope.userId;
    if (!userId) return;
    await handleUserBlocked(userId);
  });

  if (config.EVENT_TRANSPORT === 'rabbitmq') {
    rabbitMQClient.onConnect(async () => {
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
