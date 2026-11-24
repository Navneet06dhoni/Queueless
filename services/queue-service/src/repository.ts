import { query } from './db';
import { IQueueHistory, QueueEntrySource, QueueEntryStatus } from './types';

export class QueueRepository {
  private query = query;

  async findActiveEntryByCustomer(customerId: string): Promise<IQueueHistory | null> {
    const res = await this.query(
      `SELECT q.*
       FROM queue_history q
       WHERE q.customer_id = $1 AND q.status IN ('waiting', 'called')
       LIMIT 1`,
      [customerId]
    );
    return res.rows[0] || null;
  }

  async createQueueEntry(data: {
    businessId: string;
    customerId: string | null;
    customerName?: string | null;
    customerEmail?: string | null;
    walkInName?: string | null;
    ticketNumber: number;
    source: QueueEntrySource;
    appointmentId?: string | null;
    score: number;
    joinedAt: Date;
    status?: QueueEntryStatus;
    estimatedWaitMinutes?: number | null;
  }): Promise<IQueueHistory> {
    const res = await this.query(
      `INSERT INTO queue_history (
         business_id, customer_id, customer_name, customer_email, walk_in_name, ticket_number,
         source, appointment_id, score, joined_at, status, estimated_wait_minutes
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        data.businessId,
        data.customerId || null,
        data.customerName || null,
        data.customerEmail || null,
        data.walkInName || null,
        data.ticketNumber,
        data.source,
        data.appointmentId || null,
        data.score,
        data.joinedAt,
        data.status || 'waiting',
        data.estimatedWaitMinutes ?? null,
      ]
    );
    return res.rows[0];
  }

  async updateEstimatedWaitMinutes(entryId: string, estimatedWaitMinutes: number): Promise<void> {
    await this.query(
      `UPDATE queue_history SET estimated_wait_minutes = $2 WHERE id = $1`,
      [entryId, estimatedWaitMinutes]
    );
  }

  async markQueueEntryLeft(entryId: string, customerId?: string | null): Promise<boolean> {
    let sql = `UPDATE queue_history SET status = 'left' WHERE id = $1 AND status = 'waiting'`;
    const params: any[] = [entryId];
    if (customerId) {
      sql += ` AND customer_id = $2`;
      params.push(customerId);
    }
    sql += ` RETURNING id`;
    const res = await this.query(sql, params);
    return (res.rowCount ?? 0) > 0;
  }

  async markQueueEntryCalled(entryId: string, calledAt: Date): Promise<IQueueHistory | null> {
    const res = await this.query(
      `UPDATE queue_history
       SET status = 'called', called_at = $2
       WHERE id = $1
       RETURNING *`,
      [entryId, calledAt]
    );
    return res.rows[0] || null;
  }

  async markQueueEntryCompleted(entryId: string, completedAt: Date): Promise<IQueueHistory | null> {
    const res = await this.query(
      `UPDATE queue_history
       SET status = 'completed', completed_at = $2
       WHERE id = $1
       RETURNING *`,
      [entryId, completedAt]
    );
    return res.rows[0] || null;
  }

  async markQueueEntrySkipped(entryId: string, completedAt: Date): Promise<IQueueHistory | null> {
    const res = await this.query(
      `UPDATE queue_history
       SET status = 'skipped', completed_at = $2
       WHERE id = $1
       RETURNING *`,
      [entryId, completedAt]
    );
    return res.rows[0] || null;
  }

  async getAverageServiceDuration(businessId: string, sinceDate: Date): Promise<number | null> {
    const res = await this.query(
      `SELECT called_at, completed_at
       FROM queue_history
       WHERE business_id = $1
         AND status = 'completed'
         AND called_at IS NOT NULL
         AND completed_at IS NOT NULL
         AND completed_at >= $2
       ORDER BY completed_at DESC
       LIMIT 30`,
      [businessId, sinceDate]
    );

    if (res.rows.length === 0) {
      return null;
    }

    const totalMinutes = res.rows.reduce((sum: number, row: any) => {
      const diffMs = new Date(row.completed_at).getTime() - new Date(row.called_at).getTime();
      return sum + Math.max(0, diffMs / (60 * 1000));
    }, 0);

    return totalMinutes / res.rows.length;
  }

  async getOwnerQueueCounts(businessId: string, startOfDay: Date) {
    const res = await this.query(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'completed' AND completed_at >= $2 THEN 1 ELSE 0 END), 0) as served_today,
         COALESCE(SUM(CASE WHEN status = 'skipped' AND completed_at >= $2 THEN 1 ELSE 0 END), 0) as skipped_today
       FROM queue_history
       WHERE business_id = $1`,
      [businessId, startOfDay]
    );
    return {
      servedToday: Number(res.rows[0]?.served_today || 0),
      skippedToday: Number(res.rows[0]?.skipped_today || 0),
    };
  }

