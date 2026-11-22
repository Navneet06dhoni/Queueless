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

export const initNotificationSubscriptions = (): void => {
  if (subscribed) return;
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

  // RabbitMQ consumer setup
  if (config.EVENT_TRANSPORT === 'rabbitmq') {
    rabbitMQClient.onConnect(async () => {
      await startNotificationRabbitMQConsumer();
    });
  }
};
