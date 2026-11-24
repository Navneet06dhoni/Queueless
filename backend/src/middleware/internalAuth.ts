import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { config } from '../config';

/**
 * Timing-safe string comparison to prevent timing attacks on internal tokens
 */
export const verifyInternalToken = (providedToken: string | undefined, expectedToken: string): boolean => {
  if (!providedToken || !expectedToken) return false;
  const providedBuf = Buffer.from(providedToken);
  const expectedBuf = Buffer.from(expectedToken);
  if (providedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
};

/**
 * Middleware ensuring request carries a valid X-Internal-Token header
 */
export const requireInternalToken = (req: Request, res: Response, next: NextFunction): void => {
  const token = req.header('X-Internal-Token');
  if (!config.INTERNAL_TOKEN || !verifyInternalToken(token, config.INTERNAL_TOKEN)) {
    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or missing internal authentication token',
      },
    });
    return;
  }
  next();
};
