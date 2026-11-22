import { DateTime } from 'luxon';
import { config } from '../../config';
import { events } from '../../events';
import { ApiError } from '../../utils/ApiError';
import { now } from '../../utils/clock';
import { logger } from '../../utils/logger';
import { queueRepository, QueueRepository } from './queue.repository';
import { queueRedisClient, QueueRedisClient } from './queue.redis';
import {
  CustomerQueuePosition,
  IQueueEntryRedis,
  OwnerQueueDetails,
  PublicQueueStatus,
} from './queue.types';
import {
  emitOwnerQueueUpdated,
  emitQueueCalled,
  emitQueuePosition,
  emitQueueRemoved,
  emitQueueUpdated,
} from '../../socket';

export class QueueService {
  constructor(
    private repo: QueueRepository = queueRepository,
    private redisClient: QueueRedisClient = queueRedisClient
  ) {}

  /**
   * Helper to verify business ownership
   */
  private async assertBusinessOwner(businessId: string, userId: string, userRole: string): Promise<any> {
    const biz = await this.repo.findBusinessById(businessId);
    if (!biz) {
      throw ApiError.notFound('Business not found', 'BUSINESS_NOT_FOUND');
    }
    if (biz.owner_id !== userId && userRole !== 'admin') {
      throw ApiError.forbidden('You do not have permission to manage this business queue', 'FORBIDDEN_OWNER_REQUIRED');
    }
    return biz;
  }

  /**
   * Calculate rolling average service duration in minutes over last 30 completed entries in 30 days
   */
  async getAverageServiceMinutes(businessId: string): Promise<number> {
    const cached = await this.redisClient.getCachedAvgServiceMinutes(businessId);
    if (cached !== null && cached > 0) {
      return cached;
    }

    const thirtyDaysAgo = new Date(now().getTime() - 30 * 24 * 60 * 60 * 1000);
    const avg = await this.repo.getAverageServiceDuration(businessId, thirtyDaysAgo);

    const result = avg !== null && avg > 0 ? avg : config.DEFAULT_SERVICE_MINUTES;
    await this.redisClient.setCachedAvgServiceMinutes(businessId, result);
    return result;
  }

  /**
   * Calculate estimated wait minutes (rounded up to nearest integer)
   */
  private calculateEstimatedWait(position: number, avgServiceMinutes: number): number {
    if (position <= 0) return 0;
    return Math.ceil(position * avgServiceMinutes);
  }

  /**
   * Validate business is approved, queue_open is true, and within working hours in Asia/Kolkata
   */
  private async validateQueueOpenAndWorkingHours(businessId: string): Promise<any> {
    const biz = await this.repo.findBusinessById(businessId);
    if (!biz) {
      throw ApiError.notFound('Business not found', 'BUSINESS_NOT_FOUND');
    }
    if (biz.status !== 'approved') {
      throw ApiError.conflict('Business is not approved', 'BUSINESS_NOT_APPROVED');
    }
    if (!biz.queue_open) {
      throw ApiError.conflict('Queue is currently closed', 'QUEUE_CLOSED');
    }

    // Check working hours in Asia/Kolkata
    const kolkataNow = DateTime.fromJSDate(now(), { zone: config.BUSINESS_TIMEZONE });
    // In Luxon: 1 = Monday ... 7 = Sunday. DB day_of_week is 0 = Sunday ... 6 = Saturday
    const dayOfWeek = kolkataNow.weekday % 7;

    const hours = await this.repo.findWorkingHoursForDay(businessId, dayOfWeek);
    if (!hours) {
      throw ApiError.conflict('Business is currently closed outside of working hours', 'OUTSIDE_WORKING_HOURS');
    }

    const currentTime = kolkataNow.toFormat('HH:mm:ss');
    if (currentTime < hours.open_time || currentTime > hours.close_time) {
      throw ApiError.conflict('Business is currently closed outside of working hours', 'OUTSIDE_WORKING_HOURS');
    }

    return biz;
  }

  /**
   * Broadcast current public and owner queue states
   */
  async broadcastQueueState(businessId: string): Promise<void> {
    try {
      const publicStatus = await this.getPublicStatus(businessId);
      emitQueueUpdated(businessId, publicStatus);

      const ownerData = await this.getOwnerQueueInternal(businessId);
      emitOwnerQueueUpdated(businessId, ownerData);
    } catch (err: any) {
      logger.warn({ err: err.message, businessId }, `[QueueService] Error broadcasting queue state`);
    }
  }

