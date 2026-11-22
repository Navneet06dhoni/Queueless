import http from 'http';
import { createNotificationApp } from './app';
import { config } from './config';
import { pool } from './db';
import { runMigrationsUp } from './db/migrator';
import { notificationConsumerManager } from './events/consumer';
import { logger, createGracefulShutdown } from '@queueless/common';

const startServer = async () => {
  const app = createNotificationApp();
  const server = http.createServer(app);

  try {
    // Run database migrations on startup
    try {
      logger.info('🔍 Checking notification_db schema and running migrations...');
      await runMigrationsUp();
    } catch (migErr: any) {
      logger.warn({ err: migErr.message }, '⚠️ Automatic migration notice on startup');
    }

    // Start RabbitMQ consumer and outbox relay
    await notificationConsumerManager.start();

    server.listen(config.PORT, () => {
      logger.info(`🔔 Notification Service running on internal port ${config.PORT}`);
    });

    const shutdown = createGracefulShutdown({
      server,
      onShutdown: async () => {
        await notificationConsumerManager.stop();
        await pool.end();
      },
    });

    process.on('SIGINT', () => shutdown('SIGINT').then(() => process.exit(0)));
    process.on('SIGTERM', () => shutdown('SIGTERM').then(() => process.exit(0)));
  } catch (error) {
    logger.error({ error }, '❌ Failed to start Notification Service');
    process.exit(1);
  }
};

if (require.main === module) {
  startServer();
}

export default startServer;
