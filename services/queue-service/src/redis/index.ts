import Redis from 'ioredis';
import { config } from '../config';
import { logger } from '@queueless/common';
import { IQueueEntryRedis } from '../types';

const isTest = config.NODE_ENV === 'test';
export const redisDb = isTest ? 3 : config.REDIS_DB;

export const redis = new Redis({
  host: config.REDIS_HOST,
  port: config.REDIS_PORT,
  password: config.REDIS_PASSWORD || undefined,
  db: redisDb,
  lazyConnect: true,
  maxRetriesPerRequest: 2,
});

redis.on('error', (err) => {
  if (config.NODE_ENV !== 'test') {
    logger.error({ err: err.message }, '[QueueRedis] Redis error');
  }
});

export class QueueRedisClient {
  public get redis() {
    return redis;
  }

  getQueueKey(businessId: string): string {
    return `queue:${businessId}`;
  }

  getEntriesKey(businessId: string): string {
    return `queue:entries:${businessId}`;
  }

  getCurrentKey(businessId: string): string {
    return `queue:current:${businessId}`;
  }

  getUserKey(customerId: string): string {
    return `queue:user:${customerId}`;
  }

  getTicketKey(businessId: string, dateKey: string): string {
    return `queue:ticket:${businessId}:${dateKey}`;
  }

  getAvgServiceKey(businessId: string): string {
    return `queue:avg_service:${businessId}`;
  }

  async getNextTicketNumber(businessId: string, dateKey: string): Promise<number> {
    const key = this.getTicketKey(businessId, dateKey);
    const num = await this.redis.incr(key);
    if (num === 1) {
      await this.redis.expire(key, 48 * 3600); // 48 hour expiry
    }
    return num;
  }

  async addEntry(businessId: string, entry: IQueueEntryRedis): Promise<void> {
    const queueKey = this.getQueueKey(businessId);
    const entriesKey = this.getEntriesKey(businessId);
    const serialized = JSON.stringify(entry);

    const pipeline = this.redis.pipeline();
    pipeline.zadd(queueKey, entry.score, entry.id);
    pipeline.hset(entriesKey, entry.id, serialized);

    if (entry.customerId) {
      const userKey = this.getUserKey(entry.customerId);
      pipeline.set(userKey, JSON.stringify({ businessId, entryId: entry.id }));
    }

    await pipeline.exec();
  }

  async popNext(businessId: string): Promise<{ prev: IQueueEntryRedis | null; next: IQueueEntryRedis | null } | null> {
    const queueKey = this.getQueueKey(businessId);
    const entriesKey = this.getEntriesKey(businessId);
    const currentKey = this.getCurrentKey(businessId);

    const luaScript = `
      local queueKey = KEYS[1]
      local entriesKey = KEYS[2]
      local currentKey = KEYS[3]

      local popped = redis.call('ZPOPMIN', queueKey, 1)
      if not popped or #popped == 0 then
        return nil
      end

      local nextId = popped[1]
      local nextData = redis.call('HGET', entriesKey, nextId)
      redis.call('HDEL', entriesKey, nextId)

      local prevData = redis.call('GET', currentKey)
      redis.call('SET', currentKey, nextData)

      return { prevData, nextData }
    `;

    const res: any = await this.redis.eval(luaScript, 3, queueKey, entriesKey, currentKey);
    if (!res) {
      return null;
    }

    const prev = res[0] ? (JSON.parse(res[0]) as IQueueEntryRedis) : null;
    const next = res[1] ? (JSON.parse(res[1]) as IQueueEntryRedis) : null;

    if (prev?.customerId) {
      await this.redis.del(this.getUserKey(prev.customerId));
    }

    return { prev, next };
  }

  async completeCurrent(businessId: string): Promise<IQueueEntryRedis | null> {
    const currentKey = this.getCurrentKey(businessId);
    const currentData = await this.redis.get(currentKey);
    if (!currentData) {
      return null;
    }

    await this.redis.del(currentKey);
    const parsed = JSON.parse(currentData) as IQueueEntryRedis;

    if (parsed.customerId) {
      await this.redis.del(this.getUserKey(parsed.customerId));
    }

    return parsed;
  }

  async skipCurrent(businessId: string): Promise<IQueueEntryRedis | null> {
    return this.completeCurrent(businessId);
  }

