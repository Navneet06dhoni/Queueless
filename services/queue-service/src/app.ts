import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { requestIdMiddleware, requestLogger, errorHandler, createHealthRouter } from '@queueless/common';
import { query } from './db';
import { redis } from './redis';
import { queueRoutes, internalRouter } from './routes';
import { queueService } from './service';
import { queueConsumerManager } from './events/consumer';
import { getQueueOpenApiSpec } from './docs/openapi';

export const createQueueApp = (): Express => {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(requestIdMiddleware);
  app.use(requestLogger);
  app.use(express.json({ limit: '100kb' }));

  // Health checks router (/health/live, /health/ready, /health)
  const healthRouter = createHealthRouter({
    serviceName: 'queue-service',
    checks: {
      database: async () => {
        await query('SELECT 1');
        return true;
      },
      redis: async () => {
        const ping = await redis.ping();
        return ping === 'PONG';
      },
      rabbitmq: async () => {
        const ch = await queueConsumerManager.getRabbitClient()?.getChannel();
        return !!ch;
      },
    },
    getOldestUnpublishedOutboxAgeSeconds: async () => {
      return await queueService.getOutboxRepository().getOldestUnpublishedAgeSeconds();
    },
  });

  app.use('/health', healthRouter);
  app.use('/api/health', healthRouter);

  // OpenAPI spec for queue service
  app.get('/openapi.json', (_req: Request, res: Response) => {
    res.json(getQueueOpenApiSpec());
  });

  // API Routes
  app.use('/api/queue', queueRoutes);
  app.use('/internal', internalRouter);

  // 404 Handler
  app.use((req: Request, res: Response) => {
    const requestId = (req as any).requestId;
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'The requested resource or endpoint was not found',
        ...(requestId ? { requestId } : {}),
      },
    });
  });

  // Central Error Handler
  app.use(errorHandler);

  return app;
};

export default createQueueApp;
