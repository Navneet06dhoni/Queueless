import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { ApiError } from '@queueless/common';
import { config } from '../config';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: string;
        name: string;
        email: string | null;
      };
    }
  }
}

export const requireInternalToken = (req: Request, _res: Response, next: NextFunction): void => {
  const tokenHeader = req.headers['x-internal-token'];

  if (typeof tokenHeader !== 'string') {
    throw ApiError.unauthorized('Invalid or missing internal service token', 'UNAUTHORIZED');
  }

  const expectedToken = config.INTERNAL_TOKEN;
  const bufExpected = Buffer.from(expectedToken);
  const bufReceived = Buffer.from(tokenHeader);

  if (bufExpected.length !== bufReceived.length || !crypto.timingSafeEqual(bufExpected, bufReceived)) {
    throw ApiError.unauthorized('Invalid or missing internal service token', 'UNAUTHORIZED');
  }

  next();
};

export const requireInternalAuth = (req: Request, _res: Response, next: NextFunction): void => {
  const tokenHeader = req.headers['x-internal-token'];
  const userId = req.headers['x-user-id'] as string;
  const userRole = req.headers['x-user-role'] as string;
  const rawUserName = req.headers['x-user-name'] as string;
  const userEmail = (req.headers['x-user-email'] as string) || null;

  if (typeof tokenHeader !== 'string') {
    throw ApiError.unauthorized('Invalid or missing internal service token', 'UNAUTHORIZED');
  }

  const expectedToken = config.INTERNAL_TOKEN;
  const bufExpected = Buffer.from(expectedToken);
  const bufReceived = Buffer.from(tokenHeader);

  if (bufExpected.length !== bufReceived.length || !crypto.timingSafeEqual(bufExpected, bufReceived)) {
    throw ApiError.unauthorized('Invalid or missing internal service token', 'UNAUTHORIZED');
  }

  if (!userId) {
    throw ApiError.unauthorized('Missing authenticated user identity', 'UNAUTHORIZED');
  }

  let userName = 'Customer';
  if (rawUserName) {
    try {
      userName = decodeURIComponent(rawUserName);
    } catch {
      userName = rawUserName;
    }
  }

  req.user = {
    id: userId,
    role: userRole || 'customer',
    name: userName,
    email: userEmail,
  };

  next();
};

export const requireRole = (...roles: string[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user || !roles.includes(user.role)) {
      throw ApiError.forbidden('Insufficient permissions for this resource', 'FORBIDDEN');
    }
    next();
  };
};
