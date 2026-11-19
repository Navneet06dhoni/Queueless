import { DateTime } from 'luxon';
import { businessRepository, BusinessRepository } from './business.repository';
import { businessCache, BusinessCache } from './business.cache';
import { config } from '../../config';
import { events } from '../../events';
import { ApiError } from '../../utils/ApiError';
import {
  IBusiness,
  BusinessDetail,
  IService,
  IWorkingHour,
  ISlot,
  BusinessListQuery,
  PaginatedResult,
  BusinessStatus,
} from './business.types';

export class BusinessService {
  constructor(
    private repo: BusinessRepository = businessRepository,
    private cache: BusinessCache = businessCache
  ) {}

  /**
   * Reusable helper to assert business ownership
   */
  async assertBusinessOwner(businessId: string, userId: string): Promise<IBusiness> {
    const business = await this.repo.findBusinessById(businessId);
    if (!business) {
      throw ApiError.notFound('Business not found', 'BUSINESS_NOT_FOUND');
    }
    if (business.owner_id !== userId) {
      throw ApiError.forbidden('You do not own this business', 'FORBIDDEN');
    }
    return business;
  }

  // --- Businesses ---

  async createBusiness(
    ownerId: string,
    data: { name: string; category: string; address: string; city: string; phone: string }
  ): Promise<IBusiness> {
    const business = await this.repo.createBusiness({
      owner_id: ownerId,
      name: data.name.trim(),
      category: data.category.trim(),
      address: data.address.trim(),
      city: data.city.trim(),
      phone: data.phone.trim(),
    });

    await this.cache.invalidate();
    return business;
  }

  async getApprovedBusinesses(
    query: BusinessListQuery
  ): Promise<PaginatedResult<IBusiness>> {
    const cacheKey = await this.cache.getCacheKey(query);
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const { businesses, total } = await this.repo.listApprovedBusinesses(query);
    const result: PaginatedResult<IBusiness> = {
      data: businesses,
      page: query.page || 1,
      limit: query.limit || 10,
      total,
    };

    await this.cache.set(cacheKey, result);
    return result;
  }

  async getBusinessDetail(
    businessId: string,
    userId?: string,
    userRole?: string
  ): Promise<BusinessDetail> {
    const business = await this.repo.findBusinessById(businessId);
    if (!business) {
      throw ApiError.notFound('Business not found', 'BUSINESS_NOT_FOUND');
    }

    // Public users can only see approved businesses
    if (business.status !== 'approved') {
      const isOwner = userId && business.owner_id === userId;
      const isAdmin = userRole === 'admin';
      if (!isOwner && !isAdmin) {
        throw ApiError.notFound('Business not found', 'BUSINESS_NOT_FOUND');
      }
    }

    const services = await this.repo.listServicesByBusiness(businessId);
    const workingHours = await this.repo.getWorkingHoursByBusiness(businessId);

    return {
      ...business,
      services,
      working_hours: workingHours,
    };
  }

  async getOwnerBusinesses(ownerId: string): Promise<IBusiness[]> {
    return await this.repo.findBusinessesByOwner(ownerId);
  }

  async updateBusiness(
    businessId: string,
    ownerId: string,
    data: Partial<IBusiness>
  ): Promise<IBusiness> {
    await this.assertBusinessOwner(businessId, ownerId);
    const updated = await this.repo.updateBusiness(businessId, data);
    await this.cache.invalidate();
    return updated;
  }

  // --- Services ---

  async addService(
    businessId: string,
    ownerId: string,
    data: { name: string; duration_minutes: number; price: number }
  ): Promise<IService> {
    await this.assertBusinessOwner(businessId, ownerId);
    return await this.repo.createService({
      business_id: businessId,
      name: data.name.trim(),
      duration_minutes: data.duration_minutes,
      price: data.price,
    });
  }

  async updateService(
    businessId: string,
    serviceId: string,
    ownerId: string,
    data: Partial<IService>
  ): Promise<IService> {
    await this.assertBusinessOwner(businessId, ownerId);
    const service = await this.repo.findServiceById(serviceId);
    if (!service || service.business_id !== businessId) {
      throw ApiError.notFound('Service not found in this business', 'SERVICE_NOT_FOUND');
    }
    return await this.repo.updateService(serviceId, data);
  }

  async deleteService(
    businessId: string,
    serviceId: string,
    ownerId: string
  ): Promise<void> {
    await this.assertBusinessOwner(businessId, ownerId);
    const service = await this.repo.findServiceById(serviceId);
    if (!service || service.business_id !== businessId) {
      throw ApiError.notFound('Service not found in this business', 'SERVICE_NOT_FOUND');
    }

    const hasBookings = await this.repo.hasActiveBookingsForService(serviceId);
    if (hasBookings) {
      throw ApiError.conflict(
        'Cannot delete service with active bookings or appointments',
        'SERVICE_HAS_BOOKINGS'
      );
    }

    await this.repo.deleteServiceAndFreeSlots(serviceId);
  }

  // --- Working Hours ---

  async setWorkingHours(
    businessId: string,
    ownerId: string,
    hours: IWorkingHour[]
  ): Promise<IWorkingHour[]> {
    await this.assertBusinessOwner(businessId, ownerId);
    return await this.repo.replaceWorkingHours(businessId, hours);
  }

