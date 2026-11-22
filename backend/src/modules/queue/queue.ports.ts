import { query } from '../../db';
import { queueRedis } from './queue.redis';
import { queueService } from './queue.service';
import { logger } from '../../utils/logger';

export interface QueuePort {
  getQueueStats(): Promise<{ queueServed30Days: number }>;
  evictUserFromQueues(userId: string): Promise<void>;
  getQueueAnalytics(
    businessId: string,
    from: string,
    to: string
  ): Promise<{
    queue: {
      totalServed: number;
      skipped: number;
      left: number;
      walkInCount: number;
      onlineCount: number;
      appointmentCount: number;
    };
    averageWaitMinutes: number | null;
    medianWaitMinutes: number | null;
    averageServiceMinutes: number | null;
    estimateAccuracy: {
      sampleSize: number;
      meanAbsoluteErrorMinutes: number | null;
    };
    peakHours: Array<{ hour: number; count: number }>;
    daily: Array<{ date: string; served: number; averageWaitMinutes: number | null }>;
  }>;
  getQueueToday(
    businessId: string
  ): Promise<{
    waitingNow: number;
    servedToday: number;
    averageWaitMinutesToday: number | null;
  }>;
  getQueueEntry(entryId: string): Promise<{
    id: string;
    business_id: string;
    customer_id: string | null;
    ticket_number: number;
  } | null>;
}

export class QueuePortImpl implements QueuePort {
  async getQueueEntry(entryId: string) {
    const res = await query<{
      id: string;
      business_id: string;
      customer_id: string | null;
      ticket_number: number;
    }>(
      `SELECT id, business_id, customer_id, ticket_number FROM queue_history WHERE id = $1`,
      [entryId]
    );
    return res.rows[0] || null;
  }
  async getQueueStats(): Promise<{ queueServed30Days: number }> {
    const queueRes = await query<{ count: string }>(`
      SELECT COUNT(*)::text as count
      FROM queue_history
      WHERE status = 'completed' AND completed_at >= NOW() - INTERVAL '30 days'
    `);
    return { queueServed30Days: parseInt(queueRes.rows[0]?.count || '0', 10) };
  }

  async evictUserFromQueues(userId: string): Promise<void> {
    try {
      // Find active queue entries for user
      const entriesRes = await query<{ id: string; business_id: string }>(
        `UPDATE queue_history
         SET status = 'left'
         WHERE customer_id = $1 AND status IN ('waiting', 'called')
         RETURNING id, business_id`,
        [userId]
      );

      for (const entry of entriesRes.rows) {
        await queueRedis.removeEntry(entry.business_id, entry.id, userId);
        await queueService.broadcastQueueState(entry.business_id);
        await queueService.updateWaitingPositions(entry.business_id);
      }
    } catch (err: any) {
      logger.warn({ err: err.message, userId }, '[QueuePort] Failed to evict user from active queues');
    }
  }

  async getQueueAnalytics(businessId: string, from: string, to: string) {
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
      medianWaitMinutes = null;
    }

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

    let peakHours: Array<{ hour: number; count: number }> = [];
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
      peakHours = Array.from({ length: 24 }, (_, i) => ({ hour: i, count: 0 }));
    }

    let daily: Array<{ date: string; served: number; averageWaitMinutes: number | null }> = [];
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

  async getQueueToday(businessId: string) {
    let waitingNow = 0;
    try {
      const waiting = await queueRedis.getWaitingEntries(businessId);
      waitingNow = waiting.length;
    } catch {
      waitingNow = 0;
    }

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

    return {
      waitingNow,
      servedToday,
      averageWaitMinutesToday,
    };
  }
}

export const queuePort: QueuePort = new QueuePortImpl();
