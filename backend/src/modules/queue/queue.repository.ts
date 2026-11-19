import { query } from '../../db';
import { IQueueHistory, QueueEntrySource, QueueEntryStatus } from './queue.types';

export class QueueRepository {
  private query = query;

  async findBusinessById(businessId: string) {
    const res = await this.query(
      `SELECT id, owner_id, name, status, queue_open
       FROM businesses
       WHERE id = $1`,
      [businessId]
    );
    return res.rows[0] || null;
  }

  async findWorkingHoursForDay(businessId: string, dayOfWeek: number) {
    const res = await this.query(
      `SELECT open_time, close_time
       FROM working_hours
       WHERE business_id = $1 AND day_of_week = $2`,
      [businessId, dayOfWeek]
    );
    return res.rows[0] || null;
  }

  async findActiveEntryByCustomer(customerId: string) {
    const res = await this.query(
      `SELECT q.*, b.name as business_name
       FROM queue_history q
       JOIN businesses b ON q.business_id = b.id
       WHERE q.customer_id = $1 AND q.status IN ('waiting', 'called')
       LIMIT 1`,
      [customerId]
    );
    return res.rows[0] || null;
  }

  async findAppointmentForCheckIn(appointmentId: string) {
    const res = await this.query(
      `SELECT a.id, a.customer_id, a.status, a.slot_id,
              s.start_time, s.end_time, sv.business_id
       FROM appointments a
       JOIN slots s ON a.slot_id = s.id
       JOIN services sv ON s.service_id = sv.id
       WHERE a.id = $1`,
      [appointmentId]
    );
    return res.rows[0] || null;
  }

  async createQueueEntry(data: {
    businessId: string;
    customerId: string | null;
    walkInName?: string | null;
    ticketNumber: number;
    source: QueueEntrySource;
    appointmentId?: string | null;
    score: number;
    joinedAt: Date;
    status?: QueueEntryStatus;
  }): Promise<IQueueHistory> {
    const res = await this.query(
      `INSERT INTO queue_history (
         business_id, customer_id, walk_in_name, ticket_number,
         source, appointment_id, score, joined_at, status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        data.businessId,
        data.customerId || null,
        data.walkInName || null,
        data.ticketNumber,
        data.source,
        data.appointmentId || null,
        data.score,
        data.joinedAt,
        data.status || 'waiting',
      ]
    );
    return res.rows[0];
  }

  async markQueueEntryLeft(entryId: string, customerId: string): Promise<boolean> {
    const res = await this.query(
      `UPDATE queue_history
       SET status = 'left'
       WHERE id = $1 AND customer_id = $2 AND status = 'waiting'
       RETURNING id`,
      [entryId, customerId]
    );
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

  async updateBusinessQueueOpen(businessId: string, open: boolean): Promise<boolean> {
    const res = await this.query(
      `UPDATE businesses
       SET queue_open = $2
       WHERE id = $1
       RETURNING id`,
      [businessId, open]
    );
    return (res.rowCount ?? 0) > 0;
  }

  async getAllWaitingEntries(): Promise<(IQueueHistory & { customer_name?: string })[]> {
    const res = await this.query(
      `SELECT q.*, u.name as customer_name
       FROM queue_history q
       LEFT JOIN users u ON q.customer_id = u.id
       WHERE q.status = 'waiting'
       ORDER BY q.score ASC`
    );
    return res.rows;
  }

  async getActiveCalledEntry(businessId: string): Promise<(IQueueHistory & { customer_name?: string }) | null> {
    const res = await this.query(
      `SELECT q.*, u.name as customer_name
       FROM queue_history q
       LEFT JOIN users u ON q.customer_id = u.id
       WHERE q.business_id = $1 AND q.status = 'called' AND q.completed_at IS NULL
       ORDER BY q.called_at DESC
       LIMIT 1`,
      [businessId]
    );
    return res.rows[0] || null;
  }

  async findCustomerName(customerId: string): Promise<string | null> {
    const res = await this.query(
      `SELECT name FROM users WHERE id = $1`,
      [customerId]
    );
    return res.rows[0]?.name || null;
  }
}

export const queueRepository = new QueueRepository();
