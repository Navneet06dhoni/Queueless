import { config } from '../../../config';
import { now } from '../../../utils/clock';
import { notificationRepository } from '../notification.repository';
import { notificationService } from '../notification.service';
import { appointmentReminder } from '../notification.templates';

let timer: NodeJS.Timeout | null = null;
let isTicking = false;

/**
 * Execute a single reminder check pass.
 * Exported so tests can execute single ticks deterministically.
 */
export const runReminderTick = async (): Promise<number> => {
  if (isTicking) return 0;
  isTicking = true;

  try {
    const currentTime = now();
    const windowStart = currentTime;
    const windowEnd = new Date(
      currentTime.getTime() + config.REMINDER_MINUTES_BEFORE * 60 * 1000
    );

    // Atomically claim rows using SELECT ... FOR UPDATE SKIP LOCKED inside a transaction
    const claimedAppointments = await notificationRepository.claimAppointmentsDueForReminder(
      windowStart,
      windowEnd,
      currentTime
    );

    for (const appt of claimedAppointments) {
      const template = appointmentReminder({
        customerName: appt.customer_name,
        businessName: appt.business_name,
        serviceName: appt.service_name,
        slotStartTime: appt.start_time,
      });

      await notificationService.sendNotification({
        userId: appt.customer_id,
        type: 'appointment.reminder',
        title: 'Appointment Reminder',
        message: `Your appointment for ${appt.service_name} at ${appt.business_name} starts soon.`,
        data: {
          appointmentId: appt.id,
          slotTime: appt.start_time,
          businessName: appt.business_name,
        },
        dedupeKey: `reminder:${appt.id}`,
        emailOptions: {
          to: appt.customer_email,
          subject: template.subject,
          text: template.text,
          html: template.html,
        },
      });
    }

    return claimedAppointments.length;
  } catch (err: any) {
    console.error('Error running appointment reminder tick:', err.message);
    return 0;
  } finally {
    isTicking = false;
  }
};

export const startReminderJob = (intervalMs: number = 60000): NodeJS.Timeout => {
  if (timer) {
    clearInterval(timer);
  }
  timer = setInterval(runReminderTick, intervalMs);
  return timer;
};

export const stopReminderJob = (): void => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
};
