import { events } from '../../events';
import { bookingPort } from './booking.ports';
import { logger } from '../../utils/logger';
import { rabbitMQClient, QUEUES } from '../../events/rabbitmq';
import { config } from '../../config';

let subscribed = false;

const handleUserBlocked = async (userId: string) => {
  try {
    const cancelled = await bookingPort.cancelCustomerFutureAppointments(userId);
    for (const appt of cancelled) {
      await events.publish('booking.cancelled', {
        v: 1,
        appointmentId: appt.id,
        customerId: appt.customer_id,
        customerName: appt.customer_name,
        customerEmail: appt.customer_email,
        businessId: appt.business_id,
        businessName: appt.business_name,
        ownerId: appt.owner_id,
        serviceName: appt.service_name,
        slotStartTime: appt.start_time,
        cancelledBy: 'admin',
        reason: 'Account suspended',
        customerNotification: true,
        ownerNotification: true,
      });
    }
  } catch (err: any) {
    logger.error({ err: err?.message || err, userId }, '[BookingModule] Failed to cancel appointments for blocked user');
  }
};

export const initBookingSubscriptions = (): void => {
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
        QUEUES.BOOKING,
        'booking_consumer',
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
