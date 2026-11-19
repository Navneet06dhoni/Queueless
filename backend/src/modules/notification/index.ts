import { events } from '../../events';
import { notificationService } from './notification.service';

let subscribed = false;

export const initNotificationSubscriptions = (): void => {
  if (subscribed) return;
  subscribed = true;

  events.subscribe('booking.confirmed', (envelope) =>
    notificationService.handleBookingConfirmed(envelope)
  );

  events.subscribe('booking.cancelled', (envelope) =>
    notificationService.handleBookingCancelled(envelope)
  );

  events.subscribe('booking.rescheduled', (envelope) =>
    notificationService.handleBookingRescheduled(envelope)
  );

  events.subscribe('business.status_changed', (envelope) =>
    notificationService.handleBusinessStatusChanged(envelope)
  );

  events.subscribe('queue.advanced', (envelope) =>
    notificationService.handleQueueAdvanced(envelope)
  );
};
