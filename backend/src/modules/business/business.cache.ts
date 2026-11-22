import crypto from 'crypto';
import redis from '../../config/redis';
import { IBusiness, PaginatedResult, BusinessListQuery } from './business.types';
import { logger } from '../../utils/logger';

const CACHE_TTL_SECONDS = 60;
const VERSION_KEY = 'businesses:cache_version';

export class BusinessCache {
  private async getVersion(): Promise<string> {
    try {
      const v = await redis.get(VERSION_KEY);
      if (!v) {
        await redis.set(VERSION_KEY, '1');
        return '1';
      }
      return v;
    } catch (err: any) {
      logger.warn({ err: err.message }, '⚠️ Redis cache getVersion notice');
      return '1';
    }
  }

  async getCacheKey(params: BusinessListQuery): Promise<string> {
    const version = await this.getVersion();
    const normalized = JSON.stringify({
      q: params.q?.trim().toLowerCase() || '',
      category: params.category?.trim().toLowerCase() || '',
      city: params.city?.trim().toLowerCase() || '',
      page: params.page || 1,
      limit: params.limit || 10,
    });
    const hash = crypto.createHash('sha256').update(normalized).digest('hex').substring(0, 16);
    return `businesses:list:v${version}:${hash}`;
  }

  async get(key: string): Promise<PaginatedResult<IBusiness> | null> {
    try {
      const data = await redis.get(key);
      if (!data) return null;
      return JSON.parse(data) as PaginatedResult<IBusiness>;
    } catch (err: any) {
      logger.warn({ err: err.message }, '⚠️ Redis cache get notice (falling back to database)');
      return null;
    }
  }

  async set(key: string, result: PaginatedResult<IBusiness>): Promise<void> {
    try {
      await redis.set(key, JSON.stringify(result), 'EX', CACHE_TTL_SECONDS);
    } catch (err: any) {
      logger.warn({ err: err.message }, '⚠️ Redis cache set notice');
    }
  }

  async invalidate(): Promise<void> {
    try {
      await redis.incr(VERSION_KEY);
      // Optional: scan and remove older keys if connected
      const keys = await redis.keys('businesses:list:*');
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, '⚠️ Redis cache invalidation notice');
    }
  }
}

export const businessCache = new BusinessCache();
export default businessCache;
