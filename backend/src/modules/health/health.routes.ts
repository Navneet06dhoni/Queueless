import { Router, Request, Response } from 'express';
import { query } from '../../db';
import redis from '../../config/redis';
import { outboxRepository } from '../../events/outbox.repository';

const router = Router();

// Helper with timeout
const withTimeout = <T>(promise: Promise<T>, ms: number, failureMsg: string): Promise<T> => {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(failureMsg)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
};

// 1. Liveness check: process is running, no external dependencies checked
router.get('/live', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// 2. Readiness check: verifies DB and Redis within 2s each
router.get('/ready', async (_req: Request, res: Response) => {
  let dbStatus: 'up' | 'down' = 'down';
  let redisStatus: 'up' | 'down' = 'down';
  const errors: Record<string, string> = {};

  try {
    await withTimeout(query('SELECT 1'), 2000, 'PostgreSQL check timed out after 2000ms');
    dbStatus = 'up';
  } catch (err: any) {
    dbStatus = 'down';
    errors.database = err.message || 'PostgreSQL check failed';
  }

  try {
    if (redis.status === 'ready' || redis.status === 'connect') {
      await withTimeout(redis.ping(), 2000, 'Redis ping timed out after 2000ms');
      redisStatus = 'up';
    } else {
      await withTimeout(redis.ping(), 2000, 'Redis ping timed out after 2000ms');
      redisStatus = 'up';
    }
  } catch (err: any) {
    redisStatus = 'down';
    errors.redis = err.message || 'Redis check failed';
  }

  // Check oldest unpublished outbox row age
  let oldestOutboxAge: number | null = null;
  try {
    oldestOutboxAge = await outboxRepository.getOldestUnpublishedAgeSeconds();
  } catch {
    oldestOutboxAge = null;
  }

  const isDegraded = oldestOutboxAge !== null && oldestOutboxAge > 60;
  const isHealthy = dbStatus === 'up' && redisStatus === 'up';
  const statusCode = !isHealthy ? 503 : 200;

  res.status(statusCode).json({
    status: !isHealthy ? 'down' : isDegraded ? 'degraded' : 'ok',
    checks: {
      database: dbStatus,
      redis: redisStatus,
    },
    oldestUnpublishedOutboxAgeSeconds: oldestOutboxAge,
    ...(Object.keys(errors).length > 0 ? { details: errors } : {}),
    timestamp: new Date().toISOString(),
  });
});

// 3. Backward-compatible /api/health
router.get('/', async (_req: Request, res: Response) => {
  let dbStatus = 'disconnected';
  let redisStatus = 'disconnected';

  try {
    await query('SELECT 1');
    dbStatus = 'connected';
  } catch {
    dbStatus = 'error';
  }

  try {
    if (redis.status === 'ready' || redis.status === 'connect') {
      redisStatus = 'connected';
    } else {
      await redis.ping();
      redisStatus = 'connected';
    }
  } catch {
    redisStatus = 'error';
  }

  res.status(200).json({
    status: 'ok',
    service: 'queueless-backend',
    timestamp: new Date().toISOString(),
    dependencies: {
      database: dbStatus,
      redis: redisStatus,
    },
  });
});

export default router;
