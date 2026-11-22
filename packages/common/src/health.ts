import { Router, Request, Response } from 'express';

export type CheckFn = () => Promise<boolean>;

export interface HealthRouterOptions {
  serviceName: string;
  checks?: Record<string, CheckFn>;
  getOldestUnpublishedOutboxAgeSeconds?: () => Promise<number | null>;
  timeoutMs?: number;
}

const withTimeout = <T>(promise: Promise<T>, ms: number, failureMsg: string): Promise<T> => {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(failureMsg)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
};

export function createHealthRouter(options: HealthRouterOptions): Router {
  const router = Router();
  const serviceName = options.serviceName;
  const checks = options.checks || {};
  const timeout = options.timeoutMs ?? 2000;

  // 1. Liveness check: process is running, no external dependencies checked
  router.get('/live', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  // 2. Readiness check: executes all configured dependency checks
  router.get('/ready', async (_req: Request, res: Response) => {
    const checkResults: Record<string, 'up' | 'down'> = {};
    const errors: Record<string, string> = {};
    let allUp = true;

    for (const [name, checkFn] of Object.entries(checks)) {
      try {
        const passed = await withTimeout(checkFn(), timeout, `${name} check timed out after ${timeout}ms`);
        if (passed) {
          checkResults[name] = 'up';
        } else {
          checkResults[name] = 'down';
          errors[name] = `${name} check failed`;
          allUp = false;
        }
      } catch (err: any) {
        checkResults[name] = 'down';
        errors[name] = err?.message || `${name} check error`;
        allUp = false;
      }
    }

    let oldestOutboxAge: number | null = null;
    if (options.getOldestUnpublishedOutboxAgeSeconds) {
      try {
        oldestOutboxAge = await options.getOldestUnpublishedOutboxAgeSeconds();
      } catch {
        oldestOutboxAge = null;
      }
    }

    const isDegraded = oldestOutboxAge !== null && oldestOutboxAge > 60;
    const statusCode = !allUp ? 503 : 200;

    res.status(statusCode).json({
      status: !allUp ? 'down' : isDegraded ? 'degraded' : 'ok',
      checks: checkResults,
      ...(options.getOldestUnpublishedOutboxAgeSeconds ? { oldestUnpublishedOutboxAgeSeconds: oldestOutboxAge } : {}),
      ...(Object.keys(errors).length > 0 ? { details: errors } : {}),
      timestamp: new Date().toISOString(),
    });
  });

  // 3. Backward-compatible /api/health
  router.get('/', async (_req: Request, res: Response) => {
    const dependencies: Record<string, 'connected' | 'disconnected' | 'error'> = {};

    for (const [name, checkFn] of Object.entries(checks)) {
      try {
        const passed = await withTimeout(checkFn(), timeout, `${name} check timed out`);
        dependencies[name] = passed ? 'connected' : 'disconnected';
      } catch {
        dependencies[name] = 'error';
      }
    }

    res.status(200).json({
      status: 'ok',
      service: serviceName,
      timestamp: new Date().toISOString(),
      dependencies,
    });
  });

  return router;
}
