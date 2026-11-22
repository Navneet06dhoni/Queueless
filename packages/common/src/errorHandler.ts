import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { ApiError } from './ApiError';
import { logger } from './logger';

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const requestId = (req as any).requestId || (res.getHeader('X-Request-Id') as string) || undefined;
  const isProduction = process.env.NODE_ENV === 'production';

  // 1. Handled ApiError
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        ...(requestId ? { requestId } : {}),
        ...(err.details && !isProduction ? { details: err.details } : {}),
      },
    });
    return;
  }

  // 2. Zod Validation Error
  if (err instanceof ZodError) {
    const message = err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: message || 'Validation failed',
        ...(requestId ? { requestId } : {}),
        ...(!isProduction ? { details: err.format() } : {}),
      },
    });
    return;
  }

  // 3. PostgreSQL Unique Constraint Violation (Code 23505)
  if (err && err.code === '23505') {
    res.status(409).json({
      error: {
        code: 'CONFLICT',
        message: err.detail || 'A record with matching unique fields already exists',
        ...(requestId ? { requestId } : {}),
      },
    });
    return;
  }

  // 4. PostgreSQL Foreign Key Violation (Code 23503)
  if (err && err.code === '23503') {
    res.status(400).json({
      error: {
        code: 'FOREIGN_KEY_VIOLATION',
        message: err.detail || 'Referenced record does not exist',
        ...(requestId ? { requestId } : {}),
      },
    });
    return;
  }

  // 5. Malformed JSON Body
  if (err instanceof SyntaxError && 'status' in err && (err as any).status === 400 && 'body' in err) {
    res.status(400).json({
      error: {
        code: 'INVALID_JSON',
        message: 'Invalid JSON payload provided',
        ...(requestId ? { requestId } : {}),
      },
    });
    return;
  }

  // 6. Generic unhandled error
  logger.error({ err, requestId }, 'Unhandled Server Error');
  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: isProduction ? 'An unexpected error occurred' : err?.message || 'Internal server error',
      ...(requestId ? { requestId } : {}),
    },
  });
};
