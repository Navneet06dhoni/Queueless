import amqp, { Channel, ChannelModel, ConsumeMessage } from 'amqplib';
import { logger } from '@queueless/common';
import { validateEventConsume } from '@queueless/contracts';
import { OutboxRepository } from './outbox';

export const EXCHANGES = {
  EVENTS: 'queueless.events',
  RETRY: 'queueless.retry',
  DLX: 'queueless.dlx',
};

export const QUEUES = {
  NOTIFICATION: 'notification.q',
  BOOKING: 'booking.q',
  QUEUE: 'queue.q',
  RETRY: 'queueless.retry.q',
  DLQ: 'queueless.dlq',
};

export interface RabbitMQClientOptions {
  url?: string;
  outboxRepository?: OutboxRepository;
}

export class RabbitMQClient {
  private url: string;
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private isConnecting: boolean = false;
  private isInitialized: boolean = false;
  private consumerTags: Map<string, string> = new Map();
  private consumerInitializers: Array<() => Promise<void>> = [];
  private outboxRepository?: OutboxRepository;

  constructor(options?: RabbitMQClientOptions) {
    this.url = options?.url || process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
    this.outboxRepository = options?.outboxRepository;
  }

  public setOutboxRepository(repo: OutboxRepository): void {
    this.outboxRepository = repo;
  }

  onConnect(initializer: () => Promise<void>): void {
    this.consumerInitializers.push(initializer);
    if (this.channel && this.isInitialized) {
      initializer().catch((err) =>
        logger.warn({ err: err?.message || err }, '[RabbitMQ] Consumer init error')
      );
    }
  }

  async getChannel(): Promise<Channel | null> {
    if (this.channel) return this.channel;
    await this.connect();
    return this.channel;
  }

  async connect(url?: string): Promise<boolean> {
    if (this.isConnecting) return false;
    this.isConnecting = true;
    if (url) this.url = url;

    try {
      this.connection = await amqp.connect(this.url);
      if (!this.connection) return false;
      this.channel = await this.connection.createChannel();
      if (!this.channel) return false;
      await this.channel.prefetch(10);

      this.connection.on('error', (err: any) => {
        logger.error({ err: err?.message || err }, '[RabbitMQ] Connection error');
        this.reset();
      });

      this.connection.on('close', () => {
        logger.warn('[RabbitMQ] Connection closed');
        this.reset();
      });

      await this.setupTopology();
      this.isInitialized = true;
      logger.info('[RabbitMQ] Connected and topology declared successfully');

      for (const init of this.consumerInitializers) {
        await init().catch((err) =>
          logger.warn({ err: err?.message || err }, '[RabbitMQ] Consumer init error')
        );
      }

      return true;
    } catch (err: any) {
      this.reset();
      logger.warn({ err: err.message }, '[RabbitMQ] Could not connect to RabbitMQ broker');
      return false;
    } finally {
      this.isConnecting = false;
    }
  }

  private reset() {
    this.connection = null;
    this.channel = null;
    this.isInitialized = false;
  }

