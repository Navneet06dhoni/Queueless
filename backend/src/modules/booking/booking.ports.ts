import { PoolClient, QueryResultRow } from 'pg';
import { query, withTransaction } from '../../db';

export interface BookingPort {
  getAppointmentForCheckIn(appointmentId: string): Promise<{
    id: string;
    customer_id: string;
    business_id: string;
    status: string;
    start_time: string;
    end_time: string;
    service_name: string;
  } | null>;

  getAppointmentAnalytics(
    businessId: string,
    from: string,
    to: string
  ): Promise<{
    appointments: {
      confirmed: number;
      completed: number;
      noShow: number;
      cancelled: number;
      noShowRate: number | null;
    };
    slotUtilization: number | null;
  }>;

  getNextAppointments(
    businessId: string,
    limit?: number
  ): Promise<
    Array<{
      appointmentId: string;
      customerName: string;
      serviceName: string;
      startTime: string;
    }>
  >;

  hasActiveBookingsForService(serviceId: string): Promise<boolean>;

  cancelCustomerFutureAppointments(
    customerId: string,
    client?: PoolClient
  ): Promise<
    Array<{
      id: string;
      slot_id: string;
      business_id: string;
      business_name: string;
      owner_id: string;
      service_name: string;
      customer_id: string;
      customer_name: string;
      customer_email: string;
      start_time: string;
    }>
  >;

  getBookingStats(): Promise<{
    apptByStatus: {
      confirmed: number;
      completed: number;
      no_show: number;
      cancelled: number;
      total30Days: number;
    };
    dailyAppointments: Array<{ date: string; newAppointments: number }>;
  }>;

  getAppointmentDetails(appointmentId: string): Promise<{
    id: string;
    slot_id: string;
    customer_id: string;
    customer_name: string;
    customer_email: string;
    business_id: string;
    business_name: string;
    owner_id: string;
    owner_name: string;
    service_name: string;
    start_time: string;
  } | null>;
}

export class BookingPortImpl implements BookingPort {
  async getAppointmentDetails(appointmentId: string) {
    const res = await query<{
      id: string;
      slot_id: string;
      customer_id: string;
      customer_name: string;
      customer_email: string;
      business_id: string;
      business_name: string;
      owner_id: string;
      owner_name: string;
      service_name: string;
      start_time: string;
    }>(
      `SELECT 
         a.id, a.slot_id, a.customer_id,
         u.name as customer_name, u.email as customer_email,
         b.id as business_id, b.name as business_name,
         o.id as owner_id, o.name as owner_name,
         srv.name as service_name,
         s.start_time
       FROM appointments a
       JOIN slots s ON a.slot_id = s.id
       JOIN services srv ON s.service_id = srv.id
       JOIN businesses b ON srv.business_id = b.id
       JOIN users u ON a.customer_id = u.id
       JOIN users o ON b.owner_id = o.id
       WHERE a.id = $1`,
      [appointmentId]
    );
    return res.rows[0] || null;
  }
  async getAppointmentForCheckIn(appointmentId: string) {
    const res = await query<{
      id: string;
      customer_id: string;
      business_id: string;
      status: string;
      start_time: string;
      end_time: string;
      service_name: string;
    }>(
      `SELECT
         a.id,
         a.customer_id,
         sv.business_id,
         a.status,
         s.start_time,
         s.end_time,
         sv.name as service_name
       FROM appointments a
       JOIN slots s ON a.slot_id = s.id
       JOIN services sv ON s.service_id = sv.id
       WHERE a.id = $1`,
      [appointmentId]
    );

    return res.rows[0] || null;
  }

  async getAppointmentAnalytics(businessId: string, from: string, to: string) {
    const apptsRes = await query<{
      confirmed: number;
      completed: number;
      noShow: number;
      cancelled: number;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE a.status = 'confirmed')::int AS "confirmed",
         COUNT(*) FILTER (WHERE a.status = 'completed')::int AS "completed",
         COUNT(*) FILTER (WHERE a.status = 'no_show')::int AS "noShow",
         COUNT(*) FILTER (WHERE a.status = 'cancelled')::int AS "cancelled"
       FROM appointments a
       JOIN slots s ON a.slot_id = s.id
       JOIN services sv ON s.service_id = sv.id
       WHERE sv.business_id = $1
         AND s.start_time >= ($2 || ' 00:00:00 Asia/Kolkata')::timestamptz
         AND s.start_time <= ($3 || ' 23:59:59.999 Asia/Kolkata')::timestamptz`,
      [businessId, from, to]
    );

    const aRow = apptsRes.rows[0] || {
      confirmed: 0,
      completed: 0,
      noShow: 0,
      cancelled: 0,
    };

    const totalFinished = aRow.completed + aRow.noShow;
    const noShowRate =
      totalFinished > 0 ? Math.round((aRow.noShow / totalFinished) * 1000) / 1000 : null;

    const slotsRes = await query<{
      totalSlots: number;
      bookedSlots: number;
    }>(
      `SELECT
         COUNT(*)::int AS "totalSlots",
         COUNT(*) FILTER (WHERE s.status = 'booked')::int AS "bookedSlots"
       FROM slots s
       JOIN services sv ON s.service_id = sv.id
       WHERE sv.business_id = $1
         AND s.start_time >= ($2 || ' 00:00:00 Asia/Kolkata')::timestamptz
         AND s.start_time <= ($3 || ' 23:59:59.999 Asia/Kolkata')::timestamptz`,
      [businessId, from, to]
    );

    const sRow = slotsRes.rows[0] || { totalSlots: 0, bookedSlots: 0 };
    const slotUtilization =
      sRow.totalSlots > 0 ? Math.round((sRow.bookedSlots / sRow.totalSlots) * 1000) / 10 : null;

    return {
      appointments: {
        confirmed: aRow.confirmed,
        completed: aRow.completed,
        noShow: aRow.noShow,
        cancelled: aRow.cancelled,
        noShowRate,
      },
      slotUtilization,
    };
  }

  async getNextAppointments(businessId: string, limit: number = 5) {
    const res = await query<{
      appointmentId: string;
      customerName: string;
      serviceName: string;
      startTime: string;
    }>(
      `SELECT
         a.id AS "appointmentId",
         u.name AS "customerName",
         sv.name AS "serviceName",
         s.start_time AS "startTime"
       FROM appointments a
       JOIN slots s ON a.slot_id = s.id
       JOIN services sv ON s.service_id = sv.id
       JOIN users u ON a.customer_id = u.id
       WHERE sv.business_id = $1
         AND a.status = 'confirmed'
         AND s.start_time > NOW()
       ORDER BY s.start_time ASC
       LIMIT $2`,
      [businessId, limit]
    );

    return res.rows.map((r) => ({
      appointmentId: r.appointmentId,
      customerName: r.customerName,
      serviceName: r.serviceName,
      startTime: new Date(r.startTime).toISOString(),
    }));
  }

  async hasActiveBookingsForService(serviceId: string): Promise<boolean> {
    const bookedSlotRes = await query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM slots WHERE service_id = $1 AND status = 'booked'`,
      [serviceId]
    );
    if (parseInt(bookedSlotRes.rows[0]?.count || '0', 10) > 0) {
      return true;
    }

