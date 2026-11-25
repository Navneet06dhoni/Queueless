import http from 'http';
import { createQueueApp } from './app';
import { config } from './config';
import { pool } from './db';
import { redis } from './redis';
import { runMigrationsUp } from './db/migrator';
import { queueService } from './service';
import { queueConsumerManager } from './events/consumer';
import { initSocketServer, closeSocketServer } from './socket';
import { logger, createGracefulShutdown } from '@queueless/common';
import { OutboxRelay, EXCHANGES } from '@queueless/messaging';

const startServer = async () => {
  logger.info({ port: config.PORT }, '🚀 Starting Queue Service...');

  // 1. Run migrations
  try {
    await runMigrationsUp();
    logger.info('✅ Queue service migrations up to date');
  } catch (err: any) {
    logger.error({ err: err.message }, '❌ Failed to apply queue service migrations');
    process.exit(1);
  }

  // 2. Rebuild live Redis queues from DB
  try {
    await queueService.rebuildQueues();
  } catch (err: any) {
    logger.warn({ err: err.message }, '⚠️ Failed to rebuild live Redis queues on startup');
  }

  // 3. Create app and HTTP server
  const app = createQueueApp();
  const server = http.createServer(app);

  // 4. Attach Socket.io server
  initSocketServer(server);

  // 5. Start RabbitMQ consumer
  try {
    await queueConsumerManager.start();
  } catch (err: any) {
    logger.warn({ err: err.message }, '⚠️ RabbitMQ consumer failed to initialize on startup');
  }

  // 6. Start Outbox Relay
  const outboxRelay = new OutboxRelay({
    outboxRepository: queueService.getOutboxRepository(),
    publishEvent: async (eventType: string, payload: any) => {
      const client = queueConsumerManager.getRabbitClient();
      if (client) {
        return await client.publish(eventType, payload);
      }
      return false;
    },
    intervalMs: 1000,
  });
  queueService.setOutboxRelay(outboxRelay);
  outboxRelay.start();

  // 7. Start listening
  server.listen(config.PORT, () => {
    logger.info(`✅ Queue service listening on port ${config.PORT} [${config.NODE_ENV}]`);
  });

  // 8. Graceful shutdown
  const shutdown = createGracefulShutdown({
    server,
    onShutdown: async () => {
      logger.info('🛑 Shutting down queue service resources...');
      outboxRelay.stop();
      await closeSocketServer();
      await queueConsumerManager.stop();
      redis.disconnect();
      await pool.end();
      logger.info('✅ Queue service shutdown complete');
    },
  });

  process.on('SIGINT', () => shutdown('SIGINT').then(() => process.exit(0)));
  process.on('SIGTERM', () => shutdown('SIGTERM').then(() => process.exit(0)));
};

if (require.main === module) {
  startServer().catch((err) => {
    logger.error({ err: err.message }, '❌ Fatal queue service startup failure');
    process.exit(1);
  });
}

export { startServer };
