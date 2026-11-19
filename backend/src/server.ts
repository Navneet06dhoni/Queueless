import http from 'http';
import { createApp } from './app';
import { config } from './config';
import { pool } from './db';
import redis from './config/redis';
import { runMigrationsUp } from './db/migrator';
import { initSocketServer, closeSocketServer } from './socket';
import { queueService } from './modules/queue/queue.service';
import { startReminderJob, stopReminderJob } from './modules/notification/jobs/reminderJob';

const startServer = async () => {
  const app = createApp();
  const server = http.createServer(app);

  // Initialize Socket.io server
  initSocketServer(server);

  try {
    // Attempt database migration check on startup (if DB is reachable)
    try {
      console.log('🔍 Checking database connection and pending migrations...');
      await runMigrationsUp();
    } catch (dbErr: any) {
      console.warn('⚠️  Could not run migrations automatically on startup:', dbErr.message);
      console.info('💡 Ensure PostgreSQL is running and run "npm run migrate"');
    }

    // Connect to Redis
    try {
      await redis.connect();
    } catch (redisErr: any) {
      console.warn('⚠️  Redis connection initial attempt:', redisErr.message);
    }

    // Rebuild active virtual queues into Redis
    try {
      await queueService.rebuildQueues();
    } catch (qErr: any) {
      console.warn('⚠️  Could not rebuild queues on startup:', qErr.message);
    }

    // Start background appointment reminder job (runs every 60s)
    startReminderJob();

    server.listen(config.PORT, () => {
      console.log(`🚀 QueueLess Backend running on port ${config.PORT}`);
      console.log(`🌐 Health check available at http://localhost:${config.PORT}/api/health`);
    });

    const shutdown = async (signal: string) => {
      console.log(`\n🛑 Received ${signal}. Gracefully shutting down...`);
      stopReminderJob();
      server.close(async () => {
        try {
          await closeSocketServer();
          await pool.end();
          await redis.quit();
          console.log('✅ Clean shutdown completed');
          process.exit(0);
        } catch (err) {
          console.error('Error during shutdown:', err);
          process.exit(1);
        }
      });
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

if (require.main === module) {
  startServer();
}

export default startServer;
