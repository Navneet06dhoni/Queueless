import { PoolClient } from 'pg';
import { pool } from './db';
import { config } from './config';
import { getEmailTransport } from './email/transport';
import { notificationRepository, NotificationRepository } from './repository';
import { INotification, NotificationPayload, NotificationStatus } from './types';
import { OutboxRepository, OutboxRelay } from '@queueless/messaging';
import {
  appointmentReminder,
  bookingCancelledCustomer,
  bookingCancelledOwner,
  bookingConfirmedCustomer,
  bookingConfirmedOwner,
  bookingRescheduledCustomer,
  businessStatusChanged,
  formatInTimezone,
  queueStageCalled,
  queueStageNear,
  queueStageNext,
} from './templates';

export class NotificationService {
  private outboxRepo: OutboxRepository;
  private outboxRelay: OutboxRelay | null = null;

  constructor(private repo: NotificationRepository = notificationRepository) {
    this.outboxRepo = new OutboxRepository({
      query: (sql, params) => pool.query(sql, params),
    });
  }

  public getOutboxRepository(): OutboxRepository {
    return this.outboxRepo;
  }

  public setOutboxRelay(relay: OutboxRelay) {
    this.outboxRelay = relay;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async sendNotification(payload: NotificationPayload, externalClient?: PoolClient): Promise<INotification | null> {
    const hasEmail = !!payload.emailOptions && config.NOTIFICATIONS_ENABLED;

    const client = externalClient || (await pool.connect());
    let notification: INotification | null = null;

    try {
      if (!externalClient) {
        await client.query('BEGIN');
      }

      notification = await this.repo.createNotification(
        {
          userId: payload.userId,
          type: payload.type,
          title: payload.title,
          message: payload.message,
          data: payload.data,
          dedupeKey: payload.dedupeKey,
          emailStatus: hasEmail ? 'pending' : 'not_required',
        },
        client
      );

      if (notification) {
        // Enqueue notification.created into transactional outbox
        await this.outboxRepo.createOutboxEvent(
          {
            id: notification.id,
            eventType: 'notification.created',
            payload: {
              v: 1,
              eventId: notification.id,
              type: 'notification.created',
              occurredAt: notification.created_at.toISOString(),
              data: {
                notificationId: notification.id,
                userId: notification.user_id,
                type: notification.type,
                title: notification.title || '',
                message: notification.message,
                data: notification.data || {},
                createdAt: notification.created_at.toISOString(),
              },
            },
          },
          client
        );
      }

      if (!externalClient) {
        await client.query('COMMIT');
      }
    } catch (err) {
      if (!externalClient) {
        await client.query('ROLLBACK');
      }
      throw err;
    } finally {
      if (!externalClient) {
        client.release();
      }
    }

    if (!notification) {
      return null;
    }

    // Trigger relay tick immediately if available
    if (this.outboxRelay) {
      this.outboxRelay.tick().catch(() => {});
    }

    // Email delivery with retries (up to 3 attempts)
    if (hasEmail && payload.emailOptions) {
      const retryDelays = config.EMAIL_RETRY_DELAYS_MS
        ? config.EMAIL_RETRY_DELAYS_MS.split(',').map((s) => Number(s.trim()) || 1000)
        : [1000, 4000, 16000];

      const maxAttempts = 3;
      let lastErrorMsg: string | null = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          await getEmailTransport().sendMail(payload.emailOptions);
          await this.repo.updateEmailStatus(notification.id, 'sent', attempt);
          return notification;
        } catch (err: any) {
          lastErrorMsg = err?.message || 'Email delivery failed';
          if (attempt === maxAttempts) {
            await this.repo.updateEmailStatus(notification.id, 'failed', attempt, lastErrorMsg);
          } else {
            const delay = retryDelays[attempt - 1] ?? 1000;
            await this.sleep(delay);
          }
        }
      }
    }

