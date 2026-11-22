import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import { config } from './config';
import { errorHandler } from './middleware/errorHandler';
import { requestIdMiddleware, requestLogger } from './middleware/requestId';
import authRoutes from './modules/auth/auth.routes';
import businessRoutes from './modules/business/business.routes';
import adminRoutes from './modules/admin/admin.routes';
import appointmentRoutes from './modules/booking/booking.routes';
import queueRoutes from './modules/queue/queue.routes';
import { notificationRoutes, adminNotificationRoutes } from './modules/notification/notification.routes';
import { initNotificationSubscriptions } from './modules/notification';
import analyticsRoutes from './modules/analytics/analytics.routes';
import healthRoutes from './modules/health/health.routes';
import configRoutes from './modules/config/config.routes';
import { generateOpenApiSpec } from './docs/openapi';

export const createApp = (): Express => {
  const app = express();

  // Request ID & Logger middleware (must be first)
  app.use(requestIdMiddleware);
  app.use(requestLogger);

  // Security headers with Swagger UI compatibility
  app.use(
    helmet({
      contentSecurityPolicy: false,
    })
  );

  // CORS configuration: only allow FRONTEND_ORIGIN with credentials
  app.use(
    cors({
      origin: config.FRONTEND_ORIGIN,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id'],
    })
  );

  // Global Rate Limiter
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // Limit each IP to 1000 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: {
        code: 'TOO_MANY_REQUESTS',
        message: 'Too many requests from this IP, please try again later',
      },
    },
  });
  app.use(limiter);

  // Body and cookie parsers (Strict 100kb payload limit)
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: true, limit: '100kb' }));
  app.use(cookieParser());

  // OpenAPI Specification & Swagger UI
  const spec = generateOpenApiSpec();
  app.get('/api/openapi.json', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(spec);
  });

  const isDocsEnabled = config.NODE_ENV !== 'production' || config.ENABLE_DOCS;
  if (isDocsEnabled) {
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(spec, { explorer: true }));
  } else {
    app.use('/api/docs', (_req: Request, res: Response) => {
      const requestId = (_req as any).requestId;
      res.status(404).json({
        error: {
          code: 'DOCS_DISABLED',
          message: 'API documentation is disabled in production environment',
          ...(requestId ? { requestId } : {}),
        },
      });
    });
  }

  // Health and System Config Endpoints
  app.use(`${config.API_PREFIX}/health`, healthRoutes);
  app.use(`${config.API_PREFIX}/config`, configRoutes);

  // Root endpoint info
  app.get('/', (_req: Request, res: Response) => {
    res.json({
      name: 'QueueLess API',
      version: '1.0.0',
      description: 'Smart appointment booking and live virtual queue platform',
      docs: '/api/docs',
      health: '/api/health',
    });
  });

  // Initialize notification event subscriptions
  initNotificationSubscriptions();

  // Mount Module Routes
  app.use(`${config.API_PREFIX}/auth`, authRoutes);
  app.use(`${config.API_PREFIX}/businesses`, businessRoutes);
  app.use(`${config.API_PREFIX}/admin/notifications`, adminNotificationRoutes);
  app.use(`${config.API_PREFIX}/admin`, adminRoutes);
  app.use(`${config.API_PREFIX}/appointments`, appointmentRoutes);
  app.use(`${config.API_PREFIX}/queue`, queueRoutes);
  app.use(`${config.API_PREFIX}/notifications`, notificationRoutes);
  app.use(`${config.API_PREFIX}/analytics`, analyticsRoutes);

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

export default createApp;
