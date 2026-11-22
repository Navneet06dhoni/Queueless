import Redis from 'ioredis';
import { config } from './index';
import { logger } from '../utils/logger';

export const redis = new Redis({
  host: config.REDIS_HOST,
  port: config.REDIS_PORT,
  password: config.REDIS_PASSWORD || undefined,
  db: config.NODE_ENV === 'test' ? config.REDIS_DB_TEST : 0,
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => {
    if (times > 5) {
      return null; // Stop retrying after 5 attempts
    }
    return Math.min(times * 100, 2000);
  }
});

redis.on('connect', () => {
  logger.info('✅ Connected to Redis successfully');
});

redis.on('error', (err) => {
  if (config.NODE_ENV !== 'test') {
    logger.warn({ err: err.message }, '⚠️ Redis connection warning');
  }
});

export default redis;
