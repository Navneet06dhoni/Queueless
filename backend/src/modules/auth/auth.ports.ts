import { PoolClient } from 'pg';
import { query } from '../../db';

export interface UserPort {
  getUserBasic(userId: string, client?: PoolClient): Promise<{
    id: string;
    name: string;
    email: string;
    role: string;
    is_blocked: boolean;
    blocked_at: string | null;
    blocked_reason: string | null;
    created_at: string;
  } | null>;

  getUserStats(): Promise<{
    usersByRole: {
      customer: number;
      owner: number;
      admin: number;
      total: number;
    };
    dailyUsers: Array<{ date: string; newUsers: number }>;
  }>;

  revokeUserTokens(userId: string, client?: PoolClient): Promise<void>;

  blockUser(userId: string, reason?: string, client?: PoolClient): Promise<void>;
}

export class UserPortImpl implements UserPort {
  async getUserBasic(userId: string, client?: PoolClient) {
    const sql = `SELECT id, name, email, role, is_blocked, blocked_at, blocked_reason, created_at
                 FROM users WHERE id = $1`;
    const res = client
      ? await client.query<{
          id: string;
          name: string;
          email: string;
          role: string;
          is_blocked: boolean;
          blocked_at: string | null;
          blocked_reason: string | null;
          created_at: string;
        }>(sql, [userId])
      : await query<{
          id: string;
          name: string;
          email: string;
          role: string;
          is_blocked: boolean;
          blocked_at: string | null;
          blocked_reason: string | null;
          created_at: string;
        }>(sql, [userId]);

    return res.rows[0] || null;
  }

  async getUserStats() {
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

    let dailyUsers: Array<{ date: string; newUsers: number }> = [];
    try {
      const dailyRes = await query<{ date: string; newUsers: number }>(`
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
        )
        SELECT
          TO_CHAR(ds.dt, 'YYYY-MM-DD') AS date,
          COALESCE(uc.count, 0)::int AS "newUsers"
        FROM date_series ds
        LEFT JOIN user_counts uc ON ds.dt = uc.dt
        ORDER BY ds.dt ASC
      `);
      dailyUsers = dailyRes.rows;
    } catch {
      dailyUsers = [];
    }

    return { usersByRole, dailyUsers };
  }

  async revokeUserTokens(userId: string, client?: PoolClient): Promise<void> {
    const q = (sql: string, params: any[]) => (client ? client.query(sql, params) : query(sql, params));
    await q(
      `UPDATE refresh_tokens
       SET revoked_at = NOW()
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId]
    );
  }

  async blockUser(userId: string, reason?: string, client?: PoolClient): Promise<void> {
    const q = (sql: string, params: any[]) => (client ? client.query(sql, params) : query(sql, params));
    await q(
      `UPDATE users
       SET is_blocked = TRUE, blocked_at = NOW(), blocked_reason = $2
       WHERE id = $1`,
      [userId, reason || 'Suspended by administrator']
    );
  }
}

export const userPort: UserPort = new UserPortImpl();
