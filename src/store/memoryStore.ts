import NodeCache from 'node-cache';

export interface CacheValue<T = any> {
  value: T;
  createdAt: number;
  ttl: number; // seconds
}

export class MemoryStore {
  private cache: NodeCache;

  constructor() {
    this.cache = new NodeCache();
  }

  async get<T>(key: string): Promise<CacheValue<T> | undefined> {
    return this.cache.get<CacheValue<T>>(key);
  }

  async set<T>(key: string, val: CacheValue<T>, ttlSeconds: number): Promise<void> {
    this.cache.set(key, val, ttlSeconds);
  }

  async del(key: string): Promise<void> {
    this.cache.del(key);
  }

  async keys(pattern = '*'): Promise<string[]> {
    const keys: string[] = this.cache.keys();
    if (!pattern || pattern === '*') return keys;
    const re = wildcardToRegExp(pattern);
    return keys.filter((k: string) => re.test(k));
  }

  stats() {
    return {
      keys: this.cache.keys().length,
    };
  }
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}
