import { DateTime } from 'luxon';
import { bookingRepository, BookingRepository } from './booking.repository';
import { businessPort, BusinessPort } from '../business/business.ports';
import { userPort, UserPort } from '../auth/auth.ports';
import { withTransaction } from '../../db';
import { config } from '../../config';
import { events } from '../../events';
import { ApiError } from '../../utils/ApiError';
import { now } from '../../utils/clock';
import {
  IAppointment,
  AppointmentDetail,
  AppointmentStatus,
} from './booking.types';
import { PaginatedResult } from '../business/business.types';

export class BookingService {
  constructor(
    private repo: BookingRepository = bookingRepository,
    private bPort: BusinessPort = businessPort,
    private uPort: UserPort = userPort
  ) {}

  /**
   * Book a free slot with concurrency-safe locking
   */
  async bookSlot(customerId: string, slotId: string): Promise<AppointmentDetail> {
    let bookedAppt: IAppointment;
    let slotDetails: any;

    try {
      await withTransaction(async (client) => {
        // 1. Lock slot row and get service/business info
        const slot = await this.repo.findSlotWithDetailsForUpdate(client, slotId);
        if (!slot) {
          throw ApiError.notFound('Slot not found', 'SLOT_NOT_FOUND');
        }

        if (slot.status !== 'free') {
          throw ApiError.conflict('Slot is already booked', 'SLOT_ALREADY_BOOKED');
        }

        // Slot must start in the future
        const nowUtc = now();
        if (new Date(slot.start_time) <= nowUtc) {
          throw ApiError.badRequest(
            'Cannot book a slot that has already started or is in the past',
            'SLOT_IN_PAST'
          );
        }

        // Business must be approved
        if (slot.business_status !== 'approved') {
          throw ApiError.notFound('Business is not approved for bookings', 'BUSINESS_NOT_FOUND');
        }

        // 2. Prevent overlapping confirmed appointments for the same customer
        const hasConflict = await this.repo.hasConflictingConfirmedAppointment(
          client,
          customerId,
          slot.start_time,
          slot.end_time
        );
        if (hasConflict) {
          throw ApiError.conflict(
            'You already have another confirmed appointment during this time window',
            'OVERLAPPING_APPOINTMENT'
          );
        }

        // 3. Create appointment and mark slot as booked
        bookedAppt = await this.repo.createAppointment(client, slotId, customerId);
        await this.repo.updateSlotStatus(client, slotId, 'booked');
        slotDetails = slot;

        // Fetch customer name/email for denormalized event
        const user = await this.uPort.getUserBasic(customerId, client);
        const customer = { name: user?.name || '', email: user?.email || '' };

        // Transactional event publish into Outbox
        await events.publish(
          'booking.confirmed',
          {
            v: 1,
            appointmentId: bookedAppt!.id,
            customerId,
            customerName: customer.name,
            customerEmail: customer.email,
            businessId: slotDetails.business_id,
            businessName: slotDetails.business_name,
            ownerId: slotDetails.business_owner_id,
            serviceId: slotDetails.service_id,
            serviceName: slotDetails.service_name,
            slotId: slotDetails.id,
            slotStartTime: slotDetails.start_time,
            slotEndTime: slotDetails.end_time,
          },
          client
        );
      });
    } catch (err: any) {
      // Catch partial unique index violation (code 23505) and translate to 409
      if (err.code === '23505') {
        throw ApiError.conflict('Slot is already booked', 'SLOT_ALREADY_BOOKED');
      }
      throw err;
    }

    return {
      id: bookedAppt!.id,
      slot_id: slotDetails.id,
      customer_id: customerId,
      status: bookedAppt!.status,
      created_at: bookedAppt!.created_at,
      slot: {
        id: slotDetails.id,
        start_time: slotDetails.start_time,
        end_time: slotDetails.end_time,
        status: 'booked',
      },
      service: {
        id: slotDetails.service_id,
        name: slotDetails.service_name,
        duration_minutes: slotDetails.duration_minutes,
        price: slotDetails.price,
      },
      business: {
        id: slotDetails.business_id,
        name: slotDetails.business_name,
        category: '',
        address: '',
        city: '',
        phone: '',
      },
    };
  }