    return notification;
  }

  // Event handlers consuming denormalized payloads
  async handleBookingConfirmed(envelope: any): Promise<void> {
    const d = envelope.data || envelope;
    const appointmentId = d.appointmentId || d.id;
    if (!appointmentId) return;

    const customerId = d.customerId;
    const customerName = d.customerName || 'Valued Customer';
    const customerEmail = d.customerEmail;
    const businessId = d.businessId;
    const businessName = d.businessName || 'Business';
    const ownerId = d.ownerId;
    const ownerName = d.ownerName || 'Business Owner';
    const serviceName = d.serviceName || 'Service';
    const slotStartTime = d.slotStartTime || d.startTime || new Date().toISOString();

    if (customerId) {
      const custTemplate = bookingConfirmedCustomer({
        customerName,
        businessName,
        serviceName,
        slotStartTime,
      });

      await this.sendNotification({
        userId: customerId,
        type: 'booking.confirmed',
        title: 'Booking Confirmed',
        message: `Your booking for ${serviceName} at ${businessName} has been confirmed.`,
        data: { appointmentId, businessId, slotTime: slotStartTime },
        dedupeKey: `${envelope.eventId || appointmentId}:${customerId}:booking_confirmed`,
        emailOptions: customerEmail
          ? {
              to: customerEmail,
              subject: custTemplate.subject,
              text: custTemplate.text,
              html: custTemplate.html,
            }
          : undefined,
      });
    }

    if (ownerId) {
      const ownerTemplate = bookingConfirmedOwner({
        ownerName,
        customerName,
        businessName,
        serviceName,
        slotStartTime,
      });

      await this.sendNotification({
        userId: ownerId,
        type: 'booking.new',
        title: ownerTemplate.title,
        message: ownerTemplate.message,
        data: { appointmentId, businessId },
        dedupeKey: `${envelope.eventId || appointmentId}:${ownerId}:new_booking`,
      });
    }
  }

  async handleBookingCancelled(envelope: any): Promise<void> {
    const d = envelope.data || envelope;
    const appointmentId = d.appointmentId || d.id;
    const cancelledBy = d.cancelledBy;
    if (!appointmentId) return;

    const customerId = d.customerId;
    const customerName = d.customerName || 'Valued Customer';
    const customerEmail = d.customerEmail;
    const businessId = d.businessId;
    const businessName = d.businessName || 'Business';
    const ownerId = d.ownerId;
    const serviceName = d.serviceName || 'Service';
    const slotStartTime = d.slotStartTime || d.startTime || new Date().toISOString();
    const formattedTime = formatInTimezone(slotStartTime);

    if (cancelledBy === customerId && ownerId) {
      await this.sendNotification({
        userId: ownerId,
        type: 'booking.cancelled',
        title: 'Booking Cancelled',
        message: `${customerName} cancelled their appointment for ${serviceName} on ${formattedTime}.`,
        data: { appointmentId, businessId },
        dedupeKey: `${envelope.eventId || appointmentId}:${ownerId}:booking_cancelled`,
      });
    } else if (customerId) {
      const template = bookingCancelledCustomer({
        customerName,
        businessName,
        serviceName,
        slotStartTime,
        cancelledByOwner: true,
      });

      await this.sendNotification({
        userId: customerId,
        type: 'booking.cancelled',
        title: 'Booking Cancelled',
        message: `Your appointment for ${serviceName} at ${businessName} has been cancelled by the business.`,
        data: { appointmentId, businessId },
        dedupeKey: `${envelope.eventId || appointmentId}:${customerId}:booking_cancelled`,
        emailOptions: customerEmail
          ? {
              to: customerEmail,
              subject: template.subject,
              text: template.text,
              html: template.html,
            }
          : undefined,
      });
    }
  }

  async handleBookingRescheduled(envelope: any): Promise<void> {
    const d = envelope.data || envelope;
    const appointmentId = d.appointmentId || d.id;
    if (!appointmentId || !d.customerId) return;

    const customerName = d.customerName || 'Valued Customer';
    const customerEmail = d.customerEmail;
    const businessName = d.businessName || 'Business';
    const serviceName = d.serviceName || 'Service';
    const newSlotStartTime = d.newSlotStartTime || d.startTime || new Date().toISOString();

    const template = bookingRescheduledCustomer({
      customerName,
      businessName,
      serviceName,
      newSlotStartTime,
    });

    await this.sendNotification({
      userId: d.customerId,
      type: 'booking.rescheduled',
      title: 'Appointment Rescheduled',
      message: `Your appointment for ${serviceName} at ${businessName} has been rescheduled.`,
      data: { appointmentId, businessId: d.businessId, newSlotTime: newSlotStartTime },
      dedupeKey: `${envelope.eventId || appointmentId}:${d.customerId}:booking_rescheduled`,
      emailOptions: customerEmail
        ? {
            to: customerEmail,
            subject: template.subject,
            text: template.text,
            html: template.html,
          }
        : undefined,
    });
  }

  async handleAppointmentReminderDue(envelope: any): Promise<void> {
    const d = envelope.data || envelope;
    const appointmentId = d.appointmentId || d.id;
    if (!appointmentId || !d.customerId) return;

    const customerName = d.customerName || 'Valued Customer';
    const customerEmail = d.customerEmail;
    const businessName = d.businessName || 'Business';
    const serviceName = d.serviceName || 'Service';
    const slotStartTime = d.slotStartTime || d.startTime || new Date().toISOString();

    const template = appointmentReminder({
      customerName,
      businessName,
      serviceName,
      slotStartTime,
    });

    await this.sendNotification({
      userId: d.customerId,
      type: 'appointment.reminder',
      title: 'Appointment Reminder',
      message: `Reminder: You have an appointment for ${serviceName} at ${businessName} coming up.`,
      data: { appointmentId, businessId: d.businessId, slotTime: slotStartTime },
      dedupeKey: `${envelope.eventId || appointmentId}:${d.customerId}:reminder`,
      emailOptions: customerEmail
        ? {
            to: customerEmail,
            subject: template.subject,
            text: template.text,
            html: template.html,
          }
        : undefined,
    });
  }

  async handleBusinessStatusChanged(envelope: any): Promise<void> {
    const d = envelope.data || envelope;
    const businessId = d.businessId;
    const ownerId = d.ownerId;
    if (!businessId || !ownerId) return;

    const ownerName = d.ownerName || 'Business Owner';
    const ownerEmail = d.ownerEmail;
    const businessName = d.businessName || 'Your Business';
    const status = d.status as 'approved' | 'rejected';
    const rejectionReason = d.rejectionReason;

    const template = businessStatusChanged({
      ownerName,
      businessName,
      status,
      rejectionReason,
    });

    const isApproved = status === 'approved';
    const title = isApproved ? 'Business Registration Approved' : 'Business Registration Status';
    const message = isApproved
      ? `Congratulations! ${businessName} has been approved.`
      : `Registration for ${businessName} was not approved: ${rejectionReason || 'Contact support'}`;

    await this.sendNotification({
      userId: ownerId,
      type: 'business.status_changed',
      title,
      message,
      data: { businessId, status, rejectionReason },
      dedupeKey: `${envelope.eventId || businessId}:${ownerId}:status_${status}`,
      emailOptions: ownerEmail
        ? {
            to: ownerEmail,
            subject: template.subject,
            text: template.text,
            html: template.html,
          }
        : undefined,
    });
  }

  async handleQueueAdvanced(envelope: any): Promise<void> {
    const d = envelope.data || envelope;
    const businessName = d.businessName || 'Business';

    if (d.called && d.called.customerId) {
      const template = queueStageCalled({
        businessName,
        ticketNumber: d.called.ticketNumber,
      });

      await this.sendNotification({
        userId: d.called.customerId,
        type: 'queue.stage',
        title: template.title,
        message: template.message,
        data: {
          businessId: d.businessId,
          ticketNumber: d.called.ticketNumber,
          stage: 'called',
        },
        dedupeKey: `${envelope.eventId}:${d.called.customerId}:stage_called`,
      });
    }

    if (Array.isArray(d.upcoming)) {
      for (const entry of d.upcoming) {
        if (!entry.customerId) continue;

        if (entry.position === 1) {
          const template = queueStageNext({
            businessName,
            ticketNumber: entry.ticketNumber,
          });

          await this.sendNotification({
            userId: entry.customerId,
            type: 'queue.stage',
            title: template.title,
            message: template.message,
            data: {
              businessId: d.businessId,
              ticketNumber: entry.ticketNumber,
              stage: 'next',
              position: 1,
            },
            dedupeKey: `${envelope.eventId}:${entry.customerId}:stage_next`,
          });
        } else if (entry.position <= 3) {
          const template = queueStageNear({
            businessName,
            position: entry.position,
            ticketNumber: entry.ticketNumber,
          });

          await this.sendNotification({
            userId: entry.customerId,
            type: 'queue.stage',
            title: template.title,
            message: template.message,
            data: {
              businessId: d.businessId,
              ticketNumber: entry.ticketNumber,
              stage: 'near',
              position: entry.position,
            },
            dedupeKey: `${envelope.eventId}:${entry.customerId}:stage_near_${entry.position}`,
          });
        }
      }
    }
  }

  // REST API Methods
  async getUserNotifications(userId: string, options: { status?: NotificationStatus; page?: number; limit?: number }) {
    return this.repo.getUserNotifications(userId, options);
  }

  async markAsRead(id: string, userId: string) {
    return this.repo.markAsRead(id, userId, new Date());
  }

  async markAllAsRead(userId: string) {
    return this.repo.markAllAsRead(userId, new Date());
  }

  async getAdminFailed(options: { page?: number; limit?: number }) {
    return this.repo.getAdminFailedNotifications(options);
  }
}

export const notificationService = new NotificationService();
