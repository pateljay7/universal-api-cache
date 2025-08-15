import { createClient, RedisClientType } from 'redis';

import type { CacheValue } from './memoryStore';

export class RedisStore {
  private client: RedisClientType;

  constructor(redisUrl: string) {
    this.client = createClient({ url: redisUrl });
    this.client.on('error', (err) => {
      // eslint-disable-next-line no-console
      console.error('[RedisStore] error', err);
    });
  }

  async connect() {
    if (!this.client.isOpen) await this.client.connect();
  }

  async get<T>(key: string): Promise<CacheValue<T> | undefined> {
    const data = await this.client.get(key);
    if (!data) return undefined;
    return JSON.parse(data) as CacheValue<T>;
  }

  async set<T>(key: string, val: CacheValue<T>, ttlSeconds: number): Promise<void> {
    await this.client.set(key, JSON.stringify(val), { EX: ttlSeconds });
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async keys(pattern = '*'): Promise<string[]> {
    const iter = this.client.scanIterator({ MATCH: pattern });
    const out: string[] = [];
    for await (const k of iter) out.push(k as string);
    return out;
  }

  stats() {
    // Redis doesn't expose key count cheaply per prefix without SCAN
    return { keys: -1 };
  }
}
