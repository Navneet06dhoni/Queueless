import { query } from '../../db';
import { IUser, IRefreshToken } from './auth.types';

export class AuthRepository {
  async findUserByEmail(email: string): Promise<IUser | null> {
    const res = await query<IUser>(
      'SELECT id, name, email, password_hash, role, is_blocked, blocked_at, blocked_reason, created_at FROM users WHERE email = $1',
      [email]
    );
    return res.rows[0] || null;
  }

  async findUserById(id: string): Promise<IUser | null> {
    const res = await query<IUser>(
      'SELECT id, name, email, password_hash, role, is_blocked, blocked_at, blocked_reason, created_at FROM users WHERE id = $1',
      [id]
    );
    return res.rows[0] || null;
  }

  async createUser(data: {
    name: string;
    email: string;
    password_hash: string;
    role: string;
  }): Promise<IUser> {
    const res = await query<IUser>(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, password_hash, role, is_blocked, blocked_at, blocked_reason, created_at`,
      [data.name, data.email, data.password_hash, data.role]
    );
    return res.rows[0];
  }

  async createRefreshToken(data: {
    user_id: string;
    token_hash: string;
    family_id: string;
    expires_at: Date;
  }): Promise<IRefreshToken> {
    const res = await query<IRefreshToken>(
      `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, token_hash, family_id, expires_at, revoked_at, created_at`,
      [data.user_id, data.token_hash, data.family_id, data.expires_at]
    );
    return res.rows[0];
  }

  async findRefreshTokenByHash(token_hash: string): Promise<IRefreshToken | null> {
    const res = await query<IRefreshToken>(
      `SELECT id, user_id, token_hash, family_id, expires_at, revoked_at, created_at
       FROM refresh_tokens
       WHERE token_hash = $1`,
      [token_hash]
    );
    return res.rows[0] || null;
  }

  async revokeRefreshToken(id: string): Promise<void> {
    await query(
      'UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE id = $1',
      [id]
    );
  }

  async revokeFamily(family_id: string): Promise<void> {
    await query(
      'UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE family_id = $1 AND revoked_at IS NULL',
      [family_id]
    );
  }

  async revokeAllUserTokens(user_id: string): Promise<void> {
    await query(
      'UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND revoked_at IS NULL',
      [user_id]
    );
  }
}

export const authRepository = new AuthRepository();
export default authRepository;
