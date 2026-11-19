import { PoolClient } from 'pg';
import { query, withTransaction } from '../../db';
import { INotification, EmailDeliveryStatus, NotificationStatus } from './notification.types';

export class NotificationRepository {
  private query = query;

  async createNotification(data: {
    userId: string;
    type: string;
    title: string;
    message: string;
    data?: any;
    dedupeKey: string;
    emailStatus?: EmailDeliveryStatus;
  }): Promise<INotification | null> {
    if (data.dedupeKey) {
      const existing = await this.query(
        `SELECT id FROM notifications WHERE dedupe_key = $1`,
        [data.dedupeKey]
      );
      if (existing.rows.length > 0) {
        return null;
      }
    }

    const res = await this.query<INotification>(
      `INSERT INTO notifications (
         user_id, type, title, message, data, dedupe_key, email_status, status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'unread')
       ON CONFLICT (dedupe_key) DO NOTHING
       RETURNING *`,
      [
        data.userId,
        data.type,
        data.title,
        data.message,
        data.data ? JSON.stringify(data.data) : null,
        data.dedupeKey,
        data.emailStatus || 'not_required',
      ]
    );

    return res.rows[0] || null;
  }

  async updateEmailStatus(
    id: string,
    emailStatus: EmailDeliveryStatus,
    attempts: number,
    lastError: string | null = null
  ): Promise<void> {
    await this.query(
      `UPDATE notifications
       SET email_status = $2, email_attempts = $3, last_error = $4
       WHERE id = $1`,
      [id, emailStatus, attempts, lastError]
    );
  }

  async getUserNotifications(
    userId: string,
    options: { status?: NotificationStatus; page?: number; limit?: number } = {}
  ): Promise<{ data: INotification[]; total: number; unreadCount: number }> {
    const page = Math.max(1, options.page || 1);
    const limit = Math.min(50, Math.max(1, options.limit || 10));
    const offset = (page - 1) * limit;

    const countParams: any[] = [userId];
    let countSql = `SELECT COUNT(*) FROM notifications WHERE user_id = $1`;
    if (options.status) {
      countParams.push(options.status);
      countSql += ` AND status = $2`;
    }

    const dataParams: any[] = [userId];
    let dataSql = `SELECT * FROM notifications WHERE user_id = $1`;
    if (options.status) {
      dataParams.push(options.status);
      dataSql += ` AND status = $2`;
    }
    dataSql += ` ORDER BY created_at DESC LIMIT $${dataParams.length + 1} OFFSET $${dataParams.length + 2}`;
    dataParams.push(limit, offset);

    const [countRes, dataRes, unreadRes] = await Promise.all([
      this.query(countSql, countParams),
      this.query<INotification>(dataSql, dataParams),
      this.query(
        `SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND status = 'unread'`,
        [userId]
      ),
    ]);

    return {
      data: dataRes.rows,
      total: Number(countRes.rows[0]?.count || 0),
      unreadCount: Number(unreadRes.rows[0]?.count || 0),
    };
  }

