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
      };
    }
  }
}

export const requireInternalAuth = (req: Request, _res: Response, next: NextFunction): void => {
  const tokenHeader = req.headers['x-internal-token'];
  const userId = req.headers['x-user-id'] as string;
  const userRole = req.headers['x-user-role'] as string;

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

  req.user = {
    id: userId,
    role: userRole || 'customer',
  };

  next();
};

export const requireAdmin = (req: Request, _res: Response, next: NextFunction): void => {
  const user = req.user;
  if (!user || user.role !== 'admin') {
    throw ApiError.forbidden('Admin role required', 'FORBIDDEN');
  }
  next();
};