  /**
   * Update position updates for all waiting customers in room user:{id}
   */
  async updateWaitingPositions(businessId: string): Promise<void> {
    try {
      const waiting = await this.redisClient.getWaitingEntries(businessId);
      const avgMinutes = await this.getAverageServiceMinutes(businessId);

      for (let i = 0; i < waiting.length; i++) {
        const item = waiting[i];
        if (item.customerId) {
          const position = i + 1;
          const peopleAhead = i;
          const estimatedWaitMinutes = this.calculateEstimatedWait(position, avgMinutes);

          emitQueuePosition(item.customerId, {
            ticketNumber: item.ticketNumber,
            position,
            peopleAhead,
            estimatedWaitMinutes,
            status: 'waiting',
            businessId,
          });
        }
      }
    } catch (err: any) {
      logger.warn({ err: err.message, businessId }, `[QueueService] Error updating waiting positions`);
    }
  }

  /**
   * Customer: Join Virtual Queue
   */
  async joinQueue(businessId: string, customerId: string) {
    await this.validateQueueOpenAndWorkingHours(businessId);

    // Enforce one active queue per customer
    const existing = await this.repo.findActiveEntryByCustomer(customerId);
    if (existing) {
      throw ApiError.conflict('You are already in an active queue', 'ALREADY_IN_QUEUE');
    }

    const kolkataNow = DateTime.fromJSDate(now(), { zone: config.BUSINESS_TIMEZONE });
    const dateKey = kolkataNow.toFormat('yyyy-MM-dd');
    const ticketNumber = await this.redisClient.getNextTicketNumber(businessId, dateKey);
    const customerName = await this.repo.findCustomerName(customerId);

    const currentTime = now();
    const entryScore = currentTime.getTime();

    // 1. Insert into PostgreSQL
    let dbEntry: any;
    try {
      dbEntry = await this.repo.createQueueEntry({
        businessId,
        customerId,
        ticketNumber,
        source: 'online',
        score: entryScore,
        joinedAt: currentTime,
        status: 'waiting',
      });
    } catch (err: any) {
      if (err.code === '23505') {
        throw ApiError.conflict('You are already in an active queue', 'ALREADY_IN_QUEUE');
      }
      throw err;
    }

    // 2. Add to Redis
    try {
      await this.redisClient.addEntry(businessId, {
        id: dbEntry.id,
        businessId,
        customerId,
        customerName: customerName || 'Customer',
        ticketNumber,
        source: 'online',
        joinedAt: currentTime.toISOString(),
        score: entryScore,
      });
    } catch (err) {
      // Compensate on Redis failure
      await this.repo.markQueueEntryLeft(dbEntry.id, customerId);
      throw err;
    }

    // 3. Compute position and estimated wait
    const position = (await this.redisClient.getPosition(businessId, dbEntry.id)) || 1;
    const avgMinutes = await this.getAverageServiceMinutes(businessId);
    const estimatedWaitMinutes = this.calculateEstimatedWait(position, avgMinutes);
    await this.repo.updateEstimatedWaitMinutes(dbEntry.id, estimatedWaitMinutes);
    await this.repo.updateEstimatedWaitMinutes(dbEntry.id, estimatedWaitMinutes);

    // 4. Publish Event and Socket notifications
    events.publish('queue.joined', {
      businessId,
      entryId: dbEntry.id,
      customerId,
      ticketNumber,
      position,
    });

    await this.broadcastQueueState(businessId);
    emitQueuePosition(customerId, {
      ticketNumber,
      position,
      peopleAhead: Math.max(0, position - 1),
      estimatedWaitMinutes,
      status: 'waiting',
      businessId,
    });

    return {
      ticketNumber,
      position,
      estimatedWaitMinutes,
    };
  }

