import { RabbitMQClient, OutboxRelay, QUEUES } from '@queueless/messaging';
import { logger } from '@queueless/common';
import { config } from '../config';
import { notificationService } from '../service';

export class NotificationConsumerManager {
  private rmqClient: RabbitMQClient;
  private outboxRelay: OutboxRelay;

  constructor() {
    const outboxRepo = notificationService.getOutboxRepository();
    this.rmqClient = new RabbitMQClient({
      url: config.RABBITMQ_URL,
      outboxRepository: outboxRepo,
    });

    this.outboxRelay = new OutboxRelay({
      outboxRepository: outboxRepo,
      publishEvent: async (eventType, payload) => {
        return this.rmqClient.publish(eventType, payload);
      },
      isReady: () => this.rmqClient.isConnected(),
    });

    notificationService.setOutboxRelay(this.outboxRelay);
  }

  public getRabbitMQClient(): RabbitMQClient {
    return this.rmqClient;
  }

  public getOutboxRelay(): OutboxRelay {
    return this.outboxRelay;
  }

  async start(): Promise<void> {
    this.rmqClient.onConnect(async () => {
      // Start consuming from notification.q
      await this.rmqClient.startConsumer(
        QUEUES.NOTIFICATION,
        'notification_microservice',
        async (envelope: any) => {
          const type = envelope.type;
          switch (type) {
            case 'booking.confirmed':
            case 'appointment.booked':
              await notificationService.handleBookingConfirmed(envelope);
              break;
            case 'booking.cancelled':
            case 'appointment.cancelled':
              await notificationService.handleBookingCancelled(envelope);
              break;
            case 'booking.rescheduled':
              await notificationService.handleBookingRescheduled(envelope);
              break;
            case 'appointment.reminder_due':
              await notificationService.handleAppointmentReminderDue(envelope);
              break;
            case 'business.status_changed':
              await notificationService.handleBusinessStatusChanged(envelope);
              break;
            case 'queue.advanced':
              await notificationService.handleQueueAdvanced(envelope);
              break;
            default:
              logger.info({ eventType: type }, '[NotificationConsumer] Event ignored');
          }
        }
      );
    });

    let connected = await this.rmqClient.connect();
    let attempts = 0;
    while (!connected && attempts < 15) {
      attempts++;
      logger.warn(`[RabbitMQ] Waiting for broker to accept connections (attempt ${attempts}/15)...`);
      await new Promise((r) => setTimeout(r, 2000));
      connected = await this.rmqClient.connect();
    }

    if (!connected) {
      logger.warn('Could not connect to RabbitMQ broker after retries; will retry on demand');
    }

    // Start outbox relay polling (every 500ms)
    this.outboxRelay.start(500);
    logger.info('✅ Notification Consumer and Outbox Relay started successfully');
  }

  async stop(): Promise<void> {
    this.outboxRelay.stop();
    await this.rmqClient.stopConsumer(QUEUES.NOTIFICATION);
    await this.rmqClient.close();
  }
}

export const notificationConsumerManager = new NotificationConsumerManager();
