import http from 'http';
import { createApp } from './app';
import { config } from './config';
import { pool } from './db';
import redis from './config/redis';
import { runMigrationsUp } from './db/migrator';
import { initSocketServer, closeSocketServer } from './socket';
import { queueService } from './modules/queue/queue.service';
import { startReminderJob, stopReminderJob } from './modules/notification/jobs/reminderJob';
import { events } from './events';
import { logger } from './utils/logger';

export const performGracefulShutdown = async (
  server: http.Server,
  signal: string,
  timeoutMs: number = 10000
): Promise<void> => {
  logger.info(`🛑 Received ${signal}. Gracefully shutting down...`);

  // 1. Stop background appointment reminder job
  stopReminderJob();

  // 2. Stop accepting new connections
  await new Promise<void>((resolve) => {
    server.close((err) => {
      if (err) logger.warn({ err: err.message }, 'Server close notice');
      resolve();
    });
  });

  // 3. Close Socket.io server
  try {
    await closeSocketServer();
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Socket server close notice');
  }

  // 4. Wait for in-flight events with timeout limit
  try {
    let timer: NodeJS.Timeout;
    const timeoutPromise = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });
    await Promise.race([events.flush(), timeoutPromise]);
    clearTimeout(timer!);
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Event bus flush notice');
  }

  // 5. Close Redis connection
  try {
    await redis.quit();
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Redis quit notice');
  }

  // 6. Close PostgreSQL pool
  try {
    await pool.end();
  } catch (err: any) {
    logger.warn({ err: err.message }, 'PostgreSQL pool close notice');
  }

  logger.info('✅ Clean shutdown completed');
};

const startServer = async () => {
  const app = createApp();
  const server = http.createServer(app);

  // Initialize Socket.io server
  initSocketServer(server);

  try {
    // Attempt database migration check on startup (if DB is reachable)
    try {
      logger.info('🔍 Checking database connection and pending migrations...');
      await runMigrationsUp();
    } catch (dbErr: any) {
      logger.warn({ err: dbErr.message }, '⚠️ Could not run migrations automatically on startup');
    }

    // Connect to Redis
    try {
      await redis.connect();
    } catch (redisErr: any) {
      logger.warn({ err: redisErr.message }, '⚠️ Redis connection initial attempt');
    }

    // Rebuild active virtual queues into Redis
    try {
      await queueService.rebuildQueues();
    } catch (qErr: any) {
      logger.warn({ err: qErr.message }, '⚠️ Could not rebuild queues on startup');
    }

    // Start background appointment reminder job (runs every 60s)
    startReminderJob();

    server.listen(config.PORT, () => {
      logger.info(`🚀 QueueLess Backend running on port ${config.PORT}`);
      logger.info(`🌐 Health check available at http://localhost:${config.PORT}/api/health`);
      logger.info(`📚 Swagger docs available at http://localhost:${config.PORT}/api/docs`);
    });

    const shutdown = async (signal: string) => {
      try {
        await performGracefulShutdown(server, signal);
        process.exit(0);
      } catch (err) {
        logger.error({ err }, 'Error during shutdown');
        process.exit(1);
      }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error) {
    logger.error({ error }, '❌ Failed to start server');
    process.exit(1);
  }
};

if (require.main === module) {
  startServer();
}

export default startServer;