  /**
   * Customer: Check-in with booked appointment (Hybrid Queue)
   */
  async checkInAppointment(businessId: string, customerId: string, appointmentId: string) {
    const biz = await this.repo.findBusinessById(businessId);
    if (!biz) {
      throw ApiError.notFound('Business not found', 'BUSINESS_NOT_FOUND');
    }
    if (biz.status !== 'approved') {
      throw ApiError.conflict('Business is not approved', 'BUSINESS_NOT_APPROVED');
    }
    if (!biz.queue_open) {
      throw ApiError.conflict('Queue is currently closed', 'QUEUE_CLOSED');
    }

    // Validate appointment
    const appt = await this.repo.findAppointmentForCheckIn(appointmentId);
    if (!appt || appt.customer_id !== customerId) {
      throw ApiError.notFound('Appointment not found', 'APPOINTMENT_NOT_FOUND');
    }
    if (appt.business_id !== businessId) {
      throw ApiError.conflict('Appointment does not belong to this business', 'BUSINESS_MISMATCH');
    }
    if (appt.status !== 'confirmed') {
      throw ApiError.conflict('Only confirmed appointments can be checked in', 'APPOINTMENT_NOT_CONFIRMED');
    }

    // Check check-in window: CHECKIN_EARLY_MINUTES before start to CHECKIN_GRACE_MINUTES after start
    const slotStart = new Date(appt.start_time);
    const currentMs = now().getTime();
    const earlyWindow = slotStart.getTime() - config.CHECKIN_EARLY_MINUTES * 60 * 1000;
    const graceWindow = slotStart.getTime() + config.CHECKIN_GRACE_MINUTES * 60 * 1000;

    if (currentMs < earlyWindow) {
      throw ApiError.conflict(
        `Check-in is only allowed up to ${config.CHECKIN_EARLY_MINUTES} minutes before your appointment time`,
        'CHECKIN_TOO_EARLY'
      );
    }
    if (currentMs > graceWindow) {
      throw ApiError.conflict(
        `Check-in window has expired for this appointment`,
        'CHECKIN_EXPIRED'
      );
    }

    // Check if customer already in queue
    const existing = await this.repo.findActiveEntryByCustomer(customerId);
    if (existing) {
      throw ApiError.conflict('You are already in an active queue', 'ALREADY_IN_QUEUE');
    }

    const kolkataNow = DateTime.fromJSDate(now(), { zone: config.BUSINESS_TIMEZONE });
    const dateKey = kolkataNow.toFormat('yyyy-MM-dd');
    const ticketNumber = await this.redisClient.getNextTicketNumber(businessId, dateKey);
    const customerName = await this.repo.findCustomerName(customerId);

    // HYBRID RULE: score is the slot START TIME in epoch ms!
    const entryScore = slotStart.getTime();

    let dbEntry: any;
    try {
      dbEntry = await this.repo.createQueueEntry({
        businessId,
        customerId,
        ticketNumber,
        source: 'appointment',
        appointmentId,
        score: entryScore,
        joinedAt: now(),
        status: 'waiting',
      });
    } catch (err: any) {
      if (err.code === '23505') {
        throw ApiError.conflict('This appointment or customer is already in an active queue', 'ALREADY_IN_QUEUE');
      }
      throw err;
    }

    try {
      await this.redisClient.addEntry(businessId, {
        id: dbEntry.id,
        businessId,
        customerId,
        customerName: customerName || 'Appointment Customer',
        ticketNumber,
        source: 'appointment',
        appointmentId,
        joinedAt: now().toISOString(),
        score: entryScore,
      });
    } catch (err) {
      await this.repo.markQueueEntryLeft(dbEntry.id, customerId);
      throw err;
    }

    const position = (await this.redisClient.getPosition(businessId, dbEntry.id)) || 1;
    const avgMinutes = await this.getAverageServiceMinutes(businessId);
    const estimatedWaitMinutes = this.calculateEstimatedWait(position, avgMinutes);
    await this.repo.updateEstimatedWaitMinutes(dbEntry.id, estimatedWaitMinutes);

    events.publish('queue.joined', {
      businessId,
      entryId: dbEntry.id,
      customerId,
      ticketNumber,
      position,
    });

    await this.broadcastQueueState(businessId);
    await this.updateWaitingPositions(businessId);

    return {
      ticketNumber,
      position,
      estimatedWaitMinutes,
    };
  }

  /**
   * Customer: Leave Queue
   */
  async leaveQueue(businessId: string, customerId: string) {
    const entry = await this.repo.findActiveEntryByCustomer(customerId);
    if (!entry || entry.business_id !== businessId || entry.status !== 'waiting') {
      throw ApiError.notFound('No active waiting entry found for this queue', 'NOT_IN_QUEUE');
    }

    await this.repo.markQueueEntryLeft(entry.id, customerId);
    await this.redisClient.removeEntry(businessId, entry.id, customerId);

    events.publish('queue.left', {
      businessId,
      entryId: entry.id,
      customerId,
    });

    emitQueueRemoved(customerId, { businessId, status: 'left' });
    await this.broadcastQueueState(businessId);
    await this.updateWaitingPositions(businessId);

    return { success: true, message: 'Successfully left the queue' };
  }

