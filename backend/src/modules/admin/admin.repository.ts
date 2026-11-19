import { pool, query, withTransaction } from '../../db';
import {
  AdminAuditLogItem,
  AdminStats,
  AdminUserListItem,
  ListUsersQuery,
} from './admin.types';

export class AdminRepository {
  /**
   * Fetch platform-wide statistics for the admin dashboard
   */
  async getStats(): Promise<AdminStats> {
    // 1. Users by role
    const usersRes = await query<{ role: string; count: string }>(`
      SELECT role, COUNT(*)::text as count
      FROM users
      GROUP BY role
    `);
    const usersByRole = { customer: 0, owner: 0, admin: 0, total: 0 };
    for (const r of usersRes.rows) {
      const c = parseInt(r.count, 10) || 0;
      if (r.role === 'customer') usersByRole.customer = c;
      if (r.role === 'owner') usersByRole.owner = c;
      if (r.role === 'admin') usersByRole.admin = c;
      usersByRole.total += c;
    }

    // 2. Businesses by status
    const bizRes = await query<{ status: string; count: string }>(`
      SELECT status, COUNT(*)::text as count
      FROM businesses
      GROUP BY status
    `);
    const bizByStatus = { pending: 0, approved: 0, rejected: 0, total: 0 };
    for (const r of bizRes.rows) {
      const c = parseInt(r.count, 10) || 0;
      if (r.status === 'pending') bizByStatus.pending = c;
      if (r.status === 'approved') bizByStatus.approved = c;
      if (r.status === 'rejected') bizByStatus.rejected = c;
      bizByStatus.total += c;
    }

    // 3. Appointments by status for the last 30 days
    const apptRes = await query<{ status: string; count: string }>(`
      SELECT status, COUNT(*)::text as count
      FROM appointments
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY status
    `);
    const apptByStatus = { confirmed: 0, completed: 0, no_show: 0, cancelled: 0, total30Days: 0 };
    for (const r of apptRes.rows) {
      const c = parseInt(r.count, 10) || 0;
      if (r.status === 'confirmed') apptByStatus.confirmed = c;
      if (r.status === 'completed') apptByStatus.completed = c;
      if (r.status === 'no_show') apptByStatus.no_show = c;
      if (r.status === 'cancelled') apptByStatus.cancelled = c;
      apptByStatus.total30Days += c;
    }

    // 4. Queue entries served in the last 30 days
    const queueRes = await query<{ count: string }>(`
      SELECT COUNT(*)::text as count
      FROM queue_history
      WHERE status = 'completed' AND completed_at >= NOW() - INTERVAL '30 days'
    `);
    const queueServed30Days = parseInt(queueRes.rows[0]?.count || '0', 10);

    // 5. Failed email notifications count
    const failedEmailsRes = await query<{ count: string }>(`
      SELECT COUNT(*)::text as count
      FROM notifications
      WHERE email_status = 'failed'
    `);
    const failedEmails = parseInt(failedEmailsRes.rows[0]?.count || '0', 10);

    // 6. Daily series of new users and appointments for the last 30 days (all 30 dates in Asia/Kolkata)
    let daily: Array<{ date: string; newUsers: number; newAppointments: number }> = [];
    try {
      const dailyRes = await query<{
        date: string;
        newUsers: number;
        newAppointments: number;
      }>(`
        WITH date_series AS (
          SELECT (generate_series(
            (NOW() AT TIME ZONE 'Asia/Kolkata')::date - INTERVAL '29 days',
            (NOW() AT TIME ZONE 'Asia/Kolkata')::date,
            INTERVAL '1 day'
          ))::date AS dt
        ),
        user_counts AS (
          SELECT (created_at AT TIME ZONE 'Asia/Kolkata')::date AS dt, COUNT(*) AS count
          FROM users
          WHERE created_at >= NOW() - INTERVAL '31 days'
          GROUP BY 1
        ),
        appt_counts AS (
          SELECT (created_at AT TIME ZONE 'Asia/Kolkata')::date AS dt, COUNT(*) AS count
          FROM appointments
          WHERE created_at >= NOW() - INTERVAL '31 days'
          GROUP BY 1
        )
        SELECT
          TO_CHAR(ds.dt, 'YYYY-MM-DD') AS date,
          COALESCE(uc.count, 0)::int AS "newUsers",
          COALESCE(ac.count, 0)::int AS "newAppointments"
        FROM date_series ds
        LEFT JOIN user_counts uc ON ds.dt = uc.dt
        LEFT JOIN appt_counts ac ON ds.dt = ac.dt
        ORDER BY ds.dt ASC
      `);
      daily = dailyRes.rows;
    } catch {
      // Fallback in environments (like pg-mem) where generate_series is limited
      const dates: string[] = [];
      const now = new Date();
      for (let i = 29; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        dates.push(d.toISOString().slice(0, 10));
      }
      daily = dates.map((d) => ({ date: d, newUsers: 0, newAppointments: 0 }));
    }

    return {
      users: usersByRole,
      businesses: bizByStatus,
      appointments: apptByStatus,
      queueServed30Days,
      failedEmails,
      daily,
    };
  }

