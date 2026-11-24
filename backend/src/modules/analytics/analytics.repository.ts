import { BookingPort, bookingPort } from '../booking/booking.ports';
import { QueuePort, queuePort } from '../queue/queue.ports';
import { logger } from '../../utils/logger';
import { BusinessSummaryAnalytics } from './analytics.types';

/**
 * Analytics aggregator module delegates queue analytics to QueuePort
 * and appointment analytics to BookingPort.
 */
export class AnalyticsRepository {
  constructor(
    private qPort: QueuePort = queuePort,
    private bkPort: BookingPort = bookingPort
  ) {}

  /**
   * Aggregate queue metrics from QueuePort and appointment metrics from BookingPort (fail-soft with 2s timeout)
   */
  async getSummary(
    businessId: string,
    from: string,
    to: string
  ): Promise<BusinessSummaryAnalytics> {
    let queueData: any;
    let apptMetrics: {
      appointments: any;
      slotUtilization: number | null;
    };
    let partial = false;

    // Fail-soft queue query with 2s timeout limit
    try {
      let qTimer: NodeJS.Timeout;
      const qTimeoutPromise = new Promise<never>((_, reject) => {
        qTimer = setTimeout(
          () => reject(new Error('QueuePort analytics query timed out after 2000ms')),
          2000
        );
      });

      queueData = await Promise.race([
        this.qPort.getQueueAnalytics(businessId, from, to),
        qTimeoutPromise,
      ]).finally(() => clearTimeout(qTimer!));
    } catch (err: any) {
      logger.warn({ err: err.message, businessId }, 'Queue analytics query failed or timed out; failing soft');
      queueData = {
        queue: null,
        averageWaitMinutes: null,
        medianWaitMinutes: null,
        averageServiceMinutes: null,
        estimateAccuracy: null,
        peakHours: [],
        daily: [],
      };
      partial = true;
    }

    try {
      let timer: NodeJS.Timeout;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('BookingPort analytics query timed out after 2000ms')),
          2000
        );
      });

      apptMetrics = await Promise.race([
        this.bkPort.getAppointmentAnalytics(businessId, from, to),
        timeoutPromise,
      ]).finally(() => clearTimeout(timer!));
    } catch (err: any) {
      logger.warn({ err: err.message, businessId }, 'Booking analytics query failed or timed out; failing soft');
      apptMetrics = {
        appointments: null,
        slotUtilization: null,
      };
      partial = true;
    }

    return {
      queue: queueData.queue,
      averageWaitMinutes: queueData.averageWaitMinutes,
      medianWaitMinutes: queueData.medianWaitMinutes,
      averageServiceMinutes: queueData.averageServiceMinutes,
      estimateAccuracy: queueData.estimateAccuracy,
      appointments: apptMetrics.appointments,
      slotUtilization: apptMetrics.slotUtilization,
      peakHours: queueData.peakHours,
      daily: queueData.daily,
      partial,
    };
  }
}

export const analyticsRepository = new AnalyticsRepository();