  /**
   * Customer: Get my active queue entry across all businesses
   */
  async getMyActiveEntry(customerId: string): Promise<CustomerQueuePosition & { businessId: string; businessName: string }> {
    const entry = await this.repo.findActiveEntryByCustomer(customerId);
    if (!entry) {
      throw ApiError.notFound('No active queue entry found', 'NOT_IN_QUEUE');
    }

    let position = 0;
    let peopleAhead = 0;
    let waitMinutes = 0;

    if (entry.status === 'waiting') {
      const pos = await this.redisClient.getPosition(entry.business_id, entry.id);
      position = pos || 1;
      peopleAhead = Math.max(0, position - 1);
      const avg = await this.getAverageServiceMinutes(entry.business_id);
      waitMinutes = this.calculateEstimatedWait(position, avg);
    }

    return {
      ticketNumber: entry.ticket_number,
      position,
      peopleAhead,
      estimatedWaitMinutes: waitMinutes,
      status: entry.status,
      businessId: entry.business_id,
      businessName: entry.business_name,
    };
  }

  /**
   * Customer: Get position in specific business queue
   */
  async getCustomerPosition(businessId: string, customerId: string): Promise<CustomerQueuePosition> {
    const entry = await this.repo.findActiveEntryByCustomer(customerId);
    if (!entry || entry.business_id !== businessId) {
      throw ApiError.notFound('You are not currently in this queue', 'NOT_IN_QUEUE');
    }

    let position = 0;
    let peopleAhead = 0;
    let waitMinutes = 0;

    if (entry.status === 'waiting') {
      const pos = await this.redisClient.getPosition(businessId, entry.id);
      position = pos || 1;
      peopleAhead = Math.max(0, position - 1);
      const avg = await this.getAverageServiceMinutes(businessId);
      waitMinutes = this.calculateEstimatedWait(position, avg);
    }

    return {
      ticketNumber: entry.ticket_number,
      position,
      peopleAhead,
      estimatedWaitMinutes: waitMinutes,
      status: entry.status,
    };
  }

  /**
   * Public: Get public queue status (no customer names/IDs)
   */
  async getPublicStatus(businessId: string): Promise<PublicQueueStatus> {
    const biz = await this.repo.findBusinessById(businessId);
    if (!biz) {
      throw ApiError.notFound('Business not found', 'BUSINESS_NOT_FOUND');
    }

    const waitingCount = await this.redisClient.getWaitingCount(businessId);
    const current = await this.redisClient.getCurrent(businessId);
    const avgMinutes = await this.getAverageServiceMinutes(businessId);
    const estimatedWaitMinutesForNewJoiner = this.calculateEstimatedWait(waitingCount + 1, avgMinutes);

    return {
      isOpen: biz.queue_open,
      waitingCount,
      nowServing: current ? current.ticketNumber : null,
      estimatedWaitMinutesForNewJoiner,
    };
  }

  /**
   * Owner: Call next customer in queue atomically
   */
  async callNext(businessId: string, ownerId: string, userRole: string) {
    await this.assertBusinessOwner(businessId, ownerId, userRole);

    // Atomically pop next from Redis Lua script
    const result = await this.redisClient.popNext(businessId);
    if (!result || !result.next) {
      throw ApiError.conflict('Queue is empty', 'QUEUE_EMPTY');
    }

    const currentTime = now();

    // 1. If previous customer existed, complete in DB
    if (result.prev) {
      await this.repo.markQueueEntryCompleted(result.prev.id, currentTime);
      if (result.prev.customerId) {
        emitQueueRemoved(result.prev.customerId, { businessId, status: 'completed' });
      }
    }

    // 2. Mark popped customer called in DB
    await this.repo.markQueueEntryCalled(result.next.id, currentTime);
    if (result.next.customerId) {
      emitQueueCalled(result.next.customerId, {
        businessId,
        ticketNumber: result.next.ticketNumber,
      });
    }

    // 3. Prepare upcoming list for events.publish: "queue.advanced"
    const waiting = await this.redisClient.getWaitingEntries(businessId);
    const upcoming = waiting
      .slice(0, config.QUEUE_NOTIFY_POSITION)
      .map((w, idx) => ({ customerId: w.customerId, position: idx + 1 }))
      .filter((u): u is { customerId: string; position: number } => u.customerId !== null);

    events.publish('queue.advanced', {
      businessId,
      calledEntryId: result.next.id,
      calledCustomerId: result.next.customerId,
      upcoming,
    });

    await this.broadcastQueueState(businessId);
    await this.updateWaitingPositions(businessId);

    return {
      current: {
        id: result.next.id,
        ticketNumber: result.next.ticketNumber,
        name: result.next.walkInName || result.next.customerName || 'Customer',
        source: result.next.source,
        calledAt: currentTime.toISOString(),
        customerId: result.next.customerId,
      },
    };
  }

