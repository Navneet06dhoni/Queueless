import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { ApiError } from '../utils/ApiError';
import { config } from '../config';

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // 1. Handled ApiError
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details && config.NODE_ENV !== 'production' ? { details: err.details } : {})
      }
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
        ...(config.NODE_ENV !== 'production' ? { details: err.format() } : {})
      }
    });
    return;
  }

  // 3. PostgreSQL Unique Constraint Violation (Code 23505)
  if (err && err.code === '23505') {
    res.status(409).json({
      error: {
        code: 'CONFLICT',
        message: err.detail || 'A record with matching unique fields already exists'
      }
    });
    return;
  }

  // 4. PostgreSQL Foreign Key Violation (Code 23503)
  if (err && err.code === '23503') {
    res.status(400).json({
      error: {
        code: 'FOREIGN_KEY_VIOLATION',
        message: err.detail || 'Referenced record does not exist'
      }
    });
    return;
  }

  // 5. Malformed JSON Body
  if (err instanceof SyntaxError && 'status' in err && err.status === 400 && 'body' in err) {
    res.status(400).json({
      error: {
        code: 'INVALID_JSON',
        message: 'Invalid JSON payload provided'
      }
    });
    return;
  }

  // 6. Generic unhandled error
  console.error('Unhandled Server Error:', err);
  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: config.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message || 'Internal server error'
    }
  });
};
