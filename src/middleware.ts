import type { ApiCacheOptions } from './config';
import { defaultConfig } from './config';
import { buildCacheKey } from './utils/keyGenerator';
import { createLogger } from './utils/logger';
import { getPayloadSize } from './utils/hash';
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

export { ApiCacheOptions, CacheValue };

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
  const pendingRequests = new Map<string, Promise<any>>();

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
    
    // Check if method is cacheable
    if (!options.methods.includes(method as any)) return true;
    
    // Check excluded paths
    if (options.excludePaths.some((p) => (req.path || req.url || '').startsWith(p))) return true;
    
    // Check auth caching disabled
    if (options.disableAuthCaching && options.getUserId?.(req)) return true;
    
    // Check custom skip predicate
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
    
    const method = (req.method || 'GET').toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return;

    // Invalidate exact matching cache key
    const key = buildCacheKey(req, { getUserId: options.getUserId! });
    await invalidateByPattern(key);

    // Invalidate related patterns for same path
    const url = req.originalUrl || req.url || '';
    const pathOnly = url.split('?')[0] || url;
    const userId = options.getUserId?.(req) || 'anon';
    
    // Invalidate GET and POST requests for this path
    await invalidateByPattern(`GET:${pathOnly}:*:*:${userId}`);
    await invalidateByPattern(`POST:${pathOnly}:*:*:${userId}`);

    // Custom invalidation patterns
    const patterns = options.getInvalidationPatterns?.(req);
    if (patterns?.length) {
      for (const p of patterns) {
        await invalidateByPattern(p);
      }
    }
  }

  function sendCachedResponse(res: any, payload: any): void {
    if (res.headersSent) return;
    
    res.set && res.set('X-Cache', 'HIT');
    if (res.json && typeof payload === 'object') {
      res.json(payload);
    } else {
      res.send(payload);
    }
  }

  async function refreshInBackground(req: any, key: string, ttl: number, next: any): Promise<void> {
    if (pendingRequests.has(key)) return; // already refreshing

    const refreshPromise = new Promise<void>((resolve) => {
      // Create a mock response to capture the fresh data
      const mockRes: any = {
        json: (data: any) => {
          try {
            const cacheVal: CacheValue = { value: data, createdAt: Date.now(), ttl };
            void writeThrough(key, cacheVal, ttl);
          } finally {
            resolve();
          }
        },
        send: (data: any) => {
          try {
            const cacheVal: CacheValue = { value: data, createdAt: Date.now(), ttl };
            void writeThrough(key, cacheVal, ttl);
          } finally {
            resolve();
          }
        },
        set: () => {},
        setHeader: () => {},
        status: () => mockRes,
        end: () => resolve(),
      };

      // Execute route handler with mock response to get fresh data
      setImmediate(() => {
        try {
          // Create a new request context for background refresh
          const mockReq = { ...req };
          next.call(null, mockReq, mockRes, () => {});
        } catch (error) {
          logger.warn && logger.warn('[background refresh failed]', error);
          resolve();
        }
      });
    }).finally(() => {
      pendingRequests.delete(key);
    });

    pendingRequests.set(key, refreshPromise);
  }

  async function middleware(req: any, res: any, next: any) {
    const method = (req.method || 'GET').toUpperCase();

    // Handle write operations (POST/PUT/PATCH/DELETE)
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      await handleInvalidateOnWrite(req);
      
      // For non-cacheable write operations, just continue
      if (method !== 'POST' || !options.cachePostPredicate?.(req)) {
        return next();
      }
    }

    // Check if request should bypass cache
    if (shouldBypass(req)) return next();

    // Get TTL (per-route or default)
    const userTtl = options.getPerRouteTtl?.(req);
    const ttl = userTtl ?? options.ttl;
    
    // Generate cache key
    const key = buildCacheKey(req, { getUserId: options.getUserId! });

    // Check cache (L1 -> L2)
    let cached = await readThrough<any>(key);

    if (cached) {
      hits++;
      const age = Math.floor((Date.now() - cached.createdAt) / 1000);
      const isExpired = age >= ttl;

      if (!isExpired) {
        // Cache hit - serve fresh data
        logger.debug && logger.debug('[cache hit]', key);
        return sendCachedResponse(res, cached.value);
      }

      // Stale-while-revalidate: serve stale data and refresh in background
      if (options.staleWhileRevalidate) {
        logger.debug && logger.debug('[cache stale]', key);
        sendCachedResponse(res, cached.value);
        
        // Refresh in background
        void refreshInBackground(req, key, ttl, next);
        return;
      }
      // else treat as cache miss and fetch fresh data
    } else {
      misses++;
      logger.debug && logger.debug('[cache miss]', key);
    }

    // Request coalescing: prevent cache stampede
    let pending = pendingRequests.get(key);
    if (!pending) {
      pending = new Promise((resolve, reject) => {
        // Hook into response methods to capture response
        const originalJson = res.json?.bind(res);
        const originalSend = res.send?.bind(res);
        let responseCaptured = false;

        const captureAndCache = (payload: any) => {
          if (responseCaptured) return payload;
          responseCaptured = true;

          try {
            // Check payload size before caching
            const size = getPayloadSize(payload);
            if (size <= options.maxPayloadSize) {
              const cacheVal: CacheValue = { value: payload, createdAt: Date.now(), ttl };
              void writeThrough(key, cacheVal, ttl);
            } else {
              logger.warn && logger.warn('[payload too large for cache]', { key, size, maxSize: options.maxPayloadSize });
            }
          } catch (e) {
            logger.warn && logger.warn('[cache set failed]', e);
          }
          
          resolve(payload);
          return payload;
        };

        // Override response methods
        res.json = function (body: any) {
          const result = captureAndCache(body);
          return originalJson ? originalJson(body) : res;
        };

        res.send = function (body: any) {
          const result = captureAndCache(body);
          return originalSend ? originalSend(body) : res;
        };

        // Call the next middleware/route handler
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
      await pending;
      // Response should have been sent by the route handler
    } catch (e) {
      return next(e);
    }
  }

  // Manual cache clearing API
  async function clearCache(pattern = '*') {
    await invalidateByPattern(pattern);
  }

  // Attach utility methods to middleware function
  return Object.assign(middleware, {
    clearCache,
    getCacheStats,
  });
}