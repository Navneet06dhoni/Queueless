import { DateTime } from 'luxon';
import redis from '../../config/redis';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { businessPort, BusinessPort } from '../business/business.ports';
import { bookingPort, BookingPort } from '../booking/booking.ports';
import { queuePort, QueuePort } from '../queue/queue.ports';
import { analyticsRepository, AnalyticsRepository } from './analytics.repository';
import {
  BusinessSummaryAnalytics,
  BusinessTodayAnalytics,
} from './analytics.types';

export class AnalyticsService {
  constructor(
    private bPort: BusinessPort = businessPort,
    private bkPort: BookingPort = bookingPort,
    private qPort: QueuePort = queuePort,
    private repo: AnalyticsRepository = analyticsRepository
  ) {}

  /**
   * Verify business exists and user has owner or admin access
   */
  async assertBusinessAccess(
    businessId: string,
    userId: string,
    role: string
  ): Promise<{ id: string; owner_id: string; name: string }> {
    return this.bPort.assertBusinessOwner(businessId, userId, role);
  }

  /**
   * Get cached or fresh business summary analytics.
   * Splits into queue metrics from queue, and appointment metrics from booking via BookingPort.
   * Appointment metrics query is fail-soft with a 2-second timeout: if booking fails or times out,
   * returns queue metrics with appointment fields set to null and partial: true.
   */
  async getSummary(
    businessId: string,
    userId: string,
    role: string,
    fromQuery?: string,
    toQuery?: string
  ): Promise<BusinessSummaryAnalytics> {
    await this.assertBusinessAccess(businessId, userId, role);

    const nowKolkata = DateTime.now().setZone(config.BUSINESS_TIMEZONE);
    const to = toQuery || nowKolkata.toFormat('yyyy-MM-dd');
    const from = fromQuery || nowKolkata.minus({ days: 7 }).toFormat('yyyy-MM-dd');

    const cacheKey = `analytics:summary:${businessId}:${from}:${to}`;

    // 1. Try reading from Redis cache (60s TTL)
    try {
      if (redis.status === 'ready' || redis.status === 'connect') {
        const cached = await redis.get(cacheKey);
        if (cached) {
          return JSON.parse(cached);
        }
      }
    } catch (err: any) {
      if (config.NODE_ENV !== 'test') {
        logger.warn({ err: err.message, businessId }, `[Redis] Error checking summary cache`);
      }
    }

    // 2. Compute metrics through analyticsRepository (aggregates QueuePort and BookingPort fail-soft)
    const summary = await this.repo.getSummary(businessId, from, to);

    // 3. Set Redis cache (60s TTL, only when complete)
    if (!summary.partial) {
      try {
        if (redis.status === 'ready' || redis.status === 'connect') {
          await redis.setex(cacheKey, 60, JSON.stringify(summary));
        }
      } catch (err: any) {
        if (config.NODE_ENV !== 'test') {
          logger.warn({ err: err.message, businessId }, `[Redis] Error setting summary cache`);
        }
      }
    }

    return summary;
  }

  /**
   * Get live uncached numbers for today in IST
   */
  async getToday(
    businessId: string,
    userId: string,
    role: string
  ): Promise<BusinessTodayAnalytics> {
    await this.assertBusinessAccess(businessId, userId, role);

    const [queueToday, nextAppointments] = await Promise.all([
      this.qPort.getQueueToday(businessId),
      this.bkPort.getNextAppointments(businessId, 5),
    ]);

    return {
      waitingNow: queueToday.waitingNow,
      servedToday: queueToday.servedToday,
      averageWaitMinutesToday: queueToday.averageWaitMinutesToday,
      nextAppointments,
    };
  }

  /**
   * Export daily analytics as CSV with formula injection prevention
   */
  async exportCsv(
    businessId: string,
    userId: string,
    role: string,
    fromQuery?: string,
    toQuery?: string
  ): Promise<{ csv: string; filename: string }> {
    const summary = await this.getSummary(businessId, userId, role, fromQuery, toQuery);

    const nowKolkata = DateTime.now().setZone(config.BUSINESS_TIMEZONE);
    const to = toQuery || nowKolkata.toFormat('yyyy-MM-dd');
    const from = fromQuery || nowKolkata.minus({ days: 7 }).toFormat('yyyy-MM-dd');

    const sanitizeCell = (val: any): string => {
      if (val === null || val === undefined) return '';
      let str = String(val);
      if (/^[=+\-@]/.test(str)) {
        str = `'${str}`;
      }
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const headers = ['date', 'served', 'average_wait_minutes'];
    const rows = summary.daily.map((d) => [
      sanitizeCell(d.date),
      sanitizeCell(d.served),
      sanitizeCell(d.averageWaitMinutes != null ? d.averageWaitMinutes : ''),
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const filename = `analytics-${businessId}-${from}-${to}.csv`;

    return {
      csv: csvContent,
      filename,
    };
  }
}

export const analyticsService = new AnalyticsService();
