import { query } from '../../db';
import {
  BusinessSummaryAnalytics,
  BusinessTodayAnalytics,
  DailyAnalyticsItem,
  NextAppointmentItem,
  PeakHourItem,
} from './analytics.types';

export class AnalyticsRepository {
  /**
   * Find business by ID for access control check
   */
  async findBusiness(businessId: string): Promise<{ id: string; owner_id: string } | null> {
    const res = await query(
      `SELECT id, owner_id FROM businesses WHERE id = $1`,
      [businessId]
    );
    return res.rows[0] || null;
  }

  /**
   * Compute comprehensive owner analytics in SQL with Asia/Kolkata timezone
   */
  async getSummary(
    businessId: string,
    from: string,
    to: string
  ): Promise<BusinessSummaryAnalytics> {
    // 1. Queue counts and averages
    const queueRes = await query<{
      totalServed: number;
      skipped: number;
      left: number;
      walkInCount: number;
      onlineCount: number;
      appointmentCount: number;
      avgWait: string | null;
      avgService: string | null;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'completed')::int AS "totalServed",
         COUNT(*) FILTER (WHERE status = 'skipped')::int AS "skipped",
         COUNT(*) FILTER (WHERE status = 'left')::int AS "left",
         COUNT(*) FILTER (WHERE source = 'walk_in')::int AS "walkInCount",
         COUNT(*) FILTER (WHERE source = 'online')::int AS "onlineCount",
         COUNT(*) FILTER (WHERE source = 'appointment')::int AS "appointmentCount",
         AVG(EXTRACT(EPOCH FROM (called_at - joined_at)) / 60.0)
           FILTER (WHERE status IN ('called', 'completed') AND called_at IS NOT NULL) AS "avgWait",
         AVG(EXTRACT(EPOCH FROM (completed_at - called_at)) / 60.0)
           FILTER (WHERE status = 'completed' AND completed_at IS NOT NULL AND called_at IS NOT NULL) AS "avgService"
       FROM queue_history
       WHERE business_id = $1
         AND joined_at >= ($2 || ' 00:00:00 Asia/Kolkata')::timestamptz
         AND joined_at <= ($3 || ' 23:59:59.999 Asia/Kolkata')::timestamptz`,
      [businessId, from, to]
    );

    const qRow = queueRes.rows[0] || {
      totalServed: 0,
      skipped: 0,
      left: 0,
      walkInCount: 0,
      onlineCount: 0,
      appointmentCount: 0,
      avgWait: null,
      avgService: null,
    };

    const averageWaitMinutes =
      qRow.avgWait !== null && qRow.avgWait !== undefined
        ? Math.round(parseFloat(qRow.avgWait) * 10) / 10
        : null;

    const averageServiceMinutes =
      qRow.avgService !== null && qRow.avgService !== undefined
        ? Math.round(parseFloat(qRow.avgService) * 10) / 10
        : null;

    // 2. Median Wait Minutes
    let medianWaitMinutes: number | null = null;
    try {
      const medianRes = await query<{ median_wait: string | null }>(
        `SELECT
           PERCENTILE_CONT(0.5) WITHIN GROUP (
             ORDER BY EXTRACT(EPOCH FROM (called_at - joined_at)) / 60.0
           ) AS median_wait
         FROM queue_history
         WHERE business_id = $1
           AND status IN ('called', 'completed')
           AND called_at IS NOT NULL
           AND joined_at >= ($2 || ' 00:00:00 Asia/Kolkata')::timestamptz
           AND joined_at <= ($3 || ' 23:59:59.999 Asia/Kolkata')::timestamptz`,
        [businessId, from, to]
      );
      if (medianRes.rows[0]?.median_wait != null) {
        medianWaitMinutes = Math.round(parseFloat(medianRes.rows[0].median_wait) * 10) / 10;
      }
    } catch {
      // Fallback for environments lacking PERCENTILE_CONT
      const waitsRes = await query<{ wait: string }>(
        `SELECT (EXTRACT(EPOCH FROM (called_at - joined_at)) / 60.0)::text as wait
         FROM queue_history
         WHERE business_id = $1
           AND status IN ('called', 'completed')
           AND called_at IS NOT NULL
           AND joined_at >= ($2 || ' 00:00:00 Asia/Kolkata')::timestamptz
           AND joined_at <= ($3 || ' 23:59:59.999 Asia/Kolkata')::timestamptz
         ORDER BY 1 ASC`,
        [businessId, from, to]
      );
      if (waitsRes.rows.length > 0) {
        const sorted = waitsRes.rows.map((r) => parseFloat(r.wait)).sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        const med = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
        medianWaitMinutes = Math.round(med * 10) / 10;
      }
    }

    // 3. Estimate Accuracy (sampleSize, meanAbsoluteErrorMinutes)
    const accuracyRes = await query<{ sampleSize: number; mae: string | null }>(
      `SELECT
         COUNT(*)::int AS "sampleSize",
         AVG(ABS(estimated_wait_minutes - (EXTRACT(EPOCH FROM (called_at - joined_at)) / 60.0))) AS "mae"
       FROM queue_history
       WHERE business_id = $1
         AND estimated_wait_minutes IS NOT NULL
         AND status IN ('called', 'completed')
         AND called_at IS NOT NULL
         AND joined_at >= ($2 || ' 00:00:00 Asia/Kolkata')::timestamptz
         AND joined_at <= ($3 || ' 23:59:59.999 Asia/Kolkata')::timestamptz`,
      [businessId, from, to]
    );

    const sampleSize = accuracyRes.rows[0]?.sampleSize || 0;
    const maeRaw = accuracyRes.rows[0]?.mae;
    const meanAbsoluteErrorMinutes =
      sampleSize > 0 && maeRaw != null ? Math.round(parseFloat(maeRaw) * 10) / 10 : null;

    // 4. Appointments metrics (confirmed, completed, noShow, cancelled, noShowRate)
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

    // 5. Slot Utilization: booked slots / total slots in range as percentage
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

    // 6. Peak Hours: 24 items { hour: 0..23, count }
    let peakHours: PeakHourItem[] = [];
    try {
      const peakRes = await query<{ hour: number; count: number }>(
        `WITH hours AS (
           SELECT generate_series(0, 23) AS hour
         ),
         joined_counts AS (
           SELECT
             EXTRACT(HOUR FROM (joined_at AT TIME ZONE 'Asia/Kolkata'))::int AS hour,
             COUNT(*)::int AS count
           FROM queue_history
           WHERE business_id = $1
             AND joined_at >= ($2 || ' 00:00:00 Asia/Kolkata')::timestamptz
             AND joined_at <= ($3 || ' 23:59:59.999 Asia/Kolkata')::timestamptz
           GROUP BY 1
         )
         SELECT
           h.hour,
           COALESCE(jc.count, 0)::int AS count
         FROM hours h
         LEFT JOIN joined_counts jc ON h.hour = jc.hour
         ORDER BY h.hour ASC`,
        [businessId, from, to]
      );
      peakHours = peakRes.rows;
    } catch {
      // Fallback
      peakHours = Array.from({ length: 24 }, (_, i) => ({ hour: i, count: 0 }));
    }

    // 7. Daily table (including zero days)
    let daily: DailyAnalyticsItem[] = [];
    try {
      const dailyRes = await query<{
        date: string;
        served: number;
        avg_wait: string | null;
      }>(
        `WITH date_series AS (
           SELECT (generate_series(
             $2::date,
             $3::date,
             INTERVAL '1 day'
           ))::date AS dt
         ),
         daily_data AS (
           SELECT
             (joined_at AT TIME ZONE 'Asia/Kolkata')::date AS dt,
             COUNT(*) FILTER (WHERE status = 'completed')::int AS served,
             AVG(EXTRACT(EPOCH FROM (called_at - joined_at)) / 60.0)
               FILTER (WHERE status IN ('called', 'completed') AND called_at IS NOT NULL) AS avg_wait
           FROM queue_history
           WHERE business_id = $1
             AND joined_at >= ($2 || ' 00:00:00 Asia/Kolkata')::timestamptz
             AND joined_at <= ($3 || ' 23:59:59.999 Asia/Kolkata')::timestamptz
           GROUP BY 1
         )
         SELECT
           TO_CHAR(ds.dt, 'YYYY-MM-DD') AS date,
           COALESCE(dd.served, 0)::int AS served,
           dd.avg_wait
         FROM date_series ds
         LEFT JOIN daily_data dd ON ds.dt = dd.dt
         ORDER BY ds.dt ASC`,
        [businessId, from, to]
      );

      daily = dailyRes.rows.map((r) => ({
        date: r.date,
        served: r.served,
        averageWaitMinutes:
          r.avg_wait != null ? Math.round(parseFloat(r.avg_wait) * 10) / 10 : null,
      }));
    } catch {
      // Fallback
      daily = [];
    }

    return {
      queue: {
        totalServed: qRow.totalServed,
        skipped: qRow.skipped,
        left: qRow.left,
        walkInCount: qRow.walkInCount,
        onlineCount: qRow.onlineCount,
        appointmentCount: qRow.appointmentCount,
      },
      averageWaitMinutes,
      medianWaitMinutes,
      averageServiceMinutes,
      estimateAccuracy: {
        sampleSize,
        meanAbsoluteErrorMinutes,
      },
      appointments: {
        confirmed: aRow.confirmed,
        completed: aRow.completed,
        noShow: aRow.noShow,
        cancelled: aRow.cancelled,
        noShowRate,
      },
      slotUtilization,
      peakHours,
      daily,
    };
  }

  /**
   * Live numbers for today in IST
   */
  async getToday(
    businessId: string,
    waitingNow: number
  ): Promise<BusinessTodayAnalytics> {
    // 1. Served today & average wait today in IST
    const todayRes = await query<{
      servedToday: number;
      avgWait: string | null;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'completed')::int AS "servedToday",
         AVG(EXTRACT(EPOCH FROM (called_at - joined_at)) / 60.0)
           FILTER (WHERE status IN ('called', 'completed') AND called_at IS NOT NULL) AS "avgWait"
       FROM queue_history
       WHERE business_id = $1
         AND (completed_at AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date`,
      [businessId]
    );

    const servedToday = todayRes.rows[0]?.servedToday || 0;
    const avgWaitRaw = todayRes.rows[0]?.avgWait;
    const averageWaitMinutesToday =
      avgWaitRaw != null ? Math.round(parseFloat(avgWaitRaw) * 10) / 10 : null;

    // 2. Next 5 confirmed appointments from now
    const nextRes = await query<{
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
       LIMIT 5`,
      [businessId]
    );

    const nextAppointments: NextAppointmentItem[] = nextRes.rows.map((r) => ({
      appointmentId: r.appointmentId,
      customerName: r.customerName,
      serviceName: r.serviceName,
      startTime: new Date(r.startTime).toISOString(),
    }));

    return {
      waitingNow,
      servedToday,
      averageWaitMinutesToday,
      nextAppointments,
    };
  }
}

export const analyticsRepository = new AnalyticsRepository();
