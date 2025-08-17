import { createClient, RedisClientType } from 'redis';

import type { CacheValue } from './memoryStore';

export class RedisStore {
  private client: RedisClientType;

  constructor(redisUrl: string) {
    this.client = createClient({ url: redisUrl });
    this.client.on('error', (err) => {
      // Only log errors in non-test environments to reduce test noise
      if (process.env.NODE_ENV !== 'test') {
        // eslint-disable-next-line no-console
        console.error('[RedisStore] error', err);
      }
    });
  }

  async connect() {
    try {
      if (!this.client.isOpen) await this.client.connect();
    } catch (error) {
      // Redis connection failed, cache will not be available
      // This is handled gracefully by the error handling in get/set methods
    }
  }

  async get<T>(key: string): Promise<CacheValue<T> | undefined> {
    try {
      const data = await this.client.get(key);
      if (!data) return undefined;
      return JSON.parse(data) as CacheValue<T>;
    } catch (error) {
      // Redis unavailable, return undefined (cache miss)
      return undefined;
    }
  }

  async set<T>(key: string, val: CacheValue<T>, ttlSeconds: number): Promise<void> {
    try {
      await this.client.set(key, JSON.stringify(val), { EX: ttlSeconds });
    } catch (error) {
      // Redis unavailable, silently fail (no caching)
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (error) {
      // Redis unavailable, silently fail
    }
  }

  async keys(pattern = '*'): Promise<string[]> {
    try {
      const iter = this.client.scanIterator({ MATCH: pattern });
      const out: string[] = [];
      for await (const k of iter) out.push(k as string);
      return out;
    } catch (error) {
      // Redis unavailable, return empty array
      return [];
    }
  }

  stats() {
    // Redis doesn't expose key count cheaply per prefix without SCAN
    return { keys: -1 };
  }
}
