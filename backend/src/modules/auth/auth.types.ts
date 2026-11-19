export type UserRole = 'customer' | 'owner' | 'admin';

export interface IUser {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: UserRole;
  is_blocked?: boolean;
  blocked_at?: Date | null;
  blocked_reason?: string | null;
  created_at: Date;
}

export interface IUserResponse {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  is_blocked?: boolean;
  blocked_at?: Date | null;
  blocked_reason?: string | null;
  created_at: Date;
}

export interface IRefreshToken {
  id: string;
  user_id: string;
  token_hash: string;
  family_id: string;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResult {
  user: IUserResponse;
  tokens: AuthTokens;
}

export interface JwtPayload {
  sub: string;
  role: UserRole;
}