  async setupTopology(): Promise<void> {
    if (!this.channel) return;

    // 1. Declare exchanges
    await this.channel.assertExchange(EXCHANGES.EVENTS, 'topic', { durable: true });
    await this.channel.assertExchange(EXCHANGES.RETRY, 'topic', { durable: true });
    await this.channel.assertExchange(EXCHANGES.DLX, 'fanout', { durable: true });

    // 2. Declare DLQ
    await this.channel.assertQueue(QUEUES.DLQ, { durable: true });
    await this.channel.bindQueue(QUEUES.DLQ, EXCHANGES.DLX, '');

    // 3. Declare Retry Queue with message TTL (2s) and dead-letter back to main events exchange
    await this.channel.assertQueue(QUEUES.RETRY, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': EXCHANGES.EVENTS,
        'x-message-ttl': 2000,
      },
    });
    await this.channel.bindQueue(QUEUES.RETRY, EXCHANGES.RETRY, '#');

    // 4. Declare consumer queues with DLX routing
    await this.channel.assertQueue(QUEUES.NOTIFICATION, {
      durable: true,
      arguments: { 'x-dead-letter-exchange': EXCHANGES.DLX },
    });
    const notificationBindings = [
      '*.booked',
      '*.confirmed',
      '*.cancelled',
      '*.rescheduled',
      '*.reminder_due',
      'queue.*',
      'business.*',
      'appointment.*',
      'booking.*',
    ];
    for (const pattern of notificationBindings) {
      await this.channel.bindQueue(QUEUES.NOTIFICATION, EXCHANGES.EVENTS, pattern);
    }

    await this.channel.assertQueue(QUEUES.BOOKING, {
      durable: true,
      arguments: { 'x-dead-letter-exchange': EXCHANGES.DLX },
    });
    await this.channel.bindQueue(QUEUES.BOOKING, EXCHANGES.EVENTS, 'user.blocked');

    await this.channel.assertQueue(QUEUES.QUEUE, {
      durable: true,
      arguments: { 'x-dead-letter-exchange': EXCHANGES.DLX },
    });
    await this.channel.bindQueue(QUEUES.QUEUE, EXCHANGES.EVENTS, 'user.blocked');
  }

  async publish(routingKey: string, payload: any): Promise<boolean> {
    try {
      const ch = await this.getChannel();
      if (!ch) return false;

      const content = Buffer.from(JSON.stringify(payload));
      return ch.publish(EXCHANGES.EVENTS, routingKey, content, {
        persistent: true,
        contentType: 'application/json',
      });
    } catch (err: any) {
      logger.warn({ err: err.message, routingKey }, '[RabbitMQ] Publish failed');
      return false;
    }
  }

  async startConsumer(
    queueName: string,
    consumerName: string,
    handler: (data: any) => Promise<void>
  ): Promise<string | null> {
    const ch = await this.getChannel();
    if (!ch) return null;

    const { consumerTag } = await ch.consume(queueName, async (msg: ConsumeMessage | null) => {
      if (!msg) return;

      let payload: any;
      try {
        payload = JSON.parse(msg.content.toString());
      } catch (err: any) {
        logger.error({ err: err.message }, '[RabbitMQ] Failed to parse message content; rejecting to DLX');
        ch.publish(EXCHANGES.DLX, '', msg.content);
        ch.ack(msg);
        return;
      }

      const eventType = payload.type || msg.fields.routingKey;
      const eventId = payload.eventId || payload.id;
      const headers = msg.properties.headers || {};
      const attempts = (headers['x-attempts'] || 0) + 1;

      // Idempotency check: have we already processed this event for this consumer?
      if (eventId && this.outboxRepository) {
        try {
          const alreadyDone = await this.outboxRepository.isEventProcessed(eventId, consumerName);
          if (alreadyDone) {
            ch.ack(msg);
            return;
          }
        } catch {
          // If outbox check fails, continue
        }
      }

      try {
        // Validate against event contract on consume
        if (eventType) {
          validateEventConsume(eventType, payload.data || payload);
        }

        await handler(payload);

        if (eventId && this.outboxRepository) {
          try {
            await this.outboxRepository.markEventProcessed(eventId, consumerName);
          } catch {
            // Ignore mark failure if idempotent
          }
        }
        ch.ack(msg);
      } catch (err: any) {
        logger.error(
          { err: err.message, consumerName, attempts, eventId },
          '[RabbitMQ] Error processing message in consumer'
        );

        if (attempts < 3) {
          ch.publish(EXCHANGES.RETRY, msg.fields.routingKey, msg.content, {
            persistent: true,
            headers: {
              ...headers,
              'x-attempts': attempts,
              'x-original-queue': queueName,
            },
          });
          ch.ack(msg);
        } else {
          ch.publish(EXCHANGES.DLX, '', msg.content, {
            persistent: true,
            headers: {
              ...headers,
              'x-attempts': attempts,
              'x-death-reason': err.message || 'Exceeded retry limit',
            },
          });
          ch.ack(msg);
        }
      }
    });

    this.consumerTags.set(queueName, consumerTag);
    return consumerTag;
  }

  async stopConsumer(queueName: string): Promise<boolean> {
    const ch = await this.getChannel();
    const tag = this.consumerTags.get(queueName);
    if (ch && tag) {
      await ch.cancel(tag);
      this.consumerTags.delete(queueName);
      return true;
    }
    return false;
  }

  async close(): Promise<void> {
    try {
      if (this.channel) {
        await this.channel.close();
      }
      if (this.connection) {
        await this.connection.close();
      }
    } catch {
      // Ignore cleanup error
    } finally {
      this.reset();
    }
  }

  isConnected(): boolean {
    return this.channel !== null && this.connection !== null;
  }
}