  /**
   * Cancel an appointment (Customer or Business Owner)
   */
  async cancelAppointment(
    appointmentId: string,
    userId: string
  ): Promise<{ message: string }> {
    let cancelledAppt: any;
    let cancelledBy: 'owner' | 'customer' = 'customer';

    await withTransaction(async (client) => {
      const appt = await this.repo.findAppointmentByIdForUpdate(client, appointmentId);
      if (!appt) {
        throw ApiError.notFound('Appointment not found', 'APPOINTMENT_NOT_FOUND');
      }

      const isCustomer = appt.customer_id === userId;
      const isOwner = appt.business_owner_id === userId;

      if (!isCustomer && !isOwner) {
        throw ApiError.forbidden(
          'You do not have permission to cancel this appointment',
          'FORBIDDEN'
        );
      }

      cancelledBy = isOwner ? 'owner' : 'customer';

      if (appt.status !== 'confirmed') {
        throw ApiError.conflict(
          `Appointment cannot be cancelled because it is already ${appt.status}`,
          'APPOINTMENT_NOT_ACTIVE'
        );
      }

      // Customer cancellation cutoff rule (default 60 minutes)
      if (isCustomer && !isOwner) {
        const nowMs = now().getTime();
        const startTime = new Date(appt.slot_start_time).getTime();
        const diffMinutes = (startTime - nowMs) / (1000 * 60);

        if (diffMinutes < config.CANCELLATION_CUTOFF_MINUTES) {
          throw ApiError.conflict(
            `Cannot cancel within ${config.CANCELLATION_CUTOFF_MINUTES} minutes of appointment start time`,
            'CANCELLATION_CUTOFF_EXCEEDED'
          );
        }
      }

      await this.repo.updateAppointmentStatus(client, appointmentId, 'cancelled');
      await this.repo.updateSlotStatus(client, appt.slot_id, 'free');
      cancelledAppt = appt;

      // Fetch customer name/email for denormalized cancellation event
      const user = await this.uPort.getUserBasic(appt.customer_id, client);
      const customer = { name: user?.name || '', email: user?.email || '' };

      await events.publish(
        'booking.cancelled',
        {
          v: 1,
          appointmentId: appt.id,
          customerId: appt.customer_id,
          customerName: customer.name,
          customerEmail: customer.email,
          businessId: appt.business_id,
          businessName: appt.business_name,
          ownerId: appt.business_owner_id,
          serviceName: appt.service_name,
          slotId: appt.slot_id,
          slotStartTime: appt.slot_start_time,
          cancelledBy,
          customerNotification: true,
          ownerNotification: true,
        },
        client
      );
    });

    return { message: 'Appointment cancelled successfully' };
  }

  /**
   * Reschedule an appointment atomically to a new slot of the same service
   */
  async rescheduleAppointment(
    appointmentId: string,
    customerId: string,
    newSlotId: string
  ): Promise<{ message: string; appointmentId: string; new_slot_id: string }> {
    let eventPayload: any;

    try {
      await withTransaction(async (client) => {
        // 1. Lock appointment
        const appt = await this.repo.findAppointmentByIdForUpdate(client, appointmentId);
        if (!appt) {
          throw ApiError.notFound('Appointment not found', 'APPOINTMENT_NOT_FOUND');
        }

        if (appt.customer_id !== customerId) {
          throw ApiError.forbidden(
            'You do not have permission to reschedule this appointment',
            'FORBIDDEN'
          );
        }

        if (appt.status !== 'confirmed') {
          throw ApiError.conflict(
            `Appointment cannot be rescheduled because it is already ${appt.status}`,
            'APPOINTMENT_NOT_ACTIVE'
          );
        }

        if (appt.slot_id === newSlotId) {
          throw ApiError.badRequest(
            'Appointment is already booked for this slot',
            'SAME_SLOT'
          );
        }

        // Cutoff rule on current slot
        const nowMs = now().getTime();
        const currentSlotStart = new Date(appt.slot_start_time).getTime();
        const diffMinutes = (currentSlotStart - nowMs) / (1000 * 60);

        if (diffMinutes < config.CANCELLATION_CUTOFF_MINUTES) {
          throw ApiError.conflict(
            `Cannot reschedule within ${config.CANCELLATION_CUTOFF_MINUTES} minutes of appointment start time`,
            'CANCELLATION_CUTOFF_EXCEEDED'
          );
        }

        // 2. Lock BOTH slots in ASCENDING ID ORDER to prevent deadlocks
        const lockedSlots = await this.repo.lockTwoSlotsAscending(
          client,
          appt.slot_id,
          newSlotId
        );

        const newSlot = lockedSlots.get(newSlotId);
        if (!newSlot) {
          throw ApiError.notFound('New slot not found', 'SLOT_NOT_FOUND');
        }

        if (newSlot.status !== 'free') {
          throw ApiError.conflict('New slot is already booked', 'SLOT_ALREADY_BOOKED');
        }

        if (new Date(newSlot.start_time) <= now()) {
          throw ApiError.badRequest('New slot cannot be in the past', 'SLOT_IN_PAST');
        }

        if (newSlot.service_id !== appt.service_id) {
          throw ApiError.badRequest(
            'New slot must belong to the same service',
            'SERVICE_MISMATCH'
          );
        }

        if (newSlot.business_status !== 'approved') {
          throw ApiError.notFound('Business is not approved', 'BUSINESS_NOT_FOUND');
        }

        // 3. Overlapping check for new slot
        const hasConflict = await this.repo.hasConflictingConfirmedAppointment(
          client,
          customerId,
          newSlot.start_time,
          newSlot.end_time,
          appt.id
        );
        if (hasConflict) {
          throw ApiError.conflict(
            'You already have another confirmed appointment during this time window',
            'OVERLAPPING_APPOINTMENT'
          );
        }

        // 4. Update appointment slot, free old slot, book new slot
        await this.repo.updateAppointmentSlot(client, appt.id, newSlotId);
        await this.repo.updateSlotStatus(client, appt.slot_id, 'free');
        await this.repo.updateSlotStatus(client, newSlotId, 'booked');

        eventPayload = {
          v: 1,
          appointmentId: appt.id,
          customerId,
          businessId: appt.business_id,
          businessName: appt.business_name,
          serviceName: appt.service_name,
          oldSlotId: appt.slot_id,
          newSlotId,
          oldSlotStartTime: appt.slot_start_time,
          newSlotStartTime: newSlot.start_time,
          startTime: newSlot.start_time,
        };
      });
    } catch (err: any) {
      if (err.code === '23505') {
        throw ApiError.conflict('New slot is already booked', 'SLOT_ALREADY_BOOKED');
      }
      throw err;
    }

    events.publish('booking.rescheduled', eventPayload);

    return {
      message: 'Appointment rescheduled successfully',
      appointmentId,
      new_slot_id: newSlotId,
    };
  }

