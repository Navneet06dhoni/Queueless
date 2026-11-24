import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { ApiError } from '../utils/ApiError';
import { verifyAccessToken } from '../modules/auth/auth.utils';
import { UserRole } from '../modules/auth/auth.types';
import { config } from '../config';
import redis from '../config/redis';
import { query } from '../db';
import { logger } from '../utils/logger';

// Augment Express Request interface with authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: UserRole;
        name: string;
        email: string | null;
      };
    }
  }
}

/**
 * Checks if a user is blocked using Redis set 'blocked:users' first,
 * falling back to database query if Redis is unavailable.
 */
export const isUserBlocked = async (userId: string): Promise<boolean> => {
  try {
    if (redis.status === 'ready' || redis.status === 'connect') {
      const isBlocked = await redis.sismember('blocked:users', userId);
      return isBlocked === 1;
    }
  } catch {
    // Fall back to database
  }

  try {
    const res = await query('SELECT is_blocked FROM users WHERE id = $1', [userId]);
    return res.rows[0]?.is_blocked === true;
  } catch {
    return false;
  }
};

/**
 * Updates Redis set 'blocked:users'
 */
export const setUserBlockedCache = async (userId: string, blocked: boolean): Promise<void> => {
  try {
    if (redis.status === 'ready' || redis.status === 'connect') {
      if (blocked) {
        await redis.sadd('blocked:users', userId);
      } else {
        await redis.srem('blocked:users', userId);
      }
    }
  } catch (err: any) {
    if (config.NODE_ENV !== 'test') {
      logger.warn({ err: err.message, userId }, `[Redis] Failed to update blocked:users`);
    }
  }
};

/**
 * Validates JWT Access Token from Authorization Bearer header
 * and rejects immediately if the user is blocked.
 */
export const authenticate = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(ApiError.unauthorized('Authentication token missing or invalid', 'UNAUTHORIZED'));
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = verifyAccessToken(token);

    // Immediate check if user is blocked
    const blocked = await isUserBlocked(decoded.sub);
    if (blocked) {
      return next(ApiError.forbidden('Your account has been suspended', 'USER_BLOCKED'));
    }

    req.user = {
      id: decoded.sub,
      role: decoded.role,
      name: decoded.name !== undefined ? decoded.name : 'Customer',
      email: decoded.email !== undefined ? decoded.email : null,
    };
    next();
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      return next(ApiError.unauthorized('Access token has expired', 'TOKEN_EXPIRED'));
    }
    if (err instanceof ApiError) {
      return next(err);
    }
    return next(ApiError.unauthorized('Invalid authentication token', 'INVALID_TOKEN'));
  }
};

/**
 * Validates JWT Access Token if present, otherwise continues without error
 */
export const optionalAuthenticate = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = verifyAccessToken(token);
    const blocked = await isUserBlocked(decoded.sub);
    if (!blocked) {
      req.user = {
        id: decoded.sub,
        role: decoded.role,
        name: decoded.name !== undefined ? decoded.name : 'Customer',
        email: decoded.email !== undefined ? decoded.email : null,
      };
    }
  } catch {
    // Ignore invalid token on optional auth
  }
  next();
};

/**
 * Restricts access to specified user roles
 */
export const requireRole = (...allowedRoles: UserRole[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw ApiError.unauthorized('Authentication required', 'UNAUTHORIZED');
    }

    if (!allowedRoles.includes(req.user.role)) {
      throw ApiError.forbidden(
        `Access denied. Requires one of the following roles: ${allowedRoles.join(', ')}`,
        'FORBIDDEN'
      );
    }

    next();
  };
};

/**
 * Stricter rate limit on /auth/login and /auth/register (5 requests per min per IP)
 * Disabled during automated test runs
 */
export const authRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: config.NODE_ENV === 'test' ? 1000 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many authentication attempts. Please try again after 1 minute.',
    },
  },
});
