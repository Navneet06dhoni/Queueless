import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { logger } from '../utils/logger';

const VALID_ID_REGEX = /^[a-zA-Z0-9_\-.]{1,64}$/;

export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const incomingHeader = req.headers['x-request-id'];
  let requestId: string;

  if (typeof incomingHeader === 'string' && VALID_ID_REGEX.test(incomingHeader)) {
    requestId = incomingHeader;
  } else {
    requestId = crypto.randomUUID();
  }

  res.setHeader('X-Request-Id', requestId);
  (req as any).requestId = requestId;
  req.id = requestId;

  // Request-scoped child logger
  (req as any).log = logger.child({ requestId });

  next();
};

export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const startTime = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const userId = (req as any).user?.id || undefined;
    const requestId = (req as any).requestId || res.getHeader('X-Request-Id');

    logger.info({
      requestId,
      method: req.method,
      path: req.originalUrl || req.path,
      status: res.statusCode,
      durationMs: duration,
      ...(userId ? { userId } : {}),
    });
  });

  next();
};