  /**
   * Owner: Complete current entry without calling next
   */
  async completeCurrent(businessId: string, ownerId: string, userRole: string) {
    await this.assertBusinessOwner(businessId, ownerId, userRole);

    const current = await this.redisClient.completeCurrent(businessId);
    if (!current) {
      throw ApiError.conflict('No customer is currently being served', 'NO_CURRENT_ENTRY');
    }

    const currentTime = now();
    await this.repo.markQueueEntryCompleted(current.id, currentTime);

    if (current.customerId) {
      emitQueueRemoved(current.customerId, { businessId, status: 'completed' });
    }

    await this.broadcastQueueState(businessId);

    return { success: true, message: 'Current entry completed' };
  }

  /**
   * Owner: Skip current customer (optional requeue at the end)
   */
  async skipCurrent(businessId: string, ownerId: string, userRole: string, requeue: boolean = false) {
    await this.assertBusinessOwner(businessId, ownerId, userRole);

    const current = await this.redisClient.skipCurrent(businessId);
    if (!current) {
      throw ApiError.conflict('No customer is currently being served', 'NO_CURRENT_ENTRY');
    }

    const currentTime = now();
    await this.repo.markQueueEntrySkipped(current.id, currentTime);

    if (current.customerId) {
      emitQueueRemoved(current.customerId, { businessId, status: 'skipped' });
    }

    if (requeue) {
      // Re-queue at the END with score = now
      const newScore = currentTime.getTime();
      const newDbEntry = await this.repo.createQueueEntry({
        businessId,
        customerId: current.customerId,
        walkInName: current.walkInName,
        ticketNumber: current.ticketNumber,
        source: current.source,
        score: newScore,
        joinedAt: currentTime,
        status: 'waiting',
      });

      await this.redisClient.addEntry(businessId, {
        id: newDbEntry.id,
        businessId,
        customerId: current.customerId,
        customerName: current.customerName,
        walkInName: current.walkInName,
        ticketNumber: current.ticketNumber,
        source: current.source,
        joinedAt: currentTime.toISOString(),
        score: newScore,
      });

      if (current.customerId) {
        const position = (await this.redisClient.getPosition(businessId, newDbEntry.id)) || 1;
        const avgMinutes = await this.getAverageServiceMinutes(businessId);
        const wait = this.calculateEstimatedWait(position, avgMinutes);

        emitQueuePosition(current.customerId, {
          ticketNumber: current.ticketNumber,
          position,
          peopleAhead: Math.max(0, position - 1),
          estimatedWaitMinutes: wait,
          status: 'waiting',
          businessId,
        });
      }
    }

    await this.broadcastQueueState(businessId);
    await this.updateWaitingPositions(businessId);

    return { success: true, requeued: requeue };
  }

  /**
   * Owner: Add walk-in customer directly
   */
  async addWalkIn(businessId: string, ownerId: string, userRole: string, name: string) {
    await this.assertBusinessOwner(businessId, ownerId, userRole);

    const kolkataNow = DateTime.fromJSDate(now(), { zone: config.BUSINESS_TIMEZONE });
    const dateKey = kolkataNow.toFormat('yyyy-MM-dd');
    const ticketNumber = await this.redisClient.getNextTicketNumber(businessId, dateKey);

    const currentTime = now();
    const entryScore = currentTime.getTime();

    const dbEntry = await this.repo.createQueueEntry({
      businessId,
      customerId: null,
      walkInName: name,
      ticketNumber,
      source: 'walk_in',
      score: entryScore,
      joinedAt: currentTime,
      status: 'waiting',
    });

    await this.redisClient.addEntry(businessId, {
      id: dbEntry.id,
      businessId,
      customerId: null,
      walkInName: name,
      ticketNumber,
      source: 'walk_in',
      joinedAt: currentTime.toISOString(),
      score: entryScore,
    });

    const position = (await this.redisClient.getPosition(businessId, dbEntry.id)) || 1;
    const avgMinutes = await this.getAverageServiceMinutes(businessId);
    const estimatedWaitMinutes = this.calculateEstimatedWait(position, avgMinutes);
    await this.repo.updateEstimatedWaitMinutes(dbEntry.id, estimatedWaitMinutes);

    await this.broadcastQueueState(businessId);

    return {
      ticketNumber,
      position,
      estimatedWaitMinutes,
    };
  }

