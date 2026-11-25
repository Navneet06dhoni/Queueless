import { config } from '../../config';
import { EventEnvelope } from '../../events';
import { emitNotificationNew } from '../../socket';
import { getEmailTransport } from './email/transport';
import { notificationRepository, NotificationRepository } from './notification.repository';
import { bookingPort } from '../booking/booking.ports';
import { businessPort } from '../business/business.ports';
import { userPort } from '../auth/auth.ports';
import {
  appointmentReminder,
  bookingCancelledCustomer,
  bookingConfirmedCustomer,
  bookingConfirmedOwner,
  bookingRescheduledCustomer,
  businessStatusChanged,
  formatInTimezone,
  queueStageCalled,
  queueStageNear,
  queueStageNext,
} from './notification.templates';
import { INotification, NotificationPayload } from './notification.types';

export class NotificationService {
  constructor(private repo: NotificationRepository = notificationRepository) {}

  /**
   * Internal helper to sleep during retries
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Send a notification:
   * 1. Idempotently insert in-app notification row with dedupe_key.
   * 2. Push via Socket.io to user:{userId}.
   * 3. If emailOptions provided and notifications enabled, deliver email with up to 3 retries.
   */
  async sendNotification(payload: NotificationPayload): Promise<INotification | null> {
    const hasEmail = !!payload.emailOptions && config.NOTIFICATIONS_ENABLED;

    // 1. Idempotent database insert
    const notification = await this.repo.createNotification({
      userId: payload.userId,
      type: payload.type,
      title: payload.title,
      message: payload.message,
      data: payload.data,
      dedupeKey: payload.dedupeKey,
      emailStatus: hasEmail ? 'pending' : 'not_required',
    });

    // If duplicate (dedupeKey already existed), ON CONFLICT returned nothing -> skip
    if (!notification) {
      return null;
    }

    // 2. Real-time push via Socket.io
    emitNotificationNew(payload.userId, {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      data: notification.data,
      createdAt: notification.created_at,
    });

    // 3. Email delivery with retry
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

  /**
   * Event Handler: booking.confirmed
   */
  async handleBookingConfirmed(envelope: EventEnvelope): Promise<void> {
    const d = envelope.data || {};
    const appointmentId = d.appointmentId || d.id;
    if (!appointmentId) return;

    let appt = d.customerName && d.customerEmail && d.serviceName && d.businessName ? {
      id: appointmentId,
      customer_id: d.customerId,
      customer_name: d.customerName,
      customer_email: d.customerEmail,
      business_id: d.businessId,
      business_name: d.businessName,
      owner_id: d.ownerId,
      owner_name: d.ownerName || 'Business Owner',
      service_name: d.serviceName,
      start_time: d.slotStartTime || d.startTime,
    } : null;

    if (!appt) {
      appt = (await bookingPort.getAppointmentDetails(appointmentId)) as any;
    }
    if (!appt) return;

    // 1. Notify Customer (In-App + Email)
    const custTemplate = bookingConfirmedCustomer({
      customerName: appt.customer_name,
      businessName: appt.business_name,
      serviceName: appt.service_name,
      slotStartTime: appt.start_time,
    });

    await this.sendNotification({
      userId: appt.customer_id,
      type: 'booking.confirmed',
      title: 'Booking Confirmed',
      message: `Your booking for ${appt.service_name} at ${appt.business_name} has been confirmed.`,
      data: { appointmentId: appt.id, businessId: appt.business_id, slotTime: appt.start_time },
      dedupeKey: `${envelope.eventId}:${appt.customer_id}:booking_confirmed`,
      emailOptions: {
        to: appt.customer_email,
        subject: custTemplate.subject,
        text: custTemplate.text,
        html: custTemplate.html,
      },
    });

    // 2. Notify Owner (In-App only)
    const ownerTemplate = bookingConfirmedOwner({
      ownerName: appt.owner_name,
      customerName: appt.customer_name,
      businessName: appt.business_name,
      serviceName: appt.service_name,
      slotStartTime: appt.start_time,
    });

    await this.sendNotification({
      userId: appt.owner_id,
      type: 'booking.new',
      title: ownerTemplate.title,
      message: ownerTemplate.message,
      data: { appointmentId: appt.id, businessId: appt.business_id },
      dedupeKey: `${envelope.eventId}:${appt.owner_id}:new_booking`,
    });
  }

  /**
   * Event Handler: booking.cancelled
   */
  async handleBookingCancelled(envelope: EventEnvelope): Promise<void> {
    const d = envelope.data || {};
    const appointmentId = d.appointmentId || d.id;
    const cancelledBy = d.cancelledBy;
    if (!appointmentId) return;

    let appt = d.customerName && d.serviceName && d.businessName ? {
      id: appointmentId,
      customer_id: d.customerId,
      customer_name: d.customerName,
      customer_email: d.customerEmail,
      business_id: d.businessId,
      business_name: d.businessName,
      owner_id: d.ownerId,
      service_name: d.serviceName,
      start_time: d.slotStartTime || d.startTime,
    } : null;

    if (!appt) {
      appt = (await bookingPort.getAppointmentDetails(appointmentId)) as any;
    }
    if (!appt) return;

    const formattedTime = formatInTimezone(appt.start_time);

    // If cancelled by customer -> notify owner (in-app only)
    if (cancelledBy === appt.customer_id) {
      await this.sendNotification({
        userId: appt.owner_id,
        type: 'booking.cancelled',
        title: 'Booking Cancelled',
        message: `${appt.customer_name} cancelled their appointment for ${appt.service_name} on ${formattedTime}.`,
        data: { appointmentId: appt.id, businessId: appt.business_id },
        dedupeKey: `${envelope.eventId}:${appt.owner_id}:booking_cancelled`,
      });
    } else {
      // Cancelled by owner -> notify customer (in-app + email)
      const template = bookingCancelledCustomer({
        customerName: appt.customer_name,
        businessName: appt.business_name,
        serviceName: appt.service_name,
        slotStartTime: appt.start_time,
        cancelledByOwner: true,
      });

      await this.sendNotification({
        userId: appt.customer_id,
        type: 'booking.cancelled',
        title: 'Booking Cancelled',
        message: `Your appointment for ${appt.service_name} at ${appt.business_name} has been cancelled by the business.`,
        data: { appointmentId: appt.id, businessId: appt.business_id },
        dedupeKey: `${envelope.eventId}:${appt.customer_id}:booking_cancelled`,
        emailOptions: {
          to: appt.customer_email,
          subject: template.subject,
          text: template.text,
          html: template.html,
        },
      });
    }
  }

  /**
   * Event Handler: booking.rescheduled
   */
  async handleBookingRescheduled(envelope: EventEnvelope): Promise<void> {
    const d = envelope.data || {};
    const appointmentId = d.appointmentId || d.id;
    if (!appointmentId) return;

    let appt: any = d.customerName && d.serviceName && d.businessName ? {
      id: appointmentId,
      customer_id: d.customerId,
      customer_name: d.customerName,
      customer_email: d.customerEmail,
      business_id: d.businessId,
      business_name: d.businessName,
      owner_id: d.ownerId,
      service_name: d.serviceName,
      start_time: d.newSlotStartTime || d.startTime,
    } : null;

    if (!appt) {
      appt = (await bookingPort.getAppointmentDetails(appointmentId)) as any;
    }
    if (!appt) return;

    const formattedTime = formatInTimezone(appt.start_time);

    // 1. Notify Customer (In-App + Email)
    const custTemplate = bookingRescheduledCustomer({
      customerName: appt.customer_name,
      businessName: appt.business_name,
      serviceName: appt.service_name,
      newSlotStartTime: appt.start_time,
    });

    await this.sendNotification({
      userId: appt.customer_id,
      type: 'booking.rescheduled',
      title: 'Appointment Rescheduled',
      message: `Your appointment for ${appt.service_name} at ${appt.business_name} was rescheduled to ${formattedTime}.`,
      data: { appointmentId: appt.id, businessId: appt.business_id, newSlotTime: appt.start_time },
      dedupeKey: `${envelope.eventId}:${appt.customer_id}:booking_rescheduled`,
      emailOptions: {
        to: appt.customer_email,
        subject: custTemplate.subject,
        text: custTemplate.text,
        html: custTemplate.html,
      },
    });

    // 2. Notify Owner (In-App)
    await this.sendNotification({
      userId: appt.owner_id,
      type: 'booking.rescheduled',
      title: 'Appointment Rescheduled',
      message: `${appt.customer_name} rescheduled their appointment for ${appt.service_name} to ${formattedTime}.`,
      data: { appointmentId: appt.id, businessId: appt.business_id, newSlotTime: appt.start_time },
      dedupeKey: `${envelope.eventId}:${appt.owner_id}:booking_rescheduled`,
    });
  }

  /**
   * Event Handler: appointment.reminder_due
   */
  async handleAppointmentReminderDue(envelope: EventEnvelope): Promise<void> {
    const d = envelope.data || {};
    const appointmentId = d.appointmentId || d.id;
    if (!appointmentId) return;

    const template = appointmentReminder({
      customerName: d.customerName || d.customer_name || 'Customer',
      businessName: d.businessName || d.business_name || 'the business',
      serviceName: d.serviceName || d.service_name || 'Service',
      slotStartTime: d.slotStartTime || d.start_time,
    });

    await this.sendNotification({
      userId: d.customerId || d.customer_id,
      type: 'appointment.reminder',
      title: 'Appointment Reminder',
      message: `Your appointment for ${d.serviceName || d.service_name} at ${d.businessName || d.business_name} starts soon.`,
      data: {
        appointmentId,
        slotTime: d.slotStartTime || d.start_time,
        businessName: d.businessName || d.business_name,
      },
      dedupeKey: `reminder:${appointmentId}`,
      emailOptions: {
        to: d.customerEmail || d.customer_email,
        subject: template.subject,
        text: template.text,
        html: template.html,
      },
    });
  }

  /**
   * Event Handler: business.status_changed
   */
  async handleBusinessStatusChanged(envelope: EventEnvelope): Promise<void> {
    const d = envelope.data || {};
    const { businessId, ownerId, status } = d;
    if (!businessId || !ownerId) return;

    let biz = d.businessName && d.ownerName ? {
      name: d.businessName,
      status: d.status,
      owner_name: d.ownerName,
      owner_email: d.ownerEmail,
    } : null;

    if (!biz) {
      biz = await businessPort.getBusinessDetails(businessId);
    }
    if (!biz) return;

    const template = businessStatusChanged({
      ownerName: biz.owner_name,
      businessName: biz.name,
      status: status || biz.status,
    });

    await this.sendNotification({
      userId: ownerId,
      type: 'business.status_changed',
      title: status === 'approved' ? 'Business Approved' : 'Business Registration Update',
      message:
        status === 'approved'
          ? `Your business "${biz.name}" has been approved!`
          : `Your business registration for "${biz.name}" was rejected.`,
      data: { businessId, status },
      dedupeKey: `${envelope.eventId}:${ownerId}:business_status_${status}`,
      emailOptions: {
        to: biz.owner_email,
        subject: template.subject,
        text: template.text,
        html: template.html,
      },
    });
  }

  /**
   * Event Handler: queue.advanced
   */
  async handleQueueAdvanced(envelope: EventEnvelope): Promise<void> {
    const d = envelope.data || {};
    const { businessId, calledEntryId, calledCustomerId, upcoming } = d;
    if (!businessId) return;

    let businessName = d.businessName;
    if (!businessName) {
      const biz = await businessPort.getBusinessDetails(businessId);
      businessName = biz?.name || 'the business';
    }

    // 1. Stage "called": Notify called customer (if registered customer, skip walk-ins)
    if (calledCustomerId && calledEntryId) {
      let user = d.calledCustomerName && d.calledCustomerEmail ? {
        name: d.calledCustomerName,
        email: d.calledCustomerEmail,
      } : null;
      if (!user) {
        user = await userPort.getUserBasic(calledCustomerId);
      }
      if (user) {
        const ticketNumber = d.ticketNumber || d.called?.ticketNumber || 0;
        const template = queueStageCalled({
          customerName: user.name,
          businessName,
          ticketNumber,
        });

        await this.sendNotification({
          userId: calledCustomerId,
          type: 'queue.called',
          title: 'It is Your Turn!',
          message: `It is your turn at ${businessName}. Please proceed to the service desk.`,
          data: { businessId, entryId: calledEntryId },
          dedupeKey: `queue:${calledEntryId}:called`,
          emailOptions: {
            to: user.email,
            subject: template.subject,
            text: template.text,
            html: template.html,
          },
        });
      }
    }

    // 2. Upcoming customers in line
    if (Array.isArray(upcoming)) {
      for (const item of upcoming) {
        if (!item.customerId) continue; // Skip walk-ins

        const entryId = item.entryId || item.customerId;
        let user = item.customerName && item.customerEmail ? {
          name: item.customerName,
          email: item.customerEmail,
        } : null;
        if (!user) {
          user = await userPort.getUserBasic(item.customerId);
        }
        if (!user) continue;

        // Stage "next" (Position 1)
        if (item.position === 1) {
          const template = queueStageNext({
            customerName: user.name,
            businessName,
            ticketNumber: item.ticketNumber || 1,
          });

          await this.sendNotification({
            userId: item.customerId,
            type: 'queue.next',
            title: 'You are Next!',
            message: `You are next in line at ${businessName}. Please get ready.`,
            data: { businessId, entryId, position: 1 },
            dedupeKey: `queue:${entryId}:next`,
            emailOptions: {
              to: user.email,
              subject: template.subject,
              text: template.text,
              html: template.html,
            },
          });
        }

        // Stage "near" (Position <= QUEUE_NOTIFY_POSITION)
        if (item.position <= config.QUEUE_NOTIFY_POSITION) {
          const waitMins = item.estimatedWaitMinutes || item.position * config.DEFAULT_SERVICE_MINUTES;
          const template = queueStageNear({
            customerName: user.name,
            businessName,
            position: item.position,
            estimatedWaitMinutes: waitMins,
          });

          await this.sendNotification({
            userId: item.customerId,
            type: 'queue.near',
            title: 'Queue Position Update',
            message: `You are #${item.position} in line at ${businessName}. Please get ready!`,
            data: { businessId, entryId, position: item.position },
            dedupeKey: `queue:${entryId}:near`,
            emailOptions: {
              to: user.email,
              subject: template.subject,
              text: template.text,
              html: template.html,
            },
          });
        }
      }
    }
  }

  /**
   * API: Get notifications for logged-in user
   */
  async getUserNotifications(userId: string, options: any) {
    return this.repo.getUserNotifications(userId, options);
  }

  /**
   * API: Mark notification read
   */
  async markAsRead(id: string, userId: string) {
    return this.repo.markAsRead(id, userId, new Date());
  }

  /**
   * API: Mark all notifications read
   */
  async markAllAsRead(userId: string) {
    return this.repo.markAllAsRead(userId, new Date());
  }

  /**
   * API: Admin list failed email notifications
   */
  async getAdminFailedNotifications(options: any) {
    return this.repo.getAdminFailedNotifications(options);
  }
}

export const notificationService = new NotificationService();
