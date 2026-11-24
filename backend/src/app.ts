import express, { Express, Request, Response, NextFunction } from 'express';
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
import { initBookingSubscriptions } from './modules/booking';
import { initQueueSubscriptions } from './modules/queue';
import analyticsRoutes from './modules/analytics/analytics.routes';
import healthRoutes from './modules/health/health.routes';
import configRoutes from './modules/config/config.routes';
import internalRoutes from './modules/internal/internal.routes';
import { requireInternalToken } from './middleware/internalAuth';
import { generateOpenApiSpec } from './docs/openapi';

export const createApp = (): Express => {
  const app = express();

  // Trust proxy configuration
  if (config.TRUST_PROXY === 'true' || config.TRUST_PROXY === '1') {
    app.set('trust proxy', 1);
  } else if (!isNaN(Number(config.TRUST_PROXY)) && config.TRUST_PROXY !== 'false') {
    app.set('trust proxy', Number(config.TRUST_PROXY));
  } else if (config.TRUST_PROXY !== 'false') {
    app.set('trust proxy', config.TRUST_PROXY);
  }

  // Request ID & Logger middleware (must be first)
  app.use(requestIdMiddleware);
  app.use(requestLogger);

  // Security headers with strict Content-Security-Policy
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'", config.FRONTEND_ORIGIN],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
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
    app.use(
      '/api/docs',
      (_req: Request, res: Response, next: NextFunction) => {
        res.removeHeader('Content-Security-Policy');
        next();
      },
      swaggerUi.serve,
      swaggerUi.setup(spec, { explorer: true })
    );
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

  // Internal API for inter-service communication (mounted only when INTERNAL_TOKEN is configured)
  if (config.INTERNAL_TOKEN) {
    app.use('/internal', internalRoutes);
  }

  // Internal Debug endpoint for client IP observation (test or explicit debug mode only)
  if (config.NODE_ENV === 'test' || config.DEBUG_ENDPOINTS === 'true') {
    app.get('/internal/debug/client-ip', requireInternalToken, (req: Request, res: Response) => {
      res.json({
        ip: req.ip,
        xForwardedFor: req.headers['x-forwarded-for'] || null,
        trustProxy: req.app.get('trust proxy'),
      });
    });
  }

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

  // Initialize event subscriptions across modules
  initNotificationSubscriptions();
  initBookingSubscriptions();
  if (config.QUEUE_MODE === 'embedded') {
    initQueueSubscriptions();
  }

  // Mount Module Routes
  app.use(`${config.API_PREFIX}/auth`, authRoutes);
  app.use(`${config.API_PREFIX}/businesses`, businessRoutes);
  if (config.NOTIFICATIONS_MODE === 'embedded') {
    app.use(`${config.API_PREFIX}/admin/notifications`, adminNotificationRoutes);
    app.use(`${config.API_PREFIX}/notifications`, notificationRoutes);
  }
  app.use(`${config.API_PREFIX}/admin`, adminRoutes);
  app.use(`${config.API_PREFIX}/appointments`, appointmentRoutes);
  if (config.QUEUE_MODE === 'embedded') {
    app.use(`${config.API_PREFIX}/queue`, queueRoutes);
  }
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
