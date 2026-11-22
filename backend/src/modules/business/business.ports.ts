import { query } from '../../db';
import { ApiError } from '../../utils/ApiError';

export interface BusinessPort {
  getBusinessForQueue(businessId: string): Promise<{
    id: string;
    name: string;
    owner_id: string;
    default_service_minutes: number;
    checkin_early_minutes: number;
    checkin_grace_minutes: number;
    queue_open: boolean;
  } | null>;

  findBusiness(businessId: string): Promise<{ id: string; name: string; owner_id: string; status: string; queue_open: boolean } | null>;

  assertBusinessOwner(
    businessId: string,
    userId: string,
    role?: string
  ): Promise<{ id: string; owner_id: string; name: string }>;

  findWorkingHoursForDay(
    businessId: string,
    dayOfWeek: number
  ): Promise<{ open_time: string; close_time: string } | null>;

  updateBusinessQueueOpen(businessId: string, queueOpen: boolean): Promise<void>;

  getServiceIdsForBusiness(businessId: string): Promise<string[]>;

  getBusinessStats(): Promise<{
    bizByStatus: {
      pending: number;
      approved: number;
      rejected: number;
      total: number;
    };
  }>;

  getBusinessDetails(businessId: string): Promise<{
    id: string;
    name: string;
    status: string;
    owner_id: string;
    owner_name: string;
    owner_email: string;
  } | null>;
}

export class BusinessPortImpl implements BusinessPort {
  async getBusinessDetails(businessId: string) {
    const res = await query<{
      id: string;
      name: string;
      status: string;
      owner_id: string;
      owner_name: string;
      owner_email: string;
    }>(
      `SELECT b.id, b.name, b.status, b.owner_id, u.name as owner_name, u.email as owner_email
       FROM businesses b
       JOIN users u ON b.owner_id = u.id
       WHERE b.id = $1`,
      [businessId]
    );
    return res.rows[0] || null;
  }
  async getBusinessForQueue(businessId: string) {
    const res = await query<{
      id: string;
      name: string;
      owner_id: string;
      default_service_minutes: number;
      checkin_early_minutes: number;
      checkin_grace_minutes: number;
      queue_open: boolean;
    }>(
      `SELECT
         id,
         name,
         owner_id,
         default_service_minutes,
         checkin_early_minutes,
         checkin_grace_minutes,
         queue_open
       FROM businesses
       WHERE id = $1`,
      [businessId]
    );

    return res.rows[0] || null;
  }

  async findBusiness(businessId: string) {
    const res = await query<{ id: string; name: string; owner_id: string; status: string; queue_open: boolean }>(
      `SELECT id, name, owner_id, status, queue_open FROM businesses WHERE id = $1`,
      [businessId]
    );
    return res.rows[0] || null;
  }

  async assertBusinessOwner(businessId: string, userId: string, role?: string) {
    const biz = await this.findBusiness(businessId);
    if (!biz) {
      throw ApiError.notFound('Business not found', 'BUSINESS_NOT_FOUND');
    }

    if (role !== 'admin' && biz.owner_id !== userId) {
      throw ApiError.forbidden('Access denied. You do not own this business', 'FORBIDDEN');
    }

    return biz;
  }

  async findWorkingHoursForDay(businessId: string, dayOfWeek: number) {
    const res = await query<{ open_time: string; close_time: string }>(
      `SELECT open_time, close_time
       FROM working_hours
       WHERE business_id = $1 AND day_of_week = $2`,
      [businessId, dayOfWeek]
    );
    return res.rows[0] || null;
  }

  async updateBusinessQueueOpen(businessId: string, queueOpen: boolean) {
    await query(
      `UPDATE businesses
       SET queue_open = $2
       WHERE id = $1`,
      [businessId, queueOpen]
    );
  }

  async getServiceIdsForBusiness(businessId: string): Promise<string[]> {
    const res = await query<{ id: string }>(
      `SELECT id FROM services WHERE business_id = $1`,
      [businessId]
    );
    return res.rows.map((r) => r.id);
  }

  async getBusinessStats() {
    const bizRes = await query<{ status: string; count: string }>(`
      SELECT status, COUNT(*)::text as count
      FROM businesses
      GROUP BY status
    `);
    const bizByStatus = { pending: 0, approved: 0, rejected: 0, total: 0 };
    for (const r of bizRes.rows) {
      const c = parseInt(r.count, 10) || 0;
      if (r.status === 'pending') bizByStatus.pending = c;
      if (r.status === 'approved') bizByStatus.approved = c;
      if (r.status === 'rejected') bizByStatus.rejected = c;
      bizByStatus.total += c;
    }

    return { bizByStatus };
  }
}

export const businessPort: BusinessPort = new BusinessPortImpl();
