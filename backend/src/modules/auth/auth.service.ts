import crypto from 'crypto';
import { ApiError } from '../../utils/ApiError';
import { authRepository, AuthRepository } from './auth.repository';
import {
  hashPassword,
  comparePassword,
  generateAccessToken,
  generateRefreshToken,
  hashToken,
  sanitizeUser,
} from './auth.utils';
import { AuthResult, IUserResponse } from './auth.types';
import { RegisterInput, LoginInput } from './auth.validation';

const REFRESH_TOKEN_EXPIRY_DAYS = 7;

export class AuthService {
  constructor(private repo: AuthRepository = authRepository) {}

  async register(input: RegisterInput): Promise<AuthResult> {
    if ((input.role as string) === 'admin') {
      throw ApiError.badRequest('Admin role cannot be self-registered', 'FORBIDDEN_ROLE');
    }

    const normalizedEmail = input.email.toLowerCase().trim();

    const existingUser = await this.repo.findUserByEmail(normalizedEmail);
    if (existingUser) {
      throw ApiError.conflict('An account with this email already exists', 'EMAIL_ALREADY_EXISTS');
    }

    const passwordHash = await hashPassword(input.password);

    const user = await this.repo.createUser({
      name: input.name.trim(),
      email: normalizedEmail,
      password_hash: passwordHash,
      role: input.role,
    });

    const accessToken = generateAccessToken(user);
    const rawRefreshToken = generateRefreshToken();
    const tokenHash = hashToken(rawRefreshToken);
    const familyId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    await this.repo.createRefreshToken({
      user_id: user.id,
      token_hash: tokenHash,
      family_id: familyId,
      expires_at: expiresAt,
    });

    return {
      user: sanitizeUser(user),
      tokens: {
        accessToken,
        refreshToken: rawRefreshToken,
      },
    };
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const normalizedEmail = input.email.toLowerCase().trim();
    const user = await this.repo.findUserByEmail(normalizedEmail);

    // Generic error to prevent account enumeration
    if (!user) {
      throw ApiError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
    }

    const isPasswordValid = await comparePassword(input.password, user.password_hash);
    if (!isPasswordValid) {
      throw ApiError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
    }

    const accessToken = generateAccessToken(user);
    const rawRefreshToken = generateRefreshToken();
    const tokenHash = hashToken(rawRefreshToken);
    const familyId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    await this.repo.createRefreshToken({
      user_id: user.id,
      token_hash: tokenHash,
      family_id: familyId,
      expires_at: expiresAt,
    });

    return {
      user: sanitizeUser(user),
      tokens: {
        accessToken,
        refreshToken: rawRefreshToken,
      },
    };
  }

  async refresh(rawRefreshToken?: string): Promise<AuthResult> {
    if (!rawRefreshToken) {
      throw ApiError.unauthorized('Refresh token is required', 'TOKEN_REQUIRED');
    }

    const tokenHash = hashToken(rawRefreshToken);
    const record = await this.repo.findRefreshTokenByHash(tokenHash);

    if (!record) {
      throw ApiError.unauthorized('Invalid refresh token', 'INVALID_TOKEN');
    }

    // Reuse detection: if already revoked, compromise detected on family!
    if (record.revoked_at !== null) {
      console.warn(`🚨 Compromised refresh token reuse detected! Revoking family: ${record.family_id}`);
      await this.repo.revokeFamily(record.family_id);
      throw ApiError.unauthorized(
        'Revoked refresh token reused. All associated sessions have been revoked',
        'TOKEN_COMPROMISED'
      );
    }

    // Check expiration
    if (new Date(record.expires_at) < new Date()) {
      throw ApiError.unauthorized('Refresh token has expired', 'TOKEN_EXPIRED');
    }

    // Revoke current token before issuing new one
    await this.repo.revokeRefreshToken(record.id);

    // Fetch user to confirm active and get current role
    const user = await this.repo.findUserById(record.user_id);
    if (!user) {
      throw ApiError.unauthorized('User associated with token no longer exists', 'USER_NOT_FOUND');
    }

    // Issue rotated tokens in the SAME family
    const accessToken = generateAccessToken(user);
    const newRawRefreshToken = generateRefreshToken();
    const newTokenHash = hashToken(newRawRefreshToken);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    await this.repo.createRefreshToken({
      user_id: user.id,
      token_hash: newTokenHash,
      family_id: record.family_id,
      expires_at: expiresAt,
    });

    return {
      user: sanitizeUser(user),
      tokens: {
        accessToken,
        refreshToken: newRawRefreshToken,
      },
    };
  }

  async logout(rawRefreshToken?: string): Promise<void> {
    if (!rawRefreshToken) {
      return;
    }

    const tokenHash = hashToken(rawRefreshToken);
    const record = await this.repo.findRefreshTokenByHash(tokenHash);

    if (record && !record.revoked_at) {
      await this.repo.revokeRefreshToken(record.id);
    }
  }

  async getCurrentUser(userId: string): Promise<IUserResponse> {
    const user = await this.repo.findUserById(userId);
    if (!user) {
      throw ApiError.notFound('User not found', 'USER_NOT_FOUND');
    }
    return sanitizeUser(user);
  }
}

export const authService = new AuthService();
export default authService;
