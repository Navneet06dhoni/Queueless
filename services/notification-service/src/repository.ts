import { PoolClient } from 'pg';
import { pool, query } from './db';
import { INotification, EmailDeliveryStatus, NotificationStatus } from './types';

export class NotificationRepository {
  async createNotification(
    data: {
      userId: string;
      type: string;
      title: string;
      message: string;
      data?: any;
      dedupeKey: string;
      emailStatus?: EmailDeliveryStatus;
    },
    client?: PoolClient
  ): Promise<INotification | null> {
    const executor = client || { query: (q: string, p?: any[]) => pool.query(q, p) };

    if (data.dedupeKey) {
      const existing = await executor.query(
        `SELECT id FROM notifications WHERE dedupe_key = $1`,
        [data.dedupeKey]
      );
      if (existing.rows.length > 0) {
        return null;
      }
    }

    const res = await executor.query<INotification>(
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
    lastError: string | null = null,
    client?: PoolClient
  ): Promise<void> {
    const executor = client || { query: (q: string, p?: any[]) => pool.query(q, p) };
    await executor.query(
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
      query(countSql, countParams),
      query<INotification>(dataSql, dataParams),
      query(`SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND status = 'unread'`, [userId]),
    ]);

    return {
      data: dataRes.rows,
      total: Number(countRes.rows[0]?.count || 0),
      unreadCount: Number(unreadRes.rows[0]?.count || 0),
    };
  }

  async markAsRead(id: string, userId: string, readAt: Date): Promise<INotification | null> {
    const res = await query<INotification>(
      `UPDATE notifications
       SET status = 'read', read_at = $3
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [id, userId, readAt]
    );
    return res.rows[0] || null;
  }

  async markAllAsRead(userId: string, readAt: Date): Promise<number> {
    const res = await query(
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

    const countRes = await query(`SELECT COUNT(*) FROM notifications WHERE email_status = 'failed'`);
    const dataRes = await query(
      `SELECT n.*
       FROM notifications n
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
}

export const notificationRepository = new NotificationRepository();