    const apptRes = await query<{ count: string }>(
      `SELECT COUNT(*)::text as count 
       FROM appointments a
       JOIN slots s ON a.slot_id = s.id
       WHERE s.service_id = $1 AND a.status IN ('confirmed', 'completed')`,
      [serviceId]
    );
    return parseInt(apptRes.rows[0]?.count || '0', 10) > 0;
  }

  async cancelCustomerFutureAppointments(customerId: string, client?: PoolClient) {
    const q = <T extends QueryResultRow = any>(sql: string, params: any[]) =>
      client ? client.query<T>(sql, params) : query<T>(sql, params);

    const apptsRes = await q<{
      id: string;
      slot_id: string;
      business_id: string;
      business_name: string;
      owner_id: string;
      service_name: string;
      customer_id: string;
      customer_name: string;
      customer_email: string;
      start_time: string;
    }>(
      `SELECT
         a.id,
         a.slot_id,
         b.id as business_id,
         b.name as business_name,
         b.owner_id,
         sv.name as service_name,
         u.id as customer_id,
         u.name as customer_name,
         u.email as customer_email,
         s.start_time
       FROM appointments a
       JOIN slots s ON a.slot_id = s.id
       JOIN services sv ON s.service_id = sv.id
       JOIN businesses b ON sv.business_id = b.id
       JOIN users u ON a.customer_id = u.id
       WHERE a.customer_id = $1
         AND a.status = 'confirmed'
         AND s.start_time > NOW()`,
      [customerId]
    );

    const cancelled = apptsRes.rows;
    if (cancelled.length > 0) {
      const apptIds = cancelled.map((a: any) => a.id);
      const slotIds = cancelled.map((a: any) => a.slot_id);

      await q(
        `UPDATE appointments
         SET status = 'cancelled'
         WHERE id = ANY($1::uuid[])`,
        [apptIds]
      );

      await q(
        `UPDATE slots
         SET status = 'free'
         WHERE id = ANY($1::uuid[])`,
        [slotIds]
      );
    }

    return cancelled;
  }

  async getBookingStats() {
    const apptRes = await query<{ status: string; count: string }>(`
      SELECT status, COUNT(*)::text as count
      FROM appointments
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY status
    `);
    const apptByStatus = { confirmed: 0, completed: 0, no_show: 0, cancelled: 0, total30Days: 0 };
    for (const r of apptRes.rows) {
      const c = parseInt(r.count, 10) || 0;
      if (r.status === 'confirmed') apptByStatus.confirmed = c;
      if (r.status === 'completed') apptByStatus.completed = c;
      if (r.status === 'no_show') apptByStatus.no_show = c;
      if (r.status === 'cancelled') apptByStatus.cancelled = c;
      apptByStatus.total30Days += c;
    }

    let dailyAppointments: Array<{ date: string; newAppointments: number }> = [];
    try {
      const dailyRes = await query<{ date: string; newAppointments: number }>(`
        WITH date_series AS (
          SELECT (generate_series(
            (NOW() AT TIME ZONE 'Asia/Kolkata')::date - INTERVAL '29 days',
            (NOW() AT TIME ZONE 'Asia/Kolkata')::date,
            INTERVAL '1 day'
          ))::date AS dt
        ),
        appt_counts AS (
          SELECT (created_at AT TIME ZONE 'Asia/Kolkata')::date AS dt, COUNT(*) AS count
          FROM appointments
          WHERE created_at >= NOW() - INTERVAL '31 days'
          GROUP BY 1
        )
        SELECT
          TO_CHAR(ds.dt, 'YYYY-MM-DD') AS date,
          COALESCE(ac.count, 0)::int AS "newAppointments"
        FROM date_series ds
        LEFT JOIN appt_counts ac ON ds.dt = ac.dt
        ORDER BY ds.dt ASC
      `);
      dailyAppointments = dailyRes.rows;
    } catch {
      dailyAppointments = [];
    }

    return { apptByStatus, dailyAppointments };
  }
}

export const bookingPort: BookingPort = new BookingPortImpl();
