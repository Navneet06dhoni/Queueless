import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { requestIdMiddleware, requestLogger, errorHandler, createHealthRouter } from '@queueless/common';
import { pool, query } from './db';
import { notificationRoutes } from './routes';
import { notificationConsumerManager } from './events/consumer';

export const createNotificationApp = (): Express => {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(requestIdMiddleware);
  app.use(requestLogger);
  app.use(express.json({ limit: '100kb' }));

  // Health checks router (/health/live, /health/ready, /health)
  const healthRouter = createHealthRouter({
    serviceName: 'notification-service',
    checks: {
      database: async () => {
        await query('SELECT 1');
        return true;
      },
      rabbitmq: async () => {
        const ch = await notificationConsumerManager.getRabbitMQClient().getChannel();
        return !!ch;
      },
    },
    getOldestUnpublishedOutboxAgeSeconds: async () => {
      return await notificationConsumerManager.getOutboxRelay()['config'].outboxRepository.getOldestUnpublishedAgeSeconds();
    },
  });

  app.use('/health', healthRouter);
  app.use('/api/health', healthRouter);

  // OpenAPI spec for notification service
  app.get('/openapi.json', (_req: Request, res: Response) => {
    res.json(getNotificationOpenApiSpec());
  });

  // API Routes
  app.use('/api', notificationRoutes);

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

export function getNotificationOpenApiSpec() {
  return {
    openapi: '3.0.3',
    info: {
      title: 'QueueLess Notification Service API',
      version: '1.0.0',
      description: 'Standalone microservice managing in-app notifications and email dispatch.',
    },
    paths: {
      '/api/notifications': {
        get: {
          summary: 'Get user notifications',
          tags: ['Notifications'],
          responses: {
            '200': { description: 'List of notifications' },
            '401': { description: 'Unauthorized' },
          },
        },
      },
      '/api/notifications/read-all': {
        post: {
          summary: 'Mark all notifications as read',
          tags: ['Notifications'],
          responses: {
            '200': { description: 'All marked as read' },
            '401': { description: 'Unauthorized' },
          },
        },
      },
      '/api/notifications/{id}/read': {
        patch: {
          summary: 'Mark single notification as read',
          tags: ['Notifications'],
          responses: {
            '200': { description: 'Notification marked as read' },
            '401': { description: 'Unauthorized' },
            '404': { description: 'Notification not found' },
          },
        },
      },
      '/api/admin/notifications': {
        get: {
          summary: 'Get failed email deliveries (Admin only)',
          tags: ['Notifications Admin'],
          responses: {
            '200': { description: 'List of failed email deliveries' },
            '401': { description: 'Unauthorized' },
            '403': { description: 'Forbidden' },
          },
        },
      },
    },
  };
}

export default createNotificationApp;