  /**
   * Owner: Toggle queue_open
   */
  async toggleQueueOpen(businessId: string, ownerId: string, userRole: string, open: boolean) {
    await this.assertBusinessOwner(businessId, ownerId, userRole);
    await this.repo.updateBusinessQueueOpen(businessId, open);

    await this.broadcastQueueState(businessId);

    return { queue_open: open };
  }

  /**
   * Owner: Get full queue details
   */
  async getOwnerQueue(businessId: string, ownerId: string): Promise<OwnerQueueDetails> {
    await this.assertBusinessOwner(businessId, ownerId, 'owner');
    return this.getOwnerQueueInternal(businessId);
  }

  private async getOwnerQueueInternal(businessId: string): Promise<OwnerQueueDetails> {
    const current = await this.redisClient.getCurrent(businessId);
    const waitingEntries = await this.redisClient.getWaitingEntries(businessId);

    const startOfDay = DateTime.fromJSDate(now(), { zone: config.BUSINESS_TIMEZONE })
      .startOf('day')
      .toJSDate();
    const counts = await this.repo.getOwnerQueueCounts(businessId, startOfDay);

    return {
      current: current
        ? {
            id: current.id,
            ticketNumber: current.ticketNumber,
            name: current.walkInName || current.customerName || 'Customer',
            source: current.source,
            calledAt: current.joinedAt, // or called time
            customerId: current.customerId,
          }
        : null,
      waiting: waitingEntries.map((w) => ({
        id: w.id,
        ticketNumber: w.ticketNumber,
        name: w.walkInName || w.customerName || 'Customer',
        source: w.source,
        waitingSince: w.joinedAt,
        score: w.score,
        customerId: w.customerId,
      })),
      servedToday: counts.servedToday,
      waitingCount: waitingEntries.length,
      skippedToday: counts.skippedToday,
    };
  }

  /**
   * Startup / Recovery: Rebuild Redis queues from PostgreSQL waiting rows
   */
  async rebuildQueues(): Promise<void> {
    logger.info('🔄 Rebuilding Redis live queues from PostgreSQL queue_history...');
    const waitingRows = await this.repo.getAllWaitingEntries();

    // Group by business
    const businessMap = new Map<string, typeof waitingRows>();
    for (const row of waitingRows) {
      if (!businessMap.has(row.business_id)) {
        businessMap.set(row.business_id, []);
      }
      businessMap.get(row.business_id)!.push(row);
    }

    for (const [businessId, rows] of businessMap.entries()) {
      await this.redisClient.clearBusinessQueue(businessId);

      // Re-add in score order
      for (const row of rows) {
        const entry: IQueueEntryRedis = {
          id: row.id,
          businessId: row.business_id,
          customerId: row.customer_id,
          customerName: row.customer_name || null,
          walkInName: row.walk_in_name,
          ticketNumber: row.ticket_number,
          source: row.source,
          appointmentId: row.appointment_id,
          joinedAt: row.joined_at.toISOString(),
          score: Number(row.score),
        };
        await this.redisClient.addEntry(businessId, entry);
      }

      // Check active called entry
      const called = await this.repo.getActiveCalledEntry(businessId);
      if (called) {
        const calledEntry: IQueueEntryRedis = {
          id: called.id,
          businessId: called.business_id,
          customerId: called.customer_id,
          customerName: called.customer_name || null,
          walkInName: called.walk_in_name,
          ticketNumber: called.ticket_number,
          source: called.source,
          appointmentId: called.appointment_id,
          joinedAt: called.joined_at.toISOString(),
          score: Number(called.score),
        };
        await this.redisClient.redis.set(
          this.redisClient.getCurrentKey(businessId),
          JSON.stringify(calledEntry)
        );
      }
    }

    logger.info(`✅ Rebuilt ${businessMap.size} queues with ${waitingRows.length} active waiting entries.`);
  }
}

export const queueService = new QueueService();