  async getAllWaitingEntries(): Promise<IQueueHistory[]> {
    const res = await this.query(
      `SELECT q.*
       FROM queue_history q
       WHERE q.status = 'waiting'
       ORDER BY q.score ASC`
    );
    return res.rows;
  }

  async getActiveCalledEntry(businessId: string): Promise<IQueueHistory | null> {
    const res = await this.query(
      `SELECT q.*
       FROM queue_history q
       WHERE q.business_id = $1 AND q.status = 'called' AND q.completed_at IS NULL
       ORDER BY q.called_at DESC
       LIMIT 1`,
      [businessId]
    );
    return res.rows[0] || null;
  }

  async getQueueSettings(businessId: string): Promise<{ queue_open: boolean }> {
    const res = await this.query<{ queue_open: boolean }>(
      `SELECT queue_open FROM queue_settings WHERE business_id = $1`,
      [businessId]
    );
    if (res.rows.length === 0) {
      return { queue_open: true };
    }
    return res.rows[0];
  }

  async setQueueSettings(businessId: string, queueOpen: boolean): Promise<void> {
    await this.query(
      `INSERT INTO queue_settings (business_id, queue_open, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (business_id) DO UPDATE
       SET queue_open = EXCLUDED.queue_open, updated_at = NOW()`,
      [businessId, queueOpen]
    );
  }

  async evictUser(customerId: string): Promise<Array<{ id: string; business_id: string }>> {
    const res = await this.query<{ id: string; business_id: string }>(
      `UPDATE queue_history
       SET status = 'left'
       WHERE customer_id = $1 AND status IN ('waiting', 'called')
       RETURNING id, business_id`,
      [customerId]
    );
    return res.rows;
  }

  // --- Analytics Facts ---

  async get30DayStats(days = 30): Promise<{ queueServed30Days: number }> {
    const res = await this.query<{ count: string }>(
      `SELECT COUNT(*)::text as count
       FROM queue_history
       WHERE status = 'completed' AND completed_at >= NOW() - ($1 || ' days')::interval`,
      [days]
    );
    return { queueServed30Days: parseInt(res.rows[0]?.count || '0', 10) };
  }

  async getQueueAnalyticsSummary(businessId: string, from: string, to: string) {
    const queueRes = await this.query<{
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

    let medianWaitMinutes: number | null = null;
    try {
      const medianRes = await this.query<{ median_wait: string | null }>(
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
      medianWaitMinutes = null;
    }

    const accuracyRes = await this.query<{ sampleSize: number; mae: string | null }>(
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

    let peakHours: Array<{ hour: number; count: number }> = [];
    try {
      const peakRes = await this.query<{ hour: number; count: number }>(
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
      peakHours = Array.from({ length: 24 }, (_, i) => ({ hour: i, count: 0 }));
    }

    let daily: Array<{ date: string; served: number; averageWaitMinutes: number | null }> = [];
    try {
      const dailyRes = await this.query<{
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
      peakHours,
      daily,
    };
  }

  async getQueueTodayMetrics(businessId: string) {
    const todayRes = await this.query<{
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

    return {
      servedToday,
      averageWaitMinutesToday,
    };
  }
}

export const queueRepository = new QueueRepository();