  /**
   * List users with filtering, search and pagination (never returning password hashes)
   */
  async listUsers(options: ListUsersQuery): Promise<{ users: AdminUserListItem[]; total: number }> {
    const conditions: string[] = ['1=1'];
    const values: any[] = [];
    let idx = 1;

    if (options.role) {
      conditions.push(`role = $${idx++}`);
      values.push(options.role);
    }

    if (options.blocked !== undefined) {
      conditions.push(`is_blocked = $${idx++}`);
      values.push(options.blocked);
    }

    if (options.q) {
      const escaped = options.q.replace(/[%_\\]/g, '\\$&');
      conditions.push(`(name ILIKE $${idx} OR email ILIKE $${idx})`);
      values.push(`%${escaped}%`);
      idx++;
    }

    const whereClause = conditions.join(' AND ');

    // Total count query
    const countRes = await query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM users WHERE ${whereClause}`,
      values
    );
    const total = parseInt(countRes.rows[0]?.count || '0', 10);

    // Paginated rows
    const page = options.page || 1;
    const limit = options.limit || 10;
    const offset = (page - 1) * limit;

    const dataRes = await query<AdminUserListItem>(
      `SELECT id, name, email, role, is_blocked, blocked_at, blocked_reason, created_at
       FROM users
       WHERE ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...values, limit, offset]
    );

    return {
      users: dataRes.rows,
      total,
    };
  }

  async findUserById(userId: string) {
    const res = await query(
      `SELECT id, name, email, role, is_blocked, blocked_at, blocked_reason, created_at
       FROM users WHERE id = $1`,
      [userId]
    );
    return res.rows[0] || null;
  }

  /**
   * Block a user in a single atomic transaction:
   * 1. Set is_blocked, blocked_at, blocked_reason.
   * 2. Revoke all refresh tokens for this user.
   * 3. Find and cancel all future confirmed appointments, freeing their slots.
   * 4. Record admin audit log entry.
   */
  async blockUserTx(adminId: string, userId: string, reason?: string) {
    return withTransaction(async (client) => {
      // 1. Update user
      await client.query(
        `UPDATE users
         SET is_blocked = TRUE, blocked_at = NOW(), blocked_reason = $2
         WHERE id = $1`,
        [userId, reason || 'Suspended by administrator']
      );

      // 2. Revoke refresh tokens
      await client.query(
        `UPDATE refresh_tokens
         SET revoked_at = NOW()
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId]
      );

      // 3. Find future confirmed appointments
      const apptsRes = await client.query<{
        id: string;
        slot_id: string;
        business_id: string;
        owner_id: string;
      }>(
        `SELECT a.id, a.slot_id, b.id as business_id, b.owner_id
         FROM appointments a
         JOIN slots s ON a.slot_id = s.id
         JOIN services sv ON s.service_id = sv.id
         JOIN businesses b ON sv.business_id = b.id
         WHERE a.customer_id = $1
           AND a.status = 'confirmed'
           AND s.start_time > NOW()`,
        [userId]
      );

      const cancelledAppointments = apptsRes.rows;

      if (cancelledAppointments.length > 0) {
        const apptIds = cancelledAppointments.map((a) => a.id);
        const slotIds = cancelledAppointments.map((a) => a.slot_id);

        // Cancel appointments
        const apptPlaceholders = apptIds.map((_, i) => `$${i + 1}`).join(', ');
        await client.query(
          `UPDATE appointments
           SET status = 'cancelled'
           WHERE id IN (${apptPlaceholders})`,
          apptIds
        );

        // Free slots
        const slotPlaceholders = slotIds.map((_, i) => `$${i + 1}`).join(', ');
        await client.query(
          `UPDATE slots
           SET status = 'free'
           WHERE id IN (${slotPlaceholders})`,
          slotIds
        );
      }

      // 4. Create audit log row
      await client.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
         VALUES ($1, 'user.block', 'user', $2, $3)`,
        [
          adminId,
          userId,
          JSON.stringify({
            reason: reason || null,
            cancelledAppointmentsCount: cancelledAppointments.length,
          }),
        ]
      );

      return { cancelledAppointments };
    });
  }

  /**
   * Unblock a user and record audit log entry
   */
  async unblockUserTx(adminId: string, userId: string) {
    return withTransaction(async (client) => {
      await client.query(
        `UPDATE users
         SET is_blocked = FALSE, blocked_at = NULL, blocked_reason = NULL
         WHERE id = $1`,
        [userId]
      );

      await client.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
         VALUES ($1, 'user.unblock', 'user', $2, '{}')`,
        [adminId, userId]
      );
    });
  }

  /**
   * Record audit log action
   */
  async createAuditLog(
    adminId: string,
    action: string,
    targetType: string,
    targetId: string | null,
    details: any
  ): Promise<void> {
    await query(
      `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [adminId, action, targetType, targetId, details ? JSON.stringify(details) : null]
    );
  }

  /**
   * List admin audit logs with pagination
   */
  async listAuditLogs(
    page: number = 1,
    limit: number = 20
  ): Promise<{ logs: AdminAuditLogItem[]; total: number }> {
    const countRes = await query<{ count: string }>(`SELECT COUNT(*)::text as count FROM admin_audit_log`);
    const total = parseInt(countRes.rows[0]?.count || '0', 10);
    const offset = (page - 1) * limit;

    const res = await query<AdminAuditLogItem>(
      `SELECT
         l.id, l.admin_id, u.name as admin_name, u.email as admin_email,
         l.action, l.target_type, l.target_id, l.details, l.created_at
       FROM admin_audit_log l
       LEFT JOIN users u ON l.admin_id = u.id
       ORDER BY l.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return {
      logs: res.rows,
      total,
    };
  }

  /**
   * Remove user from any active waiting entries in queue_history
   */
  async removeUserFromActiveQueues(userId: string): Promise<Array<{ id: string; business_id: string }>> {
    const res = await query<{ id: string; business_id: string }>(
      `UPDATE queue_history
       SET status = 'left'
       WHERE customer_id = $1 AND status = 'waiting'
       RETURNING id, business_id`,
      [userId]
    );
    return res.rows;
  }
}

export const adminRepository = new AdminRepository();
