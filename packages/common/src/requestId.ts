import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { logger } from './logger';

const VALID_ID_REGEX = /^[a-zA-Z0-9_\-.]{1,64}$/;

declare global {
  namespace Express {
    interface Request {
      id?: string;
      requestId?: string;
      log?: any;
    }
  }
}

export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const incomingHeader = req.headers['x-request-id'];
  let requestId: string;

  if (typeof incomingHeader === 'string' && VALID_ID_REGEX.test(incomingHeader)) {
    requestId = incomingHeader;
  } else {
    requestId = crypto.randomUUID();
  }

  res.setHeader('X-Request-Id', requestId);
  req.requestId = requestId;
  req.id = requestId;

  // Request-scoped child logger
  req.log = logger.child({ requestId });

  next();
};

export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const startTime = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const userId = (req as any).user?.id || undefined;
    const requestId = req.requestId || (res.getHeader('X-Request-Id') as string) || undefined;

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