  async markAsRead(id: string, userId: string, readAt: Date): Promise<INotification | null> {
    const res = await this.query<INotification>(
      `UPDATE notifications
       SET status = 'read', read_at = $3
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [id, userId, readAt]
    );
    return res.rows[0] || null;
  }

  async markAllAsRead(userId: string, readAt: Date): Promise<number> {
    const res = await this.query(
      `UPDATE notifications
       SET status = 'read', read_at = $2
       WHERE user_id = $1 AND status = 'unread'
       RETURNING id`,
      [userId, readAt]
    );
    return res.rowCount ?? 0;
  }

  async getAdminFailedNotifications(
    options: { page?: number; limit?: number } = {}
  ): Promise<{ data: any[]; total: number }> {
    const page = Math.max(1, options.page || 1);
    const limit = Math.min(50, Math.max(1, options.limit || 10));
    const offset = (page - 1) * limit;

    const countRes = await this.query(
      `SELECT COUNT(*) FROM notifications WHERE email_status = 'failed'`
    );

    const dataRes = await this.query(
      `SELECT n.*, u.name as user_name, u.email as user_email
       FROM notifications n
       JOIN users u ON n.user_id = u.id
       WHERE n.email_status = 'failed'
       ORDER BY n.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return {
      data: dataRes.rows,
      total: Number(countRes.rows[0]?.count || 0),
    };
  }

  /**
   * Find and lock appointments due for reminder using SELECT ... FOR UPDATE SKIP LOCKED
   */
  async claimAppointmentsDueForReminder(
    windowStart: Date,
    windowEnd: Date,
    claimedAt: Date
  ): Promise<any[]> {
    return withTransaction(async (client: PoolClient) => {
      let res;
      try {
        res = await client.query(
          `SELECT a.id, a.customer_id, a.slot_id, s.start_time,
                  sv.name as service_name, b.name as business_name,
                  u.name as customer_name, u.email as customer_email
           FROM appointments a
           JOIN slots s ON a.slot_id = s.id
           JOIN services sv ON s.service_id = sv.id
           JOIN businesses b ON sv.business_id = b.id
           JOIN users u ON a.customer_id = u.id
           WHERE a.status = 'confirmed'
             AND a.reminder_sent_at IS NULL
             AND s.start_time > $1
             AND s.start_time <= $2
           FOR UPDATE SKIP LOCKED`,
          [windowStart, windowEnd]
        );
      } catch (err: any) {
        // Fallback for pg-mem in tests where SKIP LOCKED AST is not supported
        if (err?.message && (err.message.includes('skip locked') || err.message.includes('Not supported'))) {
          res = await client.query(
            `SELECT a.id, a.customer_id, a.slot_id, s.start_time,
                    sv.name as service_name, b.name as business_name,
                    u.name as customer_name, u.email as customer_email
             FROM appointments a
             JOIN slots s ON a.slot_id = s.id
             JOIN services sv ON s.service_id = sv.id
             JOIN businesses b ON sv.business_id = b.id
             JOIN users u ON a.customer_id = u.id
             WHERE a.status = 'confirmed'
               AND a.reminder_sent_at IS NULL
               AND s.start_time > $1
               AND s.start_time <= $2
             FOR UPDATE`,
            [windowStart, windowEnd]
          );
        } else {
          throw err;
        }
      }

      const appointments = res.rows;
      if (appointments.length === 0) {
        return [];
      }

      const ids = appointments.map((a) => a.id);
      const placeholders = ids.map((_, i) => `$${i + 2}`).join(', ');
      await client.query(
        `UPDATE appointments
         SET reminder_sent_at = $1
         WHERE id IN (${placeholders})`,
        [claimedAt, ...ids]
      );

      return appointments;
    });
  }

  async getUser(userId: string) {
    const res = await this.query(
      `SELECT id, name, email, role FROM users WHERE id = $1`,
      [userId]
    );
    return res.rows[0] || null;
  }

  async getAppointmentDetails(appointmentId: string) {
    const res = await this.query(
      `SELECT a.id, a.customer_id, a.status,
              s.start_time, s.end_time,
              sv.name as service_name,
              b.id as business_id, b.name as business_name, b.owner_id,
              u.name as customer_name, u.email as customer_email,
              o.name as owner_name, o.email as owner_email
       FROM appointments a
       JOIN slots s ON a.slot_id = s.id
       JOIN services sv ON s.service_id = sv.id
       JOIN businesses b ON sv.business_id = b.id
       JOIN users u ON a.customer_id = u.id
       JOIN users o ON b.owner_id = o.id
       WHERE a.id = $1`,
      [appointmentId]
    );
    return res.rows[0] || null;
  }

  async getBusinessDetails(businessId: string) {
    const res = await this.query(
      `SELECT b.id, b.name, b.status, b.owner_id,
              o.name as owner_name, o.email as owner_email
       FROM businesses b
       JOIN users o ON b.owner_id = o.id
       WHERE b.id = $1`,
      [businessId]
    );
    return res.rows[0] || null;
  }

  async getQueueEntry(entryId: string) {
    if (!entryId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entryId)) {
      return null;
    }
    try {
      const res = await this.query(
        `SELECT id, ticket_number, customer_id, business_id FROM queue_history WHERE id = $1`,
        [entryId]
      );
      return res.rows[0] || null;
    } catch {
      return null;
    }
  }
}

export const notificationRepository = new NotificationRepository();
