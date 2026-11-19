import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { ApiError } from '../utils/ApiError';
import { verifyAccessToken } from '../modules/auth/auth.utils';
import { UserRole } from '../modules/auth/auth.types';
import { config } from '../config';

// Augment Express Request interface with authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: UserRole;
      };
    }
  }
}

/**
 * Validates JWT Access Token from Authorization Bearer header
 */
export const authenticate = (req: Request, _res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw ApiError.unauthorized('Authentication token missing or invalid', 'UNAUTHORIZED');
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = verifyAccessToken(token);
    req.user = {
      id: decoded.sub,
      role: decoded.role,
    };
    next();
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      throw ApiError.unauthorized('Access token has expired', 'TOKEN_EXPIRED');
    }
    throw ApiError.unauthorized('Invalid authentication token', 'INVALID_TOKEN');
  }
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
