import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { errorHandler } from './middleware/errorHandler';
import { query } from './db';
import redis from './config/redis';

export const createApp = (): Express => {
  const app = express();

  // Security headers
  app.use(helmet());

  // CORS configuration
  app.use(
    cors({
      origin: config.FRONTEND_URL || '*',
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization']
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
        message: 'Too many requests from this IP, please try again later'
      }
    }
  });
  app.use(limiter);

  // Body parser
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Base Health Check
  app.get('/api/health', async (_req: Request, res: Response) => {
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
        redis: redisStatus
      }
    });
  });

  // Root endpoint info
  app.get('/', (_req: Request, res: Response) => {
    res.json({
      name: 'QueueLess API',
      version: '1.0.0',
      description: 'Smart appointment booking and live virtual queue platform',
      docs: '/api/docs',
      health: '/api/health'
    });
  });

  // Modules routes will be mounted under /api in subsequent steps
  // e.g., app.use('/api/auth', authRoutes);

  // 404 Handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'The requested resource or endpoint was not found'
      }
    });
  });

  // Central Error Handler
  app.use(errorHandler);

  return app;
};

export default createApp;
