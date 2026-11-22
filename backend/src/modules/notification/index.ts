import { events } from '../../events';
import { notificationService } from './notification.service';
import { rabbitMQClient, QUEUES } from '../../events/rabbitmq';
import { config } from '../../config';

let subscribed = false;

export const startNotificationRabbitMQConsumer = async (): Promise<void> => {
  await rabbitMQClient.startConsumer(
    QUEUES.NOTIFICATION,
    'notification_service',
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
      }
    }
  );
};

export const initNotificationSubscriptions = (): boolean => {
  if (config.NOTIFICATIONS_MODE !== 'embedded') {
    // In service mode, notification-service consumes notification.q and monolith does not subscribe
    return false;
  }

  if (subscribed) return true;
  subscribed = true;

  // In-process event subscriptions
  events.subscribe('booking.confirmed', (envelope) =>
    notificationService.handleBookingConfirmed(envelope)
  );

  events.subscribe('appointment.booked', (envelope) =>
    notificationService.handleBookingConfirmed(envelope)
  );

  events.subscribe('booking.cancelled', (envelope) =>
    notificationService.handleBookingCancelled(envelope)
  );

  events.subscribe('appointment.cancelled', (envelope) =>
    notificationService.handleBookingCancelled(envelope)
  );

  events.subscribe('booking.rescheduled', (envelope) =>
    notificationService.handleBookingRescheduled(envelope)
  );

  events.subscribe('appointment.reminder_due', (envelope) =>
    notificationService.handleAppointmentReminderDue(envelope)
  );

  events.subscribe('business.status_changed', (envelope) =>
    notificationService.handleBusinessStatusChanged(envelope)
  );

  events.subscribe('queue.advanced', (envelope) =>
    notificationService.handleQueueAdvanced(envelope)
  );

  // RabbitMQ consumer setup with Single-Consumer Guard
  if (config.EVENT_TRANSPORT === 'rabbitmq') {
    rabbitMQClient.onConnect(async () => {
      try {
        const ch = await rabbitMQClient.getChannel();
        if (ch) {
          const qInfo = await ch.checkQueue(QUEUES.NOTIFICATION);
          if (qInfo.consumerCount > 0) {
            console.warn(
              `⚠️ LOUD WARNING: Refusing to start embedded notification consumer on notification.q: external consumer already attached! (consumerCount=${qInfo.consumerCount})`
            );
            return; // REFUSE TO START CONSUMER
          }
        }
      } catch {
        // Queue may not exist yet
      }

      await startNotificationRabbitMQConsumer();
    });
  }

  return true;
};
