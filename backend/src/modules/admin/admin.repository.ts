import { query, withTransaction } from '../../db';
import {
  AdminAuditLogItem,
  AdminUserListItem,
  ListUsersQuery,
} from './admin.types';

export class AdminRepository {
  /**
   * List users with search, role filters, blocked status, and pagination
   */
  async listUsers(options: ListUsersQuery): Promise<{
    users: AdminUserListItem[];
    total: number;
  }> {
    const conditions: string[] = [];
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

    const whereClause = conditions.length > 0 ? conditions.join(' AND ') : 'TRUE';

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
   * Block a user and record audit log entry
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

      // 3. Create audit log row
      await client.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
         VALUES ($1, 'user.block', 'user', $2, $3)`,
        [
          adminId,
          userId,
          JSON.stringify({
            reason: reason || null,
          }),
        ]
      );
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
}

export const adminRepository = new AdminRepository();
