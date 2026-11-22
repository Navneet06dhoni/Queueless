import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import {
  createLogger,
  requestIdMiddleware,
  ApiError,
  errorHandler,
  createHealthRouter,
  createGracefulShutdown,
  loadConfig,
} from '../src';

describe('@queueless/common unit tests', () => {
  describe('Logger', () => {
    it('creates a logger with redaction configured', () => {
      const customLog = createLogger({ level: 'silent' });
      expect(customLog).toBeDefined();
      expect(typeof customLog.info).toBe('function');
    });
  });

  describe('ApiError & errorHandler', () => {
    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware);

    app.get('/api-error', () => {
      throw ApiError.badRequest('Invalid input', 'BAD_INPUT', { field: 'name' });
    });

    app.get('/zod-error', () => {
      const schema = z.object({ age: z.number() });
      schema.parse({ age: 'not-a-number' });
    });

    app.get('/generic-error', () => {
      throw new Error('Boom');
    });

    app.use(errorHandler);

    it('handles ApiError correctly', async () => {
      const res = await request(app).get('/api-error');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('BAD_INPUT');
      expect(res.body.error.message).toBe('Invalid input');
      expect(res.body.error.requestId).toBeDefined();
    });

    it('handles ZodError correctly', async () => {
      const res = await request(app).get('/zod-error');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('handles unexpected Error correctly', async () => {
      const res = await request(app).get('/generic-error');
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    });
  });

  describe('createHealthRouter', () => {
    it('provides /live and /ready and / endpoints', async () => {
      const healthRouter = createHealthRouter({
        serviceName: 'test-service',
        checks: {
          mockDb: async () => true,
        },
      });

      const app = express();
      app.use('/health', healthRouter);

      const liveRes = await request(app).get('/health/live');
      expect(liveRes.status).toBe(200);
      expect(liveRes.body.status).toBe('ok');

      const readyRes = await request(app).get('/health/ready');
      expect(readyRes.status).toBe(200);
      expect(readyRes.body.checks.mockDb).toBe('up');

      const baseRes = await request(app).get('/health');
      expect(baseRes.status).toBe(200);
      expect(baseRes.body.service).toBe('test-service');
      expect(baseRes.body.dependencies.mockDb).toBe('connected');
    });

    it('returns 503 when a readiness check fails', async () => {
      const healthRouter = createHealthRouter({
        serviceName: 'test-service',
        checks: {
          failingCheck: async () => false,
        },
      });

      const app = express();
      app.use('/health', healthRouter);

      const readyRes = await request(app).get('/health/ready');
      expect(readyRes.status).toBe(503);
      expect(readyRes.body.status).toBe('down');
      expect(readyRes.body.checks.failingCheck).toBe('down');
    });
  });

  describe('loadConfig', () => {
    it('validates and loads configuration schema', () => {
      const schema = z.object({
        FOO: z.string().default('bar'),
        NUM: z.coerce.number(),
      });

      const cfg = loadConfig(schema, { NUM: '42' });
      expect(cfg.FOO).toBe('bar');
      expect(cfg.NUM).toBe(42);
    });

    it('throws when schema validation fails', () => {
      const schema = z.object({
        REQUIRED_VAL: z.string(),
      });

      expect(() => loadConfig(schema, {})).toThrow();
    });
  });

  describe('createGracefulShutdown', () => {
    it('runs shutdown hook cleanly', async () => {
      let shutdownRun = false;
      const shutdown = createGracefulShutdown({
        onShutdown: async () => {
          shutdownRun = true;
        },
      });

      await shutdown('SIGTERM');
      expect(shutdownRun).toBe(true);
    });
  });
});