  /**
   * Owner marks appointment completed or no_show
   */
  async updateStatusByOwner(
    appointmentId: string,
    ownerId: string,
    status: 'completed' | 'no_show'
  ): Promise<IAppointment> {
    let updated: IAppointment;

    await withTransaction(async (client) => {
      const appt = await this.repo.findAppointmentByIdForUpdate(client, appointmentId);
      if (!appt) {
        throw ApiError.notFound('Appointment not found', 'APPOINTMENT_NOT_FOUND');
      }

      if (appt.business_owner_id !== ownerId) {
        throw ApiError.forbidden(
          'You do not own the business associated with this appointment',
          'FORBIDDEN'
        );
      }

      if (appt.status !== 'confirmed') {
        throw ApiError.conflict(
          `Only confirmed appointments can be updated to completed or no_show (current: ${appt.status})`,
          'INVALID_STATUS_TRANSITION'
        );
      }

      // Slot must have already started
      if (new Date(appt.slot_start_time) > now()) {
        throw ApiError.badRequest(
          'Cannot mark appointment as completed or no_show before its slot has started',
          'APPOINTMENT_NOT_STARTED'
        );
      }

      updated = await this.repo.updateAppointmentStatus(client, appointmentId, status);
    });

    return updated!;
  }

  /**
   * List customer's appointments
   */
  async getCustomerAppointments(
    customerId: string,
    status?: string,
    page = 1,
    limit = 10
  ): Promise<PaginatedResult<AppointmentDetail>> {
    const { appointments, total } = await this.repo.listCustomerAppointments(
      customerId,
      status,
      page,
      limit
    );

    return {
      data: appointments,
      page,
      limit,
      total,
    };
  }

  /**
   * List appointments for a business on a given date (Owner view)
   */
  async getBusinessAppointments(
    businessId: string,
    ownerId: string,
    dateStr: string
  ): Promise<AppointmentDetail[]> {
    const business = await this.bPort.findBusiness(businessId);
    if (!business) {
      throw ApiError.notFound('Business not found', 'BUSINESS_NOT_FOUND');
    }

    if (business.owner_id !== ownerId) {
      throw ApiError.forbidden('You do not own this business', 'FORBIDDEN');
    }

    const tz = config.BUSINESS_TIMEZONE;
    const day = DateTime.fromISO(dateStr, { zone: tz });
    const startUtc = day.startOf('day').toUTC().toJSDate();
    const endUtc = day.endOf('day').toUTC().toJSDate();

    return await this.repo.listBusinessAppointmentsForDay(businessId, startUtc, endUtc);
  }
}

export const bookingService = new BookingService();
export default bookingService;
