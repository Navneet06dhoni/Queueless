import Redis from 'ioredis';
import { config } from './index';

export const redis = new Redis({
  host: config.REDIS_HOST,
  port: config.REDIS_PORT,
  password: config.REDIS_PASSWORD || undefined,
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
  console.log('✅ Connected to Redis successfully');
});

redis.on('error', (err) => {
  if (config.NODE_ENV !== 'test') {
    console.warn('⚠️  Redis connection warning:', err.message);
  }
});

export default redis;
