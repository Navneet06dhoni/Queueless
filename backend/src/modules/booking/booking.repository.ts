import { PoolClient } from 'pg';
import { query } from '../../db';
import {
  IAppointment,
  SlotWithServiceBusiness,
  AppointmentDetail,
  AppointmentStatus,
} from './booking.types';

export class BookingRepository {
  /**
   * Lock a slot and retrieve its service and business details inside a transaction
   */
  async findSlotWithDetailsForUpdate(
    client: PoolClient,
    slotId: string
  ): Promise<SlotWithServiceBusiness | null> {
    const res = await client.query<SlotWithServiceBusiness>(
      `SELECT 
         s.id, s.service_id, s.start_time, s.end_time, s.status,
         srv.name as service_name, srv.duration_minutes, srv.price::numeric as price,
         b.id as business_id, b.name as business_name, b.status as business_status, b.owner_id as business_owner_id
       FROM slots s
       JOIN services srv ON s.service_id = srv.id
       JOIN businesses b ON srv.business_id = b.id
       WHERE s.id = $1
       FOR UPDATE`,
      [slotId]
    );

    if (!res.rows[0]) return null;
    return {
      ...res.rows[0],
      price: parseFloat(res.rows[0].price as any),
    };
  }

  /**
   * Lock two slots in ascending ID order to prevent deadlock
   */
  async lockTwoSlotsAscending(
    client: PoolClient,
    id1: string,
    id2: string
  ): Promise<Map<string, SlotWithServiceBusiness>> {
    const res = await client.query<SlotWithServiceBusiness>(
      `SELECT 
         s.id, s.service_id, s.start_time, s.end_time, s.status,
         srv.name as service_name, srv.duration_minutes, srv.price::numeric as price,
         b.id as business_id, b.name as business_name, b.status as business_status, b.owner_id as business_owner_id
       FROM slots s
       JOIN services srv ON s.service_id = srv.id
       JOIN businesses b ON srv.business_id = b.id
       WHERE s.id IN ($1, $2)
       ORDER BY s.id ASC
       FOR UPDATE`,
      [id1, id2]
    );

    const map = new Map<string, SlotWithServiceBusiness>();
    for (const row of res.rows) {
      map.set(row.id, {
        ...row,
        price: parseFloat(row.price as any),
      });
    }
    return map;
  }

  /**
   * Check if a customer has any other overlapping confirmed appointment
   */
  async hasConflictingConfirmedAppointment(
    client: PoolClient,
    customerId: string,
    startTime: Date,
    endTime: Date,
    excludeAppointmentId?: string
  ): Promise<boolean> {
    let sql = `
      SELECT a.id 
      FROM appointments a
      JOIN slots s ON a.slot_id = s.id
      WHERE a.customer_id = $1
        AND a.status = 'confirmed'
        AND s.start_time < $3
        AND s.end_time > $2
    `;
    const params: any[] = [customerId, startTime, endTime];

    if (excludeAppointmentId) {
      sql += ` AND a.id <> $4`;
      params.push(excludeAppointmentId);
    }

    sql += ' LIMIT 1';

    const res = await client.query(sql, params);
    return res.rows.length > 0;
  }

  /**
   * Create appointment record
   */
  async createAppointment(
    client: PoolClient,
    slotId: string,
    customerId: string
  ): Promise<IAppointment> {
    const res = await client.query<IAppointment>(
      `INSERT INTO appointments (slot_id, customer_id, status)
       VALUES ($1, $2, 'confirmed')
       RETURNING id, slot_id, customer_id, status, created_at`,
      [slotId, customerId]
    );
    return res.rows[0];
  }

  /**
   * Update a slot status ('free' | 'booked')
   */
  async updateSlotStatus(
    client: PoolClient,
    slotId: string,
    status: 'free' | 'booked'
  ): Promise<void> {
    await client.query(`UPDATE slots SET status = $1 WHERE id = $2`, [status, slotId]);
  }

  /**
   * Find appointment and lock it for update
   */
  async findAppointmentByIdForUpdate(
    client: PoolClient,
    appointmentId: string
  ): Promise<
    | (IAppointment & {
        slot_start_time: Date;
        slot_end_time: Date;
        service_id: string;
        business_id: string;
        business_owner_id: string;
      })
    | null
  > {
    const res = await client.query(
      `SELECT 
         a.id, a.slot_id, a.customer_id, a.status, a.created_at,
         s.start_time as slot_start_time, s.end_time as slot_end_time,
         s.service_id, srv.business_id, b.owner_id as business_owner_id
       FROM appointments a
       JOIN slots s ON a.slot_id = s.id
       JOIN services srv ON s.service_id = srv.id
       JOIN businesses b ON srv.business_id = b.id
       WHERE a.id = $1
       FOR UPDATE`,
      [appointmentId]
    );
    return res.rows[0] || null;
  }

  /**
   * Update appointment slot_id (for reschedule)
   */
  async updateAppointmentSlot(
    client: PoolClient,
    appointmentId: string,
    newSlotId: string
  ): Promise<void> {
    await client.query(`UPDATE appointments SET slot_id = $1 WHERE id = $2`, [
      newSlotId,
      appointmentId,
    ]);
  }

