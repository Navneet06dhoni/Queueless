import { query, withTransaction } from '../../db';
import {
  IBusiness,
  IService,
  IWorkingHour,
  ISlot,
  BusinessListQuery,
  BusinessStatus,
} from './business.types';

export const escapeLikeWildcards = (str: string): string => {
  return str.replace(/([%_\\])/g, '\\$1');
};

export class BusinessRepository {
  // --- Businesses ---

  async createBusiness(data: {
    owner_id: string;
    name: string;
    category: string;
    address: string;
    city: string;
    phone: string;
  }): Promise<IBusiness> {
    const res = await query<IBusiness>(
      `INSERT INTO businesses (owner_id, name, category, address, city, phone, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       RETURNING id, owner_id, name, category, address, city, phone, status, created_at`,
      [data.owner_id, data.name, data.category, data.address, data.city, data.phone]
    );
    return res.rows[0];
  }

  async findBusinessById(id: string): Promise<IBusiness | null> {
    const res = await query<IBusiness>(
      `SELECT id, owner_id, name, category, address, city, phone, status, created_at
       FROM businesses
       WHERE id = $1`,
      [id]
    );
    return res.rows[0] || null;
  }

  async findBusinessesByOwner(ownerId: string): Promise<IBusiness[]> {
    const res = await query<IBusiness>(
      `SELECT id, owner_id, name, category, address, city, phone, status, created_at
       FROM businesses
       WHERE owner_id = $1
       ORDER BY created_at DESC`,
      [ownerId]
    );
    return res.rows;
  }

  async listApprovedBusinesses(
    params: BusinessListQuery
  ): Promise<{ businesses: IBusiness[]; total: number }> {
    const conditions: string[] = ["status = 'approved'"];
    const values: any[] = [];
    let paramIndex = 1;

    if (params.q) {
      const sanitized = `%${escapeLikeWildcards(params.q.toLowerCase().trim())}%`;
      conditions.push(`LOWER(name) LIKE $${paramIndex}`);
      values.push(sanitized);
      paramIndex++;
    }

    if (params.category) {
      conditions.push(`LOWER(category) = LOWER($${paramIndex})`);
      values.push(params.category.trim());
      paramIndex++;
    }

    if (params.city) {
      conditions.push(`LOWER(city) = LOWER($${paramIndex})`);
      values.push(params.city.trim());
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    // Count query
    const countRes = await query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM businesses WHERE ${whereClause}`,
      values
    );
    const total = parseInt(countRes.rows[0]?.count || '0', 10);

    const page = params.page || 1;
    const limit = params.limit || 10;
    const offset = (page - 1) * limit;

    values.push(limit);
    const limitIdx = paramIndex++;
    values.push(offset);
    const offsetIdx = paramIndex++;

    const listRes = await query<IBusiness>(
      `SELECT id, owner_id, name, category, address, city, phone, status, created_at
       FROM businesses
       WHERE ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      values
    );

    return {
      businesses: listRes.rows,
      total,
    };
  }

  async updateBusiness(id: string, data: Partial<IBusiness>): Promise<IBusiness> {
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (data.name !== undefined) {
      fields.push(`name = $${idx++}`);
      values.push(data.name);
    }
    if (data.category !== undefined) {
      fields.push(`category = $${idx++}`);
      values.push(data.category);
    }
    if (data.address !== undefined) {
      fields.push(`address = $${idx++}`);
      values.push(data.address);
    }
    if (data.city !== undefined) {
      fields.push(`city = $${idx++}`);
      values.push(data.city);
    }
    if (data.phone !== undefined) {
      fields.push(`phone = $${idx++}`);
      values.push(data.phone);
    }

    values.push(id);
    const idIdx = idx;

    const res = await query<IBusiness>(
      `UPDATE businesses
       SET ${fields.join(', ')}
       WHERE id = $${idIdx}
       RETURNING id, owner_id, name, category, address, city, phone, status, created_at`,
      values
    );
    return res.rows[0];
  }

  async updateBusinessStatus(id: string, status: BusinessStatus): Promise<IBusiness | null> {
    const res = await query<IBusiness>(
      `UPDATE businesses
       SET status = $1
       WHERE id = $2
       RETURNING id, owner_id, name, category, address, city, phone, status, created_at`,
      [status, id]
    );
    return res.rows[0] || null;
  }