  // --- Slots ---

  async generateSlots(
    businessId: string,
    ownerId: string,
    data: { service_id: string; from_date: string; to_date: string }
  ): Promise<{ created: number; skipped: number }> {
    await this.assertBusinessOwner(businessId, ownerId);

    const service = await this.repo.findServiceById(data.service_id);
    if (!service || service.business_id !== businessId) {
      throw ApiError.notFound('Service not found in this business', 'SERVICE_NOT_FOUND');
    }

    const tz = config.BUSINESS_TIMEZONE;
    const nowInTz = DateTime.now().setZone(tz);
    const todayStr = nowInTz.toISODate()!;

    if (data.from_date < todayStr) {
      throw ApiError.badRequest('from_date cannot be in the past', 'INVALID_DATE_RANGE');
    }

    let fromDt = DateTime.fromISO(data.from_date, { zone: tz }).startOf('day');
    const toDt = DateTime.fromISO(data.to_date, { zone: tz }).startOf('day');

    if (toDt.diff(fromDt, 'days').days > 30) {
      throw ApiError.badRequest('Date range cannot exceed 30 days', 'INVALID_DATE_RANGE');
    }

    const workingHoursList = await this.repo.getWorkingHoursByBusiness(businessId);
    const workingHoursMap = new Map<number, IWorkingHour>();
    for (const wh of workingHoursList) {
      workingHoursMap.set(wh.day_of_week, wh);
    }

    const slotsToInsert: {
      service_id: string;
      start_time: Date;
      end_time: Date;
      status: string;
    }[] = [];

    let currentDay = fromDt;
    while (currentDay <= toDt) {
      // Luxon weekday: 1 = Mon ... 7 = Sun. Our DB schema: 0 = Sun, 1 = Mon ... 6 = Sat
      const dbDayOfWeek = currentDay.weekday === 7 ? 0 : currentDay.weekday;
      const wh = workingHoursMap.get(dbDayOfWeek);

      if (wh) {
        const [openHour, openMin] = wh.open_time.split(':').map((s) => parseInt(s, 10));
        const [closeHour, closeMin] = wh.close_time.split(':').map((s) => parseInt(s, 10));

        let slotStart = currentDay.set({ hour: openHour, minute: openMin, second: 0, millisecond: 0 });
        const dayClose = currentDay.set({ hour: closeHour, minute: closeMin, second: 0, millisecond: 0 });

        while (slotStart.plus({ minutes: service.duration_minutes }) <= dayClose) {
          const slotEnd = slotStart.plus({ minutes: service.duration_minutes });

          // Only generate slots that start strictly in the future
          if (slotStart > nowInTz) {
            slotsToInsert.push({
              service_id: service.id,
              start_time: slotStart.toUTC().toJSDate(),
              end_time: slotEnd.toUTC().toJSDate(),
              status: 'free',
            });
          }

          slotStart = slotEnd;
        }
      }

      currentDay = currentDay.plus({ days: 1 });
    }

    return await this.repo.insertSlotsBatch(slotsToInsert);
  }

  async getSlots(
    businessId: string,
    query: { date: string; service_id?: string },
    requesterUserId?: string,
    requesterRole?: string
  ): Promise<ISlot[]> {
    const business = await this.repo.findBusinessById(businessId);
    if (!business) {
      throw ApiError.notFound('Business not found', 'BUSINESS_NOT_FOUND');
    }

    const isOwner = requesterUserId === business.owner_id;
    const isAdmin = requesterRole === 'admin';

    if (business.status !== 'approved' && !isOwner && !isAdmin) {
      throw ApiError.notFound('Business not found', 'BUSINESS_NOT_FOUND');
    }

    const tz = config.BUSINESS_TIMEZONE;
    const day = DateTime.fromISO(query.date, { zone: tz });
    const startRange = day.startOf('day').toUTC().toJSDate();
    const endRange = day.endOf('day').toUTC().toJSDate();
    const nowUtc = DateTime.now().toUTC().toJSDate();

    // Owner sees all statuses; public/customers see only future free slots
    const onlyFreeAndFuture = !isOwner;

    return await this.repo.findSlots(
      businessId,
      query.service_id,
      startRange,
      endRange,
      onlyFreeAndFuture,
      nowUtc
    );
  }

  // --- Admin ---

  async updateBusinessStatus(
    businessId: string,
    status: BusinessStatus
  ): Promise<IBusiness> {
    const updated = await this.repo.updateBusinessStatus(businessId, status);
    if (!updated) {
      throw ApiError.notFound('Business not found', 'BUSINESS_NOT_FOUND');
    }

    await this.cache.invalidate();

    events.publish('business.status_changed', {
      businessId: updated.id,
      ownerId: updated.owner_id,
      status: updated.status,
    });

    return updated;
  }

  async listAdminBusinesses(
    status: BusinessStatus,
    page: number,
    limit: number
  ): Promise<PaginatedResult<IBusiness>> {
    const { businesses, total } = await this.repo.listAdminBusinesses(status, page, limit);
    return {
      data: businesses,
      page,
      limit,
      total,
    };
  }
}

export const businessService = new BusinessService();
export default businessService;
