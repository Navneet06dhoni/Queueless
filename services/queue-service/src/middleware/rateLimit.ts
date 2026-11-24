import { Request, Response, NextFunction } from 'express';
import { redis } from '../redis';
import { config } from '../config';
import { ApiError } from '@queueless/common';

export const queueActionLimiter = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  if (config.NODE_ENV === 'test') {
    return next();
  }

  const userId = req.user?.id || req.ip || 'anonymous';
  const key = `ratelimit:queue:${userId}`;

  try {
    const current = await redis.incr(key);
    if (current === 1) {
      await redis.expire(key, 60);
    }

    if (current > 20) {
      throw new ApiError(
        429,
        'RATE_LIMIT_EXCEEDED',
        'Too many queue requests, please try again after a minute'
      );
    }

    next();
  } catch (err) {
    next(err);
  }
};