  async removeEntry(businessId: string, entryId: string, customerId?: string | null): Promise<boolean> {
    const queueKey = this.getQueueKey(businessId);
    const entriesKey = this.getEntriesKey(businessId);
    const userKey = customerId ? this.getUserKey(customerId) : '';

    const luaScript = `
      local queueKey = KEYS[1]
      local entriesKey = KEYS[2]
      local userKey = KEYS[3]
      local entryId = ARGV[1]
      local hasUser = ARGV[2]

      local rem = redis.call('ZREM', queueKey, entryId)
      redis.call('HDEL', entriesKey, entryId)
      if hasUser == '1' and userKey ~= '' then
        redis.call('DEL', userKey)
      end
      return rem
    `;

    const res = await this.redis.eval(
      luaScript,
      3,
      queueKey,
      entriesKey,
      userKey || 'unused',
      entryId,
      customerId ? '1' : '0'
    );

    return Number(res) > 0;
  }

  async getPosition(businessId: string, entryId: string): Promise<number | null> {
    const rank = await this.redis.zrank(this.getQueueKey(businessId), entryId);
    return rank !== null ? rank + 1 : null;
  }

  async getWaitingCount(businessId: string): Promise<number> {
    return await this.redis.zcard(this.getQueueKey(businessId));
  }

  async getCurrent(businessId: string): Promise<IQueueEntryRedis | null> {
    const data = await this.redis.get(this.getCurrentKey(businessId));
    return data ? (JSON.parse(data) as IQueueEntryRedis) : null;
  }

  async getUserActiveEntry(customerId: string): Promise<{ businessId: string; entryId: string } | null> {
    const data = await this.redis.get(this.getUserKey(customerId));
    return data ? JSON.parse(data) : null;
  }

  async getWaitingEntries(businessId: string): Promise<IQueueEntryRedis[]> {
    const queueKey = this.getQueueKey(businessId);
    const entriesKey = this.getEntriesKey(businessId);

    const ids = await this.redis.zrange(queueKey, 0, -1);
    if (!ids || ids.length === 0) {
      return [];
    }

    const entriesJson = await this.redis.hmget(entriesKey, ...ids);
    const items: IQueueEntryRedis[] = [];
    for (const json of entriesJson) {
      if (json) {
        items.push(JSON.parse(json));
      }
    }
    return items;
  }

  async getCachedAvgServiceMinutes(businessId: string): Promise<number | null> {
    const cached = await this.redis.get(this.getAvgServiceKey(businessId));
    return cached ? Number(cached) : null;
  }

  async setCachedAvgServiceMinutes(businessId: string, minutes: number): Promise<void> {
    await this.redis.set(this.getAvgServiceKey(businessId), minutes.toString(), 'EX', 60);
  }

  async clearBusinessQueue(businessId: string): Promise<void> {
    const keys = [
      this.getQueueKey(businessId),
      this.getEntriesKey(businessId),
      this.getCurrentKey(businessId),
    ];
    await this.redis.del(...keys);
  }

  /**
   * Distributed lock for rebuildQueues so concurrent instances run once
   */
  async acquireRebuildLock(ttlMs = 15000): Promise<(() => Promise<void>) | null> {
    const lockKey = 'lock:queue:rebuild';
    const token = Math.random().toString(36).substring(2);
    const res = await this.redis.set(lockKey, token, 'PX', ttlMs, 'NX');
    if (res !== 'OK') {
      return null;
    }
    return async () => {
      const lua = `
        if redis.call('get', KEYS[1]) == ARGV[1] then
          return redis.call('del', KEYS[1])
        else
          return 0
        end
      `;
      await this.redis.eval(lua, 1, lockKey, token).catch(() => {});
    };
  }

  /**
   * Acquire a temporary Redis lock for serializing queue additions per business
   */
  async acquireQueueLock(businessId: string, maxWaitMs = 10000): Promise<() => Promise<void>> {
    const lockKey = `lock:queue:join:${businessId}`;
    const token = Math.random().toString(36).substring(2);
    const ttlMs = 5000;
    const start = Date.now();

    while (Date.now() - start < maxWaitMs) {
      const res = await this.redis.set(lockKey, token, 'PX', ttlMs, 'NX');
      if (res === 'OK') {
        return async () => {
          const lua = `
            if redis.call('get', KEYS[1]) == ARGV[1] then
              return redis.call('del', KEYS[1])
            else
              return 0
            end
          `;
          await this.redis.eval(lua, 1, lockKey, token).catch(() => {});
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('QUEUE_BUSY');
  }
}

export const queueRedisClient = new QueueRedisClient();
export const queueRedis = queueRedisClient;
