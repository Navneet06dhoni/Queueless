import { config } from '../../../config';
import { now } from '../../../utils/clock';
import { withTransaction } from '../../../db';
import { events } from '../../../events';
import { logger } from '../../../utils/logger';

let timer: NodeJS.Timeout | null = null;
let isTicking = false;

/**
 * Execute a single reminder check pass inside the Booking domain module.
 * Claims appointments due for reminder using FOR UPDATE SKIP LOCKED
 * and publishes typed appointment.reminder_due events.
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

    const claimedAppointments = await withTransaction(async (client) => {
      const findRes = await client.query<{
        id: string;
        customer_id: string;
        customer_name: string;
        customer_email: string;
        business_id: string;
        business_name: string;
        service_id: string;
        service_name: string;
        start_time: string;
      }>(
        `SELECT
           a.id,
           a.customer_id,
           u.name as customer_name,
           u.email as customer_email,
           b.id as business_id,
           b.name as business_name,
           sv.id as service_id,
           sv.name as service_name,
           s.start_time
         FROM appointments a
         JOIN slots s ON a.slot_id = s.id
         JOIN services sv ON s.service_id = sv.id
         JOIN businesses b ON sv.business_id = b.id
         JOIN users u ON a.customer_id = u.id
         WHERE a.status = 'confirmed'
           AND a.reminder_sent_at IS NULL
           AND s.start_time >= $1
           AND s.start_time <= $2
         FOR UPDATE OF a SKIP LOCKED`,
        [windowStart.toISOString(), windowEnd.toISOString()]
      );

      if (findRes.rows.length === 0) {
        return [];
      }

      const ids = findRes.rows.map((r) => r.id);
      await client.query(
        `UPDATE appointments
         SET reminder_sent_at = $2
         WHERE id = ANY($1::uuid[])`,
        [ids, currentTime.toISOString()]
      );

      return findRes.rows;
    });

    for (const appt of claimedAppointments) {
      events.publish('appointment.reminder_due', {
        v: 1,
        appointmentId: appt.id,
        customerId: appt.customer_id,
        customerName: appt.customer_name,
        customerEmail: appt.customer_email,
        businessId: appt.business_id,
        businessName: appt.business_name,
        serviceName: appt.service_name,
        slotStartTime: appt.start_time,
      });
    }

    return claimedAppointments.length;
  } catch (err: any) {
    logger.error({ err: err?.message || err }, '[BookingReminderJob] Error in reminder tick');
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