  /**
   * Update appointment status
   */
  async updateAppointmentStatus(
    client: PoolClient | null,
    appointmentId: string,
    status: AppointmentStatus
  ): Promise<IAppointment> {
    const queryFn = client ? client.query.bind(client) : query;
    const res = await queryFn<IAppointment>(
      `UPDATE appointments SET status = $1 WHERE id = $2 RETURNING id, slot_id, customer_id, status, created_at`,
      [status, appointmentId]
    );
    return res.rows[0];
  }

  /**
   * List customer's appointments with slot, service, and business details
   */
  async listCustomerAppointments(
    customerId: string,
    status?: string,
    page = 1,
    limit = 10
  ): Promise<{ appointments: AppointmentDetail[]; total: number }> {
    const offset = (page - 1) * limit;
    const conditions = ['a.customer_id = $1'];
    const params: any[] = [customerId];
    let idx = 2;

    if (status) {
      conditions.push(`a.status = $${idx++}`);
      params.push(status);
    }

    const whereClause = conditions.join(' AND ');

    const countRes = await query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM appointments a WHERE ${whereClause}`,
      params
    );
    const total = parseInt(countRes.rows[0]?.count || '0', 10);

    params.push(limit);
    const limitIdx = idx++;
    params.push(offset);
    const offsetIdx = idx++;

    const listRes = await query(
      `SELECT 
         a.id, a.slot_id, a.customer_id, a.status, a.created_at,
         s.id as slot_id_val, s.start_time as slot_start_time, s.end_time as slot_end_time, s.status as slot_status,
         srv.id as service_id, srv.name as service_name, srv.duration_minutes, srv.price::numeric as service_price,
         b.id as business_id, b.name as business_name, b.category as business_category, b.address as business_address, b.city as business_city, b.phone as business_phone
       FROM appointments a
       JOIN slots s ON a.slot_id = s.id
       JOIN services srv ON s.service_id = srv.id
       JOIN businesses b ON srv.business_id = b.id
       WHERE ${whereClause}
       ORDER BY a.created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params
    );

    const appointments: AppointmentDetail[] = listRes.rows.map((r: any) => ({
      id: r.id,
      slot_id: r.slot_id,
      customer_id: r.customer_id,
      status: r.status,
      created_at: r.created_at,
      slot: {
        id: r.slot_id_val,
        start_time: r.slot_start_time,
        end_time: r.slot_end_time,
        status: r.slot_status,
      },
      service: {
        id: r.service_id,
        name: r.service_name,
        duration_minutes: r.duration_minutes,
        price: parseFloat(r.service_price),
      },
      business: {
        id: r.business_id,
        name: r.business_name,
        category: r.business_category,
        address: r.business_address,
        city: r.business_city,
        phone: r.business_phone,
      },
    }));

    return { appointments, total };
  }

  /**
   * List appointments for a business on a given date (for business owner)
   */
  async listBusinessAppointmentsForDay(
    businessId: string,
    startUtc: Date,
    endUtc: Date
  ): Promise<AppointmentDetail[]> {
    const res = await query(
      `SELECT 
         a.id, a.slot_id, a.customer_id, a.status, a.created_at,
         s.id as slot_id_val, s.start_time as slot_start_time, s.end_time as slot_end_time, s.status as slot_status,
         srv.id as service_id, srv.name as service_name, srv.duration_minutes, srv.price::numeric as service_price,
         b.id as business_id, b.name as business_name, b.category as business_category, b.address as business_address, b.city as business_city, b.phone as business_phone,
         u.id as user_id, u.name as customer_name, u.email as customer_email
       FROM appointments a
       JOIN slots s ON a.slot_id = s.id
       JOIN services srv ON s.service_id = srv.id
       JOIN businesses b ON srv.business_id = b.id
       JOIN users u ON a.customer_id = u.id
       WHERE b.id = $1
         AND s.start_time >= $2
         AND s.start_time <= $3
       ORDER BY s.start_time ASC`,
      [businessId, startUtc, endUtc]
    );

    return res.rows.map((r: any) => ({
      id: r.id,
      slot_id: r.slot_id,
      customer_id: r.customer_id,
      status: r.status,
      created_at: r.created_at,
      slot: {
        id: r.slot_id_val,
        start_time: r.slot_start_time,
        end_time: r.slot_end_time,
        status: r.slot_status,
      },
      service: {
        id: r.service_id,
        name: r.service_name,
        duration_minutes: r.duration_minutes,
        price: parseFloat(r.service_price),
      },
      business: {
        id: r.business_id,
        name: r.business_name,
        category: r.business_category,
        address: r.business_address,
        city: r.business_city,
        phone: r.business_phone,
      },
      customer: {
        id: r.user_id,
        name: r.customer_name,
        email: r.customer_email,
      },
    }));
  }
}

export const bookingRepository = new BookingRepository();
export default bookingRepository;
