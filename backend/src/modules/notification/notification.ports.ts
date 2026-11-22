import { query } from '../../db';

export interface NotificationPort {
  getNotificationStats(): Promise<{ failedEmails: number }>;
}

export class NotificationPortImpl implements NotificationPort {
  async getNotificationStats(): Promise<{ failedEmails: number }> {
    const res = await query<{ count: string }>(`
      SELECT COUNT(*)::text as count
      FROM notifications
      WHERE email_status = 'failed'
    `);
    return { failedEmails: parseInt(res.rows[0]?.count || '0', 10) };
  }
}

export const notificationPort: NotificationPort = new NotificationPortImpl();
