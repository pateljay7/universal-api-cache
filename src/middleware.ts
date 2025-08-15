import type { ApiCacheOptions } from './config';
import { defaultConfig } from './config';
import { buildCacheKey } from './utils/keyGenerator';
import { createLogger } from './utils/logger';
import { MemoryStore, type CacheValue } from './store/memoryStore';
import { RedisStore } from './store/redisStore';

export type CacheStore = {
  get<T>(key: string): Promise<CacheValue<T> | undefined>;
  set<T>(key: string, val: CacheValue<T>, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  keys(pattern?: string): Promise<string[]>;
  stats(): { keys: number };
};

export type CacheStats = { hits: number; misses: number } & { keys: number };

const pendingRequests = new Map<string, Promise<any>>();

function getPayloadSize(payload: any): number {
  try {
    if (payload == null) return 0;
    if (typeof payload === 'string') return Buffer.byteLength(payload);
    return Buffer.byteLength(JSON.stringify(payload));
  } catch {
    return Number.MAX_SAFE_INTEGER; // avoid caching if size can't be computed
  }
}

export function apiCache(userOptions: ApiCacheOptions = {}) {
  const options = { ...defaultConfig, ...userOptions };
  const logger = createLogger(options.logger);

  const stores: CacheStore[] = [];
  const memory = options.useMemory ? new MemoryStore() : undefined;
  const redis = options.useRedis && options.redisUrl ? new RedisStore(options.redisUrl) : undefined;
  if (memory) stores.push(memory);
  if (redis) stores.push(redis);

  if (redis) void redis.connect();

  let hits = 0;
  let misses = 0;

  async function readThrough<T>(key: string): Promise<CacheValue<T> | undefined> {
    for (const store of stores) {
      const val = await store.get<T>(key);
      if (val) return val;
    }
    return undefined;
  }

  async function writeThrough<T>(key: string, value: CacheValue<T>, ttl: number) {
    await Promise.all(stores.map((s) => s.set<T>(key, value, ttl)));
  }

  function shouldBypass(req: any): boolean {
    const method = (req.method || 'GET').toUpperCase();
    if (!options.methods.includes(method as any)) return true;
    if (options.excludePaths.some((p) => (req.path || req.url || '').startsWith(p))) return true;
    if (options.disableAuthCaching && options.getUserId?.(req)) return true;
    if (options.skipCachePredicate && options.skipCachePredicate(req)) return true;
    return false;
  }

  async function invalidateByPattern(pattern: string) {
    await Promise.all(
      stores.map(async (s) => {
        const keys = await s.keys(pattern);
        await Promise.all(keys.map((k) => s.del(k)));
      }),
    );
  }

  function getCacheStats(): CacheStats {
    const keyCounts = stores.reduce((acc, s) => acc + s.stats().keys, 0);
    return { hits, misses, keys: keyCounts };
  }

  async function handleInvalidateOnWrite(req: any) {
    if (!options.invalidateOnWrite) return;

    const key = buildCacheKey(req, { getUserId: options.getUserId! });
    await invalidateByPattern(key);

    // Invalidate related GET/POST keys for same path
    const url = req.originalUrl || req.url || '';
    const pathOnly = url.split('?')[0] || url;
    await invalidateByPattern(`GET:${pathOnly}:*`);
    await invalidateByPattern(`POST:${pathOnly}:*`);

    const patterns = options.getInvalidationPatterns?.(req);
    if (patterns?.length) {
      for (const p of patterns) await invalidateByPattern(p);
    }
  }

  async function middleware(req: any, res: any, next: any) {
    const method = (req.method || 'GET').toUpperCase();

    // Writes or non-cacheable POSTs: invalidate and pass through
    const isCacheablePost = method === 'POST' && options.cachePostPredicate?.(req);
    if (['PUT', 'PATCH', 'DELETE'].includes(method) || (method === 'POST' && !isCacheablePost)) {
      await handleInvalidateOnWrite(req);
      return next();
    }

    if (shouldBypass(req)) return next();

    const userTtl = options.getPerRouteTtl?.(req);
    const ttl = userTtl ?? options.ttl;
    const key = buildCacheKey(req, { getUserId: options.getUserId! });

    // Check cache (L1 -> L2)
    let cached = await readThrough<any>(key);

    if (cached) {
      hits++;
      const age = Math.floor((Date.now() - cached.createdAt) / 1000);
      const isExpired = age >= ttl;

      if (!isExpired) {
        logger.debug(
          '[cache hit]',
          `${method}:${req.path || req.url || ''}:::${options.getUserId?.(req) || 'anon'}`,
        );
        return sendCached(res, cached.value, true);
      }

      // stale-while-revalidate
      if (options.staleWhileRevalidate) {
        logger.debug(
          '[cache stale]',
          `${method}:${req.path || req.url || ''}:::${options.getUserId?.(req) || 'anon'}`,
        );
        void refreshInBackground(req, key, ttl, next);
        return sendCached(res, cached.value, true);
      }
      // else treat as miss and proceed to fetch
    } else {
      misses++;
      logger.debug(
        '[cache miss]',
        `${method}:${req.path || req.url || ''}:::${options.getUserId?.(req) || 'anon'}`,
      );
    }

    // Request coalescing
    let pending = pendingRequests.get(key);
    if (!pending) {
      pending = new Promise((resolve, reject) => {
        // Hook into res to capture body
        const originalJson = res.json?.bind(res);
        const originalSend = res.send?.bind(res);

        const captureAndCache = (payload: any) => {
          try {
            const size = getPayloadSize(payload);
            if (size <= options.maxPayloadSize) {
              const cacheVal: CacheValue = { value: payload, createdAt: Date.now(), ttl };
              void writeThrough(key, cacheVal, ttl);
            }
          } catch (e) {
            logger.warn('[cache set failed]', e);
          }
          resolve(payload);
          return payload;
        };

        res.json = (body: any) => {
          captureAndCache(body);
          return originalJson(body);
        };
        res.send = (body: any) => {
          captureAndCache(body);
          return originalSend(body);
        };

        next();
      })
        .catch((e) => {
          pendingRequests.delete(key);
          throw e;
        })
        .finally(() => {
          pendingRequests.delete(key);
        });

      pendingRequests.set(key, pending);
    }

    try {
      const result = await pending;
      return result; // response already sent by route handler
    } catch (e) {
      return next(e);
    }
  }

  async function refreshInBackground(req: any, key: string, ttl: number, next: any) {
    if (pendingRequests.has(key)) return; // already refreshing

    const promise = new Promise<void>((resolve) => {
      const res: any = req.res;
      const original = {
        json: res.json?.bind(res),
        send: res.send?.bind(res),
        set: res.set?.bind(res),
        status: res.status?.bind(res),
        writeHead: res.writeHead?.bind(res),
        write: res.write?.bind(res),
        end: res.end?.bind(res),
      };

      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        // restore methods
        if (original.json) res.json = original.json;
        if (original.send) res.send = original.send;
        if (original.set) res.set = original.set;
        if (original.status) res.status = original.status;
        if (original.writeHead) res.writeHead = original.writeHead;
        if (original.write) res.write = original.write;
        if (original.end) res.end = original.end;
        resolve();
      };

      const capture = (payload: any) => {
        try {
          const cacheVal: CacheValue = { value: payload, createdAt: Date.now(), ttl };
          void writeThrough(key, cacheVal, ttl);
        } finally {
          finish();
        }
      };

      // override to swallow writes
      res.json = (b: any) => capture(b);
      res.send = (b: any) => capture(b);
      res.set = (..._args: any[]) => res; // no-op
      res.status = (..._args: any[]) => res; // no-op chainable
      res.writeHead = (..._args: any[]) => res; // no-op
      res.write = (..._args: any[]) => true; // no-op
      res.end = (..._args: any[]) => undefined; // no-op

      // Fallback in case route handler is skipped for any reason
      const timer = setTimeout(finish, 200);
      (timer as any).unref?.();

      // Yield to ensure client response has been sent before refresh
      setTimeout(() => next(), 0).unref?.();
    }).finally(() => pendingRequests.delete(key));

    pendingRequests.set(key, promise);
  }

  function sendCached(res: any, payload: any, addHeader = false) {
    if (res.headersSent) return; // already sent
    if (addHeader && res.set) res.set('X-Cache', 'HIT');

    // Ensure JSON response
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    if (res.set && !res.get?.('Content-Type')) res.set('Content-Type', 'application/json; charset=utf-8');
    if (res.end) return res.end(body);
    if (res.send) return res.send(body);
    return body;
  }

  async function clearCache(pattern = '*') {
    await invalidateByPattern(pattern);
  }

  return Object.assign(middleware, {
    clearCache,
    getCacheStats,
  });
}
