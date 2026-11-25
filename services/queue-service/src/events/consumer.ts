import { RabbitMQClient, QUEUES, EXCHANGES } from '@queueless/messaging';
import { logger } from '@queueless/common';
import { config } from '../config';
import { emitNotificationNew, disconnectUserSockets } from '../socket';
import { queueService } from '../service';

export class QueueConsumerManager {
  private rabbitClient: RabbitMQClient | null = null;
  private running = false;

  async start(): Promise<void> {
    if (this.running) return;
    if (config.EVENT_TRANSPORT !== 'rabbitmq') {
      logger.info('[QueueConsumerManager] In-memory event transport; skipping RabbitMQ consumer initialization');
      return;
    }

    this.rabbitClient = new RabbitMQClient({
      url: config.RABBITMQ_URL,
    });

    await this.rabbitClient.connect();

    this.rabbitClient.onConnect(async () => {
      const ch = await this.rabbitClient?.getChannel();
      if (!ch) return;

      // 1. Consumer on socket.q for notification.created
      const socketQueue = 'socket.q';
      await ch.assertQueue(socketQueue, { durable: true });
      await ch.bindQueue(socketQueue, EXCHANGES.EVENTS, 'notification.created');

      try {
        const socketInfo = await ch.checkQueue(socketQueue);
        if (socketInfo.consumerCount > 0) {
          logger.warn(
            { consumerCount: socketInfo.consumerCount, queue: socketQueue },
            '⚠️ [QueueStartupGuard] socket.q already has active consumer attached! Refusing to attach duplicate consumer.'
          );
        } else {
          await this.rabbitClient?.startConsumer(
            socketQueue,
            'queue_service_socket_consumer',
            async (envelope: any) => {
              const data = envelope.data || envelope;
              if (data?.userId) {
                emitNotificationNew(data.userId, {
                  id: data.notificationId || envelope.eventId,
                  type: data.type,
                  title: data.title,
                  message: data.message,
                  data: data.data,
                  createdAt: data.createdAt || envelope.occurredAt || new Date().toISOString(),
                });
              }
            }
          );
        }
      } catch (checkErr: any) {
        logger.warn({ err: checkErr.message }, '[QueueStartupGuard] Could not check socket.q status');
      }

      // 2. Consumer on queue.q for user.blocked
      const queueQueue = QUEUES.QUEUE;
      await ch.assertQueue(queueQueue, {
        durable: true,
        arguments: { 'x-dead-letter-exchange': EXCHANGES.DLX },
      });
      await ch.bindQueue(queueQueue, EXCHANGES.EVENTS, 'user.blocked');

      try {
        const queueInfo = await ch.checkQueue(queueQueue);
        if (queueInfo.consumerCount > 0) {
          logger.warn(
            { consumerCount: queueInfo.consumerCount, queue: queueQueue },
            '⚠️ [QueueStartupGuard] queue.q already has active consumer attached! Refusing to attach duplicate consumer.'
          );
        } else {
          await this.rabbitClient?.startConsumer(
            queueQueue,
            'queue_service_blocked_consumer',
            async (envelope: any) => {
              const userId = envelope.data?.userId || envelope.userId;
              if (!userId) return;

              logger.info({ userId }, '[QueueConsumerManager] Handling user.blocked: evicting user and disconnecting sockets');
              try {
                await queueService.evictUserFromQueues(userId);
                disconnectUserSockets(userId);
              } catch (err: any) {
                logger.error({ err: err.message, userId }, '[QueueConsumerManager] Error evicting blocked user');
              }
            }
          );
        }
      } catch (checkErr: any) {
        logger.warn({ err: checkErr.message }, '[QueueStartupGuard] Could not check queue.q status');
      }
    });

    this.running = true;
  }

  async stop(): Promise<void> {
    if (this.rabbitClient) {
      await this.rabbitClient.close();
      this.rabbitClient = null;
    }
    this.running = false;
  }

  getRabbitClient(): RabbitMQClient | null {
    return this.rabbitClient;
  }
}

export const queueConsumerManager = new QueueConsumerManager();