  async listAdminBusinesses(
    status: BusinessStatus,
    page: number,
    limit: number
  ): Promise<{ businesses: IBusiness[]; total: number }> {
    const offset = (page - 1) * limit;

    const countRes = await query<{ count: string }>(
      'SELECT COUNT(*)::text as count FROM businesses WHERE status = $1',
      [status]
    );
    const total = parseInt(countRes.rows[0]?.count || '0', 10);

    const listRes = await query<IBusiness>(
      `SELECT id, owner_id, name, category, address, city, phone, status, created_at
       FROM businesses
       WHERE status = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [status, limit, offset]
    );

    return { businesses: listRes.rows, total };
  }

  // --- Services ---

  async createService(data: {
    business_id: string;
    name: string;
    duration_minutes: number;
    price: number;
  }): Promise<IService> {
    const res = await query<IService>(
      `INSERT INTO services (business_id, name, duration_minutes, price)
       VALUES ($1, $2, $3, $4)
       RETURNING id, business_id, name, duration_minutes, price::numeric, created_at`,
      [data.business_id, data.name, data.duration_minutes, data.price]
    );
    return {
      ...res.rows[0],
      price: parseFloat(res.rows[0].price as any),
    };
  }

  async findServiceById(id: string): Promise<IService | null> {
    const res = await query<IService>(
      `SELECT id, business_id, name, duration_minutes, price::numeric, created_at
       FROM services
       WHERE id = $1`,
      [id]
    );
    if (!res.rows[0]) return null;
    return {
      ...res.rows[0],
      price: parseFloat(res.rows[0].price as any),
    };
  }

  async listServicesByBusiness(businessId: string): Promise<IService[]> {
    const res = await query<IService>(
      `SELECT id, business_id, name, duration_minutes, price::numeric, created_at
       FROM services
       WHERE business_id = $1
       ORDER BY created_at ASC`,
      [businessId]
    );
    return res.rows.map((row) => ({
      ...row,
      price: parseFloat(row.price as any),
    }));
  }

  async updateService(id: string, data: Partial<IService>): Promise<IService> {
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (data.name !== undefined) {
      fields.push(`name = $${idx++}`);
      values.push(data.name);
    }
    if (data.duration_minutes !== undefined) {
      fields.push(`duration_minutes = $${idx++}`);
      values.push(data.duration_minutes);
    }
    if (data.price !== undefined) {
      fields.push(`price = $${idx++}`);
      values.push(data.price);
    }

    values.push(id);
    const idIdx = idx;

    const res = await query<IService>(
      `UPDATE services
       SET ${fields.join(', ')}
       WHERE id = $${idIdx}
       RETURNING id, business_id, name, duration_minutes, price::numeric, created_at`,
      values
    );
    return {
      ...res.rows[0],
      price: parseFloat(res.rows[0].price as any),
    };
  }

  async deleteServiceAndFreeSlots(serviceId: string): Promise<void> {
    await withTransaction(async (client) => {
      // Delete free slots for this service
      await client.query(
        `DELETE FROM slots WHERE service_id = $1 AND status = 'free'`,
        [serviceId]
      );
      // Delete service
      await client.query(`DELETE FROM services WHERE id = $1`, [serviceId]);
    });
  }

  // --- Working Hours ---

  async replaceWorkingHours(
    businessId: string,
    hours: IWorkingHour[]
  ): Promise<IWorkingHour[]> {
    return await withTransaction(async (client) => {
      await client.query(`DELETE FROM working_hours WHERE business_id = $1`, [businessId]);

      const inserted: IWorkingHour[] = [];
      for (const h of hours) {
        const res = await client.query<IWorkingHour>(
          `INSERT INTO working_hours (business_id, day_of_week, open_time, close_time)
           VALUES ($1, $2, $3, $4)
           RETURNING id, business_id, day_of_week, open_time, close_time`,
          [businessId, h.day_of_week, h.open_time, h.close_time]
        );
        inserted.push(res.rows[0]);
      }
      return inserted;
    });
  }

  async getWorkingHoursByBusiness(businessId: string): Promise<IWorkingHour[]> {
    const res = await query<IWorkingHour>(
      `SELECT id, business_id, day_of_week, open_time, close_time
       FROM working_hours
       WHERE business_id = $1
       ORDER BY day_of_week ASC`,
      [businessId]
    );
    return res.rows;
  }

  // --- Slots ---

  async insertSlotsBatch(
    slots: { service_id: string; start_time: Date; end_time: Date; status: string }[]
  ): Promise<{ created: number; skipped: number }> {
    if (slots.length === 0) {
      return { created: 0, skipped: 0 };
    }

    let created = 0;
    let skipped = 0;

    await withTransaction(async (client) => {
      // Find all existing slot start times in this range for this service
      const minStart = slots[0].start_time;
      const maxEnd = slots[slots.length - 1].end_time;
      const serviceId = slots[0].service_id;

      const existingRes = await client.query<{ start_time: Date }>(
        `SELECT start_time FROM slots 
         WHERE service_id = $1 AND start_time >= $2 AND start_time <= $3`,
        [serviceId, minStart, maxEnd]
      );

      const existingSet = new Set(
        existingRes.rows.map((r) => new Date(r.start_time).toISOString())
      );

      for (const slot of slots) {
        const slotKey = new Date(slot.start_time).toISOString();
        if (existingSet.has(slotKey)) {
          skipped++;
          continue;
        }

        await client.query(
          `INSERT INTO slots (service_id, start_time, end_time, status)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (service_id, start_time) DO NOTHING`,
          [slot.service_id, slot.start_time, slot.end_time, slot.status]
        );
        existingSet.add(slotKey);
        created++;
      }
    });

    return { created, skipped };
  }

  async findSlots(
    businessId: string,
    serviceId: string | undefined,
    startRange: Date,
    endRange: Date,
    filterOnlyFutureAndFree: boolean,
    nowUtc: Date
  ): Promise<ISlot[]> {
    const conditions: string[] = [
      's.start_time >= $1',
      's.start_time <= $2',
      'srv.business_id = $3',
    ];
    const values: any[] = [startRange, endRange, businessId];
    let idx = 4;

    if (serviceId) {
      conditions.push(`s.service_id = $${idx++}`);
      values.push(serviceId);
    }

    if (filterOnlyFutureAndFree) {
      conditions.push(`s.status = 'free'`);
      conditions.push(`s.start_time >= $${idx++}`);
      values.push(nowUtc);
    }

    const res = await query<ISlot>(
      `SELECT s.id, s.service_id, s.start_time, s.end_time, s.status
       FROM slots s
       JOIN services srv ON s.service_id = srv.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY s.start_time ASC`,
      values
    );

    return res.rows;
  }
}

export const businessRepository = new BusinessRepository();
export default businessRepository;
